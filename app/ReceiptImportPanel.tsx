"use client";

import {
  Camera,
  Check,
  FileSearch,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  parseGbpAmountToPence,
  parseUkReceiptOcr,
  type ParsedUkReceipt,
  type ReceiptWarning,
} from "./taptab-receipt";
import type { ReceiptItem } from "./taptab-model";
import { inspectReceiptImage } from "./receipt-image-safety";

const MAX_ITEMS = 32;
const MAX_TOTAL_SHARES = 128;
const OCR_WATCHDOG_MS = 60_000;

type OcrWorker = Awaited<
  ReturnType<(typeof import("tesseract.js"))["createWorker"]>
>;

async function terminateOcrWorker(worker: OcrWorker | undefined): Promise<void> {
  if (!worker) return;
  try {
    await worker.terminate();
  } catch {
    // Termination is best-effort cleanup and must not replace the scan outcome.
  }
}

const DEMO_RECEIPT_TEXT = `Lina Stores Shoreditch
Table 7
Wood-fired margherita     £12.00
Truffle fries              £7.50
Burrata & tomatoes         £9.00
Bottle of house red       £14.00
Pistachio gelato           £6.00
Subtotal                  £48.50
Total                     £48.50`;

type DraftItem = {
  id: string;
  name: string;
  priceText: string;
  shareSlots: number;
};

type DraftValidationField =
  | Readonly<{ kind: "merchant" }>
  | Readonly<{ kind: "items" }>
  | Readonly<{ kind: "item-name"; itemId: string }>
  | Readonly<{ kind: "item-price"; itemId: string }>
  | Readonly<{ kind: "item-shares"; itemId: string }>;

type DraftValidation =
  | Readonly<{
      message: string;
      field: DraftValidationField;
    }>
  | Readonly<{
      items: ReceiptItem[];
      subtotalPence: number;
    }>;

export type AppliedReceipt = Readonly<{
  merchant: string;
  items: readonly ReceiptItem[];
  source: "camera" | "sample" | "manual";
  ocrWarnings: readonly ReceiptWarning[];
}>;

export type ReceiptImportPanelProps = Readonly<{
  currentMerchant: string;
  currentItems: readonly ReceiptItem[];
  disabled?: boolean;
  onApply(receipt: AppliedReceipt): void;
}>;

function poundsText(pence: number): string {
  return (pence / 100).toFixed(2);
}

function currentDraft(items: readonly ReceiptItem[]): DraftItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    priceText: poundsText(item.pricePence),
    shareSlots: item.shareSlots,
  }));
}

function applyDiscounts(
  items: DraftItem[],
  discountPence: number,
): { items: DraftItem[]; unallocatedPence: number } {
  if (discountPence <= 0) return { items, unallocatedPence: 0 };
  const adjusted = items.map((item) => ({ ...item }));
  let remaining = discountPence;
  for (let index = adjusted.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const item = adjusted[index];
    const pricePence = parseGbpAmountToPence(item.priceText) ?? 0;
    const reduction = Math.min(remaining, Math.max(0, pricePence - 1));
    if (reduction === 0) continue;
    adjusted[index] = {
      ...item,
      name: `${item.name} (after discount)`,
      priceText: poundsText(pricePence - reduction),
    };
    remaining -= reduction;
  }
  return { items: adjusted, unallocatedPence: remaining };
}

function receiptToDraft(receipt: ParsedUkReceipt): {
  merchant: string;
  items: DraftItem[];
  reconciliationWarning?: string;
} {
  const extracted = receipt.items.map((item) => ({
    id: item.id,
    name: item.name,
    priceText: poundsText(item.pricePence),
    shareSlots: 1,
  }));
  const discounted = applyDiscounts(extracted, receipt.discountTotalPence);
  const items = [...discounted.items];
  if (receipt.serviceChargePence && receipt.serviceChargePence > 0) {
    items.push({
      id: "service-charge",
      name: receipt.serviceRateBps
        ? `Service charge (${receipt.serviceRateBps / 100}%)`
        : "Service charge",
      priceText: poundsText(receipt.serviceChargePence),
      shareSlots: 1,
    });
  }
  const draftTotal = items.reduce(
    (total, item) => total + (parseGbpAmountToPence(item.priceText) ?? 0),
    0,
  );
  const expectedTotal = receipt.totalPence ?? receipt.calculatedTotalPence;
  const reconciliationWarning =
    discounted.unallocatedPence > 0
      ? "The extracted discount is larger than the usable item total. Correct the rows before applying."
      : expectedTotal !== undefined && expectedTotal !== draftTotal
        ? `The editable rows total ${poundsText(draftTotal)}, but OCR read ${poundsText(expectedTotal)}. Review the rows before applying.`
        : undefined;
  return {
    merchant: receipt.merchant ?? "",
    items,
    ...(reconciliationWarning ? { reconciliationWarning } : {}),
  };
}

function statusLabel(status: string, progress: number): string {
  const normalised = status.replaceAll("_", " ").replaceAll("-", " ");
  return `${normalised.charAt(0).toUpperCase()}${normalised.slice(1)}${
    progress > 0 ? ` · ${Math.round(progress * 100)}%` : ""
  }`;
}

function validateDraft(merchant: string, items: readonly DraftItem[]): DraftValidation {
  if (!merchant.trim() || merchant.trim().length > 100) {
    return {
      message: "Enter a merchant name between 1 and 100 characters.",
      field: { kind: "merchant" },
    };
  }
  if (items.length === 0 || items.length > MAX_ITEMS) {
    return {
      message: `Use between 1 and ${MAX_ITEMS} receipt rows.`,
      field: { kind: "items" },
    };
  }
  let totalShares = 0;
  const parsed: ReceiptItem[] = [];
  for (const [index, item] of items.entries()) {
    const name = item.name.trim();
    const pricePence = parseGbpAmountToPence(item.priceText);
    if (!name || name.length > 100) {
      return {
        message: `Enter a name between 1 and 100 characters for row ${index + 1}.`,
        field: { kind: "item-name", itemId: item.id },
      };
    }
    if (pricePence === undefined || pricePence <= 0) {
      return {
        message: `Row ${index + 1} needs a positive price with at most two decimal places.`,
        field: { kind: "item-price", itemId: item.id },
      };
    }
    if (!Number.isInteger(item.shareSlots) || item.shareSlots < 1 || item.shareSlots > 32) {
      return {
        message: `Row ${index + 1} must have between 1 and 32 shares.`,
        field: { kind: "item-shares", itemId: item.id },
      };
    }
    if (item.shareSlots > pricePence) {
      return {
        message: `Row ${index + 1} cannot have more equal shares than pennies in its price.`,
        field: { kind: "item-shares", itemId: item.id },
      };
    }
    totalShares += item.shareSlots;
    parsed.push({ id: item.id, name, pricePence, shareSlots: item.shareSlots });
  }
  if (totalShares > MAX_TOTAL_SHARES) {
    return {
      message: `This receipt has more than ${MAX_TOTAL_SHARES} total shares. Reduce the shares before applying.`,
      field: { kind: "items" },
    };
  }
  return {
    items: parsed,
    subtotalPence: parsed.reduce((sum, item) => sum + item.pricePence, 0),
  };
}

export function ReceiptImportPanel({
  currentMerchant,
  currentItems,
  disabled = false,
  onApply,
}: ReceiptImportPanelProps) {
  const [merchant, setMerchant] = useState(currentMerchant);
  const [items, setItems] = useState<DraftItem[]>(() => currentDraft(currentItems));
  const [source, setSource] = useState<AppliedReceipt["source"]>("manual");
  const [warnings, setWarnings] = useState<readonly ReceiptWarning[]>([]);
  const [reconciliationWarning, setReconciliationWarning] = useState<string>();
  const [rawText, setRawText] = useState("");
  const [imageUrl, setImageUrl] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [scanState, setScanState] = useState<
    "idle" | "loading" | "recognising" | "ready" | "error"
  >("idle");
  const [scanStatus, setScanStatus] = useState("Waiting for a receipt image");
  const [error, setError] = useState<string>();
  const receiptPanelId = useId();
  const manualSequence = useRef(0);
  const scanRequest = useRef(0);
  const workerRef = useRef<OcrWorker | undefined>(undefined);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelRequestRef = useRef<(() => void) | undefined>(undefined);
  const imageUrlRef = useRef<string | undefined>(undefined);

  const replaceImageUrl = useCallback((nextUrl?: string) => {
    const previousUrl = imageUrlRef.current;
    imageUrlRef.current = nextUrl;
    if (previousUrl && previousUrl !== nextUrl) {
      URL.revokeObjectURL(previousUrl);
    }
    setImageUrl(nextUrl);
  }, []);

  const invalidateActiveScan = useCallback(() => {
    scanRequest.current += 1;

    const cancelRequest = cancelRequestRef.current;
    cancelRequestRef.current = undefined;
    cancelRequest?.();

    if (watchdogRef.current !== undefined) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = undefined;
    }

    const worker = workerRef.current;
    workerRef.current = undefined;
    void terminateOcrWorker(worker);
  }, []);

  useEffect(
    () => () => {
      invalidateActiveScan();
    },
    [invalidateActiveScan],
  );

  useEffect(
    () => () => {
      const currentUrl = imageUrlRef.current;
      imageUrlRef.current = undefined;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    },
    [],
  );

  const validation = validateDraft(merchant, items);
  const validationError = "message" in validation ? validation : undefined;
  const validItems = "items" in validation ? validation.items : undefined;
  const validSubtotalPence =
    "subtotalPence" in validation ? validation.subtotalPence : undefined;
  const titleId = `${receiptPanelId}-title`;
  const validationErrorId = `${receiptPanelId}-draft-validation-error`;
  const applyGuidanceId = `${receiptPanelId}-apply-guidance`;
  const scanInProgress = scanState === "loading" || scanState === "recognising";
  const applyDisabledReason = disabled
    ? "Receipt editing is unavailable after item claiming ends."
    : scanInProgress
      ? "Finish or cancel the receipt scan before applying."
      : validationError
        ? `Fix the highlighted field before applying: ${validationError.message}`
        : undefined;

  const scanReceipt = async (file: File) => {
    invalidateActiveScan();
    const request = scanRequest.current;
    setError(undefined);
    setWarnings([]);
    setReconciliationWarning(undefined);
    setRawText("");
    setScanState("loading");
    setScanStatus("Checking image dimensions and file contents");
    try {
      await inspectReceiptImage(file);
    } catch (inspectionError) {
      if (scanRequest.current !== request) return;
      setScanState("error");
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : "This receipt image could not be checked safely.",
      );
      return;
    }
    if (scanRequest.current !== request) return;

    setFileName(file.name);
    replaceImageUrl(URL.createObjectURL(file));
    setScanStatus("Loading the on-device OCR engine");

    let worker: OcrWorker | undefined;
    let timedOut = false;
    let finished = false;
    let cancelRequest: (() => void) | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const isActiveRequest = () =>
      scanRequest.current === request && !timedOut && !finished;
    const cancellation = new Promise<{ kind: "cancelled" }>((resolve) => {
      cancelRequest = () => resolve({ kind: "cancelled" });
    });
    cancelRequestRef.current = cancelRequest;

    const recognition = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      if (!isActiveRequest()) return undefined;

      worker = await createWorker("eng", OEM.LSTM_ONLY, {
        logger(message) {
          if (!isActiveRequest()) return;
          setScanState(message.status === "recognizing text" ? "recognising" : "loading");
          setScanStatus(statusLabel(message.status, message.progress));
        },
      });
      if (!isActiveRequest()) {
        await terminateOcrWorker(worker);
        return undefined;
      }
      workerRef.current = worker;

      await worker.setParameters({ preserve_interword_spaces: "1" });
      if (!isActiveRequest()) return undefined;
      const result = await worker.recognize(file);
      if (!isActiveRequest()) return undefined;
      return result.data.text.trim();
    })();

    const timeout = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => {
        if (scanRequest.current !== request) return;
        timedOut = true;
        const activeWorker = workerRef.current;
        workerRef.current = undefined;
        void terminateOcrWorker(activeWorker);
        reject(
          new Error(
            "Receipt scanning took too long. Try a smaller or clearer image, or enter the rows manually.",
          ),
        );
      }, OCR_WATCHDOG_MS);
      watchdogRef.current = watchdog;
    });

    try {
      const outcome = await Promise.race([
        recognition.then((text) => ({ kind: "recognised" as const, text })),
        cancellation,
        timeout,
      ]);
      if (outcome.kind === "cancelled" || !isActiveRequest() || outcome.text === undefined) {
        return;
      }

      finished = true;
      const text = outcome.text;
      setRawText(text);
      if (!text) throw new Error("No text was recognised in this image.");
      const parsed = parseUkReceiptOcr(text);
      if (parsed.items.length === 0) {
        throw new Error("No priced receipt rows were recognised. Try a clearer, straighter image.");
      }
      const draft = receiptToDraft(parsed);
      setMerchant(draft.merchant);
      setItems(draft.items);
      setWarnings(parsed.warnings);
      setReconciliationWarning(draft.reconciliationWarning);
      setSource("camera");
      setScanState("ready");
      setScanStatus(`${parsed.items.length} priced row${parsed.items.length === 1 ? "" : "s"} extracted for review`);
    } catch (scanError) {
      if (scanRequest.current !== request) return;
      finished = true;
      setScanState("error");
      setError(
        scanError instanceof Error
          ? scanError.message
          : "This receipt could not be read. Enter the rows manually instead.",
      );
    } finally {
      if (watchdog !== undefined) {
        clearTimeout(watchdog);
      }
      if (watchdogRef.current === watchdog) {
        watchdogRef.current = undefined;
      }
      if (cancelRequestRef.current === cancelRequest) {
        cancelRequestRef.current = undefined;
      }
      if (workerRef.current === worker) {
        workerRef.current = undefined;
      }
      finished = true;
      await terminateOcrWorker(worker);
    }
  };

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void scanReceipt(file);
  };

  const loadSample = () => {
    invalidateActiveScan();
    const parsed = parseUkReceiptOcr(DEMO_RECEIPT_TEXT);
    const draft = receiptToDraft(parsed);
    setMerchant(draft.merchant);
    setItems(draft.items);
    setSource("sample");
    setWarnings(parsed.warnings);
    setReconciliationWarning(draft.reconciliationWarning);
    setRawText(DEMO_RECEIPT_TEXT);
    setFileName(undefined);
    replaceImageUrl();
    setError(undefined);
    setScanState("ready");
    setScanStatus("Sample receipt loaded for review");
  };

  const resetDraft = () => {
    invalidateActiveScan();
    setMerchant(currentMerchant);
    setItems(currentDraft(currentItems));
    setSource("manual");
    setWarnings([]);
    setReconciliationWarning(undefined);
    setRawText("");
    setFileName(undefined);
    replaceImageUrl();
    setError(undefined);
    setScanState("idle");
    setScanStatus("Waiting for a receipt image");
  };

  const cancelScan = () => {
    invalidateActiveScan();
    setRawText("");
    setFileName(undefined);
    replaceImageUrl();
    setError(undefined);
    setScanState("idle");
    setScanStatus("Receipt scan cancelled; existing rows were not changed");
  };

  const addItem = () => {
    manualSequence.current += 1;
    setItems((current) => [
      ...current,
      {
        id: `manual-${Date.now()}-${manualSequence.current}`,
        name: "New receipt item",
        priceText: "0.00",
        shareSlots: 1,
      },
    ]);
    setSource("manual");
  };

  const apply = () => {
    if (!validItems || disabled) return;
    onApply({
      merchant: merchant.trim(),
      items: validItems,
      source,
      ocrWarnings: warnings,
    });
  };

  return (
    <article className="receipt-import-panel" aria-labelledby={titleId}>
      <div className="receipt-import-intro">
        <div className="receipt-import-icon">
          <Camera size={24} />
        </div>
        <div>
          <span className="section-kicker">Receipt studio</span>
          <h3 id={titleId}>Photograph, verify, then share</h3>
          <p>
            Text recognition runs in your browser. The image is never added to the bill or
            stored by TapTab; only rows you approve enter the split.
          </p>
        </div>
        <div className="receipt-import-actions">
          <label className="scan-receipt-button">
            <Upload size={15} />
            Scan receipt
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={chooseImage}
              disabled={disabled || scanInProgress}
            />
          </label>
          {scanInProgress ? (
            <button type="button" onClick={cancelScan}>
              <X size={14} /> Cancel scan
            </button>
          ) : null}
          <button type="button" onClick={loadSample} disabled={disabled}>
            <FileSearch size={15} /> Load sample
          </button>
          <button type="button" onClick={resetDraft} disabled={disabled}>
            <RotateCcw size={14} /> Reset draft
          </button>
        </div>
      </div>

      <div className="receipt-import-workspace">
        <div className="receipt-scan-preview">
          {imageUrl ? (
            <Image
              src={imageUrl}
              width={240}
              height={300}
              unoptimized
              alt="Selected receipt awaiting confirmation"
            />
          ) : (
            <div className="receipt-scan-placeholder">
              <ReceiptText size={34} />
              <strong>No receipt image retained</strong>
              <span>JPEG, PNG or WebP · maximum 8 MB</span>
            </div>
          )}
          <div
            className={`receipt-scan-status state-${scanState}`}
            aria-live="polite"
            aria-busy={scanInProgress}
          >
            <span />
            <div>
              <strong>{fileName ?? (source === "sample" ? "Sample receipt" : "Receipt scanner")}</strong>
              <small>{scanStatus}</small>
            </div>
          </div>
          {rawText ? (
            <details className="ocr-transcript">
              <summary>Review recognised text</summary>
              <pre>{rawText}</pre>
            </details>
          ) : null}
        </div>

        <div className="receipt-review-editor">
          <div className="receipt-review-heading">
            <div>
              <span className="micro-label">Human confirmation required</span>
              <h4>Editable receipt rows</h4>
            </div>
            <strong>
              {validSubtotalPence === undefined ? "—" : `£${poundsText(validSubtotalPence)}`}
            </strong>
          </div>

          <label className="receipt-merchant-field">
            <span>Merchant</span>
            <input
              value={merchant}
              maxLength={100}
              aria-invalid={validationError?.field.kind === "merchant" || undefined}
              aria-describedby={
                validationError?.field.kind === "merchant" ? validationErrorId : undefined
              }
              onChange={(event) => {
                setMerchant(event.target.value);
                setSource("manual");
              }}
              disabled={disabled || scanInProgress}
            />
          </label>

          <div
            className="receipt-draft-rows"
            role="group"
            aria-label="Receipt items"
            aria-invalid={validationError?.field.kind === "items" || undefined}
            aria-describedby={
              validationError?.field.kind === "items" ? validationErrorId : undefined
            }
          >
            {items.map((item, index) => {
              const nameInvalid =
                validationError?.field.kind === "item-name" &&
                validationError.field.itemId === item.id;
              const priceInvalid =
                validationError?.field.kind === "item-price" &&
                validationError.field.itemId === item.id;
              const sharesInvalid =
                validationError?.field.kind === "item-shares" &&
                validationError.field.itemId === item.id;

              return (
                <div className="receipt-draft-row" key={item.id}>
                  <span>{index + 1}</span>
                  <label>
                    <span className="sr-only">Item {index + 1} name</span>
                    <input
                      value={item.name}
                      maxLength={100}
                      aria-invalid={nameInvalid || undefined}
                      aria-describedby={nameInvalid ? validationErrorId : undefined}
                      onChange={(event) => {
                        const name = event.target.value;
                        setItems((current) =>
                          current.map((candidate) =>
                            candidate.id === item.id ? { ...candidate, name } : candidate,
                          ),
                        );
                        setSource("manual");
                      }}
                      disabled={disabled || scanInProgress}
                    />
                  </label>
                  <label className="receipt-price-field">
                    <span>£</span>
                    <input
                      inputMode="decimal"
                      value={item.priceText}
                      onChange={(event) => {
                        const priceText = event.target.value;
                        setItems((current) =>
                          current.map((candidate) =>
                            candidate.id === item.id ? { ...candidate, priceText } : candidate,
                          ),
                        );
                        setSource("manual");
                      }}
                      aria-label={`${item.name || `Item ${index + 1}`} price in pounds`}
                      aria-invalid={priceInvalid || undefined}
                      aria-describedby={priceInvalid ? validationErrorId : undefined}
                      disabled={disabled || scanInProgress}
                    />
                  </label>
                  <label className="receipt-shares-field">
                    <span>Shares</span>
                    <input
                      type="number"
                      min={1}
                      max={32}
                      value={item.shareSlots}
                      aria-label={`${item.name || `Item ${index + 1}`} equal shares`}
                      aria-invalid={sharesInvalid || undefined}
                      aria-describedby={sharesInvalid ? validationErrorId : undefined}
                      onChange={(event) => {
                        const shareSlots = Number(event.target.value);
                        setItems((current) =>
                          current.map((candidate) =>
                            candidate.id === item.id ? { ...candidate, shareSlots } : candidate,
                          ),
                        );
                        setSource("manual");
                      }}
                      disabled={disabled || scanInProgress}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setItems((current) =>
                        current.filter((candidate) => candidate.id !== item.id),
                      )
                    }
                    disabled={disabled || scanInProgress || items.length <= 1}
                    aria-label={`Remove ${item.name || `item ${index + 1}`}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            className="add-receipt-row"
            type="button"
            onClick={addItem}
            disabled={disabled || scanInProgress || items.length >= MAX_ITEMS}
          >
            <Plus size={14} /> Add receipt row
          </button>

          {warnings.length || reconciliationWarning ? (
            <div className="receipt-review-warnings" role="status">
              <strong>Review before applying</strong>
              {reconciliationWarning ? <span>{reconciliationWarning}</span> : null}
              {warnings.slice(0, 3).map((warning, index) => (
                <span key={`${warning.code}-${warning.lineNumber ?? index}`}>{warning.message}</span>
              ))}
              {warnings.length > 3 ? <small>{warnings.length - 3} more OCR notes are in the transcript.</small> : null}
            </div>
          ) : null}
          {error ? (
            <p
              className="receipt-import-error"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
            >
              {error}
            </p>
          ) : null}

          {validationError ? (
            <p
              id={validationErrorId}
              className="receipt-validation-error"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
            >
              {validationError.message}
            </p>
          ) : null}

          <div className="receipt-apply-row">
            <span
              id={applyGuidanceId}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              Applying a changed receipt resets every claim and ready check so everyone can
              confirm the new bill.
              {applyDisabledReason ? ` ${applyDisabledReason}` : " The receipt is ready to apply."}
            </span>
            <button
              type="button"
              onClick={apply}
              disabled={disabled || scanInProgress || !validItems}
              aria-describedby={applyGuidanceId}
              title={applyDisabledReason}
            >
              <Check size={15} /> Apply verified receipt
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

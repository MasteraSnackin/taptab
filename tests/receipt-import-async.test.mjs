import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const receiptPanel = await readFile(
  new URL("../app/ReceiptImportPanel.tsx", import.meta.url),
  "utf8",
);

test("guards every asynchronous OCR update with one request generation", () => {
  assert.match(receiptPanel, /const scanRequest = useRef\(0\)/);
  assert.match(
    receiptPanel,
    /const isActiveRequest = \(\) =>\s+scanRequest\.current === request && !timedOut && !finished/,
  );
  assert.match(
    receiptPanel,
    /logger\(message\) \{\s+if \(!isActiveRequest\(\)\) return;/,
  );
  assert.match(
    receiptPanel,
    /const result = await worker\.recognize\(file\);\s+if \(!isActiveRequest\(\)\) return undefined;/,
  );

  const invalidations = receiptPanel.match(/invalidateActiveScan\(\);/g) ?? [];
  assert.ok(
    invalidations.length >= 5,
    "new scans, sample loading, reset, cancellation and unmount must invalidate OCR",
  );
});

test("bounds and cancels OCR without allowing cleanup errors to escape", () => {
  assert.match(receiptPanel, /const OCR_WATCHDOG_MS = 60_000/);
  assert.match(receiptPanel, /const workerRef = useRef<OcrWorker/);
  assert.match(receiptPanel, /const cancelRequestRef = useRef/);
  assert.match(receiptPanel, /await Promise\.race\(\[/);
  assert.match(
    receiptPanel,
    /async function terminateOcrWorker[\s\S]*?await worker\.terminate\(\);\s+\} catch \{[\s\S]*?\n\}/,
  );
  assert.match(receiptPanel, /> Cancel scan\s+<\/button>/);
  assert.match(receiptPanel, /aria-busy=\{scanInProgress\}/);
  assert.ok(
    (receiptPanel.match(/disabled=\{disabled \|\| scanInProgress/g) ?? []).length >= 6,
    "receipt edits and apply must stay disabled while OCR owns the draft",
  );
});

test("validates compressed image dimensions before previewing or starting OCR", () => {
  assert.match(
    receiptPanel,
    /import \{ inspectReceiptImage \} from "\.\/receipt-image-safety"/,
  );
  const inspection = receiptPanel.indexOf("await inspectReceiptImage(file)");
  const preview = receiptPanel.indexOf("URL.createObjectURL(file)");
  const ocrImport = receiptPanel.indexOf(
    'const { createWorker, OEM } = await import("tesseract.js")',
  );
  assert.ok(inspection >= 0 && inspection < preview);
  assert.ok(inspection < ocrImport);
  assert.match(receiptPanel, /Checking image dimensions and file contents/);
});

test("owns each object URL through one replacement helper and unmount cleanup", () => {
  assert.match(receiptPanel, /const imageUrlRef = useRef<string \| undefined>/);
  assert.match(
    receiptPanel,
    /const replaceImageUrl = useCallback\([\s\S]*?URL\.revokeObjectURL\(previousUrl\)/,
  );
  assert.doesNotMatch(receiptPanel, /if \(imageUrl\) URL\.revokeObjectURL/);
  assert.ok(
    (receiptPanel.match(/replaceImageUrl\(\);/g) ?? []).length >= 3,
    "sample, reset and cancellation paths must release the previous preview",
  );
});

test("exposes receipt validation errors and links them to the affected field", () => {
  assert.match(receiptPanel, /type DraftValidationField =/);
  assert.match(
    receiptPanel,
    /field: \{ kind: "item-name", itemId: item\.id \}/,
  );
  assert.match(
    receiptPanel,
    /field: \{ kind: "item-price", itemId: item\.id \}/,
  );
  assert.match(
    receiptPanel,
    /field: \{ kind: "item-shares", itemId: item\.id \}/,
  );
  assert.ok(
    (receiptPanel.match(/aria-invalid=/g) ?? []).length >= 4,
    "merchant, item group, name, price and share errors must expose invalid state",
  );
  assert.ok(
    (receiptPanel.match(/aria-describedby=/g) ?? []).length >= 5,
    "invalid fields and the Apply action must reference visible guidance",
  );
  assert.match(
    receiptPanel,
    /id=\{validationErrorId\}[\s\S]*?role="alert"[\s\S]*?aria-live="assertive"[\s\S]*?aria-atomic="true"/,
  );
});

test("explains every disabled Apply state in a polite live region", () => {
  assert.match(
    receiptPanel,
    /const applyDisabledReason = disabled[\s\S]*?: scanInProgress[\s\S]*?: validationError/,
  );
  assert.match(
    receiptPanel,
    /id=\{applyGuidanceId\}[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/,
  );
  assert.match(
    receiptPanel,
    /disabled=\{disabled \|\| scanInProgress \|\| !validItems\}[\s\S]*?aria-describedby=\{applyGuidanceId\}[\s\S]*?title=\{applyDisabledReason\}/,
  );
  assert.match(
    receiptPanel,
    /Applying a changed receipt resets every claim and ready check so everyone can/,
  );
});

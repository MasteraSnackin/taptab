"use client";

import { Download, RefreshCw, ShieldAlert, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Address } from "viem";
import type { TapTabCreateBillQuote } from "./taptab-create-bill";
import type { ReceiptItem } from "./taptab-model";
import {
  createManualTapTabQuote,
  createTapTabDemoRecoveryPack,
  parseTapTabDemoRecoveryPack,
  serialiseTapTabDemoRecoveryPack,
  tapTabRecoveryFileName,
  type ParsedTapTabDemoRecovery,
  type TapTabDemoRecoverySource,
  type TapTabQuoteAvailability,
} from "./taptab-demo-resilience";

const MAX_RECOVERY_FILE_BYTES = 256 * 1024;

export type TapTabDemoResiliencePanelProps = Readonly<{
  liveQuoteStatus: TapTabQuoteAvailability;
  manualQuote?: TapTabCreateBillQuote;
  recoverySource: TapTabDemoRecoverySource;
  trustedContractAddress?: Address;
  onManualQuoteConfirmed(quote: TapTabCreateBillQuote): void;
  onUseLiveQuote(): void;
  onRestoreReceipt(receipt: Readonly<{
    merchant: string;
    items: readonly ReceiptItem[];
  }>): void;
  onOpenRecoveredBill?(context: NonNullable<ParsedTapTabDemoRecovery["context"]>): void;
}>;

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 240);
  return "The recovery action could not be completed.";
}

function quoteTime(timestamp: number): string {
  return new Date(timestamp * 1_000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

export function TapTabDemoResiliencePanel({
  liveQuoteStatus,
  manualQuote,
  recoverySource,
  trustedContractAddress,
  onManualQuoteConfirmed,
  onUseLiveQuote,
  onRestoreReceipt,
  onOpenRecoveredBill,
}: TapTabDemoResiliencePanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [manualRate, setManualRate] = useState("");
  const [manualSource, setManualSource] = useState("");
  const [manualAcknowledged, setManualAcknowledged] = useState(false);
  const [manualError, setManualError] = useState<string>();
  const [recoveryStatus, setRecoveryStatus] = useState<string>();
  const [recoveryError, setRecoveryError] = useState<string>();

  const fallbackAvailable =
    liveQuoteStatus === "stale" || liveQuoteStatus === "unavailable";

  const confirmManualQuote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setManualError(undefined);
    try {
      const quote = createManualTapTabQuote({
        gbpPerMon: manualRate,
        sourceLabel: manualSource,
        acknowledged: manualAcknowledged,
        liveStatus: liveQuoteStatus,
        nowUnixSeconds: Math.floor(Date.now() / 1_000),
      });
      onManualQuoteConfirmed(quote);
      setRecoveryStatus(undefined);
    } catch (error) {
      setManualError(describeError(error));
    }
  };

  const downloadRecoveryPack = () => {
    setRecoveryError(undefined);
    setRecoveryStatus(undefined);
    try {
      const pack = createTapTabDemoRecoveryPack(
        recoverySource,
        Math.floor(Date.now() / 1_000),
      );
      const blob = new Blob([serialiseTapTabDemoRecoveryPack(pack)], {
        type: "application/json;charset=utf-8",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = tapTabRecoveryFileName();
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
      setRecoveryStatus(
        `Recovery pack saved with ${pack.receipt.items.length} verified receipt rows and ${pack.evidence.length} public transaction record${pack.evidence.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setRecoveryError(describeError(error));
    }
  };

  const importRecoveryPack = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRecoveryError(undefined);
    setRecoveryStatus(undefined);
    if (file.size > MAX_RECOVERY_FILE_BYTES) {
      setRecoveryError("Recovery pack exceeds the 256 KB safety limit.");
      return;
    }
    try {
      const parsed = parseTapTabDemoRecoveryPack(
        await file.text(),
        trustedContractAddress,
      );
      onRestoreReceipt(parsed.receipt);
      if (parsed.context) onOpenRecoveredBill?.(parsed.context);
      setRecoveryStatus(
        `Restored ${parsed.receipt.items.length} verified receipt rows${parsed.context ? ` and opened trusted bill #${parsed.context.billId.toString()}` : ""}. Quote provenance was checked but not activated.`,
      );
    } catch (error) {
      setRecoveryError(describeError(error));
    }
  };

  return (
    <section className="demo-resilience" aria-labelledby="demo-resilience-title">
      <header className="demo-resilience-header">
        <div>
          <span className="section-kicker">Demo resilience</span>
          <h3 id="demo-resilience-title">Recover the pitch without weakening the proof.</h3>
        </div>
        <span className="demo-resilience-badge">No wallet required</span>
      </header>

      <div className="demo-resilience-grid">
        <article className={`manual-quote-card${manualQuote ? " is-active" : ""}`}>
          <div className="demo-resilience-card-heading">
            <ShieldAlert size={20} aria-hidden="true" />
            <div>
              <span>Manual quote fallback</span>
              <strong>
                {manualQuote
                  ? `Active at £${manualQuote.gbpPerMon} per MON`
                  : fallbackAvailable
                    ? "Available because the live quote is not current"
                    : "Live CoinGecko pricing is preferred"}
              </strong>
            </div>
          </div>

          {manualQuote ? (
            <div className="manual-quote-active" role="status">
              <span>Explicit manual rate</span>
              <strong>£{manualQuote.gbpPerMon} per MON</strong>
              <small>
                {manualQuote.source} · confirmed {quoteTime(manualQuote.observedAtUnixSeconds)}
              </small>
              <button type="button" onClick={onUseLiveQuote}>
                <RefreshCw size={14} aria-hidden="true" />
                {liveQuoteStatus === "live" ? "Return to live quote" : "Stop using manual rate"}
              </button>
            </div>
          ) : null}

          <form onSubmit={confirmManualQuote}>
            <label>
              Exact GBP value of 1 MON
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.025"
                value={manualRate}
                disabled={!fallbackAvailable}
                onChange={(event) => setManualRate(event.target.value)}
                aria-describedby="manual-rate-help"
              />
            </label>
            <small id="manual-rate-help">
              Plain positive decimal only, with no £ sign, comma or exponent notation.
            </small>
            <label>
              Source label
              <input
                type="text"
                autoComplete="off"
                maxLength={70}
                placeholder="CoinGecko screen checked by host"
                value={manualSource}
                disabled={!fallbackAvailable}
                onChange={(event) => setManualSource(event.target.value)}
              />
            </label>
            <label className="manual-quote-acknowledgement">
              <input
                type="checkbox"
                checked={manualAcknowledged}
                disabled={!fallbackAvailable}
                onChange={(event) => setManualAcknowledged(event.target.checked)}
              />
              <span>I confirm this rate was entered manually and is not an oracle price.</span>
            </label>
            <button
              type="submit"
              className="demo-resilience-primary"
              disabled={!fallbackAvailable || !manualRate || !manualSource || !manualAcknowledged}
            >
              Confirm manual rate now
            </button>
            {manualError ? <p className="demo-resilience-error" role="alert">{manualError}</p> : null}
          </form>
          <p className="demo-resilience-warning">
            Testnet MON has no redeemable cash value. This fallback only converts the familiar
            GBP receipt into native Testnet MON amounts for the demonstration.
          </p>
        </article>

        <article className="recovery-pack-card">
          <div className="demo-resilience-card-heading">
            <Download size={20} aria-hidden="true" />
            <div>
              <span>Pitch recovery pack</span>
              <strong>Public receipt state and Monad evidence only</strong>
            </div>
          </div>
          <p>
            Save a small JSON pack before the pitch. It contains the verified receipt, share
            counts, trusted bill link, quote provenance and recent public transaction hashes when
            available.
          </p>
          <div className="recovery-pack-actions">
            <button type="button" className="demo-resilience-primary" onClick={downloadRecoveryPack}>
              <Download size={15} aria-hidden="true" /> Download recovery pack
            </button>
            <button type="button" onClick={() => importInputRef.current?.click()}>
              <Upload size={15} aria-hidden="true" /> Import recovery pack
            </button>
            <input
              ref={importInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={importRecoveryPack}
              aria-label="Choose a TapTab demo recovery JSON file"
            />
          </div>
          <ul>
            <li>No wallet keys, private diner names or browser history are exported.</li>
            <li>An imported bill opens only if it uses this build&apos;s trusted contract.</li>
            <li>Imported quote provenance is never activated as a fresh price.</li>
          </ul>
          <p className="recovery-pack-proof-note">
            A recovery pack helps restore the presentation. It is not chain proof; use the linked
            Monad explorer transactions as evidence.
          </p>
          {recoveryStatus ? <p className="demo-resilience-success" role="status">{recoveryStatus}</p> : null}
          {recoveryError ? <p className="demo-resilience-error" role="alert">{recoveryError}</p> : null}
        </article>
      </div>
    </section>
  );
}

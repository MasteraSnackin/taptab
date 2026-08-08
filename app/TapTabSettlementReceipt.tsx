"use client";

import {
  Check,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  RotateCcw,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useRef, useState } from "react";
import {
  createTapTabSettlementReceiptText,
  tapTabSettlementReceiptFileName,
  tapTabSettlementReceiptLines,
  validateTapTabSettlementReceipt,
  type TapTabSettlementReceiptInput,
} from "./taptab-settlement-receipt";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

function money(pence: number) {
  return GBP.format(pence / 100);
}

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maximumWidth: number,
  lineHeight: number,
) {
  const words = value.split(/\s+/u);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maximumWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  lines.slice(0, 3).forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return Math.min(lines.length, 3) * lineHeight;
}

async function loadQrImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The receipt QR could not be drawn."));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type TapTabSettlementReceiptProps = Readonly<{
  receipt: TapTabSettlementReceiptInput;
  onShare?: () => void | Promise<void>;
  onReset?: () => void;
}>;

export function TapTabSettlementReceipt({
  receipt: receiptInput,
  onShare,
  onReset,
}: TapTabSettlementReceiptProps) {
  const receipt = useMemo(
    () => validateTapTabSettlementReceipt(receiptInput),
    [receiptInput],
  );
  const [includePrivateIdentity, setIncludePrivateIdentity] = useState(false);
  const [downloadState, setDownloadState] = useState<
    "ready" | "drawing" | "downloaded" | "error"
  >("ready");
  const qrRef = useRef<HTMLDivElement>(null);
  const lines = tapTabSettlementReceiptLines(receipt, { includePrivateIdentity });
  const hasPrivateIdentity =
    receipt.identityIsPrivate === true &&
    receipt.allocations.some((allocation) => Boolean(allocation.walletAddress));

  async function downloadImage() {
    const qr = qrRef.current?.querySelector("svg");
    if (!(qr instanceof SVGSVGElement)) {
      setDownloadState("error");
      return;
    }
    setDownloadState("drawing");
    try {
      const width = 1_200;
      const rowHeight = 92;
      const height = 620 + lines.length * rowHeight;
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image drawing is unavailable in this browser.");
      context.scale(scale, scale);
      context.fillStyle = "#f3f0e9";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#fffdf9";
      context.beginPath();
      context.roundRect(60, 48, width - 120, height - 96, 34);
      context.fill();
      context.strokeStyle = "rgba(17, 23, 34, 0.16)";
      context.lineWidth = 2;
      context.stroke();

      context.fillStyle = "#0e6574";
      context.beginPath();
      context.roundRect(104, 92, 64, 64, 18);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "800 32px Arial";
      context.textAlign = "center";
      context.fillText("T", 136, 136);
      context.textAlign = "left";
      context.fillStyle = "#111722";
      context.font = "800 30px Arial";
      context.fillText("TapTab settlement receipt", 190, 122);
      context.fillStyle = "#5c626d";
      context.font = "500 19px Arial";
      context.fillText(`${receipt.merchant} · ${receipt.tableLabel}`, 190, 152);

      context.fillStyle = "#111722";
      context.font = "800 52px Arial";
      context.fillText(money(receipt.totalDuePence), 104, 232);
      context.fillStyle = "#0f7b62";
      context.font = "700 19px Arial";
      context.fillText("SETTLED IN FULL", 104, 264);
      context.fillStyle = "#5c626d";
      context.font = "500 18px Arial";
      context.fillText(
        `Subtotal ${money(receipt.subtotalPence)} · Tip ${money(receipt.tipPence)}`,
        104,
        298,
      );

      let y = 356;
      context.strokeStyle = "rgba(17, 23, 34, 0.12)";
      for (const line of lines) {
        context.beginPath();
        context.moveTo(104, y - 22);
        context.lineTo(width - 104, y - 22);
        context.stroke();
        context.fillStyle = "#111722";
        context.font = "700 22px Arial";
        context.fillText(line.label, 104, y + 4);
        context.textAlign = "right";
        context.fillText(money(line.totalDuePence), width - 104, y + 4);
        context.textAlign = "left";
        context.fillStyle = "#5c626d";
        context.font = "500 16px Arial";
        const detail = [
          `Self-paid ${money(line.selfPaidPence)}`,
          line.sponsoredByOthersPence > 0
            ? `Sponsored for them ${money(line.sponsoredByOthersPence)}`
            : undefined,
          line.sponsoredForOthersPence > 0
            ? `They sponsored ${money(line.sponsoredForOthersPence)}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        context.fillText(detail, 104, y + 34);
        if (line.walletAddress) {
          context.font = "500 14px monospace";
          context.fillText(line.walletAddress, 104, y + 60);
        }
        y += rowHeight;
      }

      context.strokeStyle = "rgba(17, 23, 34, 0.12)";
      context.beginPath();
      context.moveTo(104, y - 20);
      context.lineTo(width - 104, y - 20);
      context.stroke();
      const qrImage = await loadQrImage(qr);
      context.drawImage(qrImage, width - 308, y + 10, 180, 180);
      context.fillStyle = "#111722";
      context.font = "700 20px Arial";
      context.fillText(
        receipt.evidence.kind === "monad"
          ? "Confirmed on Monad Testnet"
          : "Local sample receipt",
        104,
        y + 36,
      );
      context.fillStyle = "#5c626d";
      context.font = "500 16px Arial";
      if (receipt.evidence.kind === "monad") {
        context.fillText(
          `Chain ${receipt.evidence.chainId} · Bill ${receipt.evidence.billId.toString()} · Block ${receipt.evidence.blockNumber.toString()}`,
          104,
          y + 68,
        );
        context.font = "500 14px monospace";
        context.fillText(shortHash(receipt.evidence.transactionHash), 104, y + 98);
      } else {
        context.font = "500 16px Arial";
        drawWrappedText(context, receipt.evidence.message, 104, y + 68, 620, 24);
      }
      context.fillStyle = "#5c626d";
      context.font = "500 14px Arial";
      context.fillText(
        includePrivateIdentity
          ? "Identity details were included by explicit choice."
          : "Privacy-safe copy: wallet addresses and private labels are hidden.",
        104,
        height - 102,
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (candidate) =>
            candidate ? resolve(candidate) : reject(new Error("The receipt image was empty.")),
          "image/png",
        );
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = tapTabSettlementReceiptFileName(receipt);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setDownloadState("downloaded");
      window.setTimeout(() => setDownloadState("ready"), 1_800);
    } catch {
      setDownloadState("error");
    }
  }

  const copyText = createTapTabSettlementReceiptText(receipt, {
    includePrivateIdentity,
  });

  return (
    <article className="settled-receipt settlement-receipt-card">
      <div className="settlement-receipt-heading">
        <div className="settled-receipt-mark" aria-hidden="true">
          <Check size={32} />
        </div>
        <div>
          <span className="section-kicker">
            {receipt.evidence.kind === "monad"
              ? "Confirmed settlement receipt"
              : "Sample settlement receipt"}
          </span>
          <h3>Paid together. Nothing left to chase.</h3>
          <p>
            {receipt.merchant} settled for {money(receipt.totalDuePence)}. The
            breakdown shows who paid their own part and who sponsored someone else.
          </p>
        </div>
      </div>

      <div className="settlement-receipt-body">
        <section className="settlement-receipt-breakdown" aria-label="Final GBP breakdown">
          <div className="settled-receipt-summary">
            <div>
              <span>Subtotal</span>
              <strong>{money(receipt.subtotalPence)}</strong>
            </div>
            <div>
              <span>Group tip</span>
              <strong>{money(receipt.tipPence)}</strong>
            </div>
            <div>
              <span>Funded</span>
              <strong>{money(receipt.fundedPence)}</strong>
            </div>
            <div>
              <span>Group status</span>
              <strong>Settled</strong>
            </div>
          </div>

          <ol className="settlement-allocation-list">
            {lines.map((line, index) => (
              <li key={receipt.allocations[index]?.id ?? `${line.label}-${index}`}>
                <span>
                  <strong>{line.label}</strong>
                  {line.walletAddress ? <small>{line.walletAddress}</small> : null}
                  <small>
                    Self-paid {money(line.selfPaidPence)}
                    {line.sponsoredByOthersPence > 0
                      ? ` · ${money(line.sponsoredByOthersPence)} sponsored for them`
                      : ""}
                    {line.sponsoredForOthersPence > 0
                      ? ` · sponsored ${money(line.sponsoredForOthersPence)} for others`
                      : ""}
                  </small>
                </span>
                <strong>{money(line.totalDuePence)}</strong>
              </li>
            ))}
          </ol>
        </section>

        <aside className="settlement-proof-card" aria-label="Settlement evidence">
          <div className="settlement-qr" ref={qrRef}>
            <QRCodeSVG
              value={receipt.receiptUrl}
              size={156}
              level="M"
              marginSize={2}
              title="QR code to open this TapTab receipt"
            />
          </div>
          {receipt.evidence.kind === "monad" ? (
            <>
              <span className="confirmed-evidence-chip">
                <ShieldCheck size={14} /> Confirmed on Monad Testnet
              </span>
              <strong>Block {receipt.evidence.blockNumber.toString()}</strong>
              <code>{shortHash(receipt.evidence.transactionHash)}</code>
              <a href={receipt.evidence.explorerUrl} target="_blank" rel="noreferrer">
                View settlement transaction <ExternalLink size={14} />
              </a>
            </>
          ) : (
            <>
              <span className="preview-evidence-chip">Local sample</span>
              <strong>No blockchain transaction</strong>
              <p>{receipt.evidence.message}</p>
            </>
          )}
          <a href={receipt.receiptUrl} className="receipt-open-link">
            Open receipt link <ExternalLink size={14} />
          </a>
        </aside>
      </div>

      {hasPrivateIdentity ? (
        <label className="receipt-privacy-toggle">
          <input
            type="checkbox"
            checked={includePrivateIdentity}
            onChange={(event) => setIncludePrivateIdentity(event.target.checked)}
          />
          <span>
            {includePrivateIdentity ? <Eye size={16} /> : <EyeOff size={16} />}
            <span>
              <strong>Include private labels and wallet addresses</strong>
              <small>
                Off by default. Turning this on also includes them in the downloaded image.
              </small>
            </span>
          </span>
        </label>
      ) : null}

      <div className="settled-receipt-actions">
        {onShare ? (
          <button type="button" className="primary-cta" onClick={() => void onShare()}>
            <Share2 size={16} /> Share receipt link
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-cta"
          onClick={() => void downloadImage()}
          disabled={downloadState === "drawing"}
        >
          <Download size={16} />
          {downloadState === "drawing"
            ? "Drawing image…"
            : downloadState === "downloaded"
              ? "Image downloaded"
              : "Download receipt image"}
        </button>
        {onReset ? (
          <button type="button" className="secondary-cta" onClick={onReset}>
            <RotateCcw size={15} /> Reset sample
          </button>
        ) : null}
      </div>
      {downloadState === "error" ? (
        <p className="field-error" role="alert">
          This browser could not create the image. The selectable receipt text remains below.
        </p>
      ) : null}
      <details className="receipt-text-fallback">
        <summary>Copyable receipt text</summary>
        <textarea
          readOnly
          value={copyText}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Copyable settlement receipt"
        />
      </details>
    </article>
  );
}

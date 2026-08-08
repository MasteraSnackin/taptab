"use client";

import { Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type {
  BillParticipant,
  BillPayment,
  ItemClaim,
  ReceiptItem,
} from "./taptab-model";
import {
  createTapTabLocalJudgeEvidence,
  serialiseTapTabLocalJudgeEvidence,
  tapTabLocalJudgeEvidenceFileName,
  type TapTabLocalPhase,
} from "./taptab-local-evidence";

export type TapTabLocalEvidencePanelProps = Readonly<{
  merchant: string;
  items: readonly ReceiptItem[];
  participants: readonly BillParticipant[];
  claims: readonly ItemClaim[];
  payments: readonly BillPayment[];
  approvedParticipantIds: readonly string[];
  refundedPayerIds: readonly string[];
  splitRevision: number;
  phase: TapTabLocalPhase;
}>;

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 240);
  return "The local evidence file could not be created.";
}

export function TapTabLocalEvidencePanel(props: TapTabLocalEvidencePanelProps) {
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const downloadEvidence = () => {
    setStatus(undefined);
    setError(undefined);
    try {
      const now = new Date();
      const evidence = createTapTabLocalJudgeEvidence(
        props,
        Math.floor(now.getTime() / 1_000),
      );
      if (!evidence.allInvariantsPass) {
        throw new Error("The local preview failed an integrity check and was not exported.");
      }
      const blob = new Blob([serialiseTapTabLocalJudgeEvidence(evidence)], {
        type: "application/json;charset=utf-8",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = tapTabLocalJudgeEvidenceFileName(now);
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
      setStatus(
        `Local evidence saved with ${evidence.invariants.filter(({ pass }) => pass).length} passing integrity checks.`,
      );
    } catch (nextError) {
      setError(describeError(nextError));
    }
  };

  return (
    <section className="demo-resilience local-evidence-panel" aria-labelledby="local-evidence-title">
      <header className="demo-resilience-header">
        <div>
          <span className="section-kicker">Local judge evidence</span>
          <h3 id="local-evidence-title">Save the preview without overstating the proof.</h3>
        </div>
        <span className="demo-resilience-badge">No wallet required</span>
      </header>

      <div className="demo-resilience-grid">
        <article className="recovery-pack-card local-evidence-card">
          <div className="demo-resilience-card-heading">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <span>Current sample snapshot</span>
              <strong>Receipt, allocation, funding and invariant checks</strong>
            </div>
          </div>
          <p>
            Download the current local sample as a self-contained JSON record. It deliberately
            contains no chain, contract, wallet, transaction, explorer or price claims.
          </p>
          <div className="recovery-pack-actions">
            <button type="button" className="demo-resilience-primary" onClick={downloadEvidence}>
              <Download size={15} aria-hidden="true" /> Download local evidence
            </button>
          </div>
          <ul>
            <li>Derived totals are recalculated when the file is created.</li>
            <li>Every conservation and settlement check records expected and actual values.</li>
            <li>The file cannot be imported as live Monad evidence.</li>
          </ul>
          <p className="recovery-pack-proof-note">
            Use this to explain the deterministic preview. The separate Hardhat rehearsal exercises
            the Solidity contract locally.
          </p>
          {status ? <p className="demo-resilience-success" role="status">{status}</p> : null}
          {error ? <p className="demo-resilience-error" role="alert">{error}</p> : null}
        </article>
      </div>
    </section>
  );
}

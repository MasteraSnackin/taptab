"use client";

import { useEffect } from "react";
import Link from "next/link";

type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function RouteError({ error, reset }: RouteErrorProps) {
  useEffect(() => {
    console.error("[TapTab] Route error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error.digest, error.message]);

  return (
    <main className="route-error-shell">
      <section
        className="route-error-card"
        role="alert"
        aria-labelledby="route-error-title"
        aria-describedby="route-error-message route-error-transaction-note"
      >
        <Link className="route-error-brand" href="/" aria-label="TapTab home">
          <span aria-hidden="true">TT</span>
          TapTab
        </Link>

        <p className="route-error-kicker">Recovery</p>
        <h1 id="route-error-title">TapTab hit a snag.</h1>
        <p id="route-error-message" className="route-error-message">
          This page could not continue. Your wallet or transaction status may not have changed.
        </p>

        <p id="route-error-transaction-note" className="route-error-warning">
          <strong>Before repeating a submitted transaction:</strong> check its status in
          MonadVision and your wallet to avoid a duplicate action.
        </p>

        <div className="route-error-actions">
          <button type="button" onClick={reset}>
            Retry
          </button>
          <Link href="/#bill">Open sample mode</Link>
        </div>
      </section>
    </main>
  );
}

"use client";

import { Check, ExternalLink } from "lucide-react";

export type TapTabHostJourneyStatus = "complete" | "ready" | "waiting";

export type TapTabHostJourneyAction = Readonly<{
  detail: string;
  status: TapTabHostJourneyStatus;
  href: string;
  onOpen?(): void;
  external?: boolean;
  disabled?: boolean;
}>;

export type TapTabHostJourneyProps = Readonly<{
  wallet: TapTabHostJourneyAction;
  receipt: TapTabHostJourneyAction;
  quote: TapTabHostJourneyAction;
  createBill: TapTabHostJourneyAction;
  invitations: TapTabHostJourneyAction;
  participation: TapTabHostJourneyAction;
  payment: TapTabHostJourneyAction;
  proof: TapTabHostJourneyAction;
}>;

const STATUS_LABELS: Readonly<Record<TapTabHostJourneyStatus, string>> = {
  complete: "Confirmed",
  ready: "Ready",
  waiting: "Waiting",
};

export function TapTabHostJourney({
  wallet,
  receipt,
  quote,
  createBill,
  invitations,
  participation,
  payment,
  proof,
}: TapTabHostJourneyProps) {
  const steps = [
    {
      id: "wallet",
      label: "Sign in and switch network",
      actionLabel: "Open wallet sign-in",
      ...wallet,
    },
    {
      id: "receipt",
      label: "Fill bill details",
      actionLabel: "Edit receipt fields",
      ...receipt,
    },
    {
      id: "quote",
      label: "Review locked quote",
      actionLabel: "Review quote",
      ...quote,
    },
    {
      id: "create",
      label: "Create Testnet bill",
      actionLabel: "Create bill",
      ...createBill,
    },
    {
      id: "invite",
      label: "Fill participant wallets",
      actionLabel: "Open wallet fields",
      ...invitations,
    },
    {
      id: "participation",
      label: "Join, claim and approve",
      actionLabel: "Open participant actions",
      ...participation,
    },
    {
      id: "payment",
      label: "Pay and settle",
      actionLabel: "Open protected payment",
      ...payment,
    },
    {
      id: "proof",
      label: "Show Testnet proof",
      actionLabel: "Open transaction",
      ...proof,
    },
  ] as const;

  return (
    <section
      className="host-journey"
      aria-labelledby="host-journey-title"
      data-testid="testnet-demo-guide"
    >
      <header className="host-journey-header">
        <div>
          <span className="section-kicker">Live Testnet demo</span>
          <h3 id="host-journey-title">From sign-in to explorer proof</h3>
          <p>
            Fill the linked fields, approve each wallet request and finish on a confirmed Monad
            transaction that judges can inspect independently.
          </p>
        </div>
        <span className="host-journey-count">Eight linked checks</span>
      </header>

      <ol aria-label="Eight-step live Testnet checklist">
        {steps.map((step, index) => (
          <li key={step.id} data-status={step.status}>
            <a
              href={step.href}
              data-testid={`testnet-demo-step-${step.id}`}
              aria-disabled={step.disabled || undefined}
              tabIndex={step.disabled ? -1 : undefined}
              onClick={(event) => {
                if (step.disabled) {
                  event.preventDefault();
                  return;
                }
                if (step.onOpen) {
                  event.preventDefault();
                  step.onOpen();
                }
              }}
              {...(step.external
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              <span className="host-journey-number" aria-hidden="true">
                {step.status === "complete" ? <Check size={14} /> : index + 1}
              </span>
              <span className="host-journey-copy">
                <span className="host-journey-status">
                  {STATUS_LABELS[step.status]}
                </span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
                <span className="host-journey-action">
                  {step.actionLabel}
                  {step.external ? <ExternalLink size={12} aria-hidden="true" /> : null}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

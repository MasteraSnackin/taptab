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
  receipt: TapTabHostJourneyAction;
  quote: TapTabHostJourneyAction;
  createBill: TapTabHostJourneyAction;
  invitations: TapTabHostJourneyAction;
  audience: TapTabHostJourneyAction;
}>;

const STATUS_LABELS: Readonly<Record<TapTabHostJourneyStatus, string>> = {
  complete: "Confirmed",
  ready: "Ready",
  waiting: "Waiting",
};

export function TapTabHostJourney({
  receipt,
  quote,
  createBill,
  invitations,
  audience,
}: TapTabHostJourneyProps) {
  const steps = [
    {
      id: "receipt",
      label: "Verify receipt",
      actionLabel: "Open receipt",
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
      label: "Invite wallets",
      actionLabel: "Open invitations",
      ...invitations,
    },
    {
      id: "audience",
      label: "Open trusted audience view",
      actionLabel: "Open audience view",
      ...audience,
    },
  ] as const;

  return (
    <section className="host-journey" aria-labelledby="host-journey-title">
      <header className="host-journey-header">
        <div>
          <span className="section-kicker">Host checklist</span>
          <h3 id="host-journey-title">Take the verified receipt live</h3>
          <p>
            Follow each linked check before sharing the contract-backed bill with the table.
          </p>
        </div>
        <span className="host-journey-count">Five linked checks</span>
      </header>

      <ol aria-label="Five-step host checklist">
        {steps.map((step, index) => (
          <li key={step.id} data-status={step.status}>
            <a
              href={step.href}
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

import {
  calculateTapTabPreview,
  type BillParticipant,
  type BillPayment,
  type ItemClaim,
  type ReceiptItem,
} from "./taptab-model.ts";

export type TapTabLocalPhase =
  | "claiming"
  | "funding"
  | "settled"
  | "cancelled"
  | "expired";

export type TapTabLocalEvidenceInput = Readonly<{
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

function cleanText(value: string, label: string): string {
  const text = value.normalize("NFC");
  if (
    !text ||
    text.trim() !== text ||
    text.length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(text)
  ) {
    throw new TypeError(`${label} must be a clean 1 to 100 character value.`);
  }
  return text;
}

function checkedIds(
  values: readonly string[],
  allowed: ReadonlySet<string>,
  label: string,
): readonly string[] {
  const seen = new Set<string>();
  return values.map((value) => {
    if (!allowed.has(value)) throw new TypeError(`${label} contains an unknown identifier.`);
    if (seen.has(value)) throw new TypeError(`${label} contains a duplicate participant.`);
    seen.add(value);
    return value;
  });
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function invariant(name: string, expected: number | boolean, actual: number | boolean) {
  return {
    name,
    expected,
    actual,
    pass: Object.is(expected, actual),
  };
}

export function createTapTabLocalJudgeEvidence(
  input: TapTabLocalEvidenceInput,
  exportedAtUnixSeconds: number,
) {
  if (!Number.isSafeInteger(exportedAtUnixSeconds) || exportedAtUnixSeconds <= 0) {
    throw new RangeError("Local evidence timestamp must be a positive Unix timestamp.");
  }
  if (!Number.isSafeInteger(input.splitRevision) || input.splitRevision < 1) {
    throw new RangeError("Local split revision must be a positive safe integer.");
  }

  const participantIds = new Set(input.participants.map(({ id }) => id));
  const approvedParticipantIds = checkedIds(
    input.approvedParticipantIds,
    participantIds,
    "Local approvals",
  );
  const contributorIds = new Set(input.payments.map(({ payerId }) => payerId));
  const refundedPayerIds = checkedIds(
    input.refundedPayerIds,
    contributorIds,
    "Local refunds",
  );
  const preview = calculateTapTabPreview({
    items: input.items,
    participants: input.participants,
    claims: input.claims,
    payments: input.payments,
  });

  const contributorTotals = new Map(
    preview.contributors.map(({ payerId, contributedPence }) => [
      payerId,
      contributedPence,
    ]),
  );
  const refundedPence = sum(
    refundedPayerIds.map((payerId) => contributorTotals.get(payerId) ?? 0),
  );
  const receiptSubtotal = sum(input.items.map(({ pricePence }) => pricePence));
  const participantBaseTotal = sum(
    preview.participants.map(({ baseDuePence }) => baseDuePence),
  );
  const participantTipTotal = sum(
    preview.participants.map(({ tipPence }) => tipPence),
  );
  const participantDueTotal = sum(
    preview.participants.map(({ totalDuePence }) => totalDuePence),
  );
  const beneficiaryFundingTotal = sum(
    preview.participants.map(({ creditedPence }) => creditedPence),
  );
  const contributorFundingTotal = sum(
    preview.contributors.map(({ contributedPence }) => contributedPence),
  );
  const invariants = [
    invariant("receipt subtotal conservation", receiptSubtotal, preview.subtotalPence),
    invariant("participant base conservation", preview.subtotalPence, participantBaseTotal),
    invariant("participant tip conservation", preview.tipPence, participantTipTotal),
    invariant("participant due conservation", preview.totalDuePence, participantDueTotal),
    invariant(
      "beneficiary funding conservation",
      preview.funding.fundedPence,
      beneficiaryFundingTotal,
    ),
    invariant(
      "contributor funding conservation",
      preview.funding.fundedPence,
      contributorFundingTotal,
    ),
    invariant(
      "settlement guard",
      preview.funding.fundedPence === preview.totalDuePence,
      preview.funding.canSettle,
    ),
    invariant("refunds do not exceed funding", true, refundedPence <= preview.funding.fundedPence),
    invariant(
      "settled phase requires complete funding",
      true,
      input.phase !== "settled" || preview.funding.canSettle,
    ),
  ];

  return deepFreeze({
    schema: "taptab-local-judge-evidence" as const,
    version: 1 as const,
    scope: "local-preview" as const,
    notice:
      "Deterministic local preview only — not Monad, deployment, wallet, transaction or explorer proof." as const,
    exportedAtUnixSeconds,
    receipt: {
      merchant: cleanText(input.merchant, "Merchant"),
      items: input.items.map(({ name, pricePence, shareSlots }) => ({
        name: cleanText(name, "Receipt item name"),
        pricePence,
        shareSlots,
      })),
    },
    state: {
      phase: input.phase,
      splitRevision: input.splitRevision,
      approvedParticipantIds,
      refundedPayerIds,
      participants: input.participants.map(
        ({ id, name, remainderOptIn, tipVoteBps }) => ({
          id,
          name: cleanText(name, "Participant name"),
          remainderOptIn,
          tipVoteBps,
        }),
      ),
      claims: input.claims.map(({ participantId, itemId, shareIndexes }) => ({
        participantId,
        itemId,
        shareIndexes: [...shareIndexes],
      })),
      payments: input.payments.map(({ payerId, beneficiaryId, amountPence }) => ({
        payerId,
        beneficiaryId,
        amountPence,
      })),
    },
    derived: {
      subtotalPence: preview.subtotalPence,
      medianTipVoteBps: preview.medianTipVoteBps,
      tipPence: preview.tipPence,
      totalDuePence: preview.totalDuePence,
      unclaimedPence: preview.unclaimedPence,
      fundedPence: preview.funding.fundedPence,
      remainingPence: preview.funding.remainingPence,
      canSettle: preview.funding.canSettle,
      refundedPence,
      participantAllocations: preview.participants.map((participant) => ({
        participantId: participant.participantId,
        claimedPence: participant.claimedPence,
        remainderPence: participant.remainderPence,
        baseDuePence: participant.baseDuePence,
        tipPence: participant.tipPence,
        totalDuePence: participant.totalDuePence,
        creditedPence: participant.creditedPence,
        unpaidPence: participant.unpaidPence,
      })),
      contributorTotals: preview.contributors.map((contributor) => ({ ...contributor })),
    },
    invariants,
    allInvariantsPass: invariants.every(({ pass }) => pass),
  });
}

export function serialiseTapTabLocalJudgeEvidence(
  evidence: ReturnType<typeof createTapTabLocalJudgeEvidence>,
): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export function tapTabLocalJudgeEvidenceFileName(date = new Date()): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("Local evidence date is invalid.");
  return `taptab-local-judge-evidence-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

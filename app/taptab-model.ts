/**
 * Pure, integer-only TapTab bill allocation.
 *
 * All money is GBP pence. Participant array order is contract join order and
 * receives fair-remainder and tip dust. Item claims store exact zero-based share
 * indexes, matching the contract even when someone deliberately claims a later
 * slot whose integer value differs from an earlier slot.
 */

export const BASIS_POINTS = 10_000;
export const MAX_TIP_VOTE_BPS = 3_000;
export const MAX_PARTICIPANTS = 32;
export const MAX_ITEMS = 32;
export const MAX_SHARES_PER_ITEM = 32;
export const MAX_TOTAL_SHARES = 128;

export type ReceiptItem = Readonly<{
  id: string;
  name: string;
  pricePence: number;
  shareSlots: number;
}>;

export type BillParticipant = Readonly<{
  id: string;
  name: string;
  remainderOptIn: boolean;
  tipVoteBps: number;
}>;

export type ItemClaim = Readonly<{
  participantId: string;
  itemId: string;
  shareIndexes: readonly number[];
}>;

/** payerId funds beneficiaryId's due amount and owns the contribution/refund. */
export type BillPayment = Readonly<{
  payerId: string;
  beneficiaryId: string;
  amountPence: number;
}>;

export type TapTabInput = Readonly<{
  items: readonly ReceiptItem[];
  participants: readonly BillParticipant[];
  claims: readonly ItemClaim[];
  payments?: readonly BillPayment[];
}>;

export type ItemParticipantAllocation = Readonly<{
  participantId: string;
  shareIndexes: readonly number[];
  slots: number;
  amountPence: number;
}>;

export type ItemAllocation = Readonly<{
  itemId: string;
  name: string;
  pricePence: number;
  shareSlots: number;
  claimedSlots: number;
  unclaimedSlots: number;
  unclaimedShareIndexes: readonly number[];
  claimedPence: number;
  unclaimedPence: number;
  participantAllocations: readonly ItemParticipantAllocation[];
}>;

export type ParticipantAllocation = Readonly<{
  participantId: string;
  name: string;
  remainderOptIn: boolean;
  tipVoteBps: number;
  claimedPence: number;
  remainderPence: number;
  baseDuePence: number;
  tipPence: number;
  totalDuePence: number;
  creditedPence: number;
  unpaidPence: number;
  selfPaidPence: number;
  sponsoredByOthersPence: number;
  contributedPence: number;
  sponsoredForOthersPence: number;
}>;

export type AppliedPayment = Readonly<{
  payerId: string;
  beneficiaryId: string;
  amountPence: number;
  isSponsorship: boolean;
}>;

export type ContributorAllocation = Readonly<{
  payerId: string;
  contributedPence: number;
  selfPaidPence: number;
  sponsoredPence: number;
}>;

export type BillFundingStatus =
  | "unfunded"
  | "partially_funded"
  | "fully_funded";

export type BillFunding = Readonly<{
  requiredPence: number;
  fundedPence: number;
  remainingPence: number;
  status: BillFundingStatus;
  canSettle: boolean;
}>;

export type TapTabPreview = Readonly<{
  currency: "GBP";
  subtotalPence: number;
  medianTipVoteBps: number;
  tipPence: number;
  totalDuePence: number;
  unclaimedPence: number;
  items: readonly ItemAllocation[];
  participants: readonly ParticipantAllocation[];
  payments: readonly AppliedPayment[];
  contributors: readonly ContributorAllocation[];
  funding: BillFunding;
}>;

type MutableParticipantAmounts = {
  claimedPence: number;
  remainderPence: number;
  tipPence: number;
  creditedPence: number;
  selfPaidPence: number;
  sponsoredByOthersPence: number;
  contributedPence: number;
  sponsoredForOthersPence: number;
};

type MutableContributorAmounts = {
  contributedPence: number;
  selfPaidPence: number;
  sponsoredPence: number;
};

type ItemClaimIndex = {
  claims: ItemClaim[];
  claimByParticipantId: Map<string, ItemClaim>;
  claimedShareIndexes: Set<number>;
};

const MAX_SAFE_PENCE = BigInt(Number.MAX_SAFE_INTEGER);

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty, unpadded string`);
  }
}

function assertName(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertSafeInteger(
  value: number,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be a safe integer between ${minimum} and ${maximum}`,
    );
  }
}

function safeNumber(value: bigint, label: string): number {
  if (value < BigInt(0) || value > MAX_SAFE_PENCE) {
    throw new RangeError(`${label} exceeds the safe GBP pence range`);
  }
  return Number(value);
}

function sumPence(values: Iterable<number>, label: string): number {
  let total = BigInt(0);
  for (const value of values) total += BigInt(value);
  return safeNumber(total, label);
}

/**
 * Even voter counts use the floor of the two middle votes' arithmetic mean,
 * matching Solidity integer division.
 */
export function computeMedianTipVoteBps(votes: readonly number[]): number {
  if (votes.length === 0) {
    throw new RangeError("at least one tip vote is required");
  }
  for (const [index, vote] of votes.entries()) {
    assertSafeInteger(vote, `tip vote ${index}`, 0, MAX_TIP_VOTE_BPS);
  }

  const sorted = [...votes].sort((left, right) => left - right);
  const upperIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[upperIndex];
  return Math.floor((sorted[upperIndex - 1] + sorted[upperIndex]) / 2);
}

function validateInput(input: TapTabInput): {
  participantById: Map<string, BillParticipant>;
  claimIndexByItemId: Map<string, ItemClaimIndex>;
} {
  if (!input || typeof input !== "object") {
    throw new TypeError("TapTab input is required");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new RangeError("a bill requires at least one receipt item");
  }
  if (input.items.length > MAX_ITEMS) {
    throw new RangeError(`a bill supports at most ${MAX_ITEMS} receipt items`);
  }
  if (!Array.isArray(input.participants) || input.participants.length === 0) {
    throw new RangeError("a bill requires at least one participant");
  }
  if (input.participants.length > MAX_PARTICIPANTS) {
    throw new RangeError(`a bill supports at most ${MAX_PARTICIPANTS} participants`);
  }
  if (!Array.isArray(input.claims)) {
    throw new TypeError("claims must be an array");
  }
  if (input.payments !== undefined && !Array.isArray(input.payments)) {
    throw new TypeError("payments must be an array when provided");
  }

  const itemById = new Map<string, ReceiptItem>();
  const claimIndexByItemId = new Map<string, ItemClaimIndex>();
  let totalShares = 0;
  for (const item of input.items) {
    assertIdentifier(item.id, "item id");
    assertName(item.name, `item ${item.id} name`);
    assertSafeInteger(item.pricePence, `item ${item.id} pricePence`, 1);
    assertSafeInteger(
      item.shareSlots,
      `item ${item.id} shareSlots`,
      1,
      MAX_SHARES_PER_ITEM,
    );
    if (item.shareSlots > item.pricePence) {
      throw new RangeError(
        `item ${item.id} shareSlots cannot exceed its pricePence`,
      );
    }
    if (itemById.has(item.id)) throw new RangeError(`duplicate item id ${item.id}`);
    itemById.set(item.id, item);
    claimIndexByItemId.set(item.id, {
      claims: [],
      claimByParticipantId: new Map(),
      claimedShareIndexes: new Set(),
    });
    totalShares += item.shareSlots;
  }
  if (totalShares > MAX_TOTAL_SHARES) {
    throw new RangeError(`a bill supports at most ${MAX_TOTAL_SHARES} total shares`);
  }
  // Fail early if otherwise-valid individual item prices overflow in aggregate.
  sumPence(
    input.items.map((item) => item.pricePence),
    "receipt subtotal",
  );

  const participantById = new Map<string, BillParticipant>();
  for (const participant of input.participants) {
    assertIdentifier(participant.id, "participant id");
    assertName(participant.name, `participant ${participant.id} name`);
    if (typeof participant.remainderOptIn !== "boolean") {
      throw new TypeError(
        `participant ${participant.id} remainderOptIn must be boolean`,
      );
    }
    assertSafeInteger(
      participant.tipVoteBps,
      `participant ${participant.id} tipVoteBps`,
      0,
      MAX_TIP_VOTE_BPS,
    );
    if (participantById.has(participant.id)) {
      throw new RangeError(`duplicate participant id ${participant.id}`);
    }
    participantById.set(participant.id, participant);
  }

  for (const claim of input.claims) {
    const item = itemById.get(claim.itemId);
    if (!item) throw new RangeError(`claim references unknown item ${claim.itemId}`);
    if (!participantById.has(claim.participantId)) {
      throw new RangeError(
        `claim references unknown participant ${claim.participantId}`,
      );
    }
    if (!Array.isArray(claim.shareIndexes) || claim.shareIndexes.length === 0) {
      throw new RangeError(
        `claim shareIndexes for ${claim.participantId}/${claim.itemId} must be a non-empty array`,
      );
    }

    const itemClaimIndex = claimIndexByItemId.get(claim.itemId);
    if (!itemClaimIndex) throw new Error("validated item disappeared");
    if (itemClaimIndex.claimByParticipantId.has(claim.participantId)) {
      throw new RangeError(
        `duplicate claim for ${claim.participantId}/${claim.itemId}`,
      );
    }
    itemClaimIndex.claimByParticipantId.set(claim.participantId, claim);

    for (const shareIndex of claim.shareIndexes) {
      assertSafeInteger(
        shareIndex,
        `share index for ${claim.participantId}/${claim.itemId}`,
        0,
        item.shareSlots - 1,
      );
      if (itemClaimIndex.claimedShareIndexes.has(shareIndex)) {
        throw new RangeError(
          `share index ${shareIndex} is claimed more than once for item ${claim.itemId}`,
        );
      }
      itemClaimIndex.claimedShareIndexes.add(shareIndex);
    }
    itemClaimIndex.claims.push(claim);
  }

  return { participantById, claimIndexByItemId };
}

function createAmountMap(
  participants: readonly BillParticipant[],
): Map<string, MutableParticipantAmounts> {
  return new Map(
    participants.map((participant) => [
      participant.id,
      {
        claimedPence: 0,
        remainderPence: 0,
        tipPence: 0,
        creditedPence: 0,
        selfPaidPence: 0,
        sponsoredByOthersPence: 0,
        contributedPence: 0,
        sponsoredForOthersPence: 0,
      },
    ]),
  );
}

export function calculateTapTabPreview(input: TapTabInput): TapTabPreview {
  const { participantById, claimIndexByItemId } = validateInput(input);
  const amounts = createAmountMap(input.participants);
  const itemAllocations: ItemAllocation[] = [];

  for (const item of input.items) {
    const itemClaimIndex = claimIndexByItemId.get(item.id);
    if (!itemClaimIndex) throw new Error("validated item disappeared");
    const { claims, claimedShareIndexes } = itemClaimIndex;
    const claimedSlots = claimedShareIndexes.size;
    const unclaimedSlots = item.shareSlots - claimedSlots;
    const unclaimedShareIndexes = Array.from(
      { length: item.shareSlots },
      (_, shareIndex) => shareIndex,
    ).filter((shareIndex) => !claimedShareIndexes.has(shareIndex));
    const equalSlotPence = Math.floor(item.pricePence / item.shareSlots);
    const dustySlotCount = item.pricePence % item.shareSlots;

    const participantAllocations = claims.map((claim) => {
      const shareIndexes = [...claim.shareIndexes].sort(
        (left, right) => left - right,
      );
      const amountPence = shareIndexes.reduce((total, shareIndex) => {
        return total + equalSlotPence + (shareIndex < dustySlotCount ? 1 : 0);
      }, 0);

      const participantAmounts = amounts.get(claim.participantId);
      if (!participantAmounts) throw new Error("validated participant disappeared");
      participantAmounts.claimedPence += amountPence;
      return Object.freeze({
        participantId: claim.participantId,
        shareIndexes: Object.freeze(shareIndexes),
        slots: shareIndexes.length,
        amountPence,
      });
    });

    const claimedPence = sumPence(
      participantAllocations.map((allocation) => allocation.amountPence),
      `claimed value for ${item.id}`,
    );
    const unclaimedPence = item.pricePence - claimedPence;
    itemAllocations.push(
      Object.freeze({
        itemId: item.id,
        name: item.name,
        pricePence: item.pricePence,
        shareSlots: item.shareSlots,
        claimedSlots,
        unclaimedSlots,
        unclaimedShareIndexes: Object.freeze(unclaimedShareIndexes),
        claimedPence,
        unclaimedPence,
        participantAllocations: Object.freeze(participantAllocations),
      }),
    );
  }

  const unclaimedPence = sumPence(
    itemAllocations.map((item) => item.unclaimedPence),
    "unclaimed receipt value",
  );
  if (unclaimedPence > 0) {
    const optedIn = input.participants.filter(
      (participant) => participant.remainderOptIn,
    );
    if (optedIn.length === 0) {
      throw new RangeError(
        "unclaimed receipt value requires at least one remainder opt-in",
      );
    }

    const equalRemainderPence = Math.floor(unclaimedPence / optedIn.length);
    const remainderDust = unclaimedPence % optedIn.length;
    for (const [index, participant] of optedIn.entries()) {
      const participantAmounts = amounts.get(participant.id);
      if (!participantAmounts) throw new Error("validated participant disappeared");
      participantAmounts.remainderPence =
        equalRemainderPence + (index < remainderDust ? 1 : 0);
    }
  }

  const subtotalPence = sumPence(
    input.items.map((item) => item.pricePence),
    "receipt subtotal",
  );
  const medianTipVoteBps = computeMedianTipVoteBps(
    input.participants.map((participant) => participant.tipVoteBps),
  );
  const tipPence = safeNumber(
    (BigInt(subtotalPence) * BigInt(medianTipVoteBps)) / BigInt(BASIS_POINTS),
    "tip",
  );

  const baseDueByParticipant = new Map<string, number>();
  for (const participant of input.participants) {
    const participantAmounts = amounts.get(participant.id);
    if (!participantAmounts) throw new Error("validated participant disappeared");
    baseDueByParticipant.set(
      participant.id,
      sumPence(
        [participantAmounts.claimedPence, participantAmounts.remainderPence],
        `base due for ${participant.id}`,
      ),
    );
  }

  let allocatedTipPence = 0;
  for (const participant of input.participants) {
    const participantAmounts = amounts.get(participant.id);
    if (!participantAmounts) throw new Error("validated participant disappeared");
    participantAmounts.tipPence = safeNumber(
      (BigInt(baseDueByParticipant.get(participant.id) ?? 0) *
        BigInt(medianTipVoteBps)) /
        BigInt(BASIS_POINTS),
      `tip for ${participant.id}`,
    );
    allocatedTipPence += participantAmounts.tipPence;
  }

  let tipDust = tipPence - allocatedTipPence;
  for (const participant of input.participants) {
    if (tipDust === 0) break;
    if ((baseDueByParticipant.get(participant.id) ?? 0) === 0) continue;
    const participantAmounts = amounts.get(participant.id);
    if (!participantAmounts) throw new Error("validated participant disappeared");
    participantAmounts.tipPence += 1;
    tipDust -= 1;
  }
  if (tipDust !== 0) throw new Error("tip dust allocation failed");

  const totalDueByParticipant = new Map<string, number>();
  for (const participant of input.participants) {
    const participantAmounts = amounts.get(participant.id);
    if (!participantAmounts) throw new Error("validated participant disappeared");
    totalDueByParticipant.set(
      participant.id,
      sumPence(
        [baseDueByParticipant.get(participant.id) ?? 0, participantAmounts.tipPence],
        `total due for ${participant.id}`,
      ),
    );
  }

  const appliedPayments: AppliedPayment[] = [];
  const contributorAmounts = new Map<string, MutableContributorAmounts>();
  for (const payment of input.payments ?? []) {
    assertIdentifier(payment.payerId, "payment payer id");
    assertIdentifier(payment.beneficiaryId, "payment beneficiary id");
    if (!participantById.has(payment.beneficiaryId)) {
      throw new RangeError(
        `payment references unknown beneficiary ${payment.beneficiaryId}`,
      );
    }
    assertSafeInteger(
      payment.amountPence,
      `payment amount for ${payment.payerId}/${payment.beneficiaryId}`,
      1,
    );

    const beneficiaryAmounts = amounts.get(payment.beneficiaryId);
    if (!beneficiaryAmounts) throw new Error("validated beneficiary disappeared");
    const beneficiaryDue = totalDueByParticipant.get(payment.beneficiaryId) ?? 0;
    if (beneficiaryAmounts.creditedPence + payment.amountPence > beneficiaryDue) {
      throw new RangeError(
        `payment overfunds beneficiary ${payment.beneficiaryId}`,
      );
    }

    let contributor = contributorAmounts.get(payment.payerId);
    if (!contributor) {
      contributor = {
        contributedPence: 0,
        selfPaidPence: 0,
        sponsoredPence: 0,
      };
      contributorAmounts.set(payment.payerId, contributor);
    }

    const payerParticipantAmounts = amounts.get(payment.payerId);
    beneficiaryAmounts.creditedPence += payment.amountPence;
    contributor.contributedPence += payment.amountPence;
    if (payerParticipantAmounts) {
      payerParticipantAmounts.contributedPence += payment.amountPence;
    }

    if (payment.payerId === payment.beneficiaryId) {
      contributor.selfPaidPence += payment.amountPence;
      if (!payerParticipantAmounts) {
        throw new Error("a self-paying beneficiary must be a participant");
      }
      payerParticipantAmounts.selfPaidPence += payment.amountPence;
    } else {
      contributor.sponsoredPence += payment.amountPence;
      if (payerParticipantAmounts) {
        payerParticipantAmounts.sponsoredForOthersPence += payment.amountPence;
      }
      beneficiaryAmounts.sponsoredByOthersPence += payment.amountPence;
    }

    appliedPayments.push(
      Object.freeze({
        payerId: payment.payerId,
        beneficiaryId: payment.beneficiaryId,
        amountPence: payment.amountPence,
        isSponsorship: payment.payerId !== payment.beneficiaryId,
      }),
    );
  }

  const participantAllocations = input.participants.map((participant) => {
    const participantAmounts = amounts.get(participant.id);
    if (!participantAmounts) throw new Error("validated participant disappeared");
    const baseDuePence = baseDueByParticipant.get(participant.id) ?? 0;
    const totalDuePence = totalDueByParticipant.get(participant.id) ?? 0;
    return Object.freeze({
      participantId: participant.id,
      name: participant.name,
      remainderOptIn: participant.remainderOptIn,
      tipVoteBps: participant.tipVoteBps,
      claimedPence: participantAmounts.claimedPence,
      remainderPence: participantAmounts.remainderPence,
      baseDuePence,
      tipPence: participantAmounts.tipPence,
      totalDuePence,
      creditedPence: participantAmounts.creditedPence,
      unpaidPence: totalDuePence - participantAmounts.creditedPence,
      selfPaidPence: participantAmounts.selfPaidPence,
      sponsoredByOthersPence: participantAmounts.sponsoredByOthersPence,
      contributedPence: participantAmounts.contributedPence,
      sponsoredForOthersPence: participantAmounts.sponsoredForOthersPence,
    });
  });

  const totalDuePence = sumPence(
    participantAllocations.map((participant) => participant.totalDuePence),
    "bill total",
  );
  const fundedPence = sumPence(
    participantAllocations.map((participant) => participant.creditedPence),
    "funded total",
  );
  const remainingPence = totalDuePence - fundedPence;
  const status: BillFundingStatus =
    fundedPence === 0
      ? "unfunded"
      : remainingPence === 0
        ? "fully_funded"
        : "partially_funded";
  const funding: BillFunding = Object.freeze({
    requiredPence: totalDuePence,
    fundedPence,
    remainingPence,
    status,
    canSettle: status === "fully_funded",
  });
  const contributors = [...contributorAmounts.entries()].map(
    ([payerId, contributor]) => Object.freeze({ payerId, ...contributor }),
  );

  return Object.freeze({
    currency: "GBP",
    subtotalPence,
    medianTipVoteBps,
    tipPence,
    totalDuePence,
    unclaimedPence,
    items: Object.freeze(itemAllocations),
    participants: Object.freeze(participantAllocations),
    payments: Object.freeze(appliedPayments),
    contributors: Object.freeze(contributors),
    funding,
  });
}

/** Enforces payment protection at the boundary that initiates settlement. */
export function assertCanSettle(
  preview: Pick<TapTabPreview, "funding">,
): void {
  if (!preview.funding.canSettle || preview.funding.remainingPence !== 0) {
    throw new Error(
      `bill is not fully funded: ${preview.funding.remainingPence} pence remains`,
    );
  }
}

/** A complete, fully funded central-London dinner used by the preview UI. */
export const LONDON_DINNER_FIXTURE: TapTabInput = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      id: "arancini",
      name: "Truffle arancini",
      pricePence: 1_050,
      shareSlots: 2,
    }),
    Object.freeze({
      id: "margherita",
      name: "Wood-fired margherita",
      pricePence: 1_650,
      shareSlots: 1,
    }),
    Object.freeze({
      id: "pappardelle",
      name: "Wild mushroom pappardelle",
      pricePence: 2_250,
      shareSlots: 1,
    }),
    Object.freeze({
      id: "house-red",
      name: "Bottle of house red",
      pricePence: 3_600,
      shareSlots: 4,
    }),
  ]),
  participants: Object.freeze([
    Object.freeze({
      id: "maya",
      name: "Maya",
      remainderOptIn: false,
      tipVoteBps: 1_000,
    }),
    Object.freeze({
      id: "noah",
      name: "Noah",
      remainderOptIn: false,
      tipVoteBps: 1_250,
    }),
    Object.freeze({
      id: "priya",
      name: "Priya",
      remainderOptIn: true,
      tipVoteBps: 1_250,
    }),
    Object.freeze({
      id: "tom",
      name: "Tom",
      remainderOptIn: true,
      tipVoteBps: 1_500,
    }),
  ]),
  claims: Object.freeze([
    Object.freeze({
      participantId: "maya",
      itemId: "arancini",
      shareIndexes: Object.freeze([0]),
    }),
    Object.freeze({
      participantId: "priya",
      itemId: "arancini",
      shareIndexes: Object.freeze([1]),
    }),
    Object.freeze({
      participantId: "maya",
      itemId: "margherita",
      shareIndexes: Object.freeze([0]),
    }),
    Object.freeze({
      participantId: "noah",
      itemId: "pappardelle",
      shareIndexes: Object.freeze([0]),
    }),
    Object.freeze({
      participantId: "maya",
      itemId: "house-red",
      shareIndexes: Object.freeze([0]),
    }),
    Object.freeze({
      participantId: "noah",
      itemId: "house-red",
      shareIndexes: Object.freeze([1]),
    }),
    Object.freeze({
      participantId: "priya",
      itemId: "house-red",
      shareIndexes: Object.freeze([2]),
    }),
  ]),
  payments: Object.freeze([
    Object.freeze({ payerId: "maya", beneficiaryId: "maya", amountPence: 3_460 }),
    Object.freeze({ payerId: "noah", beneficiaryId: "noah", amountPence: 3_543 }),
    Object.freeze({ payerId: "priya", beneficiaryId: "priya", amountPence: 2_109 }),
    Object.freeze({ payerId: "maya", beneficiaryId: "tom", amountPence: 506 }),
  ]),
});

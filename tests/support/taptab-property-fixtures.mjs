const STANDARD_TIP_VOTES = Object.freeze([0, 1_000, 1_250, 2_000, 3_000]);

export const PURE_PROPERTY_SEEDS = Object.freeze([
  0x1357_9bdf,
  0x2468_ace0,
  0xc0ff_ee01,
]);

export const DIFFERENTIAL_PROPERTY_SEEDS = Object.freeze([
  0x0bad_5eed,
  0x51a7_e123,
  0xa110_ca7e,
  0xd1ff_e2e1,
]);

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function mixSeed(seed, fixtureIndex) {
  let value = (seed ^ Math.imul(fixtureIndex + 1, 0x9e37_79b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85eb_ca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2_ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

export function createSeededPrng(seed) {
  let state = seed >>> 0;
  return Object.freeze({
    nextUint32() {
      state = (state + 0x6d2b_79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    },
    integer(minimum, maximum) {
      if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
        throw new RangeError("invalid deterministic integer range");
      }
      return minimum + (this.nextUint32() % (maximum - minimum + 1));
    },
  });
}

function medianTipVote(votes) {
  const sorted = [...votes].sort((left, right) => left - right);
  const upper = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[upper]
    : Math.floor((sorted[upper - 1] + sorted[upper]) / 2);
}

function referenceDues(input) {
  const amounts = new Map(
    input.participants.map(({ id }) => [id, { claimed: 0, remainder: 0, tip: 0 }]),
  );
  const claimedByItem = new Map();

  for (const claim of input.claims) {
    let indexes = claimedByItem.get(claim.itemId);
    if (!indexes) {
      indexes = new Map();
      claimedByItem.set(claim.itemId, indexes);
    }
    for (const shareIndex of claim.shareIndexes) {
      indexes.set(shareIndex, claim.participantId);
    }
  }

  let unclaimed = 0;
  for (const item of input.items) {
    const equalShare = Math.floor(item.pricePence / item.shareSlots);
    const dust = item.pricePence % item.shareSlots;
    const owners = claimedByItem.get(item.id) ?? new Map();
    for (let shareIndex = 0; shareIndex < item.shareSlots; shareIndex += 1) {
      const value = equalShare + (shareIndex < dust ? 1 : 0);
      const owner = owners.get(shareIndex);
      if (owner === undefined) {
        unclaimed += value;
      } else {
        amounts.get(owner).claimed += value;
      }
    }
  }

  if (unclaimed > 0) {
    const optedIn = input.participants.filter(({ remainderOptIn }) => remainderOptIn);
    const equalRemainder = Math.floor(unclaimed / optedIn.length);
    const dust = unclaimed % optedIn.length;
    optedIn.forEach(({ id }, index) => {
      amounts.get(id).remainder = equalRemainder + (index < dust ? 1 : 0);
    });
  }

  const subtotal = input.items.reduce((sum, item) => sum + item.pricePence, 0);
  const median = medianTipVote(input.participants.map(({ tipVoteBps }) => tipVoteBps));
  const totalTip = Math.floor((subtotal * median) / 10_000);
  let allocatedTip = 0;
  for (const participant of input.participants) {
    const amount = amounts.get(participant.id);
    const baseDue = amount.claimed + amount.remainder;
    amount.tip = Math.floor((baseDue * median) / 10_000);
    allocatedTip += amount.tip;
  }
  let tipDust = totalTip - allocatedTip;
  for (const participant of input.participants) {
    if (tipDust === 0) break;
    const amount = amounts.get(participant.id);
    if (amount.claimed + amount.remainder === 0) continue;
    amount.tip += 1;
    tipDust -= 1;
  }

  return new Map(
    input.participants.map(({ id }) => {
      const amount = amounts.get(id);
      return [id, amount.claimed + amount.remainder + amount.tip];
    }),
  );
}

function addPayments(input, mode, externalSponsorId) {
  const dues = referenceDues(input);
  const positive = input.participants.filter(({ id }) => dues.get(id) > 0);
  const payments = [];

  if (mode === "partial" && positive.length > 0) {
    const beneficiary = positive[0];
    const due = dues.get(beneficiary.id);
    payments.push({
      payerId:
        input.participants.length > 1
          ? input.participants[1].id
          : externalSponsorId,
      beneficiaryId: beneficiary.id,
      amountPence: Math.max(1, Math.floor(due / 2)),
    });
  } else if (mode === "full-self") {
    for (const beneficiary of positive) {
      payments.push({
        payerId: beneficiary.id,
        beneficiaryId: beneficiary.id,
        amountPence: dues.get(beneficiary.id),
      });
    }
  } else if (mode === "full-sponsored") {
    positive.forEach((beneficiary, index) => {
      const participantIndex = input.participants.findIndex(({ id }) => id === beneficiary.id);
      const sponsor =
        input.participants.length === 1
          ? externalSponsorId
          : input.participants[(participantIndex + 1) % input.participants.length].id;
      payments.push({
        payerId: index === 0 ? sponsor : beneficiary.id,
        beneficiaryId: beneficiary.id,
        amountPence: dues.get(beneficiary.id),
      });
    });
  }

  return deepFreeze({ ...input, payments });
}

function generatedTipVote(random, fixtureIndex, participantIndex) {
  if (participantIndex === 0 && fixtureIndex % 6 === 0) {
    let custom = 1 + ((fixtureIndex * 137 + random.integer(0, 2_998)) % 2_999);
    while (STANDARD_TIP_VOTES.includes(custom)) custom = (custom % 2_999) + 1;
    return custom;
  }
  return STANDARD_TIP_VOTES[
    (fixtureIndex + participantIndex + random.integer(0, STANDARD_TIP_VOTES.length - 1)) %
      STANDARD_TIP_VOTES.length
  ];
}

export function generateTapTabFixture(seed, fixtureIndex) {
  const random = createSeededPrng(mixSeed(seed, fixtureIndex));
  const participantCount = 1 + ((fixtureIndex + random.integer(0, 4)) % 5);
  const itemCount = 1 + ((Math.floor(fixtureIndex / 2) + random.integer(0, 4)) % 5);
  const seedLabel = (seed >>> 0).toString(16).padStart(8, "0");
  const fixtureLabel = `${seedLabel}-${fixtureIndex}`;
  const forceFullyClaimed = fixtureIndex % 7 === 0;

  const participants = Array.from({ length: participantCount }, (_, index) => ({
    id: `p-${fixtureLabel}-${index}`,
    name: `Participant ${index + 1}`,
    remainderOptIn:
      forceFullyClaimed && fixtureIndex % 14 === 0
        ? false
        : random.integer(0, 2) !== 0,
    tipVoteBps: generatedTipVote(random, fixtureIndex, index),
  }));

  if (!forceFullyClaimed && !participants.some(({ remainderOptIn }) => remainderOptIn)) {
    participants[fixtureIndex % participantCount].remainderOptIn = true;
  }

  const items = Array.from({ length: itemCount }, (_, index) => {
    const shareSlots = 1 + random.integer(0, 4);
    const equalShare = 2 + random.integer(0, 2_000);
    const dust = shareSlots === 1 ? 0 : random.integer(0, shareSlots - 1);
    return {
      id: `i-${fixtureLabel}-${index}`,
      name: `Item ${index + 1}`,
      pricePence: equalShare * shareSlots + dust,
      shareSlots,
    };
  });

  const claims = [];
  for (const [itemIndex, item] of items.entries()) {
    const byParticipant = new Map();
    const forceOneUnclaimed = !forceFullyClaimed && fixtureIndex % 3 === 0;
    for (let shareIndex = 0; shareIndex < item.shareSlots; shareIndex += 1) {
      const claimed =
        forceFullyClaimed ||
        (forceOneUnclaimed && shareIndex === item.shareSlots - 1
          ? false
          : random.integer(0, 99) < 68);
      if (!claimed) continue;
      const ownerIndex =
        (shareIndex + itemIndex + fixtureIndex + random.integer(0, participantCount - 1)) %
        participantCount;
      const ownerId = participants[ownerIndex].id;
      const indexes = byParticipant.get(ownerId) ?? [];
      indexes.push(shareIndex);
      byParticipant.set(ownerId, indexes);
    }
    for (const participant of participants) {
      const indexes = byParticipant.get(participant.id);
      if (!indexes) continue;
      if ((fixtureIndex + itemIndex) % 2 === 1) indexes.reverse();
      claims.push({
        participantId: participant.id,
        itemId: item.id,
        shareIndexes: indexes,
      });
    }
  }

  const base = { items, participants, claims };
  const modes = ["none", "partial", "full-self", "full-sponsored"];
  return addPayments(
    base,
    modes[fixtureIndex % modes.length],
    `sponsor-${fixtureLabel}`,
  );
}

function curated(input, mode, id) {
  return Object.freeze({
    id,
    input: addPayments(input, mode, `external-${id}`),
  });
}

export const CURATED_DIFFERENTIAL_FIXTURES = Object.freeze([
  curated(
    {
      items: [{ id: "solo-item", name: "Solo item", pricePence: 101, shareSlots: 1 }],
      participants: [
        { id: "solo", name: "Solo", remainderOptIn: false, tipVoteBps: 0 },
      ],
      claims: [{ participantId: "solo", itemId: "solo-item", shareIndexes: [0] }],
    },
    "full-self",
    "single-owner-no-tip",
  ),
  curated(
    {
      items: [{ id: "odd-shares", name: "Odd shares", pricePence: 101, shareSlots: 3 }],
      participants: [
        { id: "even-a", name: "Even A", remainderOptIn: false, tipVoteBps: 1_001 },
        { id: "even-b", name: "Even B", remainderOptIn: false, tipVoteBps: 1_250 },
      ],
      claims: [
        { participantId: "even-a", itemId: "odd-shares", shareIndexes: [2, 0] },
        { participantId: "even-b", itemId: "odd-shares", shareIndexes: [1] },
      ],
    },
    "partial",
    "even-median-floor-and-share-dust",
  ),
  curated(
    {
      items: [
        { id: "shared", name: "Shared", pricePence: 107, shareSlots: 4 },
        { id: "unclaimed", name: "Unclaimed", pricePence: 19, shareSlots: 2 },
      ],
      participants: [
        { id: "join-0", name: "Join 0", remainderOptIn: true, tipVoteBps: 777 },
        { id: "join-1", name: "Join 1", remainderOptIn: false, tipVoteBps: 1_251 },
        { id: "join-2", name: "Join 2", remainderOptIn: true, tipVoteBps: 1_999 },
      ],
      claims: [
        { participantId: "join-0", itemId: "shared", shareIndexes: [0] },
        { participantId: "join-1", itemId: "shared", shareIndexes: [2] },
        { participantId: "join-2", itemId: "shared", shareIndexes: [3] },
      ],
    },
    "full-sponsored",
    "remainder-and-tip-dust-with-sponsor",
  ),
  curated(
    {
      items: [{ id: "whole-remainder", name: "Whole remainder", pricePence: 103, shareSlots: 5 }],
      participants: [
        { id: "r-0", name: "R 0", remainderOptIn: false, tipVoteBps: 0 },
        { id: "r-1", name: "R 1", remainderOptIn: true, tipVoteBps: 1_000 },
        { id: "r-2", name: "R 2", remainderOptIn: false, tipVoteBps: 1_250 },
        { id: "r-3", name: "R 3", remainderOptIn: true, tipVoteBps: 3_000 },
      ],
      claims: [],
    },
    "none",
    "fully-unclaimed-mixed-opt-in",
  ),
  curated(
    {
      items: [
        { id: "m-0", name: "M 0", pricePence: 31, shareSlots: 2 },
        { id: "m-1", name: "M 1", pricePence: 47, shareSlots: 3 },
        { id: "m-2", name: "M 2", pricePence: 59, shareSlots: 4 },
        { id: "m-3", name: "M 3", pricePence: 71, shareSlots: 5 },
        { id: "m-4", name: "M 4", pricePence: 83, shareSlots: 2 },
      ],
      participants: Array.from({ length: 5 }, (_, index) => ({
        id: `m-p-${index}`,
        name: `M P ${index}`,
        remainderOptIn: index % 2 === 0,
        tipVoteBps: [0, 333, 1_250, 2_001, 3_000][index],
      })),
      claims: [
        { participantId: "m-p-0", itemId: "m-0", shareIndexes: [0] },
        { participantId: "m-p-1", itemId: "m-0", shareIndexes: [1] },
        { participantId: "m-p-2", itemId: "m-1", shareIndexes: [0, 2] },
        { participantId: "m-p-3", itemId: "m-2", shareIndexes: [1, 3] },
        { participantId: "m-p-4", itemId: "m-3", shareIndexes: [4, 0] },
        { participantId: "m-p-0", itemId: "m-4", shareIndexes: [1] },
      ],
    },
    "full-self",
    "five-by-five-mixed-ownership",
  ),
  curated(
    {
      items: [{ id: "empty-claims", name: "Empty claims", pricePence: 77, shareSlots: 3 }],
      participants: [
        { id: "external-a", name: "External A", remainderOptIn: true, tipVoteBps: 1_500 },
        { id: "external-b", name: "External B", remainderOptIn: true, tipVoteBps: 1_500 },
      ],
      claims: [],
    },
    "full-sponsored",
    "external-style-sponsorship",
  ),
  curated(
    {
      items: [
        { id: "partial-a", name: "Partial A", pricePence: 113, shareSlots: 5 },
        { id: "partial-b", name: "Partial B", pricePence: 89, shareSlots: 4 },
      ],
      participants: [
        { id: "partial-0", name: "Partial 0", remainderOptIn: true, tipVoteBps: 1 },
        { id: "partial-1", name: "Partial 1", remainderOptIn: false, tipVoteBps: 999 },
        { id: "partial-2", name: "Partial 2", remainderOptIn: true, tipVoteBps: 1_777 },
        { id: "partial-3", name: "Partial 3", remainderOptIn: false, tipVoteBps: 2_999 },
      ],
      claims: [
        { participantId: "partial-0", itemId: "partial-a", shareIndexes: [0, 4] },
        { participantId: "partial-1", itemId: "partial-a", shareIndexes: [1] },
        { participantId: "partial-2", itemId: "partial-b", shareIndexes: [2] },
        { participantId: "partial-3", itemId: "partial-b", shareIndexes: [0] },
      ],
    },
    "partial",
    "partial-sponsored-funding",
  ),
  curated(
    {
      items: [{ id: "max-tip", name: "Max tip", pricePence: 17, shareSlots: 3 }],
      participants: [
        { id: "max-tip-owner", name: "Max tip owner", remainderOptIn: false, tipVoteBps: 3_000 },
      ],
      claims: [
        { participantId: "max-tip-owner", itemId: "max-tip", shareIndexes: [2, 1, 0] },
      ],
    },
    "full-sponsored",
    "single-owner-max-tip-external-sponsor",
  ),
]);

import assert from "node:assert/strict";
import test from "node:test";

import {
  LONDON_DINNER_FIXTURE,
  MAX_SHARES_PER_ITEM,
  MAX_TIP_VOTE_BPS,
  assertCanSettle,
  calculateTapTabPreview,
  computeMedianTipVoteBps,
} from "../app/taptab-model.ts";

function person(id, overrides = {}) {
  return {
    id,
    name: id.toUpperCase(),
    remainderOptIn: false,
    tipVoteBps: 0,
    ...overrides,
  };
}

function oneItemBill(overrides = {}) {
  return {
    items: [{ id: "item", name: "Shared plate", pricePence: 100, shareSlots: 1 }],
    participants: [person("a")],
    claims: [{ participantId: "a", itemId: "item", shareIndexes: [0] }],
    payments: [],
    ...overrides,
  };
}

function participant(preview, id) {
  const allocation = preview.participants.find((entry) => entry.participantId === id);
  assert.ok(allocation, `missing participant ${id}`);
  return allocation;
}

test("London dinner fixture conserves every penny and reaches protected settlement", () => {
  const preview = calculateTapTabPreview(LONDON_DINNER_FIXTURE);

  assert.equal(preview.currency, "GBP");
  assert.equal(preview.subtotalPence, 8_550);
  assert.equal(preview.medianTipVoteBps, 1_250);
  assert.equal(preview.tipPence, 1_068);
  assert.equal(preview.totalDuePence, 9_618);
  assert.equal(preview.unclaimedPence, 900);
  assert.deepEqual(
    preview.participants.map(({ participantId, baseDuePence, tipPence, totalDuePence }) => ({
      participantId,
      baseDuePence,
      tipPence,
      totalDuePence,
    })),
    [
      { participantId: "maya", baseDuePence: 3_075, tipPence: 385, totalDuePence: 3_460 },
      { participantId: "noah", baseDuePence: 3_150, tipPence: 393, totalDuePence: 3_543 },
      { participantId: "priya", baseDuePence: 1_875, tipPence: 234, totalDuePence: 2_109 },
      { participantId: "tom", baseDuePence: 450, tipPence: 56, totalDuePence: 506 },
    ],
  );
  assert.deepEqual(preview.funding, {
    requiredPence: 9_618,
    fundedPence: 9_618,
    remainingPence: 0,
    status: "fully_funded",
    canSettle: true,
  });
  assert.doesNotThrow(() => assertCanSettle(preview));
  assert.equal(
    preview.participants.reduce((sum, row) => sum + row.baseDuePence, 0),
    preview.subtotalPence,
  );
  assert.equal(
    preview.participants.reduce((sum, row) => sum + row.tipPence, 0),
    preview.tipPence,
  );
});

test("shared items allocate penny dust by explicit share index, not claim order", () => {
  const preview = calculateTapTabPreview(
    oneItemBill({
      items: [{ id: "item", name: "Olives", pricePence: 10, shareSlots: 3 }],
      participants: [person("a"), person("m"), person("z")],
      claims: [
        { participantId: "z", itemId: "item", shareIndexes: [2] },
        { participantId: "a", itemId: "item", shareIndexes: [0] },
        { participantId: "m", itemId: "item", shareIndexes: [1] },
      ],
    }),
  );

  assert.deepEqual(preview.items[0].participantAllocations, [
    { participantId: "z", shareIndexes: [2], slots: 1, amountPence: 3 },
    { participantId: "a", shareIndexes: [0], slots: 1, amountPence: 4 },
    { participantId: "m", shareIndexes: [1], slots: 1, amountPence: 3 },
  ]);
  assert.deepEqual(preview.items[0].unclaimedShareIndexes, []);
  assert.equal(participant(preview, "z").baseDuePence, 3);
  assert.equal(participant(preview, "a").baseDuePence, 4);
  assert.equal(participant(preview, "m").baseDuePence, 3);
  assert.equal(preview.items[0].claimedPence, 10);
});

test("claim identity uses exact item and participant keys without delimiter collisions", () => {
  const preview = calculateTapTabPreview({
    items: [
      { id: "x\0q", name: "First item", pricePence: 100, shareSlots: 1 },
      { id: "q", name: "Second item", pricePence: 100, shareSlots: 1 },
    ],
    participants: [person("p"), person("p\0x")],
    claims: [
      { participantId: "p", itemId: "x\0q", shareIndexes: [0] },
      { participantId: "p\0x", itemId: "q", shareIndexes: [0] },
    ],
    payments: [],
  });

  assert.deepEqual(
    preview.items.map(({ itemId, participantAllocations }) => ({
      itemId,
      participantIds: participantAllocations.map(
        (allocation) => allocation.participantId,
      ),
    })),
    [
      { itemId: "x\0q", participantIds: ["p"] },
      { itemId: "q", participantIds: ["p\0x"] },
    ],
  );
  assert.equal(preview.subtotalPence, 200);
  assert.equal(
    preview.participants.reduce((sum, row) => sum + row.baseDuePence, 0),
    preview.subtotalPence,
  );
});

test("fair remainder excludes non-opt-ins and gives penny dust in join order", () => {
  const preview = calculateTapTabPreview(
    oneItemBill({
      items: [{ id: "item", name: "Bread", pricePence: 10, shareSlots: 4 }],
      participants: [
        person("first", { remainderOptIn: true }),
        person("claimant"),
        person("second", { remainderOptIn: true }),
      ],
      claims: [
        { participantId: "claimant", itemId: "item", shareIndexes: [0] },
      ],
    }),
  );

  assert.equal(preview.items[0].claimedPence, 3);
  assert.equal(preview.items[0].unclaimedPence, 7);
  assert.equal(participant(preview, "claimant").remainderPence, 0);
  assert.equal(participant(preview, "first").remainderPence, 4);
  assert.equal(participant(preview, "second").remainderPence, 3);
  assert.equal(
    preview.participants.reduce((sum, row) => sum + row.baseDuePence, 0),
    10,
  );
});

test("unclaimed value without a fair-remainder opt-in cannot be allocated", () => {
  assert.throws(
    () =>
      calculateTapTabPreview(
        oneItemBill({
          items: [{ id: "item", name: "Bread", pricePence: 10, shareSlots: 2 }],
          claims: [{ participantId: "a", itemId: "item", shareIndexes: [0] }],
        }),
      ),
    /requires at least one remainder opt-in/,
  );
});

test("custom tip votes produce deterministic odd and even medians", () => {
  assert.equal(computeMedianTipVoteBps([2_000, 0, 1_250]), 1_250);
  assert.equal(computeMedianTipVoteBps([2_000, 1_001, 0, 1_000]), 1_000);
  assert.equal(computeMedianTipVoteBps([1_000, 1_251]), 1_125);
  assert.throws(
    () => computeMedianTipVoteBps([MAX_TIP_VOTE_BPS + 1]),
    /between 0 and 3000/,
  );

  const preview = calculateTapTabPreview(
    oneItemBill({
      items: [{ id: "item", name: "Custom tip", pricePence: 101, shareSlots: 2 }],
      participants: [
        person("a", { tipVoteBps: 1_000 }),
        person("b", { tipVoteBps: 1_251 }),
      ],
      claims: [
        { participantId: "a", itemId: "item", shareIndexes: [0] },
        { participantId: "b", itemId: "item", shareIndexes: [1] },
      ],
    }),
  );
  assert.equal(preview.medianTipVoteBps, 1_125);
  assert.equal(preview.tipPence, 11);
  assert.equal(preview.totalDuePence, 112);
});

test("tip floors are topped up in join order while conserving pennies", () => {
  const preview = calculateTapTabPreview(
    oneItemBill({
      items: [{ id: "item", name: "Three-way dish", pricePence: 101, shareSlots: 3 }],
      participants: [
        person("m", { tipVoteBps: 1_000 }),
        person("a", { tipVoteBps: 1_000 }),
        person("z", { tipVoteBps: 1_000 }),
      ],
      claims: [
        { participantId: "z", itemId: "item", shareIndexes: [0] },
        { participantId: "a", itemId: "item", shareIndexes: [1] },
        { participantId: "m", itemId: "item", shareIndexes: [2] },
      ],
    }),
  );

  assert.deepEqual(
    preview.participants.map(({ participantId, baseDuePence, tipPence }) => ({
      participantId,
      baseDuePence,
      tipPence,
    })),
    [
      { participantId: "m", baseDuePence: 33, tipPence: 4 },
      { participantId: "a", baseDuePence: 34, tipPence: 3 },
      { participantId: "z", baseDuePence: 34, tipPence: 3 },
    ],
  );
  assert.equal(preview.tipPence, 10);
  assert.equal(preview.totalDuePence, 111);
});

test("sponsorship credits beneficiaries while tracking each actual payer", () => {
  const preview = calculateTapTabPreview(
    oneItemBill({
      items: [{ id: "item", name: "Taxi", pricePence: 100, shareSlots: 2 }],
      participants: [person("a"), person("b")],
      claims: [
        { participantId: "a", itemId: "item", shareIndexes: [0] },
        { participantId: "b", itemId: "item", shareIndexes: [1] },
      ],
      payments: [
        { payerId: "guest", beneficiaryId: "b", amountPence: 20 },
        { payerId: "a", beneficiaryId: "b", amountPence: 30 },
        { payerId: "a", beneficiaryId: "a", amountPence: 50 },
      ],
    }),
  );

  assert.deepEqual(preview.contributors, [
    { payerId: "guest", contributedPence: 20, selfPaidPence: 0, sponsoredPence: 20 },
    { payerId: "a", contributedPence: 80, selfPaidPence: 50, sponsoredPence: 30 },
  ]);
  assert.deepEqual(
    {
      creditedPence: participant(preview, "b").creditedPence,
      sponsoredByOthersPence: participant(preview, "b").sponsoredByOthersPence,
      unpaidPence: participant(preview, "b").unpaidPence,
    },
    { creditedPence: 50, sponsoredByOthersPence: 50, unpaidPence: 0 },
  );
  assert.equal(participant(preview, "a").contributedPence, 80);
  assert.equal(participant(preview, "a").sponsoredForOthersPence, 30);
  assert.equal(preview.funding.status, "fully_funded");
});

test("partial funding cannot settle and cumulative beneficiary overpayment is rejected", () => {
  const partial = calculateTapTabPreview(
    oneItemBill({ payments: [{ payerId: "a", beneficiaryId: "a", amountPence: 40 }] }),
  );
  assert.deepEqual(partial.funding, {
    requiredPence: 100,
    fundedPence: 40,
    remainingPence: 60,
    status: "partially_funded",
    canSettle: false,
  });
  assert.throws(() => assertCanSettle(partial), /60 pence remains/);

  assert.throws(
    () =>
      calculateTapTabPreview(
        oneItemBill({
          payments: [
            { payerId: "sponsor-1", beneficiaryId: "a", amountPence: 60 },
            { payerId: "sponsor-2", beneficiaryId: "a", amountPence: 41 },
          ],
        }),
      ),
    /overfunds beneficiary a/,
  );
});

test("claims enforce indexed-share bounds, global uniqueness and item capacity", () => {
  const splitItem = [{ id: "item", name: "Shared dish", pricePence: 100, shareSlots: 2 }];
  const people = [person("a"), person("b")];

  for (const shareIndexes of [[], [-1], [0.5], [2]]) {
    assert.throws(() =>
      calculateTapTabPreview(
        oneItemBill({
          items: splitItem,
          participants: people,
          claims: [{ participantId: "a", itemId: "item", shareIndexes }],
        }),
      ),
    );
  }
  assert.throws(
    () =>
      calculateTapTabPreview(
        oneItemBill({
          items: splitItem,
          participants: people,
          claims: [
            { participantId: "a", itemId: "item", shareIndexes: [0] },
            { participantId: "b", itemId: "item", shareIndexes: [0] },
          ],
        }),
      ),
    /share index 0 is claimed more than once/,
  );
  assert.throws(
    () =>
      calculateTapTabPreview(
        oneItemBill({
          items: splitItem,
          claims: [
            { participantId: "a", itemId: "item", shareIndexes: [0] },
            { participantId: "a", itemId: "item", shareIndexes: [1] },
          ],
        }),
      ),
    /duplicate claim/,
  );
  assert.throws(
    () =>
      calculateTapTabPreview(
        oneItemBill({
          items: [
            {
              id: "item",
              name: "Too many shares",
              pricePence: 100,
              shareSlots: MAX_SHARES_PER_ITEM + 1,
            },
          ],
        }),
      ),
    /between 1 and 32/,
  );
  assert.throws(
    () =>
      calculateTapTabPreview(
        oneItemBill({
          items: [
            { id: "item", name: "Sub-penny shares", pricePence: 2, shareSlots: 3 },
          ],
        }),
      ),
    /cannot exceed its pricePence/,
  );
});

test("calculation does not mutate inputs and returns deeply frozen public collections", () => {
  const input = oneItemBill({
    participants: [person("a", { tipVoteBps: 1_000 })],
  });
  const before = structuredClone(input);
  const preview = calculateTapTabPreview(input);

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.isFrozen(preview.items), true);
  assert.equal(Object.isFrozen(preview.items[0]), true);
  assert.equal(Object.isFrozen(preview.items[0].participantAllocations), true);
  assert.equal(
    Object.isFrozen(preview.items[0].participantAllocations[0].shareIndexes),
    true,
  );
  assert.equal(Object.isFrozen(preview.items[0].unclaimedShareIndexes), true);
  assert.equal(Object.isFrozen(preview.participants), true);
  assert.equal(Object.isFrozen(preview.participants[0]), true);
  assert.equal(Object.isFrozen(preview.funding), true);
});

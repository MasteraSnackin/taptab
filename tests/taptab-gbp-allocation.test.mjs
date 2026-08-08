import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  allocateTapTabParticipantPence,
  allocateTapTabPence,
  allocateTapTabSponsorshipPence,
  formatTapTabAmount,
} from "../app/taptab-live-helpers.ts";

const PROPERTY_SEEDS = [0x1020_3040, 0x55aa_55aa, 0x7fff_ffff, 0xc001_d00d];
const FIXTURES_PER_SEED = 2_000;

function createGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

function expectedLargestRemainders(sources, totalPence) {
  const totalWei = sources.reduce((total, source) => total + source.amountWei, 0n);
  const target = BigInt(totalPence);
  const rows = sources.map((source, index) => {
    const numerator = source.amountWei * target;
    return {
      index,
      amountPence: numerator / totalWei,
      remainder: numerator % totalWei,
    };
  });
  const remaining = Number(
    target - rows.reduce((total, row) => total + row.amountPence, 0n),
  );
  const priority = [...rows].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    return left.index - right.index;
  });
  for (let index = 0; index < remaining; index += 1) {
    priority[index].amountPence += 1n;
  }
  return rows.map((row) => Number(row.amountPence));
}

test("allocates tiny grouped values by stable largest remainder and preserves MON", () => {
  const sources = ["first", "second", "third"].map((key) => ({
    key,
    amountWei: 1n,
  }));
  const allocation = allocateTapTabPence(sources, 1);

  assert.deepEqual(
    allocation?.map(({ key, amountPence }) => ({ key, amountPence })),
    [
      { key: "first", amountPence: 1 },
      { key: "second", amountPence: 0 },
      { key: "third", amountPence: 0 },
    ],
  );
  assert.ok(Object.isFrozen(allocation));
  assert.ok(allocation?.every(Object.isFrozen));

  const quote = {
    subtotalPence: 1,
    subtotalWei: 3n,
  };
  const independentlyRounded = formatTapTabAmount(sources[0].amountWei, quote);
  assert.equal(independentlyRounded.primary, "£0.00");
  assert.deepEqual(formatTapTabAmount(sources[0].amountWei, quote, 1), {
    primary: "£0.01",
    secondary: independentlyRounded.secondary,
    unit: "GBP",
  });
  assert.deepEqual(formatTapTabAmount(sources[1].amountWei, quote, 0), {
    primary: "£0.00",
    secondary: independentlyRounded.secondary,
    unit: "GBP",
  });
});

test("rejects unsafe ledgers and handles empty, zero and huge cases exactly", () => {
  assert.deepEqual(allocateTapTabPence([], 0), []);
  assert.deepEqual(
    allocateTapTabPence(
      [
        { key: "zero-a", amountWei: 0n },
        { key: "zero-b", amountWei: 0n },
      ],
      0,
    )?.map(({ amountPence }) => amountPence),
    [0, 0],
  );
  assert.equal(allocateTapTabPence([], 1), undefined);
  assert.equal(allocateTapTabPence([{ key: "zero", amountWei: 0n }], 1), undefined);
  assert.equal(allocateTapTabPence([{ key: "negative", amountWei: -1n }], 0), undefined);
  assert.equal(
    allocateTapTabPence(
      [
        { key: "duplicate", amountWei: 1n },
        { key: "duplicate", amountWei: 1n },
      ],
      1,
    ),
    undefined,
  );
  assert.equal(allocateTapTabPence([{ key: "", amountWei: 1n }], 1), undefined);
  assert.equal(allocateTapTabPence([{ key: "wrong-type", amountWei: 1 }], 1), undefined);
  assert.equal(allocateTapTabPence([{ key: "one", amountWei: 1n }], -1), undefined);
  assert.equal(
    allocateTapTabPence([{ key: "one", amountWei: 1n }], Number.MAX_SAFE_INTEGER + 1),
    undefined,
  );

  const huge = allocateTapTabPence(
    [
      { key: "huge", amountWei: 1n << 255n },
      { key: "medium", amountWei: (1n << 192n) + 17n },
      { key: "tiny", amountWei: 1n },
    ],
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(huge);
  assert.equal(
    huge.reduce((total, row) => total + row.amountPence, 0),
    Number.MAX_SAFE_INTEGER,
  );
  assert.ok(huge.every((row) => Number.isSafeInteger(row.amountPence) && row.amountPence >= 0));
});

test("participant base and tip ledgers conserve their separate bill targets", () => {
  const participants = [
    { key: "a", baseDueWei: 1n, tipDueWei: 1n },
    { key: "b", baseDueWei: 1n, tipDueWei: 1n },
    { key: "c", baseDueWei: 1n, tipDueWei: 1n },
  ];
  const allocation = allocateTapTabParticipantPence(participants, 1, 2);

  assert.deepEqual(allocation, [
    { key: "a", baseDuePence: 1, tipPence: 1, totalDuePence: 2 },
    { key: "b", baseDuePence: 0, tipPence: 1, totalDuePence: 1 },
    { key: "c", baseDuePence: 0, tipPence: 0, totalDuePence: 0 },
  ]);
  assert.equal(allocation?.reduce((total, row) => total + row.baseDuePence, 0), 1);
  assert.equal(allocation?.reduce((total, row) => total + row.tipPence, 0), 2);
  assert.equal(allocation?.reduce((total, row) => total + row.totalDuePence, 0), 3);

  assert.deepEqual(
    allocateTapTabParticipantPence(
      participants.map((participant) => ({ ...participant, tipDueWei: 0n })),
      1,
      0,
    )?.map(({ tipPence }) => tipPence),
    [0, 0, 0],
  );
  assert.equal(
    allocateTapTabParticipantPence(
      [
        { key: "same", baseDueWei: 1n, tipDueWei: 0n },
        { key: "same", baseDueWei: 1n, tipDueWei: 0n },
      ],
      1,
      0,
    ),
    undefined,
  );
});

test("allocates partial contribution pennies before deriving sponsorship", () => {
  const allocation = allocateTapTabSponsorshipPence(
    [
      { key: "alice", totalDueWei: 3n, totalDuePence: 1 },
      { key: "bob", totalDueWei: 0n, totalDuePence: 0 },
    ],
    [
      {
        key: "01-bob-sponsors-alice",
        payerKey: "bob",
        beneficiaryKey: "alice",
        amountWei: 1n,
      },
      {
        key: "02-alice-pays-self",
        payerKey: "alice",
        beneficiaryKey: "alice",
        amountWei: 1n,
      },
      {
        key: "03-external-sponsors-alice",
        payerKey: "external",
        beneficiaryKey: "alice",
        amountWei: 1n,
      },
    ],
  );

  assert.deepEqual(allocation, [
    {
      key: "alice",
      selfPaidPence: 0,
      sponsoredByOthersPence: 1,
      sponsoredForOthersPence: 0,
    },
    {
      key: "bob",
      selfPaidPence: 0,
      sponsoredByOthersPence: 0,
      sponsoredForOthersPence: 1,
    },
  ]);
  assert.equal(
    allocation?.find(({ key }) => key === "alice")?.selfPaidPence +
      allocation?.find(({ key }) => key === "alice")?.sponsoredByOthersPence,
    1,
  );
});

test("sponsorship allocation fails closed for incomplete or ambiguous evidence", () => {
  const participants = [{ key: "alice", totalDueWei: 2n, totalDuePence: 1 }];
  const oneContribution = {
    key: "one",
    payerKey: "alice",
    beneficiaryKey: "alice",
    amountWei: 1n,
  };

  assert.equal(allocateTapTabSponsorshipPence(participants, [oneContribution]), undefined);
  assert.equal(
    allocateTapTabSponsorshipPence(participants, [
      oneContribution,
      { ...oneContribution, amountWei: 1n },
    ]),
    undefined,
  );
  assert.equal(
    allocateTapTabSponsorshipPence(participants, [
      { ...oneContribution, key: "unknown", beneficiaryKey: "unknown" },
    ]),
    undefined,
  );
});

test("8,000 deterministic generated ledgers satisfy exact largest-remainder properties", () => {
  for (const seed of PROPERTY_SEEDS) {
    const random = createGenerator(seed);
    for (let fixture = 0; fixture < FIXTURES_PER_SEED; fixture += 1) {
      const count = 1 + (random() % 12);
      const sources = Array.from({ length: count }, (_, index) => {
        const low = BigInt(random());
        const shift = BigInt(random() % 129);
        const amountWei = random() % 7 === 0 ? 0n : (low + 1n) << shift;
        return { key: `row-${index}`, amountWei };
      });
      const totalWei = sources.reduce((total, source) => total + source.amountWei, 0n);
      const totalPence = totalWei === 0n ? 0 : random() % 1_000_001;
      const context = `seed 0x${seed.toString(16)}, fixture ${fixture}`;
      const allocation = allocateTapTabPence(sources, totalPence);
      const repeated = allocateTapTabPence(sources, totalPence);

      assert.ok(allocation, context);
      assert.deepEqual(repeated, allocation, `${context}: deterministic result`);
      assert.deepEqual(
        allocation.map(({ key }) => key),
        sources.map(({ key }) => key),
        `${context}: source order`,
      );
      assert.deepEqual(
        allocation.map(({ amountPence }) => amountPence),
        totalWei === 0n
          ? Array.from({ length: count }, () => 0)
          : expectedLargestRemainders(sources, totalPence),
        `${context}: stable largest remainders`,
      );
      assert.equal(
        allocation.reduce((total, row) => total + row.amountPence, 0),
        totalPence,
        `${context}: exact conservation`,
      );
      assert.ok(
        allocation.every(
          (row) => Number.isSafeInteger(row.amountPence) && row.amountPence >= 0,
        ),
        `${context}: safe nonnegative rows`,
      );
    }
  }
});

test("4,000 deterministic participant ledgers conserve base, tip and combined dues", () => {
  for (const seed of PROPERTY_SEEDS) {
    const random = createGenerator(seed ^ 0x9e37_79b9);
    for (let fixture = 0; fixture < 1_000; fixture += 1) {
      const count = 1 + (random() % 10);
      const participants = Array.from({ length: count }, (_, index) => ({
        key: `participant-${index}`,
        baseDueWei: random() % 9 === 0 ? 0n : BigInt(random()) + 1n,
        tipDueWei: random() % 5 === 0 ? 0n : BigInt(random()) + 1n,
      }));
      if (participants.every(({ baseDueWei }) => baseDueWei === 0n)) {
        participants[0].baseDueWei = 1n;
      }
      const subtotalPence = random() % 1_000_001;
      const tipPence = participants.every(({ tipDueWei }) => tipDueWei === 0n)
        ? 0
        : random() % 300_001;
      const context = `seed 0x${seed.toString(16)}, participant fixture ${fixture}`;
      const allocation = allocateTapTabParticipantPence(
        participants,
        subtotalPence,
        tipPence,
      );
      const repeated = allocateTapTabParticipantPence(
        participants,
        subtotalPence,
        tipPence,
      );

      assert.ok(allocation, context);
      assert.deepEqual(repeated, allocation, `${context}: deterministic result`);
      assert.deepEqual(
        allocation.map(({ key }) => key),
        participants.map(({ key }) => key),
        `${context}: stable participant order`,
      );
      assert.equal(
        allocation.reduce((total, row) => total + row.baseDuePence, 0),
        subtotalPence,
        `${context}: base conservation`,
      );
      assert.equal(
        allocation.reduce((total, row) => total + row.tipPence, 0),
        tipPence,
        `${context}: tip conservation`,
      );
      assert.equal(
        allocation.reduce((total, row) => total + row.totalDuePence, 0),
        subtotalPence + tipPence,
        `${context}: combined conservation`,
      );
      assert.ok(
        allocation.every(
          (row) =>
            Number.isSafeInteger(row.baseDuePence) &&
            Number.isSafeInteger(row.tipPence) &&
            Number.isSafeInteger(row.totalDuePence) &&
            row.baseDuePence >= 0 &&
            row.tipPence >= 0 &&
            row.totalDuePence === row.baseDuePence + row.tipPence,
        ),
        `${context}: safe participant rows`,
      );
    }
  }
});

test("live grouped displays consume the shared bill-wide ledgers", async () => {
  const [panelSource, appSource] = await Promise.all([
    readFile(new URL("../app/TapTabLivePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(panelSource, /allocateTapTabPence\([\s\S]*?quote\.subtotalPence/);
  assert.match(panelSource, /allocateTapTabParticipantPence\(/);
  assert.match(panelSource, /allocateTapTabSponsorshipPence\(/);
  assert.match(panelSource, /itemDisplayPenceByIndex\.get\(item\.index\)/);
  assert.match(panelSource, /callbackSnapshot && gbpDisplay/);
  assert.doesNotMatch(panelSource, /function allocatePence\(/);
  assert.match(appSource, /participantDisplayPence\?\.totalDuePence/);
  assert.doesNotMatch(
    appSource,
    /formatTapTabAmount\(participant\.remainingDue/,
    "grouped participant rows must not imply an independently rounded remaining ledger",
  );
  assert.doesNotMatch(
    panelSource,
    /total \+ contributionPence\(event\)/,
    "partial contribution events must be allocated as one conserved beneficiary ledger",
  );
});

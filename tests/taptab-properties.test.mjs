import assert from "node:assert/strict";
import test from "node:test";

import { BASIS_POINTS, calculateTapTabPreview } from "../app/taptab-model.ts";
import {
  CURATED_DIFFERENTIAL_FIXTURES,
  PURE_PROPERTY_SEEDS,
  generateTapTabFixture,
} from "./support/taptab-property-fixtures.mjs";

const FIXTURES_PER_SEED = 4_000;

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function expectedMedian(votes) {
  const sorted = [...votes].sort((left, right) => left - right);
  const upper = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[upper]
    : Math.floor((sorted[upper - 1] + sorted[upper]) / 2);
}

function assertSafeNonnegativeInteger(value, label) {
  assert.ok(Number.isSafeInteger(value), `${label} must be a safe integer`);
  assert.ok(value >= 0, `${label} must be nonnegative`);
}

function assertAllNumericFields(value, context, path = "preview") {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (typeof child === "number") {
      assertSafeNonnegativeInteger(child, `${context}: ${childPath}`);
    }
    assertAllNumericFields(child, context, childPath);
  }
}

function assertPreviewProperties(input, context) {
  const inputBefore = structuredClone(input);
  const preview = calculateTapTabPreview(input);
  const repeated = calculateTapTabPreview(input);

  assert.deepEqual(input, inputBefore, `${context}: calculation mutated its input`);
  assert.deepEqual(repeated, preview, `${context}: calculation was not deterministic`);
  assert.ok(Object.isFrozen(preview), `${context}: preview should be frozen`);
  assert.ok(Object.isFrozen(preview.items), `${context}: item list should be frozen`);
  assert.ok(Object.isFrozen(preview.participants), `${context}: participant list should be frozen`);
  assert.ok(Object.isFrozen(preview.funding), `${context}: funding should be frozen`);
  assertAllNumericFields(preview, context);

  const subtotal = sum(input.items.map(({ pricePence }) => pricePence));
  assert.equal(preview.subtotalPence, subtotal, `${context}: subtotal conservation`);
  assert.equal(
    preview.medianTipVoteBps,
    expectedMedian(input.participants.map(({ tipVoteBps }) => tipVoteBps)),
    `${context}: median tip vote`,
  );
  assert.equal(
    preview.tipPence,
    Math.floor((subtotal * preview.medianTipVoteBps) / BASIS_POINTS),
    `${context}: bill tip rounding`,
  );

  for (const [itemIndex, item] of preview.items.entries()) {
    const inputItem = input.items[itemIndex];
    const claimedIndexes = item.participantAllocations.flatMap(
      ({ shareIndexes }) => shareIndexes,
    );
    assert.equal(new Set(claimedIndexes).size, claimedIndexes.length, `${context}: unique slots`);
    assert.equal(item.claimedSlots + item.unclaimedSlots, item.shareSlots, `${context}: slot total`);
    assert.equal(item.claimedPence + item.unclaimedPence, item.pricePence, `${context}: item total`);
    assert.equal(
      sum(item.participantAllocations.map(({ amountPence }) => amountPence)),
      item.claimedPence,
      `${context}: claimed item value`,
    );
    const equalShare = Math.floor(inputItem.pricePence / inputItem.shareSlots);
    const dust = inputItem.pricePence % inputItem.shareSlots;
    for (const allocation of item.participantAllocations) {
      const exact = sum(
        allocation.shareIndexes.map(
          (shareIndex) => equalShare + (shareIndex < dust ? 1 : 0),
        ),
      );
      assert.equal(allocation.amountPence, exact, `${context}: exact slot value`);
    }
  }

  const claimed = sum(preview.items.map(({ claimedPence }) => claimedPence));
  const unclaimed = sum(preview.items.map(({ unclaimedPence }) => unclaimedPence));
  assert.equal(claimed + unclaimed, subtotal, `${context}: claimed/unclaimed conservation`);
  assert.equal(preview.unclaimedPence, unclaimed, `${context}: unclaimed bill value`);
  assert.equal(
    sum(preview.participants.map(({ claimedPence }) => claimedPence)),
    claimed,
    `${context}: participant claimed total`,
  );
  assert.equal(
    sum(preview.participants.map(({ remainderPence }) => remainderPence)),
    unclaimed,
    `${context}: fair remainder total`,
  );
  assert.equal(
    sum(preview.participants.map(({ baseDuePence }) => baseDuePence)),
    subtotal,
    `${context}: base due conservation`,
  );
  assert.equal(
    sum(preview.participants.map(({ tipPence }) => tipPence)),
    preview.tipPence,
    `${context}: participant tip conservation`,
  );
  assert.equal(preview.totalDuePence, subtotal + preview.tipPence, `${context}: bill total`);
  assert.equal(
    sum(preview.participants.map(({ totalDuePence }) => totalDuePence)),
    preview.totalDuePence,
    `${context}: participant due conservation`,
  );

  const funded = sum(preview.payments.map(({ amountPence }) => amountPence));
  assert.equal(preview.funding.requiredPence, preview.totalDuePence, `${context}: funding required`);
  assert.equal(preview.funding.fundedPence, funded, `${context}: funded payment total`);
  assert.equal(
    sum(preview.participants.map(({ creditedPence }) => creditedPence)),
    funded,
    `${context}: beneficiary funding total`,
  );
  assert.equal(
    sum(preview.contributors.map(({ contributedPence }) => contributedPence)),
    funded,
    `${context}: contributor funding total`,
  );
  assert.equal(
    preview.funding.remainingPence,
    preview.totalDuePence - funded,
    `${context}: remaining funding`,
  );
  assert.equal(preview.funding.canSettle, funded === preview.totalDuePence, `${context}: settlement guard`);
  assert.equal(
    preview.funding.status,
    funded === 0
      ? "unfunded"
      : funded === preview.totalDuePence
        ? "fully_funded"
        : "partially_funded",
    `${context}: funding status`,
  );

  for (const participant of preview.participants) {
    assert.equal(
      participant.baseDuePence,
      participant.claimedPence + participant.remainderPence,
      `${context}: participant base due`,
    );
    assert.equal(
      participant.totalDuePence,
      participant.baseDuePence + participant.tipPence,
      `${context}: participant total due`,
    );
    assert.equal(
      participant.unpaidPence,
      participant.totalDuePence - participant.creditedPence,
      `${context}: participant unpaid`,
    );
  }
}

test("12,000 deterministic generated TapTab bills conserve all integer money", () => {
  const coverage = {
    oddParticipants: false,
    evenParticipants: false,
    customTip: false,
    unclaimed: false,
    shareDust: false,
    tipDust: false,
    sponsorship: false,
    unfunded: false,
    partiallyFunded: false,
    fullyFunded: false,
  };

  for (const seed of PURE_PROPERTY_SEEDS) {
    for (let fixtureIndex = 0; fixtureIndex < FIXTURES_PER_SEED; fixtureIndex += 1) {
      const seedLabel = `0x${seed.toString(16).padStart(8, "0")}`;
      const context = `seed ${seedLabel}, fixture ${fixtureIndex}`;
      try {
        const input = generateTapTabFixture(seed, fixtureIndex);
        const preview = calculateTapTabPreview(input);
        coverage.oddParticipants ||= input.participants.length % 2 === 1;
        coverage.evenParticipants ||= input.participants.length % 2 === 0;
        coverage.customTip ||= input.participants.some(
          ({ tipVoteBps }) => ![0, 1_000, 1_250, 2_000, 3_000].includes(tipVoteBps),
        );
        coverage.unclaimed ||= preview.unclaimedPence > 0;
        coverage.shareDust ||= input.items.some(
          ({ pricePence, shareSlots }) => pricePence % shareSlots !== 0,
        );
        coverage.tipDust ||= preview.participants.some(({ baseDuePence, tipPence }) =>
          tipPence > Math.floor((baseDuePence * preview.medianTipVoteBps) / BASIS_POINTS),
        );
        coverage.sponsorship ||= preview.payments.some(({ isSponsorship }) => isSponsorship);
        coverage.unfunded ||= preview.funding.status === "unfunded";
        coverage.partiallyFunded ||= preview.funding.status === "partially_funded";
        coverage.fullyFunded ||= preview.funding.status === "fully_funded";
        assertPreviewProperties(input, context);
      } catch (error) {
        throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    }
  }

  assert.deepEqual(coverage, Object.fromEntries(Object.keys(coverage).map((key) => [key, true])));
});

test("the eight curated differential edge cases satisfy the same invariants", () => {
  for (const fixture of CURATED_DIFFERENTIAL_FIXTURES) {
    assertPreviewProperties(fixture.input, `curated fixture ${fixture.id}`);
  }
});

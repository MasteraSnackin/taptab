import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECEIPT_OCR_CHARACTERS,
  parseGbpAmountToPence,
  parseUkReceiptOcr,
  serialiseReceiptSplitVersion,
} from "../app/taptab-receipt.ts";

function warningCodes(receipt) {
  return receipt.warnings.map((warning) => warning.code);
}

test("parses a common UK receipt without floating point or invented values", () => {
  const receipt = parseUkReceiptOcr(`Dishoom Shoreditch
7 Boundary Street
Bhel ........ £8.90
2 x House Chai 7.00
SUBTOTAL £15.90
Discretionary Service Charge 12.5% £1.99
TOTAL £17.89`);

  assert.equal(receipt.currency, "GBP");
  assert.equal(receipt.merchant, "Dishoom Shoreditch");
  assert.deepEqual(
    receipt.items.map(({ name, pricePence }) => ({ name, pricePence })),
    [
      { name: "Bhel", pricePence: 890 },
      { name: "2 x House Chai", pricePence: 700 },
    ],
  );
  assert.equal(receipt.itemTotalPence, 1_590);
  assert.equal(receipt.serviceRateBps, 1_250);
  assert.equal(receipt.serviceChargePence, 199);
  assert.equal(receipt.subtotalPence, 1_590);
  assert.equal(receipt.totalPence, 1_789);
  assert.equal(receipt.calculatedTotalPence, 1_789);
  assert.deepEqual(receipt.warnings, []);
});

test("captures discounts but refuses to calculate a missing service amount", () => {
  const receipt = parseUkReceiptOcr(`Corner Cafe
Toast £10.00
Juice £5.00
Voucher 2.50-
SUBTOTAL £12.50
SERVICE CHARGE 10%
TOTAL £12.50`);

  assert.deepEqual(
    receipt.discounts.map(({ label, amountPence }) => ({ label, amountPence })),
    [{ label: "Voucher", amountPence: 250 }],
  );
  assert.equal(receipt.itemTotalPence, 1_500);
  assert.equal(receipt.discountTotalPence, 250);
  assert.equal(receipt.subtotalPence, 1_250);
  assert.equal(receipt.serviceRateBps, 1_000);
  assert.equal(receipt.serviceChargePence, undefined);
  assert.equal(receipt.calculatedTotalPence, undefined);
  assert.ok(warningCodes(receipt).includes("service_amount_missing"));
  assert.equal(warningCodes(receipt).includes("total_mismatch"), false);
});

test("retains duplicate item lines and warns instead of guessing deduplication", () => {
  const receipt = parseUkReceiptOcr(`Cafe Seven
Tea £3.25
Tea £3.25
SUBTOTAL £6.50
TOTAL £6.50`);

  assert.equal(receipt.items.length, 2);
  assert.equal(receipt.itemTotalPence, 650);
  assert.equal(
    receipt.warnings.filter((warning) => warning.code === "duplicate_line").length,
    1,
  );
});

test("malformed OCR amounts remain unset with explicit warnings", () => {
  const receipt = parseUkReceiptOcr(`Example Kitchen
Burger £12.345
SUBTOTAL £oops
TOTAL 12,50`);

  assert.deepEqual(receipt.items, []);
  assert.equal(receipt.subtotalPence, undefined);
  assert.equal(receipt.totalPence, undefined);
  assert.ok(warningCodes(receipt).includes("amount_unreadable"));
  assert.ok(warningCodes(receipt).includes("items_missing"));
  assert.ok(warningCodes(receipt).includes("subtotal_missing"));
  assert.ok(warningCodes(receipt).includes("total_missing"));
});

test("conflicting printed totals fail closed instead of selecting one", () => {
  const receipt = parseUkReceiptOcr(`The Diner
Lunch £10.00
SUBTOTAL £10.00
TOTAL £10.00
TOTAL £11.00`);

  assert.equal(receipt.totalPence, undefined);
  assert.ok(warningCodes(receipt).includes("conflicting_total"));
  assert.ok(warningCodes(receipt).includes("total_missing"));
});

test("GBP decimal parsing accepts receipt conventions and rejects ambiguity", () => {
  assert.equal(parseGbpAmountToPence("£12.34"), 1_234);
  assert.equal(parseGbpAmountToPence("12.3"), 1_230);
  assert.equal(parseGbpAmountToPence("GBP 1,234.56"), 123_456);
  assert.equal(parseGbpAmountToPence("-£2.50"), -250);
  assert.equal(parseGbpAmountToPence("£-2.50"), -250);
  assert.equal(parseGbpAmountToPence("(2.50)"), -250);
  assert.equal(parseGbpAmountToPence("2.50-"), -250);
  assert.equal(parseGbpAmountToPence("12"), 1_200);
  for (const malformed of ["12.345", "12,50", "1e2", "£", "--2.00", "(2.00-"]) {
    assert.equal(parseGbpAmountToPence(malformed), undefined, malformed);
  }
});

test("receipt OCR has explicit resource bounds", () => {
  assert.throws(
    () => parseUkReceiptOcr("x".repeat(MAX_RECEIPT_OCR_CHARACTERS + 1)),
    /exceeds 50000 characters/,
  );
});

test("canonical receipt/split versions ignore claim ordering but detect edits", () => {
  const base = {
    receipt: {
      currency: "GBP",
      merchant: "Cafe Seven",
      items: [{ id: "tea", name: "Tea", pricePence: 975, shareSlots: 3 }],
      discounts: [{ id: "offer", label: "Lunch offer", amountPence: 75 }],
      serviceChargePence: 100,
      subtotalPence: 900,
      totalPence: 1_000,
    },
    split: {
      participants: [
        { id: "alice", remainderOptIn: true, tipVoteBps: 1_000 },
        { id: "bob", remainderOptIn: false, tipVoteBps: 1_250 },
      ],
      claims: [
        { participantId: "bob", itemId: "tea", shareIndexes: [2] },
        { participantId: "alice", itemId: "tea", shareIndexes: [1, 0] },
      ],
    },
  };
  const reordered = structuredClone(base);
  reordered.split.claims = [
    { participantId: "alice", itemId: "tea", shareIndexes: [0] },
    { participantId: "bob", itemId: "tea", shareIndexes: [2] },
    { participantId: "alice", itemId: "tea", shareIndexes: [1] },
  ];

  const first = serialiseReceiptSplitVersion(base);
  const second = serialiseReceiptSplitVersion(reordered);
  assert.equal(first, second);
  assert.equal(JSON.parse(first).schema, "taptab-receipt-split");

  const edited = structuredClone(base);
  edited.receipt.items[0].pricePence = 976;
  assert.notEqual(serialiseReceiptSplitVersion(edited), first);
});

test("canonical serialisation rejects duplicate indexed ownership", () => {
  assert.throws(
    () =>
      serialiseReceiptSplitVersion({
        receipt: {
          currency: "GBP",
          items: [{ id: "tea", name: "Tea", pricePence: 300, shareSlots: 2 }],
        },
        split: {
          participants: [
            { id: "a", remainderOptIn: false, tipVoteBps: 0 },
            { id: "b", remainderOptIn: false, tipVoteBps: 0 },
          ],
          claims: [
            { participantId: "a", itemId: "tea", shareIndexes: [0] },
            { participantId: "b", itemId: "tea", shareIndexes: [0] },
          ],
        },
      }),
    /share 0 is claimed twice/,
  );
});

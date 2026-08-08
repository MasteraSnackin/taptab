import assert from "node:assert/strict";
import test from "node:test";

import {
  createTapTabSettlementReceiptText,
  tapTabSettlementReceiptFileName,
  tapTabSettlementReceiptLines,
  validateTapTabSettlementReceipt,
} from "../app/taptab-settlement-receipt.ts";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"a".repeat(64)}`;

function receipt(overrides = {}) {
  return {
    merchant: "Lina Stores",
    tableLabel: "Table 7",
    subtotalPence: 4_850,
    tipPence: 550,
    totalDuePence: 5_400,
    fundedPence: 5_400,
    allocations: [
      {
        id: "alice",
        displayName: "Alice",
        walletAddress: ALICE,
        totalDuePence: 3_000,
        selfPaidPence: 2_400,
        sponsoredByOthersPence: 600,
        sponsoredForOthersPence: 0,
      },
      {
        id: "bob",
        displayName: "Bob",
        walletAddress: BOB,
        totalDuePence: 2_400,
        selfPaidPence: 2_400,
        sponsoredByOthersPence: 0,
        sponsoredForOthersPence: 600,
      },
    ],
    evidence: {
      kind: "monad",
      chainId: 10_143,
      billId: 7n,
      transactionHash: HASH,
      blockNumber: 51_733_815n,
      explorerUrl: `https://testnet.monadexplorer.com/tx/${HASH}`,
    },
    receiptUrl:
      "https://taptab.example/?contract=0x3333333333333333333333333333333333333333&bill=7#live",
    identityIsPrivate: true,
    ...overrides,
  };
}

test("live receipt identity stays hidden until explicitly included", () => {
  const hidden = tapTabSettlementReceiptLines(receipt());
  assert.deepEqual(
    hidden.map(({ label, walletAddress }) => ({ label, walletAddress })),
    [
      { label: "Diner 1", walletAddress: undefined },
      { label: "Diner 2", walletAddress: undefined },
    ],
  );

  const hiddenText = createTapTabSettlementReceiptText(receipt());
  assert.equal(hiddenText.includes("Alice"), false);
  assert.equal(hiddenText.includes(ALICE), false);
  assert.match(hiddenText, /Confirmed on Monad Testnet/);
  assert.match(hiddenText, new RegExp(HASH));

  const disclosed = tapTabSettlementReceiptLines(receipt(), {
    includePrivateIdentity: true,
  });
  assert.equal(disclosed[0].label, "Alice");
  assert.equal(disclosed[0].walletAddress, ALICE);
});

test("sample receipts keep their fictional names and label the lack of chain evidence", () => {
  const sample = receipt({
    evidence: {
      kind: "preview",
      message: "Local rehearsal only; no blockchain transaction.",
    },
    receiptUrl: "http://localhost:3000/?workspace=preview#bill",
    identityIsPrivate: false,
  });
  const text = createTapTabSettlementReceiptText(sample);
  assert.match(text, /Alice · £30\.00/);
  assert.match(text, /sponsored by others £6\.00/);
  assert.match(text, /Local rehearsal only; no blockchain transaction/);
  assert.equal(text.includes("Confirmed on Monad"), false);
});

test("settlement receipts fail closed on incomplete or inconsistent money", () => {
  assert.throws(
    () => validateTapTabSettlementReceipt(receipt({ fundedPence: 5_399 })),
    /exact total/,
  );
  assert.throws(
    () =>
      validateTapTabSettlementReceipt(
        receipt({
          allocations: [
            { ...receipt().allocations[0], sponsoredByOthersPence: 599 },
            receipt().allocations[1],
          ],
        }),
      ),
    /covered by self-payment and sponsorship/,
  );
  assert.throws(
    () =>
      validateTapTabSettlementReceipt(
        receipt({
          evidence: {
            ...receipt().evidence,
            explorerUrl: "https://testnet.monadexplorer.com/tx/0xdead",
          },
        }),
      ),
    /identify the settlement transaction/,
  );
});

test("download names are stable and safe", () => {
  assert.equal(
    tapTabSettlementReceiptFileName(receipt()),
    "taptab-lina-stores-bill-7-receipt.png",
  );
  assert.equal(
    tapTabSettlementReceiptFileName({
      merchant: "Élodie’s Café / London",
      evidence: { kind: "preview", message: "Sample" },
    }),
    "taptab-elodie-s-cafe-london-sample-receipt.png",
  );
});

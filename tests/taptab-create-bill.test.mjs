import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";

import {
  TAPTAB_CREATE_BILL_QUOTE_MAX_AGE_SECONDS,
  allocateReceiptPenceToWei,
  finiteNumberToPlainDecimal,
  findConfirmedTapTabBillCreated,
  parsePositiveDecimal,
  prepareTapTabBill,
} from "../app/taptab-create-bill.ts";
import { TAPTAB_MONAD_TESTNET, tapTabAbi } from "../app/taptab-chain.ts";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const PAYEE = "0x3333333333333333333333333333333333333333";
const OTHER = "0x4444444444444444444444444444444444444444";
const NOW = 1_800_000_000;

const RECEIPT = {
  merchant: "The Green Room",
  items: [
    { id: "starter", name: "Shared starter", pricePence: 1_001, shareSlots: 3 },
    { id: "main", name: "Main", pricePence: 2_000, shareSlots: 1 },
  ],
};

const QUOTE = {
  gbpPerMon: "0.025000",
  source: "CoinGecko",
  basis: "mainnet MON reference",
  observedAtUnixSeconds: NOW - 30,
};

function prepare(overrides = {}) {
  return prepareTapTabBill({
    trustedContract: { address: CONTRACT, chainId: TAPTAB_MONAD_TESTNET.id },
    receipt: RECEIPT,
    quote: QUOTE,
    payee: PAYEE,
    deadlineUnixSeconds: NOW + 7_200,
    nowUnixSeconds: NOW,
    confirmations: { payee: true, deadline: true, quote: true },
    ...overrides,
  });
}

test("parses only exact positive decimal quote strings", () => {
  assert.deepEqual(parsePositiveDecimal("0.025000"), {
    canonical: "0.025",
    numerator: 25n,
    scale: 1_000n,
  });
  assert.deepEqual(parsePositiveDecimal("12"), {
    canonical: "12",
    numerator: 12n,
    scale: 1n,
  });

  for (const value of ["0", "-1", " 1", "1 ", ".25", "1.", "1e-3", "01", "NaN"]) {
    assert.throws(() => parsePositiveDecimal(value), { name: /TypeError|RangeError/ }, value);
  }
  assert.throws(() => parsePositiveDecimal("0.1234567890123456789"), /at most 18/);
});

test("converts finite API quote numbers to plain decimal strings", () => {
  assert.equal(finiteNumberToPlainDecimal(0.025), "0.025");
  assert.equal(finiteNumberToPlainDecimal(1e-7), "0.0000001");
  assert.equal(finiteNumberToPlainDecimal(1.25e3), "1250");
  assert.throws(() => finiteNumberToPlainDecimal(0), /positive finite/);
  assert.throws(() => finiteNumberToPlainDecimal(Number.NaN), /positive finite/);
});

test("converts pence to wei without floating point and reconciles item dust", () => {
  assert.deepEqual(allocateReceiptPenceToWei([100, 100], "2"), {
    itemAmountsWei: [500_000_000_000_000_000n, 500_000_000_000_000_000n],
    subtotalWei: 1_000_000_000_000_000_000n,
  });

  const thirds = allocateReceiptPenceToWei([100, 100], "3");
  assert.deepEqual(thirds.itemAmountsWei, [
    333_333_333_333_333_334n,
    333_333_333_333_333_333n,
  ]);
  assert.equal(thirds.subtotalWei, 666_666_666_666_666_667n);
  assert.equal(
    thirds.itemAmountsWei.reduce((sum, amount) => sum + amount, 0n),
    thirds.subtotalWei,
  );

  assert.throws(() => allocateReceiptPenceToWei([], "1"), /At least one/);
  assert.throws(() => allocateReceiptPenceToWei([0], "1"), /positive integer pence/);
});

test("prepares an exact Monad Testnet createBill request and auditable metadata", () => {
  const prepared = prepare();
  assert.equal(prepared.contractAddress, CONTRACT);
  assert.equal(prepared.payee, PAYEE);
  assert.equal(prepared.deadline, BigInt(NOW + 7_200));
  assert.equal(prepared.subtotalPence, 3_001);
  assert.equal(
    prepared.itemAmountsWei.reduce((sum, amount) => sum + amount, 0n),
    prepared.subtotalWei,
  );
  assert.deepEqual(prepared.shareCounts, [3, 1]);
  assert.equal(prepared.write.functionName, "createBill");
  assert.equal(prepared.write.address, CONTRACT);
  assert.deepEqual(prepared.write.args, [
    PAYEE,
    prepared.metadataURI,
    BigInt(NOW + 7_200),
    [...prepared.itemAmountsWei],
    [3, 1],
  ]);

  assert.deepEqual(prepared.metadata, {
    schema: "taptab-gbp-receipt",
    version: 1,
    currency: "GBP",
    merchant: "The Green Room",
    subtotalPence: 3_001,
    items: [
      { name: "Shared starter", amountPence: 1_001 },
      { name: "Main", amountPence: 2_000 },
    ],
    quote: {
      gbpPerMon: "0.025",
      source: "CoinGecko",
      basis: "mainnet MON reference",
      observedAtUnixSeconds: NOW - 30,
      lockedAtUnixSeconds: NOW,
      allocation: "largest-remainder-half-up",
      subtotalWei: prepared.subtotalWei.toString(),
    },
  });
  assert.equal(prepared.metadataURI.startsWith("data:application/json,"), true);
  const decodedMetadata = JSON.parse(
    decodeURIComponent(prepared.metadataURI.slice("data:application/json,".length)),
  );
  assert.deepEqual(decodedMetadata, prepared.metadata);
});

test("fails closed unless payee, deadline and a fresh quote are explicitly confirmed", () => {
  for (const missing of ["payee", "deadline", "quote"]) {
    assert.throws(
      () =>
        prepare({
          confirmations: {
            payee: missing !== "payee",
            deadline: missing !== "deadline",
            quote: missing !== "quote",
          },
        }),
      /Confirm the payee, deadline and quote/,
    );
  }

  assert.equal(TAPTAB_CREATE_BILL_QUOTE_MAX_AGE_SECONDS, 300);
  assert.throws(
    () =>
      prepare({
        quote: {
          ...QUOTE,
          observedAtUnixSeconds: NOW - TAPTAB_CREATE_BILL_QUOTE_MAX_AGE_SECONDS - 1,
        },
      }),
    /older than five minutes/,
  );
  assert.throws(
    () => prepare({ deadlineUnixSeconds: NOW }),
    /deadline must be in the future/,
  );
  assert.throws(
    () => prepare({ trustedContract: { address: CONTRACT, chainId: 1 } }),
    /restricted to the trusted Monad Testnet chain/,
  );
  assert.throws(() => prepare({ payee: "not-an-address" }), /valid EVM address/);
  assert.throws(
    () => prepare({ receipt: { ...RECEIPT, merchant: " The Green Room" } }),
    /Merchant must be a clean/,
  );
});

function creationLog(prepared, overrides = {}) {
  const args = {
    billId: 9n,
    creator: CREATOR,
    payee: prepared.payee,
    deadline: prepared.deadline,
    subtotal: prepared.subtotalWei,
    metadataURI: prepared.metadataURI,
    ...overrides,
  };
  return {
    address: CONTRACT,
    topics: encodeEventTopics({
      abi: tapTabAbi,
      eventName: "BillCreated",
      args: {
        billId: args.billId,
        creator: args.creator,
        payee: args.payee,
      },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("uint64 deadline, uint256 subtotal, string metadataURI"),
      [args.deadline, args.subtotal, args.metadataURI],
    ),
  };
}

test("accepts only the exact BillCreated event from the trusted contract", () => {
  const prepared = prepare();
  const expected = {
    contractAddress: CONTRACT,
    creator: CREATOR,
    payee: prepared.payee,
    deadline: prepared.deadline,
    subtotalWei: prepared.subtotalWei,
    metadataURI: prepared.metadataURI,
  };
  const unrelated = { ...creationLog(prepared), address: OTHER };
  const confirmed = findConfirmedTapTabBillCreated(
    [unrelated, creationLog(prepared)],
    expected,
  );
  assert.deepEqual(confirmed, {
    context: { address: CONTRACT, billId: 9n },
    creator: CREATOR,
    payee: PAYEE,
    deadline: prepared.deadline,
    subtotalWei: prepared.subtotalWei,
    metadataURI: prepared.metadataURI,
  });

  assert.throws(
    () => findConfirmedTapTabBillCreated([creationLog(prepared, { creator: OTHER })], expected),
    /did not contain the expected BillCreated event/,
  );
  assert.throws(
    () =>
      findConfirmedTapTabBillCreated(
        [creationLog(prepared, { subtotal: prepared.subtotalWei + 1n })],
        expected,
      ),
    /did not contain the expected BillCreated event/,
  );
});

test("the panel verifies Monad chain state and waits for a successful event receipt", async () => {
  const source = await readFile(
    new URL("../app/TapTabCreateBillPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /switchTapTabWalletToMonadTestnet\(provider\)/);
  assert.match(source, /publicClient\.simulateContract/);
  assert.equal(
    source.match(/simulateExactCreation\(\)/g)?.length,
    2,
    "bill creation must be simulated before network interaction and immediately before submission",
  );
  assert.match(source, /publicClient\.getChainId/);
  assert.match(source, /publicClient\.estimateContractGas/);
  assert.match(source, /publicClient\.estimateFeesPerGas/);
  assert.match(source, /publicClient\.getBalance/);
  assert.match(source, /calculateBufferedGasLimit/);
  assert.match(source, /Nothing was submitted/);
  assert.match(source, /waitForTransactionReceipt/);
  assert.match(source, /receiptResult\.status !== "success"/);
  assert.match(source, /findConfirmedTapTabBillCreated/);
  assert.match(source, /const submittedAt = Date\.now\(\)/);
  assert.match(source, /const confirmedAt = Date\.now\(\)/);
  assert.match(source, /Math\.max\(0, confirmedAt - pending\.submittedAt\)/);
  assert.match(source, /visibleSubmissionState === "unverified"/);
  assert.match(source, /Check status again/);
  assert.match(source, /MonadVision shows failed · reset/);
  assert.match(source, /submissionLockRef\.current/);
  assert.match(source, /Confirmed on Monad in/);
  assert.match(source, /onCreated\(\{/);
});

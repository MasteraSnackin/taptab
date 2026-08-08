import assert from "node:assert/strict";
import test from "node:test";

import {
  PENDING_TAPTAB_TRANSACTION_MAX_AGE_MS,
  PENDING_TAPTAB_TRANSACTION_MAX_ENTRIES,
  parsePendingTapTabTransactions,
  pendingTapTabTransactionScopeKey,
  pendingTapTabTransactionsForScope,
  removePendingTapTabTransaction,
  replacePendingTapTabTransactionHash,
  serialisePendingTapTabTransactions,
  upsertPendingTapTabTransaction,
} from "../app/taptab-pending-transactions.ts";

const NOW = 2_000_000_000_000;
const CONTRACT = "0x1111111111111111111111111111111111111111";
const OTHER_CONTRACT = "0x2222222222222222222222222222222222222222";
const ACCOUNT = "0x3333333333333333333333333333333333333333";
const OTHER_ACCOUNT = "0x4444444444444444444444444444444444444444";
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;

function pending(overrides = {}) {
  return {
    chainId: 10_143,
    contract: CONTRACT,
    billId: "7",
    account: ACCOUNT,
    action: "Fund bill",
    hash: HASH_A,
    submittedAt: NOW - 1_000,
    ...overrides,
  };
}

function envelope(transactions, version = 1) {
  return JSON.stringify({ version, transactions });
}

test("parses only bounded, current and structurally valid pending transactions", () => {
  const parsed = parsePendingTapTabTransactions(
    envelope([
      pending(),
      pending({ hash: HASH_B, action: "  Claim shares  " }),
      pending({ account: "not-an-address" }),
      pending({ action: "Fund\u0000bill" }),
      pending({ billId: "0" }),
      pending({ hash: "0x1234" }),
      pending({ submittedAt: NOW - PENDING_TAPTAB_TRANSACTION_MAX_AGE_MS - 1 }),
      pending({ submittedAt: NOW + 5 * 60_000 + 1 }),
    ]),
    NOW,
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].action, "Fund bill");
  assert.equal(parsed[1].action, "Claim shares");
  assert.equal(parsed[0].contract, CONTRACT);
  assert.equal(parsed[0].account, ACCOUNT);
});

test("rejects malformed, oversized and unknown-version storage without throwing", () => {
  assert.deepEqual(parsePendingTapTabTransactions("{", NOW), []);
  assert.deepEqual(parsePendingTapTabTransactions(envelope([pending()], 2), NOW), []);
  assert.deepEqual(parsePendingTapTabTransactions("x".repeat(32_769), NOW), []);
  assert.deepEqual(parsePendingTapTabTransactions(null, NOW), []);
});

test("scopes restored records to the exact chain, contract, bill and wallet", () => {
  const transactions = [
    pending(),
    pending({ hash: HASH_B, account: OTHER_ACCOUNT }),
    pending({ hash: `0x${"c".repeat(64)}`, contract: OTHER_CONTRACT }),
    pending({ hash: `0x${"d".repeat(64)}`, billId: "8" }),
    pending({ hash: `0x${"e".repeat(64)}`, chainId: 1 }),
  ];
  const scope = {
    chainId: 10_143,
    contract: CONTRACT,
    billId: "7",
    account: ACCOUNT,
  };

  assert.match(
    pendingTapTabTransactionScopeKey(scope),
    /^10143:0x[0-9a-f]{40}:7:0x[0-9a-f]{40}$/,
  );
  assert.deepEqual(
    pendingTapTabTransactionsForScope(transactions, scope).map(({ hash }) => hash),
    [HASH_A],
  );
});

test("deduplicates, orders and caps persisted transactions", () => {
  let transactions = [];
  for (let index = 0; index < PENDING_TAPTAB_TRANSACTION_MAX_ENTRIES + 3; index += 1) {
    transactions = upsertPendingTapTabTransaction(
      transactions,
      pending({
        hash: `0x${index.toString(16).padStart(64, "0")}`,
        submittedAt: NOW - index,
      }),
      NOW,
    );
  }

  assert.equal(transactions.length, PENDING_TAPTAB_TRANSACTION_MAX_ENTRIES);
  assert.equal(transactions[0].submittedAt, NOW);
  const roundTrip = parsePendingTapTabTransactions(
    serialisePendingTapTabTransactions(transactions, NOW),
    NOW,
  );
  assert.deepEqual(roundTrip, transactions);
});

test("moves repriced hashes and removes completed hashes only within their scope", () => {
  const scope = pending();
  const otherWallet = pending({ account: OTHER_ACCOUNT });
  const transactions = [scope, otherWallet];

  const repriced = replacePendingTapTabTransactionHash(
    transactions,
    scope,
    HASH_A,
    HASH_B,
    NOW,
  );
  assert.equal(repriced[0].hash, HASH_B);
  assert.equal(repriced[1].hash, HASH_A);

  const remaining = removePendingTapTabTransaction(repriced, scope, HASH_B);
  assert.deepEqual(remaining, [otherWallet]);
});

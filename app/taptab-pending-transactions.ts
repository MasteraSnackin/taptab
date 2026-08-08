import { getAddress, isAddress, type Address, type Hash } from "viem";

export const PENDING_TAPTAB_TRANSACTION_STORAGE_KEY =
  "taptab.pending-transactions.v1";
export const PENDING_TAPTAB_TRANSACTION_MAX_AGE_MS = 24 * 60 * 60_000;
export const PENDING_TAPTAB_TRANSACTION_MAX_ENTRIES = 10;

const STORAGE_VERSION = 1;
const MAX_STORAGE_BYTES = 32_768;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_ACTION_LENGTH = 80;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const BILL_ID_PATTERN = /^[1-9][0-9]{0,77}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type PendingTapTabTransaction = Readonly<{
  chainId: number;
  contract: Address;
  billId: string;
  account: Address;
  action: string;
  hash: Hash;
  submittedAt: number;
}>;

export type PendingTapTabTransactionScope = Readonly<{
  chainId: number;
  contract: Address;
  billId: string;
  account: Address;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storageByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normaliseScope(
  value: PendingTapTabTransactionScope,
): PendingTapTabTransactionScope | undefined {
  if (
    !Number.isSafeInteger(value.chainId) ||
    value.chainId <= 0 ||
    !isAddress(value.contract) ||
    !BILL_ID_PATTERN.test(value.billId) ||
    !isAddress(value.account)
  ) {
    return undefined;
  }

  return {
    chainId: value.chainId,
    contract: getAddress(value.contract),
    billId: value.billId,
    account: getAddress(value.account),
  };
}

function normaliseTransaction(
  value: unknown,
  now: number,
): PendingTapTabTransaction | undefined {
  if (!isRecord(value)) return undefined;

  const chainId = value.chainId;
  const contract = value.contract;
  const billId = value.billId;
  const account = value.account;
  const action = value.action;
  const hash = value.hash;
  const submittedAt = value.submittedAt;
  if (
    typeof chainId !== "number" ||
    typeof contract !== "string" ||
    typeof billId !== "string" ||
    typeof account !== "string" ||
    typeof action !== "string" ||
    typeof hash !== "string" ||
    typeof submittedAt !== "number"
  ) {
    return undefined;
  }

  const scope = normaliseScope({
    chainId,
    contract: contract as Address,
    billId,
    account: account as Address,
  });
  const trimmedAction = action.trim();
  if (
    !scope ||
    !trimmedAction ||
    trimmedAction.length > MAX_ACTION_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(trimmedAction) ||
    !HASH_PATTERN.test(hash) ||
    !Number.isSafeInteger(submittedAt) ||
    submittedAt <= 0 ||
    submittedAt < now - PENDING_TAPTAB_TRANSACTION_MAX_AGE_MS ||
    submittedAt > now + MAX_FUTURE_SKEW_MS
  ) {
    return undefined;
  }

  return {
    ...scope,
    action: trimmedAction,
    hash: hash.toLowerCase() as Hash,
    submittedAt,
  };
}

export function pendingTapTabTransactionScopeKey(
  scope: PendingTapTabTransactionScope,
): string {
  const normalised = normaliseScope(scope);
  if (!normalised) return "";
  return [
    normalised.chainId,
    normalised.contract.toLowerCase(),
    normalised.billId,
    normalised.account.toLowerCase(),
  ].join(":");
}

function transactionKey(transaction: PendingTapTabTransaction): string {
  return `${pendingTapTabTransactionScopeKey(transaction)}:${transaction.hash.toLowerCase()}`;
}

function normaliseList(
  values: readonly unknown[],
  now: number,
): PendingTapTabTransaction[] {
  const byKey = new Map<string, PendingTapTabTransaction>();
  for (const value of values) {
    const transaction = normaliseTransaction(value, now);
    if (!transaction) continue;
    const key = transactionKey(transaction);
    const existing = byKey.get(key);
    if (!existing || transaction.submittedAt > existing.submittedAt) {
      byKey.set(key, transaction);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => right.submittedAt - left.submittedAt)
    .slice(0, PENDING_TAPTAB_TRANSACTION_MAX_ENTRIES);
}

export function parsePendingTapTabTransactions(
  raw: string | null,
  now = Date.now(),
): PendingTapTabTransaction[] {
  if (!raw || storageByteLength(raw) > MAX_STORAGE_BYTES) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== STORAGE_VERSION ||
      !Array.isArray(parsed.transactions)
    ) {
      return [];
    }
    return normaliseList(parsed.transactions, now);
  } catch {
    return [];
  }
}

export function serialisePendingTapTabTransactions(
  transactions: readonly PendingTapTabTransaction[],
  now = Date.now(),
): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    transactions: normaliseList(transactions, now),
  });
}

export function pendingTapTabTransactionsForScope(
  transactions: readonly PendingTapTabTransaction[],
  scope: PendingTapTabTransactionScope,
): PendingTapTabTransaction[] {
  const scopeKey = pendingTapTabTransactionScopeKey(scope);
  if (!scopeKey) return [];
  return transactions.filter(
    (transaction) => pendingTapTabTransactionScopeKey(transaction) === scopeKey,
  );
}

export function upsertPendingTapTabTransaction(
  transactions: readonly PendingTapTabTransaction[],
  transaction: PendingTapTabTransaction,
  now = Date.now(),
): PendingTapTabTransaction[] {
  return normaliseList(
    [transaction, ...transactions.filter((entry) => transactionKey(entry) !== transactionKey(transaction))],
    now,
  );
}

export function replacePendingTapTabTransactionHash(
  transactions: readonly PendingTapTabTransaction[],
  scope: PendingTapTabTransactionScope,
  currentHash: Hash,
  replacementHash: Hash,
  now = Date.now(),
): PendingTapTabTransaction[] {
  const scopeKey = pendingTapTabTransactionScopeKey(scope);
  if (!scopeKey || !HASH_PATTERN.test(replacementHash)) return [...transactions];
  return normaliseList(
    transactions.map((transaction) =>
      pendingTapTabTransactionScopeKey(transaction) === scopeKey &&
      transaction.hash.toLowerCase() === currentHash.toLowerCase()
        ? { ...transaction, hash: replacementHash.toLowerCase() as Hash }
        : transaction,
    ),
    now,
  );
}

export function removePendingTapTabTransaction(
  transactions: readonly PendingTapTabTransaction[],
  scope: PendingTapTabTransactionScope,
  hash: Hash,
): PendingTapTabTransaction[] {
  const scopeKey = pendingTapTabTransactionScopeKey(scope);
  if (!scopeKey) return [...transactions];
  return transactions.filter(
    (transaction) =>
      pendingTapTabTransactionScopeKey(transaction) !== scopeKey ||
      transaction.hash.toLowerCase() !== hash.toLowerCase(),
  );
}

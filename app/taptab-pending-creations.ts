import { getAddress, isAddress, type Address, type Hash } from "viem";
import { TAPTAB_MONAD_TESTNET } from "./taptab-chain.ts";
import {
  parsePositiveDecimal,
  type TapTabCreateBillQuote,
} from "./taptab-create-bill.ts";

export const PENDING_TAPTAB_CREATION_STORAGE_KEY =
  "taptab.pending-create-bills.v1";
export const PENDING_TAPTAB_CREATION_MAX_AGE_MS = 24 * 60 * 60_000;

const STORAGE_VERSION = 1;
const MAX_STORAGE_BYTES = 512_000;
const MAX_ENTRIES = 5;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_METADATA_URI_CHARACTERS = 64_000;
const MAX_QUOTE_TEXT_CHARACTERS = 100;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9][0-9]{0,77})$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UINT256_MAX = (1n << 256n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;

export type PendingTapTabCreationScope = Readonly<{
  chainId: typeof TAPTAB_MONAD_TESTNET.id;
  contract: Address;
  account: Address;
}>;

export type PendingTapTabCreation = PendingTapTabCreationScope &
  Readonly<{
    hash: Hash;
    submittedAt: number;
    payee: Address;
    deadline: string;
    subtotalPence: number;
    subtotalWei: string;
    metadataURI: string;
    quote: TapTabCreateBillQuote;
  }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storageByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function checkedText(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > MAX_QUOTE_TEXT_CHARACTERS ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return undefined;
  }
  return value;
}

function normaliseScope(
  value: unknown,
): PendingTapTabCreationScope | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.chainId !== TAPTAB_MONAD_TESTNET.id ||
    typeof value.contract !== "string" ||
    !isAddress(value.contract) ||
    typeof value.account !== "string" ||
    !isAddress(value.account)
  ) {
    return undefined;
  }
  return {
    chainId: TAPTAB_MONAD_TESTNET.id,
    contract: getAddress(value.contract),
    account: getAddress(value.account),
  };
}

function normaliseQuote(value: unknown): TapTabCreateBillQuote | undefined {
  if (!isRecord(value)) return undefined;
  const gbpPerMon = checkedText(value.gbpPerMon);
  const source = checkedText(value.source);
  const basis = checkedText(value.basis);
  const observedAtUnixSeconds = value.observedAtUnixSeconds;
  if (
    !gbpPerMon ||
    !source ||
    !basis ||
    !Number.isSafeInteger(observedAtUnixSeconds) ||
    (observedAtUnixSeconds as number) <= 0
  ) {
    return undefined;
  }
  try {
    parsePositiveDecimal(gbpPerMon);
  } catch {
    return undefined;
  }
  return {
    gbpPerMon,
    source,
    basis,
    observedAtUnixSeconds: observedAtUnixSeconds as number,
  };
}

function metadataMatchesCreationEvidence(
  metadataURI: string,
  subtotalPence: number,
  subtotalWei: string,
  quote: TapTabCreateBillQuote,
): boolean {
  try {
    const parsed = JSON.parse(
      decodeURIComponent(metadataURI.slice("data:application/json,".length)),
    ) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.quote)) return false;
    const canonicalRate = parsePositiveDecimal(quote.gbpPerMon).canonical;
    return (
      parsed.schema === "taptab-gbp-receipt" &&
      parsed.version === 1 &&
      parsed.currency === "GBP" &&
      parsed.subtotalPence === subtotalPence &&
      parsed.quote.gbpPerMon === canonicalRate &&
      parsed.quote.source === quote.source &&
      parsed.quote.basis === quote.basis &&
      parsed.quote.observedAtUnixSeconds === quote.observedAtUnixSeconds &&
      parsed.quote.subtotalWei === subtotalWei
    );
  } catch {
    return false;
  }
}

function normaliseCreation(
  value: unknown,
  now: number,
): PendingTapTabCreation | undefined {
  if (!isRecord(value)) return undefined;
  const scope = normaliseScope(value);
  const hash = value.hash;
  const submittedAt = value.submittedAt;
  const payee = value.payee;
  const deadline = value.deadline;
  const subtotalPence = value.subtotalPence;
  const subtotalWei = value.subtotalWei;
  const metadataURI = value.metadataURI;
  const quote = normaliseQuote(value.quote);
  if (
    !scope ||
    typeof hash !== "string" ||
    !HASH_PATTERN.test(hash) ||
    !Number.isSafeInteger(submittedAt) ||
    (submittedAt as number) <= 0 ||
    (submittedAt as number) < now - PENDING_TAPTAB_CREATION_MAX_AGE_MS ||
    (submittedAt as number) > now + MAX_FUTURE_SKEW_MS ||
    typeof payee !== "string" ||
    !isAddress(payee) ||
    typeof deadline !== "string" ||
    !UNSIGNED_INTEGER_PATTERN.test(deadline) ||
    BigInt(deadline) > UINT64_MAX ||
    !Number.isSafeInteger(subtotalPence) ||
    (subtotalPence as number) <= 0 ||
    typeof subtotalWei !== "string" ||
    !UNSIGNED_INTEGER_PATTERN.test(subtotalWei) ||
    BigInt(subtotalWei) <= 0n ||
    BigInt(subtotalWei) > UINT256_MAX ||
    typeof metadataURI !== "string" ||
    !metadataURI.startsWith("data:application/json,") ||
    metadataURI.length > MAX_METADATA_URI_CHARACTERS ||
    CONTROL_CHARACTER_PATTERN.test(metadataURI) ||
    !quote
  ) {
    return undefined;
  }
  if (
    !metadataMatchesCreationEvidence(
      metadataURI,
      subtotalPence as number,
      subtotalWei,
      quote,
    )
  ) {
    return undefined;
  }
  return {
    ...scope,
    hash: hash.toLowerCase() as Hash,
    submittedAt: submittedAt as number,
    payee: getAddress(payee),
    deadline,
    subtotalPence: subtotalPence as number,
    subtotalWei,
    metadataURI,
    quote,
  };
}

export function pendingTapTabCreationScopeKey(
  scope: PendingTapTabCreationScope,
): string {
  const normalised = normaliseScope(scope);
  if (!normalised) return "";
  return [
    normalised.chainId,
    normalised.contract.toLowerCase(),
    normalised.account.toLowerCase(),
  ].join(":");
}

function normaliseList(
  values: readonly unknown[],
  now: number,
): PendingTapTabCreation[] {
  const byTransaction = new Map<string, PendingTapTabCreation>();
  for (const value of values) {
    const creation = normaliseCreation(value, now);
    if (!creation) continue;
    const key = `${pendingTapTabCreationScopeKey(creation)}:${creation.hash.toLowerCase()}`;
    const existing = byTransaction.get(key);
    if (!existing || creation.submittedAt > existing.submittedAt) {
      byTransaction.set(key, creation);
    }
  }
  return [...byTransaction.values()]
    .sort((left, right) => right.submittedAt - left.submittedAt)
    .slice(0, MAX_ENTRIES);
}

export function parsePendingTapTabCreations(
  raw: string | null,
  now = Date.now(),
): PendingTapTabCreation[] {
  if (!raw || storageByteLength(raw) > MAX_STORAGE_BYTES) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== STORAGE_VERSION ||
      !Array.isArray(parsed.creations)
    ) {
      return [];
    }
    return normaliseList(parsed.creations, now);
  } catch {
    return [];
  }
}

export function serialisePendingTapTabCreations(
  creations: readonly PendingTapTabCreation[],
  now = Date.now(),
): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    creations: normaliseList(creations, now),
  });
}

export function pendingTapTabCreationForScope(
  creations: readonly PendingTapTabCreation[],
  scope: PendingTapTabCreationScope,
): PendingTapTabCreation | undefined {
  const scopeKey = pendingTapTabCreationScopeKey(scope);
  if (!scopeKey) return undefined;
  return creations.find(
    (creation) => pendingTapTabCreationScopeKey(creation) === scopeKey,
  );
}

export function upsertPendingTapTabCreation(
  creations: readonly PendingTapTabCreation[],
  creation: PendingTapTabCreation,
  now = Date.now(),
): PendingTapTabCreation[] {
  return normaliseList([creation, ...creations], now);
}

export function replacePendingTapTabCreationHash(
  creations: readonly PendingTapTabCreation[],
  scope: PendingTapTabCreationScope,
  currentHash: Hash,
  replacementHash: Hash,
  now = Date.now(),
): PendingTapTabCreation[] {
  const scopeKey = pendingTapTabCreationScopeKey(scope);
  if (!scopeKey || !HASH_PATTERN.test(replacementHash)) return [...creations];
  return normaliseList(
    creations.map((creation) =>
      pendingTapTabCreationScopeKey(creation) === scopeKey &&
      creation.hash.toLowerCase() === currentHash.toLowerCase()
        ? { ...creation, hash: replacementHash.toLowerCase() as Hash }
        : creation,
    ),
    now,
  );
}

export function removePendingTapTabCreation(
  creations: readonly PendingTapTabCreation[],
  scope: PendingTapTabCreationScope,
  hash?: Hash,
): PendingTapTabCreation[] {
  const scopeKey = pendingTapTabCreationScopeKey(scope);
  if (!scopeKey) return [...creations];
  return creations.filter(
    (creation) =>
      pendingTapTabCreationScopeKey(creation) !== scopeKey ||
      (hash !== undefined && creation.hash.toLowerCase() !== hash.toLowerCase()),
  );
}

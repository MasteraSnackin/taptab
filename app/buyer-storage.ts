export const BUYER_STORAGE_KEY = "crowdcart.savedDeals.v1";
export const BUYER_STORAGE_VERSION = 1 as const;
export const MONAD_TESTNET_CHAIN_ID = 10143 as const;
export const MAX_SAVED_BUYER_DEALS = 20;

export type HexAddress = `0x${string}`;
export type TransactionHash = `0x${string}`;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SavedBuyerDeal = {
  chainId: typeof MONAD_TESTNET_CHAIN_ID;
  contractAddress: HexAddress;
  dealId: string;
  buyerAddress: HexAddress;
  joinTxHash?: TransactionHash;
  refundTxHash?: TransactionHash;
  savedAt: number;
};

export type SavedBuyerDealsStore = {
  version: typeof BUYER_STORAGE_VERSION;
  items: SavedBuyerDeal[];
};

export type SavedBuyerDealLocator = Pick<
  SavedBuyerDeal,
  "chainId" | "contractAddress" | "dealId" | "buyerAddress"
>;

export type ConfirmedJoin = SavedBuyerDealLocator & {
  joinTxHash: TransactionHash;
  savedAt?: number;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DEAL_ID_PATTERN = /^\d+$/;
const MAX_UINT256 = (1n << 256n) - 1n;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseAddress(value: unknown): HexAddress | undefined {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) return undefined;
  return value.toLowerCase() as HexAddress;
}

function normaliseTransactionHash(value: unknown): TransactionHash | undefined {
  if (typeof value !== "string" || !TRANSACTION_HASH_PATTERN.test(value)) {
    return undefined;
  }
  return value.toLowerCase() as TransactionHash;
}

function normaliseDealId(value: unknown): string | undefined {
  if (typeof value !== "string" || !DEAL_ID_PATTERN.test(value)) return undefined;

  try {
    const dealId = BigInt(value);
    return dealId > 0n && dealId <= MAX_UINT256
      ? dealId.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function normaliseSavedAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function normaliseSavedBuyerDeal(value: unknown): SavedBuyerDeal | undefined {
  if (!isRecord(value) || value.chainId !== MONAD_TESTNET_CHAIN_ID) return undefined;

  const contractAddress = normaliseAddress(value.contractAddress);
  const buyerAddress = normaliseAddress(value.buyerAddress);
  const dealId = normaliseDealId(value.dealId);
  const savedAt = normaliseSavedAt(value.savedAt);

  if (!contractAddress || !buyerAddress || !dealId || savedAt === undefined) {
    return undefined;
  }

  const joinTxHash =
    value.joinTxHash === undefined
      ? undefined
      : normaliseTransactionHash(value.joinTxHash);
  const refundTxHash =
    value.refundTxHash === undefined
      ? undefined
      : normaliseTransactionHash(value.refundTxHash);

  if (
    (value.joinTxHash !== undefined && !joinTxHash) ||
    (value.refundTxHash !== undefined && !refundTxHash)
  ) {
    return undefined;
  }

  return {
    chainId: MONAD_TESTNET_CHAIN_ID,
    contractAddress,
    dealId,
    buyerAddress,
    ...(joinTxHash ? { joinTxHash } : {}),
    ...(refundTxHash ? { refundTxHash } : {}),
    savedAt,
  };
}

function compareSavedDeals(left: SavedBuyerDeal, right: SavedBuyerDeal) {
  if (left.savedAt !== right.savedAt) return right.savedAt - left.savedAt;

  const leftKey = savedBuyerDealKey(left);
  const rightKey = savedBuyerDealKey(right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return 0;
}

function preferDuplicate(
  current: SavedBuyerDeal,
  candidate: SavedBuyerDeal,
): SavedBuyerDeal {
  const preferred = compareSavedDeals(current, candidate) <= 0 ? current : candidate;
  const alternate = preferred === current ? candidate : current;

  return {
    ...preferred,
    joinTxHash: preferred.joinTxHash ?? alternate.joinTxHash,
    refundTxHash: preferred.refundTxHash ?? alternate.refundTxHash,
  };
}

function canonicaliseSavedDeals(items: Iterable<SavedBuyerDeal>): SavedBuyerDeal[] {
  const deduplicated = new Map<string, SavedBuyerDeal>();

  for (const item of items) {
    const key = savedBuyerDealKey(item);
    const existing = deduplicated.get(key);
    deduplicated.set(key, existing ? preferDuplicate(existing, item) : item);
  }

  return [...deduplicated.values()]
    .sort(compareSavedDeals)
    .slice(0, MAX_SAVED_BUYER_DEALS);
}

function saveSavedBuyerDeals(storage: StorageLike, items: SavedBuyerDeal[]) {
  const canonicalItems = canonicaliseSavedDeals(items);
  if (canonicalItems.length === 0) {
    storage.removeItem(BUYER_STORAGE_KEY);
    return canonicalItems;
  }

  const store: SavedBuyerDealsStore = {
    version: BUYER_STORAGE_VERSION,
    items: canonicalItems,
  };
  storage.setItem(BUYER_STORAGE_KEY, JSON.stringify(store));
  return canonicalItems;
}

export function savedBuyerDealKey(locator: SavedBuyerDealLocator): string {
  const contractAddress = normaliseAddress(locator.contractAddress);
  const buyerAddress = normaliseAddress(locator.buyerAddress);
  const dealId = normaliseDealId(locator.dealId);

  if (
    locator.chainId !== MONAD_TESTNET_CHAIN_ID ||
    !contractAddress ||
    !buyerAddress ||
    !dealId
  ) {
    throw new TypeError("Invalid saved CrowdCart deal locator.");
  }

  return `${MONAD_TESTNET_CHAIN_ID}:${contractAddress}:${dealId}:${buyerAddress}`;
}

export function parseSavedBuyerDeals(raw: string | null): SavedBuyerDeal[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== BUYER_STORAGE_VERSION ||
      !Array.isArray(parsed.items)
    ) {
      return [];
    }

    const validItems = parsed.items
      .map(normaliseSavedBuyerDeal)
      .filter((item): item is SavedBuyerDeal => item !== undefined);
    return canonicaliseSavedDeals(validItems);
  } catch {
    return [];
  }
}

export function loadSavedBuyerDeals(storage: StorageLike): SavedBuyerDeal[] {
  try {
    return parseSavedBuyerDeals(storage.getItem(BUYER_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function upsertConfirmedJoin(
  storage: StorageLike,
  confirmedJoin: ConfirmedJoin,
): SavedBuyerDeal[] {
  const savedAt = confirmedJoin.savedAt ?? Date.now();
  const item = normaliseSavedBuyerDeal({ ...confirmedJoin, savedAt });
  if (!item?.joinTxHash) {
    throw new TypeError("A confirmed join requires a valid saved deal and transaction hash.");
  }

  const key = savedBuyerDealKey(item);
  const existingItems = loadSavedBuyerDeals(storage);
  const existing = existingItems.find(
    (candidate) => savedBuyerDealKey(candidate) === key,
  );

  return saveSavedBuyerDeals(storage, [
    {
      ...existing,
      ...item,
      refundTxHash: existing?.refundTxHash,
    },
    ...existingItems.filter(
      (candidate) => savedBuyerDealKey(candidate) !== key,
    ),
  ]);
}

export function updateSavedBuyerDealRefundHash(
  storage: StorageLike,
  locator: SavedBuyerDealLocator,
  refundTxHash?: TransactionHash,
): SavedBuyerDeal[] {
  const key = savedBuyerDealKey(locator);
  const normalisedRefundHash =
    refundTxHash === undefined
      ? undefined
      : normaliseTransactionHash(refundTxHash);
  if (refundTxHash !== undefined && !normalisedRefundHash) {
    throw new TypeError("Invalid refund transaction hash.");
  }

  const items = loadSavedBuyerDeals(storage);
  let found = false;
  const updatedItems = items.map((item) => {
    if (savedBuyerDealKey(item) !== key) return item;
    found = true;
    if (normalisedRefundHash) return { ...item, refundTxHash: normalisedRefundHash };

    const withoutRefundHash = { ...item };
    delete withoutRefundHash.refundTxHash;
    return withoutRefundHash;
  });

  return found ? saveSavedBuyerDeals(storage, updatedItems) : items;
}

export function removeSavedBuyerDeal(
  storage: StorageLike,
  locator: SavedBuyerDealLocator,
): SavedBuyerDeal[] {
  const key = savedBuyerDealKey(locator);
  const remainingItems = loadSavedBuyerDeals(storage).filter(
    (item) => savedBuyerDealKey(item) !== key,
  );
  return saveSavedBuyerDeals(storage, remainingItems);
}

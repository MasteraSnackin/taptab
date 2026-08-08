import assert from "node:assert/strict";
import test from "node:test";

import {
  BUYER_STORAGE_KEY,
  MAX_SAVED_BUYER_DEALS,
  loadSavedBuyerDeals,
  parseSavedBuyerDeals,
  removeSavedBuyerDeal,
  savedBuyerDealKey,
  updateSavedBuyerDealRefundHash,
  upsertConfirmedJoin,
} from "../app/buyer-storage.ts";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const JOIN_HASH = `0x${"a".repeat(64)}`;
const REFUND_HASH = `0x${"b".repeat(64)}`;

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}

function locator(overrides = {}) {
  return {
    chainId: 10143,
    contractAddress: CONTRACT,
    dealId: "1",
    buyerAddress: BUYER,
    ...overrides,
  };
}

test("returns an empty list for absent, malformed or unsupported storage", () => {
  assert.deepEqual(parseSavedBuyerDeals(null), []);
  assert.deepEqual(parseSavedBuyerDeals("not json"), []);
  assert.deepEqual(parseSavedBuyerDeals(JSON.stringify({ version: 2, items: [] })), []);
  assert.deepEqual(parseSavedBuyerDeals(JSON.stringify({ version: 1, items: {} })), []);

  const throwingStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {},
    removeItem() {},
  };
  assert.deepEqual(loadSavedBuyerDeals(throwingStorage), []);
});

test("filters invalid records, normalises identifiers and retains valid optional hashes", () => {
  const raw = JSON.stringify({
    version: 1,
    items: [
      {
        ...locator({
          contractAddress: CONTRACT.toUpperCase().replace("0X", "0x"),
          buyerAddress: BUYER.toUpperCase().replace("0X", "0x"),
          dealId: "0007",
        }),
        joinTxHash: JOIN_HASH.toUpperCase().replace("0X", "0x"),
        refundTxHash: REFUND_HASH,
        savedAt: 20,
      },
      { ...locator({ dealId: "0" }), savedAt: 10 },
      { ...locator({ dealId: (1n << 256n).toString() }), savedAt: 10 },
      { ...locator({ buyerAddress: "0x1234" }), savedAt: 10 },
      { ...locator(), joinTxHash: "0xdead", savedAt: 10 },
      { ...locator(), savedAt: Number.NaN },
    ],
  });

  assert.deepEqual(parseSavedBuyerDeals(raw), [
    {
      ...locator({ dealId: "7" }),
      contractAddress: CONTRACT,
      buyerAddress: BUYER,
      joinTxHash: JOIN_HASH,
      refundTxHash: REFUND_HASH,
      savedAt: 20,
    },
  ]);
});

test("builds a deterministic key from canonical chain, address and deal identity", () => {
  const key = savedBuyerDealKey(
    locator({
      contractAddress: CONTRACT.toUpperCase().replace("0X", "0x"),
      buyerAddress: BUYER.toUpperCase().replace("0X", "0x"),
      dealId: "0009",
    }),
  );

  assert.equal(key, `10143:${CONTRACT}:9:${BUYER}`);
  assert.throws(
    () => savedBuyerDealKey(locator({ chainId: 1 })),
    /Invalid saved CrowdCart deal locator/,
  );
});

test("upserts confirmed joins, deduplicates identity and keeps an existing refund hash", () => {
  const storage = new MemoryStorage();
  upsertConfirmedJoin(storage, {
    ...locator(),
    joinTxHash: JOIN_HASH,
    savedAt: 10,
  });
  updateSavedBuyerDealRefundHash(storage, locator(), REFUND_HASH);

  const secondJoinHash = `0x${"c".repeat(64)}`;
  const items = upsertConfirmedJoin(storage, {
    ...locator({
      contractAddress: CONTRACT.toUpperCase().replace("0X", "0x"),
      dealId: "01",
    }),
    joinTxHash: secondJoinHash,
    savedAt: 30,
  });

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    ...locator(),
    joinTxHash: secondJoinHash,
    refundTxHash: REFUND_HASH,
    savedAt: 30,
  });
  assert.deepEqual(loadSavedBuyerDeals(storage), items);
  assert.ok(storage.getItem(BUYER_STORAGE_KEY));
});

test("rejects unconfirmed or malformed join records", () => {
  const storage = new MemoryStorage();
  assert.throws(
    () =>
      upsertConfirmedJoin(storage, {
        ...locator(),
        joinTxHash: "0xdead",
        savedAt: 10,
      }),
    /confirmed join requires/,
  );
  assert.deepEqual(loadSavedBuyerDeals(storage), []);
});

test("updates, clears and ignores refund hashes without creating records", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(
    updateSavedBuyerDealRefundHash(storage, locator(), REFUND_HASH),
    [],
  );

  upsertConfirmedJoin(storage, {
    ...locator(),
    joinTxHash: JOIN_HASH,
    savedAt: 10,
  });
  let items = updateSavedBuyerDealRefundHash(storage, locator(), REFUND_HASH);
  assert.equal(items[0].refundTxHash, REFUND_HASH);

  items = updateSavedBuyerDealRefundHash(storage, locator(), undefined);
  assert.equal("refundTxHash" in items[0], false);
  assert.throws(
    () => updateSavedBuyerDealRefundHash(storage, locator(), "0xdead"),
    /Invalid refund transaction hash/,
  );
});

test("keeps at most 20 unique records in deterministic newest-first order", () => {
  const storage = new MemoryStorage();

  for (let dealId = 1; dealId <= 25; dealId += 1) {
    upsertConfirmedJoin(storage, {
      ...locator({ dealId: String(dealId) }),
      joinTxHash: `0x${dealId.toString(16).padStart(64, "0")}`,
      savedAt: dealId <= 23 ? dealId : 100,
    });
  }

  const items = loadSavedBuyerDeals(storage);
  assert.equal(items.length, MAX_SAVED_BUYER_DEALS);
  assert.deepEqual(
    items.slice(0, 2).map((item) => item.dealId),
    ["24", "25"],
  );
  assert.equal(items.at(-1).dealId, "6");
});

test("removes only the matching record and clears the storage key when empty", () => {
  const storage = new MemoryStorage();
  upsertConfirmedJoin(storage, {
    ...locator(),
    joinTxHash: JOIN_HASH,
    savedAt: 20,
  });
  upsertConfirmedJoin(storage, {
    ...locator({ dealId: "2" }),
    joinTxHash: `0x${"c".repeat(64)}`,
    savedAt: 10,
  });

  let items = removeSavedBuyerDeal(storage, locator());
  assert.deepEqual(items.map((item) => item.dealId), ["2"]);

  items = removeSavedBuyerDeal(storage, locator({ dealId: "2" }));
  assert.deepEqual(items, []);
  assert.equal(storage.getItem(BUYER_STORAGE_KEY), null);
});

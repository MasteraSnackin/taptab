import assert from "node:assert/strict";
import test from "node:test";

import {
  MONAD_TESTNET,
  crowdCartAbi,
  deriveDealPhase,
  parseProductMetadata,
  resolveCrowdCartAddress,
  toDisplayTiers,
} from "../app/crowdcart-chain.ts";

const CHECKSUMMED_ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

test("normalises a valid CrowdCart address to its checksum form", () => {
  assert.equal(
    resolveCrowdCartAddress(CHECKSUMMED_ADDRESS.toLowerCase()),
    CHECKSUMMED_ADDRESS,
  );
  assert.equal(
    resolveCrowdCartAddress(CHECKSUMMED_ADDRESS.toUpperCase()),
    CHECKSUMMED_ADDRESS,
  );
});

test("rejects missing and invalid CrowdCart addresses", () => {
  assert.equal(resolveCrowdCartAddress(undefined), undefined);
  assert.equal(resolveCrowdCartAddress(""), undefined);
  assert.equal(resolveCrowdCartAddress("  "), undefined);
  assert.equal(resolveCrowdCartAddress("0x1234"), undefined);
  assert.equal(
    resolveCrowdCartAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeg"),
    undefined,
  );
});

test("only resolves the configured trusted CrowdCart address", () => {
  assert.equal(
    resolveCrowdCartAddress(
      CHECKSUMMED_ADDRESS.toLowerCase(),
      CHECKSUMMED_ADDRESS.toUpperCase(),
    ),
    CHECKSUMMED_ADDRESS,
  );

  assert.equal(
    resolveCrowdCartAddress(
      "0xde709f2102306220921060314715629080e2fb77",
      CHECKSUMMED_ADDRESS,
    ),
    undefined,
  );
});

test("exports Monad Testnet and the complete CrowdCart interface", () => {
  assert.equal(MONAD_TESTNET.id, 10_143);
  assert.equal(MONAD_TESTNET.nativeCurrency.symbol, "MON");
  assert.deepEqual(MONAD_TESTNET.rpcUrls.default.http, [
    "https://testnet-rpc.monad.xyz",
  ]);

  const functionNames = new Set(
    crowdCartAbi
      .filter((entry) => entry.type === "function")
      .map((entry) => entry.name),
  );
  const eventNames = new Set(
    crowdCartAbi
      .filter((entry) => entry.type === "event")
      .map((entry) => entry.name),
  );

  for (const name of [
    "createDeal",
    "joinDeal",
    "finaliseDeal",
    "claimRefund",
    "dealCount",
    "getBuyer",
    "getDeal",
    "getTiers",
  ]) {
    assert.equal(functionNames.has(name), true, `missing function ${name}`);
  }

  for (const name of [
    "DealCreated",
    "DealJoined",
    "DealFinalised",
    "DealCancelled",
    "RefundClaimed",
  ]) {
    assert.equal(eventNames.has(name), true, `missing event ${name}`);
  }
});

test("derives every display phase from contract state", () => {
  assert.equal(deriveDealPhase(null, false), "preview");
  assert.equal(deriveDealPhase(undefined, false), "unavailable");
  assert.equal(deriveDealPhase(0, false), "unavailable");
  assert.equal(deriveDealPhase(1, false), "open");
  assert.equal(deriveDealPhase(1n, true), "awaiting_finalisation");
  assert.equal(deriveDealPhase(2, false), "successful");
  assert.equal(deriveDealPhase(3, false), "cancelled");
  assert.equal(deriveDealPhase(4, false), "failed");
  assert.equal(deriveDealPhase(99, true), "unavailable");
});

test("parses URL-encoded JSON product metadata and ignores unknown values", () => {
  const metadataURI = `data:application/json;charset=utf-8,${encodeURIComponent(
    JSON.stringify({
      name: "  The London Pizza Drop  ",
      pickup: "Encode Hub · Today",
      image: "crowdcart://pizza-drop",
      description: 42,
      untrusted: { nested: true },
    }),
  )}`;

  assert.deepEqual(parseProductMetadata(metadataURI), {
    name: "The London Pizza Drop",
    pickup: "Encode Hub · Today",
    image: "crowdcart://pizza-drop",
  });
});

test("parses UTF-8 base64 JSON metadata", () => {
  const payload = Buffer.from(
    JSON.stringify({ name: "Pizza · London", pickup: "Shoreditch" }),
    "utf8",
  ).toString("base64");

  assert.deepEqual(
    parseProductMetadata(`data:application/json;base64,${payload}`),
    {
      name: "Pizza · London",
      pickup: "Shoreditch",
    },
  );
});

test("rejects malformed, non-JSON and unhelpful metadata", () => {
  assert.equal(parseProductMetadata("https://example.com/product.json"), undefined);
  assert.equal(parseProductMetadata("data:text/plain,%7B%7D"), undefined);
  assert.equal(parseProductMetadata("data:application/json,%xx"), undefined);
  assert.equal(parseProductMetadata("data:application/json,[]"), undefined);
  assert.equal(parseProductMetadata("data:application/json,%7B%7D"), undefined);
  assert.equal(
    parseProductMetadata(`data:application/json,${"x".repeat(128_001)}`),
    undefined,
  );
});

test("pairs on-chain tier values without converting monetary amounts", () => {
  const prices = [10_000_000_000_000_000n, 8_000_000_000_000_000n, 4n];

  const tiers = toDisplayTiers([1, 2, 7], prices);

  assert.deepEqual(tiers, [
    { buyers: 1, price: prices[0], label: "Opening price" },
    { buyers: 2, price: prices[1], label: "Price drop 1" },
    { buyers: 7, price: prices[2], label: "Best price" },
  ]);
  assert.equal(typeof tiers[0].price, "bigint");
});

test("rejects inconsistent or invalid tier data", () => {
  assert.throws(() => toDisplayTiers([], []), RangeError);
  assert.throws(() => toDisplayTiers([1], [10n, 8n]), RangeError);
  assert.throws(() => toDisplayTiers([0], [10n]), RangeError);
  assert.throws(() => toDisplayTiers([1], [0n]), RangeError);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  TAPTAB_PRICE_FRESH_AGE_SECONDS,
  TAPTAB_PRICE_MAX_AGE_SECONDS,
  parseTapTabPriceReference,
  lockTapTabPriceReference,
} from "../app/taptab-price-reference.ts";

const NOW = 1_800_000_000;

function payload(overrides = {}) {
  return {
    usd: 0.031,
    gbp: 0.024,
    lastUpdatedAt: NOW - 20,
    source: "CoinGecko",
    basis: "mainnet MON",
    quoteStatus: "live",
    ...overrides,
  };
}

test("derives live and stale state from age instead of trusting presentation headers", () => {
  const live = parseTapTabPriceReference(payload(), { nowUnixSeconds: NOW });
  assert.equal(live.state, "live");
  assert.equal(live.ageSeconds, 20);

  const stale = parseTapTabPriceReference(
    payload({ lastUpdatedAt: NOW - TAPTAB_PRICE_FRESH_AGE_SECONDS - 1 }),
    { nowUnixSeconds: NOW },
  );
  assert.equal(stale.state, "stale");

  const headerStale = parseTapTabPriceReference(payload(), {
    nowUnixSeconds: NOW,
    responseStatus: "stale",
  });
  assert.equal(headerStale.state, "stale");
});

test("rejects expired, implausibly future and malformed price references", () => {
  assert.throws(
    () =>
      parseTapTabPriceReference(
        payload({ lastUpdatedAt: NOW - TAPTAB_PRICE_MAX_AGE_SECONDS - 1 }),
        { nowUnixSeconds: NOW },
      ),
    /usable window/,
  );
  assert.throws(
    () => parseTapTabPriceReference(payload({ lastUpdatedAt: NOW + 301 }), { nowUnixSeconds: NOW }),
    /usable window/,
  );
  assert.throws(
    () => parseTapTabPriceReference(payload({ gbp: Number.NaN }), { nowUnixSeconds: NOW }),
    /GBP price/,
  );
  assert.throws(
    () => parseTapTabPriceReference(payload({ source: "\u0000bad" }), { nowUnixSeconds: NOW }),
    /source/,
  );
});

test("copies every conversion-evidence field into an immutable funding lock", () => {
  const observed = parseTapTabPriceReference(payload(), { nowUnixSeconds: NOW });
  const locked = lockTapTabPriceReference(
    {
      gbpPerMon: observed.gbp,
      usdPerMon: observed.usd,
      observedAtUnixSeconds: observed.lastUpdatedAt,
      source: observed.source,
      basis: observed.basis,
      mode: observed.state,
    },
    NOW,
  );

  assert.deepEqual(locked, {
    gbpPerMon: 0.024,
    usdPerMon: 0.031,
    observedAtUnixSeconds: NOW - 20,
    source: "CoinGecko",
    basis: "mainnet MON",
    mode: "live",
    lockedAtUnixSeconds: NOW,
  });
  assert.equal(Object.isFrozen(locked), true);
  assert.throws(() => {
    locked.gbpPerMon = 99;
  });
});

test("supports an explicit manual GBP fallback without inventing a USD value", () => {
  const locked = lockTapTabPriceReference({
    gbpPerMon: 0.025,
    observedAtUnixSeconds: NOW,
    source: "Organiser entry",
    basis: "manual mainnet MON reference",
    mode: "manual",
  }, NOW + 1);

  assert.equal(locked.gbpPerMon, 0.025);
  assert.equal(locked.usdPerMon, undefined);
  assert.equal(locked.mode, "manual");
});

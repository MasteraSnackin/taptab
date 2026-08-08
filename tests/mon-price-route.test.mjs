import assert from "node:assert/strict";
import test from "node:test";

const PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd,gbp&include_last_updated_at=true";
const COINBASE_RATES_URL =
  "https://api.coinbase.com/v2/exchange-rates?currency=MON";

let moduleSequence = 0;

function validQuote(overrides = {}) {
  return {
    monad: {
      usd: 0.031,
      gbp: 0.024,
      last_updated_at: Math.floor(Date.now() / 1_000),
      ...overrides,
    },
  };
}

async function loadFreshRoute() {
  const routeUrl = new URL("../app/api/mon-price/route.ts", import.meta.url);
  routeUrl.searchParams.set("test", String(moduleSequence++));
  return import(routeUrl.href);
}

async function withMockedGlobals(run) {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const originalConsoleError = console.error;

  const consoleErrors = [];
  console.error = (...args) => consoleErrors.push(args);
  try {
    await run({ consoleErrors });
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    console.error = originalConsoleError;
  }
}

function assertRequestCorrelation(response, body) {
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.match(body.requestId, /^(?:[0-9a-f-]{36}|mon-price-[a-z0-9-]+)$/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("returns a validated live CoinGecko MON quote", async () => {
  await withMockedGlobals(async () => {
    const lastUpdatedAt = Math.floor(Date.now() / 1_000);
    const upstreamCalls = [];
    globalThis.fetch = async (...args) => {
      upstreamCalls.push(args);
      return Response.json(validQuote({ last_updated_at: lastUpdatedAt }));
    };

    const { GET } = await loadFreshRoute();
    const response = await GET();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      { ...body, requestId: undefined },
      {
      usd: 0.031,
      gbp: 0.024,
      lastUpdatedAt,
      source: "CoinGecko",
      basis: "mainnet MON",
        quoteStatus: "live",
        requestId: undefined,
      },
    );
    assertRequestCorrelation(response, body);
    assert.match(response.headers.get("cache-control") ?? "", /^public, /);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0][0], PRICE_URL);
    assert.equal(upstreamCalls[0][1]?.headers?.accept, "application/json");
    assert.match(
      upstreamCalls[0][1]?.headers?.["user-agent"] ?? "",
      /^TapTab\//,
    );
  });
});

test("falls back to validated Coinbase MON exchange rates", async () => {
  await withMockedGlobals(async () => {
    const observedAt = 1_800_000_000;
    Date.now = () => observedAt * 1_000;
    const upstreamCalls = [];
    globalThis.fetch = async (url) => {
      upstreamCalls.push(url);
      if (url === PRICE_URL) {
        return new Response("Rate limited", {
          status: 429,
          headers: { "retry-after": "30" },
        });
      }
      if (url === COINBASE_RATES_URL) {
        return Response.json({
          data: {
            currency: "MON",
            rates: {
              USD: "0.020731",
              GBP: "0.015353852551903350143",
            },
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const { GET } = await loadFreshRoute();
    const response = await GET();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      { ...body, requestId: undefined },
      {
        usd: 0.020731,
        gbp: 0.01535385255190335,
        lastUpdatedAt: observedAt,
        source: "Coinbase",
        basis: "mainnet MON",
        quoteStatus: "live",
        requestId: undefined,
      },
    );
    assertRequestCorrelation(response, body);
    assert.deepEqual(upstreamCalls, [
      PRICE_URL,
      COINBASE_RATES_URL,
    ]);
  });
});

test("rejects a malformed upstream quote when no cached quote exists", async () => {
  await withMockedGlobals(async () => {
    globalThis.fetch = async () =>
      Response.json({ monad: { usd: 0.031, last_updated_at: 1_800_000_000 } });

    const { GET } = await loadFreshRoute();
    const response = await GET();
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(Number(response.headers.get("retry-after")) >= 1);
    assert.deepEqual(body, {
      error: "The live MON reference price is temporarily unavailable.",
      requestId: body.requestId,
    });
    assertRequestCorrelation(response, body);
  });
});

test("rejects stale and implausibly future upstream timestamps", async () => {
  await withMockedGlobals(async () => {
    const nowInSeconds = Math.floor(Date.now() / 1_000);
    const invalidTimestamps = [
      nowInSeconds - 24 * 60 * 60 - 1,
      nowInSeconds + 5 * 60 + 1,
    ];

    for (const lastUpdatedAt of invalidTimestamps) {
      globalThis.fetch = async () =>
        Response.json(validQuote({ last_updated_at: lastUpdatedAt }));

      const { GET } = await loadFreshRoute();
      const response = await GET();

      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });
});

test("returns a correlated no-store 503 and privacy-safe failure log", async () => {
  await withMockedGlobals(async ({ consoleErrors }) => {
    globalThis.fetch = async () => new Response("Rate limited", { status: 429 });

    const { GET } = await loadFreshRoute();
    const response = await GET();
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(Number(response.headers.get("retry-after")) >= 1);
    assert.deepEqual(body, {
      error: "The live MON reference price is temporarily unavailable.",
      requestId: body.requestId,
    });
    assertRequestCorrelation(response, body);
    assert.equal(consoleErrors.length, 1);
    assert.equal(consoleErrors[0][0], "MON reference price request failed");
    assert.deepEqual(consoleErrors[0][1], {
      requestId: body.requestId,
      errorName: "Error",
    });
    assert.doesNotMatch(JSON.stringify(consoleErrors[0]), /Rate limited|coingecko\.com/i);
  });
});

test("serves the last good quote as stale after a later upstream failure", async () => {
  await withMockedGlobals(async () => {
    const initialNow = Date.now();
    let upstreamHealthy = true;
    globalThis.fetch = async () => {
      if (upstreamHealthy) {
        return Response.json(validQuote());
      }
      return new Response("Upstream unavailable", { status: 503 });
    };

    const { GET } = await loadFreshRoute();
    const freshResponse = await GET();
    const freshQuote = await freshResponse.json();
    assertRequestCorrelation(freshResponse, freshQuote);

    upstreamHealthy = false;
    Date.now = () => initialNow + 3_600_000;
    const staleResponse = await GET();
    const staleQuote = await staleResponse.json();

    assert.equal(staleResponse.status, 200);
    assert.deepEqual(
      { ...staleQuote, requestId: undefined, quoteStatus: undefined },
      { ...freshQuote, requestId: undefined, quoteStatus: undefined },
    );
    assert.notEqual(staleQuote.requestId, freshQuote.requestId);
    assertRequestCorrelation(staleResponse, staleQuote);
    assert.equal(
      staleResponse.headers.get("x-taptab-price-status"),
      "stale",
    );
    assert.equal(staleQuote.quoteStatus, "stale");
    assert.equal(freshQuote.quoteStatus, "live");
    assert.match(
      staleResponse.headers.get("cache-control") ?? "",
      /stale-while-revalidate/,
    );
  });
});

test("de-duplicates concurrent requests while the quote cache is cold", async () => {
  await withMockedGlobals(async () => {
    let resolveUpstream;
    let upstreamCallCount = 0;
    const upstreamResponse = new Promise((resolve) => {
      resolveUpstream = resolve;
    });

    globalThis.fetch = async () => {
      upstreamCallCount += 1;
      return upstreamResponse;
    };

    const { GET } = await loadFreshRoute();
    const firstRequest = GET();
    const secondRequest = GET();

    await Promise.resolve();
    assert.equal(upstreamCallCount, 1);

    resolveUpstream(Response.json(validQuote()));
    const [firstResponse, secondResponse] = await Promise.all([
      firstRequest,
      secondRequest,
    ]);

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();
    assert.deepEqual(
      { ...firstBody, requestId: undefined },
      { ...secondBody, requestId: undefined },
    );
    assert.notEqual(firstBody.requestId, secondBody.requestId);
    assertRequestCorrelation(firstResponse, firstBody);
    assertRequestCorrelation(secondResponse, secondBody);
  });
});

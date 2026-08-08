type CoinGeckoPriceResponse = {
  monad?: {
    usd?: number;
    gbp?: number;
    last_updated_at?: number;
  };
};

type CoinbaseExchangeRatesResponse = {
  data?: {
    currency?: string;
    rates?: {
      USD?: string;
      GBP?: string;
    };
  };
};

type MonPriceQuote = {
  usd: number;
  gbp: number;
  lastUpdatedAt: number;
  source: "CoinGecko" | "Coinbase";
  basis: "mainnet MON";
};

const PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd,gbp&include_last_updated_at=true";
const COINBASE_RATES_URL =
  "https://api.coinbase.com/v2/exchange-rates?currency=MON";
const CACHE_WINDOW_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
const FAILURE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_QUOTE_AGE_MS = 24 * 60 * 60_000;
const FRESH_QUOTE_AGE_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

let cachedQuote: MonPriceQuote | undefined;
let cacheExpiresAt = 0;
let retryAfterAt = 0;
let inFlightQuote: Promise<MonPriceQuote> | undefined;
let requestSequence = 0;

function createRequestId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    requestSequence += 1;
    return `mon-price-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
  }
}

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return safeName || "UnknownError";
}

function parseRetryAfter(value: string | null) {
  if (!value) return FAILURE_BACKOFF_MS;

  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();

  if (!Number.isFinite(delay)) return FAILURE_BACKOFF_MS;
  return Math.min(Math.max(delay, FAILURE_BACKOFF_MS), MAX_BACKOFF_MS);
}

function isCurrentQuote(quote: MonPriceQuote) {
  const age = Date.now() - quote.lastUpdatedAt * 1000;
  return age >= -MAX_CLOCK_SKEW_MS && age <= FRESH_QUOTE_AGE_MS;
}

function isUsableQuote(quote: MonPriceQuote) {
  const age = Date.now() - quote.lastUpdatedAt * 1000;
  return age >= -MAX_CLOCK_SKEW_MS && age <= MAX_QUOTE_AGE_MS;
}

function quoteResponse(
  quote: MonPriceQuote,
  requestId: string,
  forceStale = false,
) {
  const stale = forceStale || !isCurrentQuote(quote);

  return Response.json({
    ...quote,
    quoteStatus: stale ? "stale" : "live",
    requestId,
  }, {
    headers: {
      "cache-control": stale
        ? "public, max-age=10, stale-while-revalidate=300"
        : "public, max-age=30, stale-while-revalidate=120",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
      ...(stale ? { "x-taptab-price-status": "stale" } : {}),
    },
  });
}

function unavailableResponse(requestId: string) {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((Math.max(retryAfterAt, Date.now() + FAILURE_BACKOFF_MS) - Date.now()) / 1_000),
  );
  return Response.json(
    {
      error: "The live MON reference price is temporarily unavailable.",
      requestId,
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(retryAfterSeconds),
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    },
  );
}

async function requestCoinGeckoQuote() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(PRICE_URL, {
      headers: {
        accept: "application/json",
        "user-agent": "TapTab/1.0 (Monad Blitz price reference)",
      },
      signal: controller.signal,
    });

    if (response.status === 429) {
      retryAfterAt = Date.now() + parseRetryAfter(response.headers.get("retry-after"));
    }

    if (!response.ok) {
      throw new Error(`CoinGecko returned ${response.status}.`);
    }

    const data = (await response.json()) as CoinGeckoPriceResponse;
    const usd = data.monad?.usd;
    const gbp = data.monad?.gbp;
    const lastUpdatedAt = data.monad?.last_updated_at;
    const now = Date.now();
    const updatedAtMs = typeof lastUpdatedAt === "number" ? lastUpdatedAt * 1000 : NaN;

    if (
      typeof usd !== "number" ||
      !Number.isFinite(usd) ||
      usd <= 0 ||
      typeof gbp !== "number" ||
      !Number.isFinite(gbp) ||
      gbp <= 0 ||
      typeof lastUpdatedAt !== "number" ||
      !Number.isFinite(lastUpdatedAt) ||
      lastUpdatedAt <= 0 ||
      updatedAtMs < now - MAX_QUOTE_AGE_MS ||
      updatedAtMs > now + MAX_CLOCK_SKEW_MS
    ) {
      throw new Error("CoinGecko returned an incomplete or invalid MON quote.");
    }

    return {
      usd,
      gbp,
      lastUpdatedAt,
      source: "CoinGecko",
      basis: "mainnet MON",
    } satisfies MonPriceQuote;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCoinbasePrice(
  amount: string | undefined,
  currency: "USD" | "GBP",
) {
  if (
    typeof amount !== "string" ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount)
  ) {
    throw new Error(`Coinbase returned an invalid MON-${currency} quote.`);
  }

  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Coinbase returned a non-positive MON-${currency} quote.`);
  }
  return parsed;
}

async function requestCoinbaseQuote() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(COINBASE_RATES_URL, {
      headers: {
        accept: "application/json",
        "user-agent": "TapTab/1.0 (Monad Blitz price reference)",
      },
      signal: controller.signal,
    });

    if (response.status === 429) {
      retryAfterAt = Date.now() + parseRetryAfter(response.headers.get("retry-after"));
    }
    if (!response.ok) {
      throw new Error(`Coinbase returned ${response.status}.`);
    }

    const payload = (await response.json()) as CoinbaseExchangeRatesResponse;
    if (payload.data?.currency !== "MON") {
      throw new Error("Coinbase returned exchange rates for the wrong base currency.");
    }

    return {
      usd: parseCoinbasePrice(payload.data.rates?.USD, "USD"),
      gbp: parseCoinbasePrice(payload.data.rates?.GBP, "GBP"),
      lastUpdatedAt: Math.floor(Date.now() / 1_000),
      source: "Coinbase",
      basis: "mainnet MON",
    } satisfies MonPriceQuote;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestQuote() {
  try {
    return await requestCoinGeckoQuote();
  } catch {
    return requestCoinbaseQuote();
  }
}

function getFreshQuote() {
  if (!inFlightQuote) {
    inFlightQuote = requestQuote()
      .then((quote) => {
        cachedQuote = quote;
        cacheExpiresAt = Date.now() + CACHE_WINDOW_MS;
        retryAfterAt = 0;
        return quote;
      })
      .catch((error: unknown) => {
        if (retryAfterAt <= Date.now()) {
          retryAfterAt = Date.now() + FAILURE_BACKOFF_MS;
        }
        throw error;
      })
      .finally(() => {
        inFlightQuote = undefined;
      });
  }

  return inFlightQuote;
}

export async function GET() {
  const requestId = createRequestId();
  const now = Date.now();
  const usableCachedQuote = cachedQuote && isUsableQuote(cachedQuote)
    ? cachedQuote
    : undefined;

  if (usableCachedQuote && now < cacheExpiresAt) {
    return quoteResponse(usableCachedQuote, requestId);
  }

  if (now < retryAfterAt) {
    return usableCachedQuote
      ? quoteResponse(usableCachedQuote, requestId, true)
      : unavailableResponse(requestId);
  }

  try {
    return quoteResponse(await getFreshQuote(), requestId);
  } catch (error) {
    console.error("MON reference price request failed", {
      requestId,
      errorName: safeErrorName(error),
    });
    return usableCachedQuote
      ? quoteResponse(usableCachedQuote, requestId, true)
      : unavailableResponse(requestId);
  }
}

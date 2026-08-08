export const TAPTAB_PRICE_FRESH_AGE_SECONDS = 5 * 60;
export const TAPTAB_PRICE_MAX_AGE_SECONDS = 24 * 60 * 60;
export const TAPTAB_PRICE_MAX_FUTURE_SKEW_SECONDS = 5 * 60;

export type TapTabPriceState = "live" | "stale";

export type TapTabPriceReference = Readonly<{
  usd: number;
  gbp: number;
  lastUpdatedAt: number;
  source: string;
  basis: string;
  state: TapTabPriceState;
  ageSeconds: number;
}>;

export type TapTabLockedPriceReference = Readonly<{
  gbpPerMon: number;
  usdPerMon?: number;
  observedAtUnixSeconds: number;
  source: string;
  basis: string;
  mode: TapTabPriceState | "manual";
  lockedAtUnixSeconds: number;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function readPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} was not a positive finite number.`);
  }
  return value;
}

function readBoundedLabel(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} was missing.`);
  const clean = value.trim();
  if (!clean || clean.length > 80 || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new Error(`${label} was invalid.`);
  }
  return clean;
}

export function parseTapTabPriceReference(
  payload: unknown,
  options: Readonly<{
    nowUnixSeconds?: number;
    responseStatus?: string | null;
  }> = {},
): TapTabPriceReference {
  if (!isRecord(payload)) throw new Error("Price response was not an object.");

  const nowUnixSeconds = options.nowUnixSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(nowUnixSeconds) || nowUnixSeconds <= 0) {
    throw new Error("Current time was invalid.");
  }
  if (!Number.isSafeInteger(payload.lastUpdatedAt) || Number(payload.lastUpdatedAt) <= 0) {
    throw new Error("Price timestamp was invalid.");
  }

  const lastUpdatedAt = Number(payload.lastUpdatedAt);
  const ageSeconds = nowUnixSeconds - lastUpdatedAt;
  if (
    ageSeconds < -TAPTAB_PRICE_MAX_FUTURE_SKEW_SECONDS ||
    ageSeconds > TAPTAB_PRICE_MAX_AGE_SECONDS
  ) {
    throw new Error("Price timestamp was outside the usable window.");
  }

  const bodyStatus = payload.quoteStatus;
  if (bodyStatus !== undefined && bodyStatus !== "live" && bodyStatus !== "stale") {
    throw new Error("Price status was invalid.");
  }
  const responseStatus = options.responseStatus;
  if (responseStatus && responseStatus !== "live" && responseStatus !== "stale") {
    throw new Error("Price response status was invalid.");
  }
  const stale =
    ageSeconds > TAPTAB_PRICE_FRESH_AGE_SECONDS ||
    bodyStatus === "stale" ||
    responseStatus === "stale";

  return Object.freeze({
    usd: readPositiveNumber(payload.usd, "USD price"),
    gbp: readPositiveNumber(payload.gbp, "GBP price"),
    lastUpdatedAt,
    source: readBoundedLabel(payload.source, "Price source"),
    basis: readBoundedLabel(payload.basis, "Price basis"),
    state: stale ? "stale" : "live",
    ageSeconds: Math.max(0, ageSeconds),
  });
}

export function lockTapTabPriceReference(
  input: Readonly<{
    gbpPerMon: number;
    usdPerMon?: number;
    observedAtUnixSeconds: number;
    source: string;
    basis: string;
    mode: TapTabPriceState | "manual";
  }>,
  lockedAtUnixSeconds = Math.floor(Date.now() / 1_000),
): TapTabLockedPriceReference {
  if (!Number.isSafeInteger(input.observedAtUnixSeconds) || input.observedAtUnixSeconds <= 0) {
    throw new Error("Locked price timestamp was invalid.");
  }
  if (!Number.isSafeInteger(lockedAtUnixSeconds) || lockedAtUnixSeconds <= 0) {
    throw new Error("Price lock time was invalid.");
  }

  return Object.freeze({
    gbpPerMon: readPositiveNumber(input.gbpPerMon, "Locked GBP price"),
    ...(input.usdPerMon === undefined
      ? {}
      : { usdPerMon: readPositiveNumber(input.usdPerMon, "Locked USD price") }),
    observedAtUnixSeconds: input.observedAtUnixSeconds,
    source: readBoundedLabel(input.source, "Locked price source"),
    basis: readBoundedLabel(input.basis, "Locked price basis"),
    mode: input.mode,
    lockedAtUnixSeconds,
  });
}

const WEI_PER_MON = 10n ** 18n;
const UINT256_MAX = (1n << 256n) - 1n;
const MIN_GBP_PER_MON = { numerator: 1n, scale: 1_000_000_000n };
const MAX_GBP_PER_MON = 1_000_000n;
const TESTNET_SETTLEMENT_DIVISOR = 1_000n;

const TABLE_7_ITEMS = Object.freeze([
  Object.freeze({ name: "Wood-fired margherita", amountPence: 1_200, shareCount: 1 }),
  Object.freeze({ name: "Truffle fries", amountPence: 750, shareCount: 2 }),
  Object.freeze({ name: "Burrata & tomatoes", amountPence: 900, shareCount: 2 }),
  Object.freeze({ name: "Bottle of house red", amountPence: 1_400, shareCount: 4 }),
  Object.freeze({ name: "Pistachio gelato", amountPence: 600, shareCount: 2 }),
]);

function parseGbpPerMon(value) {
  if (typeof value !== "string") throw new TypeError("GBP-per-MON quote must be a string.");
  const text = value.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/.exec(text);
  if (!match) {
    throw new Error("GBP-per-MON quote must be a positive decimal with at most 18 decimal places.");
  }

  const fraction = match[2] || "";
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(match[1]) * scale + BigInt(fraction || "0");
  if (numerator === 0n) throw new Error("GBP-per-MON quote must be greater than zero.");
  if (numerator * MIN_GBP_PER_MON.scale < MIN_GBP_PER_MON.numerator * scale) {
    throw new Error("GBP-per-MON quote is implausibly small (minimum 0.000000001).");
  }
  if (numerator > MAX_GBP_PER_MON * scale) {
    throw new Error("GBP-per-MON quote is implausibly large (maximum 1000000).");
  }

  return Object.freeze({ text, numerator, scale });
}

function numberQuoteToDecimal(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("CoinGecko returned an invalid GBP-per-MON quote.");
  }
  const shortest = String(value);
  if (!/[eE]/.test(shortest)) return shortest;
  const fixed = value.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
  return fixed || "0";
}

function penceToWei(amountPence, quote) {
  if (!Number.isSafeInteger(amountPence) || amountPence <= 0) {
    throw new Error("Receipt item pence must be a positive safe integer.");
  }
  const numerator = BigInt(amountPence) * WEI_PER_MON * quote.scale;
  const denominator = 100n * quote.numerator;
  const amountWei = (numerator + denominator / 2n) / denominator;
  if (amountWei === 0n || amountWei > UINT256_MAX) {
    throw new Error("Converted receipt item does not fit a non-zero uint256 amount.");
  }
  return amountWei;
}

function table7Config(quote) {
  const subtotalPence = TABLE_7_ITEMS.reduce((total, item) => total + item.amountPence, 0);
  const metadata = Object.freeze({
    currency: "GBP",
    merchant: "Lina Stores · Shoreditch",
    subtotalPence,
    items: TABLE_7_ITEMS.map(({ name, amountPence }) => ({ name, amountPence })),
  });
  const itemAmounts = TABLE_7_ITEMS.map((item) => penceToWei(item.amountPence, quote));
  const shareCounts = TABLE_7_ITEMS.map((item) => item.shareCount);
  return Object.freeze({ metadata, itemAmounts, shareCounts });
}

/**
 * Scales already-rounded reference rows while reconciling their sum to the
 * half-up rounded scaled subtotal. Largest remainders and original row order
 * make the result deterministic without hiding rounding in the final row.
 */
function scaleWeiAmounts(itemAmounts, divisor = TESTNET_SETTLEMENT_DIVISOR) {
  if (!Array.isArray(itemAmounts) || itemAmounts.length === 0) {
    throw new Error("At least one reference item amount is required.");
  }
  if (typeof divisor !== "bigint" || divisor <= 1n) {
    throw new Error("Settlement divisor must be a bigint greater than one.");
  }
  if (itemAmounts.some((amount) => typeof amount !== "bigint" || amount <= 0n)) {
    throw new Error("Reference item amounts must be positive bigint values.");
  }

  const referenceSubtotalWei = itemAmounts.reduce((total, amount) => total + amount, 0n);
  const subtotalWei = (referenceSubtotalWei + divisor / 2n) / divisor;
  const rows = itemAmounts.map((amount, index) => ({
    index,
    floor: amount / divisor,
    remainder: amount % divisor,
  }));
  const floorSubtotal = rows.reduce((total, row) => total + row.floor, 0n);
  const remaining = subtotalWei - floorSubtotal;
  if (remaining < 0n || remaining > BigInt(rows.length)) {
    throw new Error("Scaled receipt rows could not be reconciled exactly.");
  }

  const itemAmountsWei = rows.map((row) => row.floor);
  const priority = [...rows].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; index < Number(remaining); index += 1) {
    itemAmountsWei[priority[index].index] += 1n;
  }
  if (
    itemAmountsWei.some((amount) => amount <= 0n) ||
    itemAmountsWei.reduce((total, amount) => total + amount, 0n) !== subtotalWei
  ) {
    throw new Error("Scaled receipt rows do not reconcile to the settlement subtotal.");
  }

  return Object.freeze({
    divisor,
    referenceSubtotalWei,
    subtotalWei,
    itemAmountsWei: Object.freeze(itemAmountsWei),
  });
}

function table7ScaledTestnetConfig(quote) {
  const reference = table7Config(quote);
  const scaled = scaleWeiAmounts(reference.itemAmounts);
  return Object.freeze({
    metadata: reference.metadata,
    referenceItemAmounts: reference.itemAmounts,
    referenceSubtotalWei: scaled.referenceSubtotalWei,
    itemAmounts: scaled.itemAmountsWei,
    subtotalWei: scaled.subtotalWei,
    shareCounts: reference.shareCounts,
    divisor: scaled.divisor,
  });
}

function scaledTestnetMetadata({
  demo,
  quote,
  source,
  basis,
  observedAtUnixSeconds,
  lockedAtUnixSeconds,
}) {
  if (!demo || typeof demo !== "object") throw new TypeError("Scaled demo data is required.");
  if (!quote || typeof quote.text !== "string") throw new TypeError("A parsed quote is required.");
  for (const [label, value] of [
    ["Quote source", source],
    ["Quote basis", basis],
  ]) {
    if (typeof value !== "string" || !value.trim() || value.length > 100) {
      throw new TypeError(`${label} must be a non-empty string of at most 100 characters.`);
    }
  }
  if (
    !Number.isSafeInteger(observedAtUnixSeconds) ||
    observedAtUnixSeconds <= 0 ||
    !Number.isSafeInteger(lockedAtUnixSeconds) ||
    lockedAtUnixSeconds < observedAtUnixSeconds
  ) {
    throw new Error("Scaled demo quote timestamps are invalid.");
  }
  if (
    demo.divisor !== TESTNET_SETTLEMENT_DIVISOR ||
    !Array.isArray(demo.referenceItemAmounts) ||
    !Array.isArray(demo.itemAmounts) ||
    typeof demo.referenceSubtotalWei !== "bigint" ||
    typeof demo.subtotalWei !== "bigint" ||
    demo.referenceSubtotalWei <= 0n ||
    demo.subtotalWei <= 0n ||
    demo.itemAmounts.reduce((total, amount) => total + amount, 0n) !== demo.subtotalWei
  ) {
    throw new Error("Scaled demo amounts do not satisfy the disclosed 1,000:1 settlement mode.");
  }
  const reconciled = scaleWeiAmounts(demo.referenceItemAmounts, demo.divisor);
  if (
    reconciled.referenceSubtotalWei !== demo.referenceSubtotalWei ||
    reconciled.subtotalWei !== demo.subtotalWei ||
    reconciled.itemAmountsWei.length !== demo.itemAmounts.length ||
    reconciled.itemAmountsWei.some((amount, index) => amount !== demo.itemAmounts[index])
  ) {
    throw new Error("Scaled demo amounts do not reconcile exactly from the reference rows.");
  }

  return Object.freeze({
    schema: "taptab-gbp-receipt",
    version: 2,
    ...demo.metadata,
    quote: Object.freeze({
      gbpPerMon: quote.text,
      source: source.trim(),
      basis: basis.trim(),
      observedAtUnixSeconds,
      lockedAtUnixSeconds,
      allocation: "per-row-half-up",
      referenceSubtotalWei: demo.referenceSubtotalWei.toString(),
    }),
    settlement: Object.freeze({
      mode: "scaled-testnet-demo",
      divisor: Number(TESTNET_SETTLEMENT_DIVISOR),
      allocation: "largest-remainder-half-up",
      subtotalWei: demo.subtotalWei.toString(),
      network: "Monad Testnet",
    }),
  });
}

function parseDuration(value) {
  const text = value === undefined || value === "" ? "14400" : String(value).trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new Error("TAPTAB_DURATION_SECONDS must be a whole number.");
  }
  const duration = Number(text);
  if (!Number.isSafeInteger(duration) || duration < 300 || duration > 604_800) {
    throw new Error("TAPTAB_DURATION_SECONDS must be from 300 to 604800.");
  }
  return duration;
}

module.exports = {
  TABLE_7_ITEMS,
  TESTNET_SETTLEMENT_DIVISOR,
  numberQuoteToDecimal,
  parseDuration,
  parseGbpPerMon,
  penceToWei,
  scaleWeiAmounts,
  scaledTestnetMetadata,
  table7Config,
  table7ScaledTestnetConfig,
};

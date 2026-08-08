import {
  decodeEventLog,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import {
  MAX_TAPTAB_ITEMS,
  TAPTAB_MONAD_TESTNET,
  buildCreateBillWrite,
  tapTabAbi,
  type TapTabContext,
} from "./taptab-chain.ts";
import type { ReceiptItem } from "./taptab-model.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WEI_PER_MON = 1_000_000_000_000_000_000n;
const PENCE_PER_GBP = 100n;
const UINT256_MAX = (1n << 256n) - 1n;
const MAX_METADATA_URI_CHARACTERS = 64_000;
const MAX_TEXT_CHARACTERS = 100;
const MAX_QUOTE_DECIMALS = 18;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 300;

export const TAPTAB_CREATE_BILL_QUOTE_MAX_AGE_SECONDS = 300;

export type TapTabVerifiedReceipt = Readonly<{
  merchant: string;
  items: readonly ReceiptItem[];
}>;

/**
 * A decimal string is deliberate: converting a JavaScript floating-point
 * price to wei can silently change a receipt total.
 */
export type TapTabCreateBillQuote = Readonly<{
  gbpPerMon: string;
  source: string;
  basis: string;
  observedAtUnixSeconds: number;
}>;

export type TapTabTrustedContract = Readonly<{
  address: Address;
  chainId: typeof TAPTAB_MONAD_TESTNET.id;
}>;

export type TapTabBillConfirmations = Readonly<{
  payee: boolean;
  deadline: boolean;
  quote: boolean;
}>;

export type TapTabBillMetadata = Readonly<{
  schema: "taptab-gbp-receipt";
  version: 1;
  currency: "GBP";
  merchant: string;
  subtotalPence: number;
  items: readonly Readonly<{
    name: string;
    amountPence: number;
  }>[];
  quote: Readonly<{
    gbpPerMon: string;
    source: string;
    basis: string;
    observedAtUnixSeconds: number;
    lockedAtUnixSeconds: number;
    allocation: "largest-remainder-half-up";
    subtotalWei: string;
  }>;
}>;

export type PreparedTapTabBill = Readonly<{
  contractAddress: Address;
  payee: Address;
  deadline: bigint;
  subtotalPence: number;
  subtotalWei: bigint;
  itemAmountsWei: readonly bigint[];
  shareCounts: readonly number[];
  metadata: TapTabBillMetadata;
  metadataURI: string;
  write: ReturnType<typeof buildCreateBillWrite>;
}>;

export type TapTabConfirmationLog = Readonly<{
  address: Address;
  data: Hex;
  topics: readonly Hex[];
}>;

export type ExpectedTapTabBillCreated = Readonly<{
  contractAddress: Address;
  creator: Address;
  payee: Address;
  deadline: bigint;
  subtotalWei: bigint;
  metadataURI: string;
}>;

export type ConfirmedTapTabBill = Readonly<{
  context: TapTabContext;
  creator: Address;
  payee: Address;
  deadline: bigint;
  subtotalWei: bigint;
  metadataURI: string;
}>;

type ParsedDecimal = Readonly<{
  canonical: string;
  numerator: bigint;
  scale: bigint;
}>;

function checkedText(value: string, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is required.`);
  const text = value.normalize("NFC");
  if (
    !text ||
    text.trim() !== text ||
    text.length > MAX_TEXT_CHARACTERS ||
    /[\u0000-\u001f\u007f]/.test(text)
  ) {
    throw new TypeError(`${label} must be a clean 1 to ${MAX_TEXT_CHARACTERS} character value.`);
  }
  return text;
}

function checkedAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new TypeError(`${label} must be a valid EVM address.`);
  const address = getAddress(value);
  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new TypeError(`${label} cannot be the zero address.`);
  }
  return address;
}

function checkedUnixSeconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive Unix timestamp in seconds.`);
  }
  return value;
}

export function parsePositiveDecimal(value: string): ParsedDecimal {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new TypeError("The GBP-per-MON quote must be an exact decimal string.");
  }
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(value);
  if (!match) {
    throw new TypeError(
      `The GBP-per-MON quote must be a plain positive decimal with at most ${MAX_QUOTE_DECIMALS} decimal places.`,
    );
  }
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  const canonical = fraction ? `${match[1]}.${fraction}` : match[1];
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(match[1]) * scale + BigInt(fraction || "0");
  if (numerator <= 0n) throw new RangeError("The GBP-per-MON quote must be positive.");
  return { canonical, numerator, scale };
}

/** Preserves JavaScript's shortest numeric representation while expanding exponent notation. */
export function finiteNumberToPlainDecimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("The GBP-per-MON quote must be a positive finite number.");
  }
  const shortest = String(value).toLowerCase();
  if (!shortest.includes("e")) return parsePositiveDecimal(shortest).canonical;

  const [coefficient, rawExponent] = shortest.split("e");
  const exponent = Number(rawExponent);
  if (!coefficient || !Number.isSafeInteger(exponent)) {
    throw new TypeError("The GBP-per-MON quote could not be represented as a decimal.");
  }
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  const expanded =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return parsePositiveDecimal(expanded).canonical;
}

function checkedReceipt(receipt: TapTabVerifiedReceipt) {
  if (!receipt || typeof receipt !== "object") {
    throw new TypeError("A verified receipt is required.");
  }
  const merchant = checkedText(receipt.merchant, "Merchant");
  if (!Array.isArray(receipt.items) || receipt.items.length === 0) {
    throw new RangeError("The verified receipt must contain at least one item.");
  }
  if (receipt.items.length > MAX_TAPTAB_ITEMS) {
    throw new RangeError(`The verified receipt can contain at most ${MAX_TAPTAB_ITEMS} items.`);
  }

  let subtotalPence = 0;
  let totalShares = 0;
  const items = receipt.items.map((item, index) => {
    const name = checkedText(item.name, `Item ${index + 1} name`);
    if (!Number.isSafeInteger(item.pricePence) || item.pricePence <= 0) {
      throw new RangeError(`Item ${index + 1} must have a positive integer-pence price.`);
    }
    if (!Number.isInteger(item.shareSlots) || item.shareSlots < 1 || item.shareSlots > 32) {
      throw new RangeError(`Item ${index + 1} must have between 1 and 32 shares.`);
    }
    subtotalPence += item.pricePence;
    totalShares += item.shareSlots;
    if (!Number.isSafeInteger(subtotalPence)) {
      throw new RangeError("The receipt subtotal exceeds the safe integer-pence range.");
    }
    return { name, pricePence: item.pricePence, shareSlots: item.shareSlots };
  });
  if (totalShares > 128) {
    throw new RangeError("The verified receipt can contain at most 128 share slots.");
  }
  return { merchant, items, subtotalPence };
}

function checkedQuote(
  quote: TapTabCreateBillQuote,
  nowUnixSeconds: number,
): TapTabCreateBillQuote & Readonly<{ rate: ParsedDecimal }> {
  if (!quote || typeof quote !== "object") throw new TypeError("A MON quote is required.");
  const source = checkedText(quote.source, "Quote source");
  const basis = checkedText(quote.basis, "Quote basis");
  const observedAtUnixSeconds = checkedUnixSeconds(
    quote.observedAtUnixSeconds,
    "Quote timestamp",
  );
  if (observedAtUnixSeconds > nowUnixSeconds + MAX_FUTURE_CLOCK_SKEW_SECONDS) {
    throw new RangeError("The MON quote timestamp is too far in the future.");
  }
  if (nowUnixSeconds - observedAtUnixSeconds > TAPTAB_CREATE_BILL_QUOTE_MAX_AGE_SECONDS) {
    throw new RangeError("The MON quote is older than five minutes. Refresh it before creating the bill.");
  }
  const rate = parsePositiveDecimal(quote.gbpPerMon);
  return {
    gbpPerMon: rate.canonical,
    source,
    basis,
    observedAtUnixSeconds,
    rate,
  };
}

/**
 * Converts every receipt row together. Floors are allocated first, then the
 * rounded subtotal's remaining wei go to the largest fractional remainders.
 * This keeps the onchain item sum exactly equal to the displayed subtotal.
 */
export function allocateReceiptPenceToWei(
  itemPence: readonly number[],
  gbpPerMon: string,
): Readonly<{ itemAmountsWei: readonly bigint[]; subtotalWei: bigint }> {
  if (!Array.isArray(itemPence) || itemPence.length === 0) {
    throw new RangeError("At least one receipt amount is required.");
  }
  const rate = parsePositiveDecimal(gbpPerMon);
  const denominator = PENCE_PER_GBP * rate.numerator;
  let subtotalPence = 0n;
  const allocations = itemPence.map((pence, index) => {
    if (!Number.isSafeInteger(pence) || pence <= 0) {
      throw new RangeError(`Receipt amount ${index + 1} must be positive integer pence.`);
    }
    subtotalPence += BigInt(pence);
    const exactNumerator = BigInt(pence) * WEI_PER_MON * rate.scale;
    return {
      index,
      floor: exactNumerator / denominator,
      remainder: exactNumerator % denominator,
    };
  });

  const subtotalNumerator = subtotalPence * WEI_PER_MON * rate.scale;
  const subtotalWei = (subtotalNumerator + denominator / 2n) / denominator;
  if (subtotalWei <= 0n || subtotalWei > UINT256_MAX) {
    throw new RangeError("The converted receipt subtotal does not fit a positive uint256 amount.");
  }
  const floorTotal = allocations.reduce((sum, allocation) => sum + allocation.floor, 0n);
  const remaining = subtotalWei - floorTotal;
  if (remaining < 0n || remaining > BigInt(allocations.length)) {
    throw new RangeError("The converted receipt could not be reconciled exactly.");
  }

  const result = allocations.map((allocation) => allocation.floor);
  const priority = [...allocations].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; index < Number(remaining); index += 1) {
    result[priority[index].index] += 1n;
  }
  if (result.some((amount) => amount <= 0n)) {
    throw new RangeError("Every converted receipt item must be worth at least one wei.");
  }
  return { itemAmountsWei: result, subtotalWei };
}

export function prepareTapTabBill(input: Readonly<{
  trustedContract: TapTabTrustedContract;
  receipt: TapTabVerifiedReceipt;
  quote: TapTabCreateBillQuote;
  payee: string;
  deadlineUnixSeconds: number;
  nowUnixSeconds: number;
  confirmations: TapTabBillConfirmations;
}>): PreparedTapTabBill {
  if (!input || typeof input !== "object") throw new TypeError("Bill creation input is required.");
  if (
    !input.confirmations ||
    input.confirmations.payee !== true ||
    input.confirmations.deadline !== true ||
    input.confirmations.quote !== true
  ) {
    throw new Error("Confirm the payee, deadline and quote before creating the bill.");
  }
  if (input.trustedContract.chainId !== TAPTAB_MONAD_TESTNET.id) {
    throw new Error("Bill creation is restricted to the trusted Monad Testnet chain.");
  }
  const contractAddress = checkedAddress(input.trustedContract.address, "Trusted contract");
  const payee = checkedAddress(input.payee, "Payee");
  const nowUnixSeconds = checkedUnixSeconds(input.nowUnixSeconds, "Current timestamp");
  const deadlineUnixSeconds = checkedUnixSeconds(input.deadlineUnixSeconds, "Deadline");
  if (deadlineUnixSeconds <= nowUnixSeconds) {
    throw new RangeError("The bill deadline must be in the future.");
  }

  const receipt = checkedReceipt(input.receipt);
  const quote = checkedQuote(input.quote, nowUnixSeconds);
  const conversion = allocateReceiptPenceToWei(
    receipt.items.map((item) => item.pricePence),
    quote.gbpPerMon,
  );
  receipt.items.forEach((item, index) => {
    if (BigInt(item.shareSlots) > conversion.itemAmountsWei[index]) {
      throw new RangeError(`Item ${index + 1} has more shares than its converted wei value.`);
    }
  });

  const metadata: TapTabBillMetadata = {
    schema: "taptab-gbp-receipt",
    version: 1,
    currency: "GBP",
    merchant: receipt.merchant,
    subtotalPence: receipt.subtotalPence,
    items: receipt.items.map((item) => ({
      name: item.name,
      amountPence: item.pricePence,
    })),
    quote: {
      gbpPerMon: quote.gbpPerMon,
      source: quote.source,
      basis: quote.basis,
      observedAtUnixSeconds: quote.observedAtUnixSeconds,
      lockedAtUnixSeconds: Math.max(nowUnixSeconds, quote.observedAtUnixSeconds),
      allocation: "largest-remainder-half-up",
      subtotalWei: conversion.subtotalWei.toString(),
    },
  };
  const metadataURI = `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
  if (metadataURI.length > MAX_METADATA_URI_CHARACTERS) {
    throw new RangeError("The verified receipt metadata is too large for TapTab.");
  }
  const deadline = BigInt(deadlineUnixSeconds);
  const shareCounts = receipt.items.map((item) => item.shareSlots);
  const write = buildCreateBillWrite(contractAddress, {
    payee,
    metadataURI,
    deadline,
    itemAmounts: conversion.itemAmountsWei,
    shareCounts,
    currentTimestamp: BigInt(nowUnixSeconds),
  });

  return {
    contractAddress,
    payee,
    deadline,
    subtotalPence: receipt.subtotalPence,
    subtotalWei: conversion.subtotalWei,
    itemAmountsWei: conversion.itemAmountsWei,
    shareCounts,
    metadata,
    metadataURI,
    write,
  };
}

/** Finds and verifies the exact BillCreated event expected from a confirmed transaction. */
export function findConfirmedTapTabBillCreated(
  logs: readonly TapTabConfirmationLog[],
  expected: ExpectedTapTabBillCreated,
): ConfirmedTapTabBill {
  const contractAddress = checkedAddress(expected.contractAddress, "Trusted contract");
  const creator = checkedAddress(expected.creator, "Creator");
  const payee = checkedAddress(expected.payee, "Payee");

  for (const log of logs) {
    if (!isAddress(log.address) || getAddress(log.address) !== contractAddress) continue;
    if (log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: tapTabAbi,
        eventName: "BillCreated",
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
        strict: true,
      });
      const args = decoded.args;
      if (
        args.billId <= 0n ||
        getAddress(args.creator) !== creator ||
        getAddress(args.payee) !== payee ||
        args.deadline !== expected.deadline ||
        args.subtotal !== expected.subtotalWei ||
        args.metadataURI !== expected.metadataURI
      ) {
        continue;
      }
      return {
        context: { address: contractAddress, billId: args.billId },
        creator,
        payee,
        deadline: args.deadline,
        subtotalWei: args.subtotal,
        metadataURI: args.metadataURI,
      };
    } catch {
      // Other contract events and malformed logs are not creation confirmation.
    }
  }
  throw new Error("The confirmed transaction did not contain the expected BillCreated event.");
}

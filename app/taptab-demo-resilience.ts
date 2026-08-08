import { getAddress, isAddress, type Address, type Hash } from "viem";
import {
  MAX_TAPTAB_ITEMS,
  MAX_TAPTAB_SHARES_PER_ITEM,
  MAX_TAPTAB_TOTAL_SHARES,
  TAPTAB_MONAD_TESTNET,
  type TapTabContext,
} from "./taptab-chain.ts";
import {
  parsePositiveDecimal,
  type TapTabCreateBillQuote,
} from "./taptab-create-bill.ts";
import type { ReceiptItem } from "./taptab-model.ts";

const RECOVERY_SCHEMA = "taptab-demo-recovery";
const RECOVERY_VERSION = 1;
const MAX_RECOVERY_BYTES = 256 * 1024;
const MAX_RECOVERY_EVIDENCE = 10;
const MAX_RECEIPT_PENCE = 1_000_000_000;
const MAX_TEXT_CHARACTERS = 100;
const UINT256_MAX = (1n << 256n) - 1n;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const EXPLORER_ORIGIN = new URL(
  TAPTAB_MONAD_TESTNET.blockExplorers.default.url,
).origin;

export type TapTabQuoteAvailability =
  | "loading"
  | "live"
  | "stale"
  | "unavailable";

export type TapTabRecoveryQuoteMode = "live" | "manual" | "stale";

export type TapTabDemoRecoveryEvidenceInput = Readonly<{
  action: string;
  transactionHash: string;
  blockNumber: bigint | string;
  confirmedAtUnixSeconds?: number;
  confirmationMs?: number;
}>;

export type TapTabDemoRecoverySource = Readonly<{
  merchant: string;
  items: readonly ReceiptItem[];
  audienceUrl: string;
  context?: TapTabContext;
  quote?: TapTabCreateBillQuote & Readonly<{ mode: TapTabRecoveryQuoteMode }>;
  evidence?: readonly TapTabDemoRecoveryEvidenceInput[];
}>;

export type TapTabDemoRecoveryPack = Readonly<{
  schema: typeof RECOVERY_SCHEMA;
  version: typeof RECOVERY_VERSION;
  notice: "Recovery pack only — not chain proof.";
  chain: Readonly<{
    name: "Monad Testnet";
    chainId: typeof TAPTAB_MONAD_TESTNET.id;
  }>;
  exportedAtUnixSeconds: number;
  audienceUrl: string;
  receipt: Readonly<{
    verification: "host-verified";
    merchant: string;
    items: readonly Readonly<{
      name: string;
      pricePence: number;
      shareCount: number;
    }>[];
  }>;
  context?: Readonly<{
    contractAddress: Address;
    billId: string;
  }>;
  quote?: Readonly<{
    mode: TapTabRecoveryQuoteMode;
    gbpPerMon: string;
    source: string;
    basis: string;
    observedAtUnixSeconds: number;
  }>;
  evidence: readonly Readonly<{
    action: string;
    transactionHash: Hash;
    blockNumber: string;
    explorerUrl: string;
    confirmedAtUnixSeconds?: number;
    confirmationMs?: number;
  }>[];
}>;

export type ParsedTapTabDemoRecovery = Readonly<{
  pack: TapTabDemoRecoveryPack;
  receipt: Readonly<{
    merchant: string;
    items: readonly ReceiptItem[];
  }>;
  context?: TapTabContext;
}>;

function checkedUnixSeconds(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new RangeError(`${label} must be a positive Unix timestamp in seconds.`);
  }
  return Number(value);
}

function checkedText(value: unknown, label: string, maxLength = MAX_TEXT_CHARACTERS): string {
  if (typeof value !== "string") throw new TypeError(`${label} is required.`);
  const text = value.normalize("NFC");
  if (
    !text ||
    text.trim() !== text ||
    text.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(text)
  ) {
    throw new TypeError(`${label} must be a clean 1 to ${maxLength} character value.`);
  }
  return text;
}

function checkedAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new TypeError(`${label} must be a valid EVM address.`);
  }
  const address = getAddress(value);
  if (address === "0x0000000000000000000000000000000000000000") {
    throw new TypeError(`${label} cannot be the zero address.`);
  }
  return address;
}

function checkedBillId(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new TypeError("Recovery bill ID must be a positive decimal integer.");
  }
  const billId = BigInt(value);
  if (billId > UINT256_MAX) throw new RangeError("Recovery bill ID is out of range.");
  return billId;
}

function checkedQuoteMode(value: unknown): TapTabRecoveryQuoteMode {
  if (value === "live" || value === "manual" || value === "stale") return value;
  throw new TypeError("Recovery quote mode is invalid.");
}

function sanitiseAudienceUrl(value: unknown, context?: TapTabContext): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new TypeError("Audience URL must be a public HTTP or HTTPS URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Audience URL must be a public HTTP or HTTPS URL.");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError("Audience URL must be a public HTTP or HTTPS URL.");
  }
  parsed.search = "";
  parsed.hash = context ? "#live" : "";
  if (context) {
    parsed.searchParams.set("contract", context.address);
    parsed.searchParams.set("bill", context.billId.toString());
  }
  return parsed.toString();
}

function checkedReceipt(value: unknown): {
  merchant: string;
  items: readonly ReceiptItem[];
  recoveryItems: TapTabDemoRecoveryPack["receipt"]["items"];
} {
  if (!value || typeof value !== "object") throw new TypeError("Recovery receipt is required.");
  const record = value as Record<string, unknown>;
  if (record.verification !== undefined && record.verification !== "host-verified") {
    throw new TypeError("Recovery receipt verification label is invalid.");
  }
  const merchant = checkedText(record.merchant, "Recovery merchant");
  if (!Array.isArray(record.items) || record.items.length === 0) {
    throw new RangeError("Recovery receipt must contain at least one row.");
  }
  if (record.items.length > MAX_TAPTAB_ITEMS) {
    throw new RangeError(`Recovery receipt can contain at most ${MAX_TAPTAB_ITEMS} rows.`);
  }

  let totalShares = 0;
  let subtotalPence = 0;
  const recoveryItems = record.items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new TypeError(`Recovery row ${index + 1} is invalid.`);
    }
    const row = item as Record<string, unknown>;
    const name = checkedText(row.name, `Recovery row ${index + 1} name`);
    if (
      !Number.isSafeInteger(row.pricePence) ||
      Number(row.pricePence) <= 0 ||
      Number(row.pricePence) > MAX_RECEIPT_PENCE
    ) {
      throw new RangeError(`Recovery row ${index + 1} price is out of range.`);
    }
    const shareCount = row.shareCount ?? row.shareSlots;
    if (
      !Number.isInteger(shareCount) ||
      Number(shareCount) < 1 ||
      Number(shareCount) > MAX_TAPTAB_SHARES_PER_ITEM
    ) {
      throw new RangeError(
        `Recovery row ${index + 1} must have between 1 and ${MAX_TAPTAB_SHARES_PER_ITEM} shares.`,
      );
    }
    totalShares += Number(shareCount);
    subtotalPence += Number(row.pricePence);
    if (!Number.isSafeInteger(subtotalPence) || subtotalPence > MAX_RECEIPT_PENCE) {
      throw new RangeError("Recovery receipt subtotal is out of range.");
    }
    return {
      name,
      pricePence: Number(row.pricePence),
      shareCount: Number(shareCount),
    };
  });
  if (totalShares > MAX_TAPTAB_TOTAL_SHARES) {
    throw new RangeError(
      `Recovery receipt exceeds the ${MAX_TAPTAB_TOTAL_SHARES}-share contract limit.`,
    );
  }
  return {
    merchant,
    items: recoveryItems.map((item, index) => ({
      id: `recovery-row-${index + 1}`,
      name: item.name,
      pricePence: item.pricePence,
      shareSlots: item.shareCount,
    })),
    recoveryItems,
  };
}

function checkedQuote(value: unknown): TapTabDemoRecoveryPack["quote"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new TypeError("Recovery quote is invalid.");
  const record = value as Record<string, unknown>;
  const rate = parsePositiveDecimal(checkedText(record.gbpPerMon, "Recovery quote", 64));
  return {
    mode: checkedQuoteMode(record.mode),
    gbpPerMon: rate.canonical,
    source: checkedText(record.source, "Recovery quote source"),
    basis: checkedText(record.basis, "Recovery quote basis"),
    observedAtUnixSeconds: checkedUnixSeconds(
      record.observedAtUnixSeconds,
      "Recovery quote timestamp",
    ),
  };
}

function checkedEvidence(
  value: unknown,
): TapTabDemoRecoveryPack["evidence"] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RECOVERY_EVIDENCE) {
    throw new RangeError(
      `Recovery evidence must contain at most ${MAX_RECOVERY_EVIDENCE} transactions.`,
    );
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new TypeError(`Recovery evidence ${index + 1} is invalid.`);
    }
    const record = entry as Record<string, unknown>;
    const hashValue = checkedText(
      record.transactionHash,
      `Recovery evidence ${index + 1} transaction hash`,
      66,
    );
    if (!HASH_PATTERN.test(hashValue)) {
      throw new TypeError(`Recovery evidence ${index + 1} transaction hash is invalid.`);
    }
    const transactionHash = hashValue.toLowerCase() as Hash;
    if (seen.has(transactionHash)) {
      throw new TypeError("Recovery evidence contains a duplicate transaction hash.");
    }
    seen.add(transactionHash);
    const blockNumber = checkedBillId(String(record.blockNumber));
    const confirmedAtUnixSeconds =
      record.confirmedAtUnixSeconds === undefined
        ? undefined
        : checkedUnixSeconds(
            record.confirmedAtUnixSeconds,
            `Recovery evidence ${index + 1} confirmation timestamp`,
          );
    const confirmationMs = record.confirmationMs;
    if (
      confirmationMs !== undefined &&
      (!Number.isSafeInteger(confirmationMs) || Number(confirmationMs) < 0 || Number(confirmationMs) > 3_600_000)
    ) {
      throw new RangeError(`Recovery evidence ${index + 1} confirmation time is invalid.`);
    }
    return {
      action: checkedText(record.action, `Recovery evidence ${index + 1} action`),
      transactionHash,
      blockNumber: blockNumber.toString(),
      explorerUrl: `${EXPLORER_ORIGIN}/tx/${transactionHash}`,
      ...(confirmedAtUnixSeconds === undefined ? {} : { confirmedAtUnixSeconds }),
      ...(confirmationMs === undefined ? {} : { confirmationMs: Number(confirmationMs) }),
    };
  });
}

export function createManualTapTabQuote(input: Readonly<{
  gbpPerMon: string;
  sourceLabel: string;
  acknowledged: boolean;
  liveStatus: TapTabQuoteAvailability;
  nowUnixSeconds: number;
}>): TapTabCreateBillQuote {
  if (input.liveStatus !== "stale" && input.liveStatus !== "unavailable") {
    throw new Error("Manual pricing is available only when the live quote is stale or unavailable.");
  }
  if (input.acknowledged !== true) {
    throw new Error("Acknowledge that the manual rate is not an oracle.");
  }
  const rate = parsePositiveDecimal(input.gbpPerMon);
  const sourceLabel = checkedText(input.sourceLabel, "Manual quote source", 70);
  const observedAtUnixSeconds = checkedUnixSeconds(
    input.nowUnixSeconds,
    "Manual quote confirmation timestamp",
  );
  return {
    gbpPerMon: rate.canonical,
    source: `Manual fallback: ${sourceLabel}`,
    basis: "Host-entered GBP-per-MON fallback; not an oracle",
    observedAtUnixSeconds,
  };
}

export function createTapTabDemoRecoveryPack(
  source: TapTabDemoRecoverySource,
  nowUnixSeconds: number,
): TapTabDemoRecoveryPack {
  const exportedAtUnixSeconds = checkedUnixSeconds(nowUnixSeconds, "Export timestamp");
  const receipt = checkedReceipt({
    merchant: source.merchant,
    items: source.items.map((item) => ({
      name: item.name,
      pricePence: item.pricePence,
      shareCount: item.shareSlots,
    })),
  });
  const context = source.context
    ? {
        address: checkedAddress(source.context.address, "Recovery contract"),
        billId: checkedBillId(source.context.billId.toString()),
      }
    : undefined;
  const quote = checkedQuote(source.quote);
  const evidence = checkedEvidence(source.evidence ?? []);
  return {
    schema: RECOVERY_SCHEMA,
    version: RECOVERY_VERSION,
    notice: "Recovery pack only — not chain proof.",
    chain: { name: "Monad Testnet", chainId: TAPTAB_MONAD_TESTNET.id },
    exportedAtUnixSeconds,
    audienceUrl: sanitiseAudienceUrl(source.audienceUrl, context),
    receipt: {
      verification: "host-verified",
      merchant: receipt.merchant,
      items: receipt.recoveryItems,
    },
    ...(context
      ? {
          context: {
            contractAddress: context.address,
            billId: context.billId.toString(),
          },
        }
      : {}),
    ...(quote ? { quote } : {}),
    evidence,
  };
}

export function parseTapTabDemoRecoveryPack(
  json: string,
  trustedContractAddress?: string,
): ParsedTapTabDemoRecovery {
  if (typeof json !== "string" || new TextEncoder().encode(json).length > MAX_RECOVERY_BYTES) {
    throw new RangeError("Recovery pack exceeds the 256 KB safety limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new TypeError("Recovery pack is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Recovery pack must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== RECOVERY_SCHEMA || record.version !== RECOVERY_VERSION) {
    throw new TypeError("Recovery pack schema or version is not supported.");
  }
  if (!record.chain || typeof record.chain !== "object") {
    throw new TypeError("Recovery pack chain information is missing.");
  }
  const chain = record.chain as Record<string, unknown>;
  if (chain.name !== "Monad Testnet" || chain.chainId !== TAPTAB_MONAD_TESTNET.id) {
    throw new TypeError("Recovery pack is not for Monad Testnet.");
  }
  const exportedAtUnixSeconds = checkedUnixSeconds(
    record.exportedAtUnixSeconds,
    "Recovery export timestamp",
  );
  if (
    !record.receipt ||
    typeof record.receipt !== "object" ||
    (record.receipt as Record<string, unknown>).verification !== "host-verified"
  ) {
    throw new TypeError("Recovery receipt is not labelled as host-verified.");
  }
  const receipt = checkedReceipt(record.receipt);
  let context: TapTabContext | undefined;
  if (record.context !== undefined) {
    if (!record.context || typeof record.context !== "object") {
      throw new TypeError("Recovery bill context is invalid.");
    }
    const rawContext = record.context as Record<string, unknown>;
    const contractAddress = checkedAddress(
      rawContext.contractAddress,
      "Recovery contract",
    );
    if (!trustedContractAddress) {
      throw new Error("This build has no trusted TapTab contract for the recovery bill.");
    }
    const trustedContract = checkedAddress(trustedContractAddress, "Trusted contract");
    if (contractAddress !== trustedContract) {
      throw new Error("Recovery bill does not use the TapTab contract trusted by this build.");
    }
    context = { address: trustedContract, billId: checkedBillId(rawContext.billId) };
  }
  const quote = checkedQuote(record.quote);
  const evidence = checkedEvidence(record.evidence);
  const audienceUrl = sanitiseAudienceUrl(record.audienceUrl, context);
  const pack: TapTabDemoRecoveryPack = {
    schema: RECOVERY_SCHEMA,
    version: RECOVERY_VERSION,
    notice: "Recovery pack only — not chain proof.",
    chain: { name: "Monad Testnet", chainId: TAPTAB_MONAD_TESTNET.id },
    exportedAtUnixSeconds,
    audienceUrl,
    receipt: {
      verification: "host-verified",
      merchant: receipt.merchant,
      items: receipt.recoveryItems,
    },
    ...(context
      ? {
          context: {
            contractAddress: context.address,
            billId: context.billId.toString(),
          },
        }
      : {}),
    ...(quote ? { quote } : {}),
    evidence,
  };
  return {
    pack,
    receipt: { merchant: receipt.merchant, items: receipt.items },
    ...(context ? { context } : {}),
  };
}

export function serialiseTapTabDemoRecoveryPack(pack: TapTabDemoRecoveryPack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function tapTabRecoveryFileName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `taptab-demo-recovery-${stamp}.json`;
}

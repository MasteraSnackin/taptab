/** Pure privacy, sharing and settlement-export helpers for TapTab. */

export const PRIVATE_NAME_STORAGE_KEY = "taptab.private-names.v1";
export const MAX_PRIVATE_DISPLAY_NAME_LENGTH = 40;

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const PRIVATE_NAME_KEY =
  /^taptab-name:v1:(0x[0-9a-f]{40}):([1-9][0-9]*):(0x[0-9a-f]{40})$/;

export type PrivateNameContext = Readonly<{
  contractAddress: string;
  billId: bigint;
  walletAddress: string;
}>;

export type PrivateNameMapping = Readonly<{
  key: string;
  name: string;
}>;

export type TrustedParticipantLinkContext = Readonly<{
  origin: string;
  pathname: string;
  contractAddress: string;
  billId: bigint;
  participantAddresses: readonly string[];
}>;

export type ParticipantPaymentLinkResolution =
  | Readonly<{
      status: "trusted";
      participantAddress: string;
      url: string;
    }>
  | Readonly<{
      status: "rejected";
      reason: string;
    }>;

export type VenueSettlementAllocationInput = Readonly<{
  walletAddress: string;
  baseDuePence: number;
  tipPence: number;
  totalDuePence: number;
  fundedPence: number;
  transactionHashes?: readonly string[];
  privateName?: string;
}>;

export type VenueSettlementRecordInput = Readonly<{
  chainId: number;
  contractAddress: string;
  billId: bigint;
  currency: "GBP";
  merchant?: string;
  subtotalPence: number;
  tipPence: number;
  totalDuePence: number;
  fundedPence: number;
  allocations: readonly VenueSettlementAllocationInput[];
  transactionHashes: readonly string[];
}>;

export type VenueSettlementSerialiseOptions = Readonly<{
  includePrivateNames?: boolean;
}>;

export type VenueSettlementDownload = Readonly<{
  fileName: string;
  mimeType: "application/json;charset=utf-8";
  text: string;
}>;

function normaliseAddress(value: string, label: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new TypeError(`${label} must be a valid EVM address.`);
  }
  const address = value.toLowerCase();
  if (address === ZERO_ADDRESS) throw new TypeError(`${label} cannot be zero.`);
  return address;
}

function checkedBillId(value: bigint): bigint {
  if (typeof value !== "bigint" || value <= BigInt(0) || value > UINT256_MAX) {
    throw new RangeError("Bill ID must be a positive uint256.");
  }
  return value;
}

function checkedPence(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function checkedTransactionHash(value: string): string {
  if (typeof value !== "string" || !TRANSACTION_HASH.test(value)) {
    throw new TypeError("Transaction hashes must be 32-byte hexadecimal values.");
  }
  return value.toLowerCase();
}

function checkedPublicText(value: string, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value.normalize("NFC");
}

/** Validates a device-local label without permitting markup, URLs or controls. */
export function validatePrivateDisplayName(value: string): string {
  if (typeof value !== "string") throw new TypeError("Private name must be a string.");
  const name = value.normalize("NFC");
  const length = Array.from(name).length;
  if (
    length < 1 ||
    length > MAX_PRIVATE_DISPLAY_NAME_LENGTH ||
    name.trim() !== name ||
    !/[\p{L}]/u.test(name) ||
    !/^[\p{L}\p{M}\p{N} .\-'’]+$/u.test(name) ||
    !/^[\p{L}\p{N}]/u.test(name) ||
    !/[\p{L}\p{N}]$/u.test(name) ||
    /\s{2,}|[.\-'’]{2,}/u.test(name)
  ) {
    throw new TypeError(
      "Private name must be 1–40 letters or numbers with single spaces, dots, apostrophes or hyphens.",
    );
  }
  return name;
}

export function privateNameMappingKey(context: PrivateNameContext): string {
  const contractAddress = normaliseAddress(
    context.contractAddress,
    "Private-name contract",
  );
  const walletAddress = normaliseAddress(context.walletAddress, "Private-name wallet");
  const billId = checkedBillId(context.billId);
  return `taptab-name:v1:${contractAddress}:${billId.toString()}:${walletAddress}`;
}

export function createPrivateNameMapping(
  context: PrivateNameContext,
  name: string,
): PrivateNameMapping {
  return Object.freeze({
    key: privateNameMappingKey(context),
    name: validatePrivateDisplayName(name),
  });
}

function validateStoredKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = PRIVATE_NAME_KEY.exec(value);
  if (!match) return undefined;
  try {
    normaliseAddress(match[1], "Stored contract");
    checkedBillId(BigInt(match[2]));
    normaliseAddress(match[3], "Stored wallet");
    return value;
  } catch {
    return undefined;
  }
}

/** Malformed storage fails closed to an empty mapping. */
export function parsePrivateNameMappings(raw: string | null): readonly PrivateNameMapping[] {
  if (raw === null || typeof raw !== "string" || raw.length > 100_000) {
    return Object.freeze([]);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return Object.freeze([]);
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.entries) || record.entries.length > 200) {
      return Object.freeze([]);
    }

    const seen = new Set<string>();
    const entries: PrivateNameMapping[] = [];
    for (const candidate of record.entries) {
      if (!candidate || typeof candidate !== "object") return Object.freeze([]);
      const entry = candidate as Record<string, unknown>;
      const key = validateStoredKey(entry.key);
      if (!key || typeof entry.name !== "string" || seen.has(key)) {
        return Object.freeze([]);
      }
      seen.add(key);
      entries.push(
        Object.freeze({ key, name: validatePrivateDisplayName(entry.name) }),
      );
    }
    entries.sort((left, right) => left.key.localeCompare(right.key, "en"));
    return Object.freeze(entries);
  } catch {
    return Object.freeze([]);
  }
}

export function serialisePrivateNameMappings(
  mappings: readonly PrivateNameMapping[],
): string {
  if (!Array.isArray(mappings) || mappings.length > 200) {
    throw new RangeError("Private-name mappings must be an array of at most 200 entries.");
  }
  const seen = new Set<string>();
  const entries = mappings.map((mapping) => {
    const key = validateStoredKey(mapping.key);
    if (!key || seen.has(key)) throw new TypeError("Private-name mapping key is invalid or duplicated.");
    seen.add(key);
    return { key, name: validatePrivateDisplayName(mapping.name) };
  });
  entries.sort((left, right) => left.key.localeCompare(right.key, "en"));
  return JSON.stringify({ version: 1, entries });
}

export function findPrivateDisplayName(
  mappings: readonly PrivateNameMapping[],
  context: PrivateNameContext,
): string | undefined {
  const key = privateNameMappingKey(context);
  return mappings.find((mapping) => mapping.key === key)?.name;
}

export function upsertPrivateNameMapping(
  mappings: readonly PrivateNameMapping[],
  context: PrivateNameContext,
  name: string,
): readonly PrivateNameMapping[] {
  const next = createPrivateNameMapping(context, name);
  const entries = mappings.filter((mapping) => mapping.key !== next.key);
  entries.push(next);
  entries.sort((left, right) => left.key.localeCompare(right.key, "en"));
  return Object.freeze(entries);
}

function checkedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Trusted origin must be an absolute HTTP(S) origin.");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new TypeError("Trusted origin must contain only scheme and authority.");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("Trusted origin must use HTTPS, except on loopback hosts.");
  }
  return url.origin;
}

function checkedPathname(value: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.length > 200 ||
    /[?#\\]/.test(value)
  ) {
    throw new TypeError("Trusted pathname must be a local absolute path.");
  }
  if (new URL(value, "https://taptab.invalid").pathname !== value) {
    throw new TypeError("Trusted pathname must already be canonical.");
  }
  return value;
}

function checkedLinkContext(context: TrustedParticipantLinkContext): {
  origin: string;
  pathname: string;
  contractAddress: string;
  billId: bigint;
  participants: Set<string>;
} {
  const participants = new Set<string>();
  if (!Array.isArray(context.participantAddresses) || context.participantAddresses.length === 0) {
    throw new RangeError("Trusted links require at least one participant address.");
  }
  for (const participant of context.participantAddresses) {
    const address = normaliseAddress(participant, "Trusted participant");
    if (participants.has(address)) {
      throw new RangeError("Trusted participant addresses must be unique.");
    }
    participants.add(address);
  }
  return {
    origin: checkedOrigin(context.origin),
    pathname: checkedPathname(context.pathname),
    contractAddress: normaliseAddress(context.contractAddress, "Trusted contract"),
    billId: checkedBillId(context.billId),
    participants,
  };
}

export function buildParticipantPaymentUrl(
  context: TrustedParticipantLinkContext,
  participantAddress: string,
): string {
  const trusted = checkedLinkContext(context);
  const participant = normaliseAddress(participantAddress, "Payment participant");
  if (!trusted.participants.has(participant)) {
    throw new RangeError("Payment participant is not in the trusted bill participant list.");
  }

  const url = new URL(trusted.pathname, trusted.origin);
  if (url.origin !== trusted.origin) throw new Error("Payment link escaped its trusted origin.");
  url.searchParams.set("contract", trusted.contractAddress);
  url.searchParams.set("bill", trusted.billId.toString());
  url.searchParams.set("pay", participant);
  url.hash = "pay";
  return url.toString();
}

export function resolveParticipantPaymentUrl(
  value: string,
  context: TrustedParticipantLinkContext,
): ParticipantPaymentLinkResolution {
  const trusted = checkedLinkContext(context);
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return { status: "rejected", reason: "Payment link is empty or too long." };
  }

  let url: URL;
  try {
    url = new URL(value, trusted.origin);
  } catch {
    return { status: "rejected", reason: "Payment link is not a valid URL." };
  }
  if (url.origin !== trusted.origin || url.pathname !== trusted.pathname) {
    return {
      status: "rejected",
      reason: "Payment link is not on the trusted TapTab origin and path.",
    };
  }
  if (url.hash !== "#pay") {
    return { status: "rejected", reason: "Payment link has an invalid destination." };
  }

  const allowedParameters = new Set(["contract", "bill", "pay"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key)) {
      return { status: "rejected", reason: "Payment link contains an unknown parameter." };
    }
  }
  for (const key of allowedParameters) {
    if (url.searchParams.getAll(key).length !== 1) {
      return {
        status: "rejected",
        reason: "Payment link must contain one contract, bill and participant.",
      };
    }
  }

  const contract = url.searchParams.get("contract") ?? "";
  const rawBillId = url.searchParams.get("bill") ?? "";
  const rawParticipant = url.searchParams.get("pay") ?? "";
  let participant: string;
  try {
    if (normaliseAddress(contract, "Payment-link contract") !== trusted.contractAddress) {
      throw new Error("contract mismatch");
    }
    if (!/^[1-9][0-9]*$/.test(rawBillId) || BigInt(rawBillId) !== trusted.billId) {
      throw new Error("bill mismatch");
    }
    participant = normaliseAddress(rawParticipant, "Payment-link participant");
  } catch {
    return {
      status: "rejected",
      reason: "Payment link does not match the trusted bill context.",
    };
  }
  if (!trusted.participants.has(participant)) {
    return {
      status: "rejected",
      reason: "Payment link participant is not trusted for this bill.",
    };
  }

  return Object.freeze({
    status: "trusted",
    participantAddress: participant,
    url: buildParticipantPaymentUrl(context, participant),
  });
}

export function buildWhatsAppPaymentShareUrl(
  context: TrustedParticipantLinkContext,
  participantAddress: string,
): string {
  const paymentUrl = buildParticipantPaymentUrl(context, participantAddress);
  const whatsapp = new URL("https://wa.me/");
  whatsapp.searchParams.set("text", `Open your TapTab payment link: ${paymentUrl}`);
  return whatsapp.toString();
}

function sortedUniqueHashes(
  values: readonly string[],
  label: string,
  allowEmpty = false,
): string[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new RangeError(`${label} must contain at least one transaction hash.`);
  }
  const hashes = values.map(checkedTransactionHash);
  if (new Set(hashes).size !== hashes.length) {
    throw new RangeError(`${label} contains a duplicate transaction hash.`);
  }
  return hashes.sort();
}

export function serialiseVenueSettlementRecord(
  input: VenueSettlementRecordInput,
  options: VenueSettlementSerialiseOptions = {},
): string {
  if (!input || typeof input !== "object") {
    throw new TypeError("Venue settlement input is required.");
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new RangeError("Settlement chainId must be a positive safe integer.");
  }
  if (input.currency !== "GBP") throw new TypeError("Venue settlement must use GBP.");

  const contractAddress = normaliseAddress(input.contractAddress, "Settlement contract");
  const billId = checkedBillId(input.billId);
  const subtotalPence = checkedPence(input.subtotalPence, "Settlement subtotal");
  const tipPence = checkedPence(input.tipPence, "Settlement tip");
  const totalDuePence = checkedPence(input.totalDuePence, "Settlement total due");
  const fundedPence = checkedPence(input.fundedPence, "Settlement funded total");
  if (subtotalPence + tipPence !== totalDuePence) {
    throw new RangeError("Settlement subtotal and tip do not equal total due.");
  }
  if (fundedPence !== totalDuePence) {
    throw new RangeError("A venue settlement record must be fully funded.");
  }
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    throw new RangeError("Venue settlement needs at least one allocation.");
  }

  const transactionHashes = sortedUniqueHashes(
    input.transactionHashes,
    "Settlement transactions",
  );
  const transactionHashSet = new Set(transactionHashes);
  const includePrivateNames = options.includePrivateNames === true;
  const seenWallets = new Set<string>();
  const allocations = input.allocations.map((allocation) => {
    const walletAddress = normaliseAddress(
      allocation.walletAddress,
      "Settlement allocation wallet",
    );
    if (seenWallets.has(walletAddress)) {
      throw new RangeError("Settlement allocation wallets must be unique.");
    }
    seenWallets.add(walletAddress);

    const baseDuePence = checkedPence(allocation.baseDuePence, "Allocation base due");
    const allocationTipPence = checkedPence(allocation.tipPence, "Allocation tip");
    const allocationTotalPence = checkedPence(
      allocation.totalDuePence,
      "Allocation total due",
    );
    const allocationFundedPence = checkedPence(
      allocation.fundedPence,
      "Allocation funded amount",
    );
    if (baseDuePence + allocationTipPence !== allocationTotalPence) {
      throw new RangeError("Allocation base and tip do not equal its total due.");
    }
    if (allocationFundedPence !== allocationTotalPence) {
      throw new RangeError("Every settlement allocation must be fully funded.");
    }

    const hashes = allocation.transactionHashes
      ? sortedUniqueHashes(
          allocation.transactionHashes,
          `Transactions for ${walletAddress}`,
          true,
        )
      : [];
    if (hashes.some((hash) => !transactionHashSet.has(hash))) {
      throw new RangeError(
        "Allocation transaction hashes must be included in settlement transactions.",
      );
    }
    return {
      walletAddress,
      ...(includePrivateNames
        ? {
            privateName:
              allocation.privateName === undefined
                ? null
                : validatePrivateDisplayName(allocation.privateName),
          }
        : {}),
      baseDuePence,
      tipPence: allocationTipPence,
      totalDuePence: allocationTotalPence,
      fundedPence: allocationFundedPence,
      transactionHashes: hashes,
    };
  });
  allocations.sort((left, right) =>
    left.walletAddress.localeCompare(right.walletAddress, "en"),
  );

  const sum = (field: "baseDuePence" | "tipPence" | "totalDuePence" | "fundedPence") => {
    return allocations.reduce(
      (total, allocation) => total + BigInt(allocation[field]),
      BigInt(0),
    );
  };
  if (
    sum("baseDuePence") !== BigInt(subtotalPence) ||
    sum("tipPence") !== BigInt(tipPence) ||
    sum("totalDuePence") !== BigInt(totalDuePence) ||
    sum("fundedPence") !== BigInt(fundedPence)
  ) {
    throw new RangeError("Settlement allocation totals do not match the public bill totals.");
  }

  const merchant =
    input.merchant === undefined
      ? null
      : checkedPublicText(input.merchant, "Settlement merchant", 100);
  const record = {
    schema: "taptab-venue-settlement",
    version: 1,
    chainId: input.chainId,
    contractAddress,
    billId: billId.toString(),
    currency: "GBP",
    merchant,
    totals: { subtotalPence, tipPence, totalDuePence, fundedPence },
    allocations,
    transactionHashes,
  };
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function createVenueSettlementDownload(
  input: VenueSettlementRecordInput,
  options: VenueSettlementSerialiseOptions = {},
): VenueSettlementDownload {
  const billId = checkedBillId(input.billId);
  return Object.freeze({
    fileName: `taptab-bill-${billId.toString()}-settlement.json`,
    mimeType: "application/json;charset=utf-8",
    text: serialiseVenueSettlementRecord(input, options),
  });
}

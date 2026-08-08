import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Abi,
  type Address,
} from "viem";
import { monadTestnet } from "viem/chains";

export const MONAD_TESTNET = monadTestnet;

export const publicClient = createPublicClient({
  chain: MONAD_TESTNET,
  transport: http(),
});

export function resolveCrowdCartAddress(
  candidate: string | undefined,
  trustedAddress?: Address,
): Address | undefined {
  const normalisedCandidate = candidate?.toLowerCase();
  if (!normalisedCandidate || !isAddress(normalisedCandidate, { strict: false })) {
    return undefined;
  }

  const resolvedAddress = getAddress(normalisedCandidate);
  if (trustedAddress === undefined) {
    return resolvedAddress;
  }

  const normalisedTrustedAddress = trustedAddress.toLowerCase();
  if (!isAddress(normalisedTrustedAddress, { strict: false })) {
    return undefined;
  }

  const resolvedTrustedAddress = getAddress(normalisedTrustedAddress);
  return resolvedAddress === resolvedTrustedAddress
    ? resolvedTrustedAddress
    : undefined;
}

export const crowdCartAbi = [
  { type: "error", name: "DealAlreadyJoined", inputs: [] },
  { type: "error", name: "DealNotActive", inputs: [] },
  { type: "error", name: "DealNotFound", inputs: [] },
  { type: "error", name: "DealNotSettled", inputs: [] },
  { type: "error", name: "DealSoldOut", inputs: [] },
  { type: "error", name: "DealStillOpen", inputs: [] },
  {
    type: "error",
    name: "IncorrectDeposit",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "received", type: "uint256" },
    ],
  },
  { type: "error", name: "InvalidBuyerLimits", inputs: [] },
  { type: "error", name: "InvalidDeadline", inputs: [] },
  { type: "error", name: "InvalidTierCount", inputs: [] },
  { type: "error", name: "InvalidTierPrices", inputs: [] },
  { type: "error", name: "InvalidTierThresholds", inputs: [] },
  { type: "error", name: "MerchantCannotJoin", inputs: [] },
  { type: "error", name: "NoProceedsAvailable", inputs: [] },
  { type: "error", name: "NoRefundAvailable", inputs: [] },
  { type: "error", name: "NotMerchant", inputs: [] },
  { type: "error", name: "NotParticipant", inputs: [] },
  { type: "error", name: "Reentrancy", inputs: [] },
  { type: "error", name: "RefundAlreadyClaimed", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  {
    type: "event",
    name: "DealCancelled",
    anonymous: false,
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "merchant", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "DealCreated",
    anonymous: false,
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "merchant", type: "address", indexed: true },
      { name: "endsAt", type: "uint64", indexed: false },
      { name: "minBuyers", type: "uint32", indexed: false },
      { name: "maxBuyers", type: "uint32", indexed: false },
      { name: "maxPrice", type: "uint96", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DealFinalised",
    anonymous: false,
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "successful", type: "bool", indexed: false },
      { name: "buyerCount", type: "uint32", indexed: false },
      { name: "clearingPrice", type: "uint96", indexed: false },
      { name: "merchantProceeds", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DealJoined",
    anonymous: false,
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "buyerCount", type: "uint32", indexed: false },
      { name: "currentPrice", type: "uint96", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ProceedsWithdrawn",
    anonymous: false,
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "merchant", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RefundClaimed",
    anonymous: false,
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "MAX_TIERS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelDeal",
    stateMutability: "nonpayable",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimRefund",
    stateMutability: "nonpayable",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimableRefund",
    stateMutability: "view",
    inputs: [
      { name: "dealId", type: "uint256" },
      { name: "buyer", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "createDeal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "metadataURI", type: "string" },
      { name: "endsAt", type: "uint64" },
      { name: "minBuyers", type: "uint32" },
      { name: "maxBuyers", type: "uint32" },
      { name: "thresholds", type: "uint32[]" },
      { name: "prices", type: "uint96[]" },
    ],
    outputs: [{ name: "dealId", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentPrice",
    stateMutability: "view",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [{ name: "", type: "uint96" }],
  },
  {
    type: "function",
    name: "dealCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "finaliseDeal",
    stateMutability: "nonpayable",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getBuyer",
    stateMutability: "view",
    inputs: [
      { name: "dealId", type: "uint256" },
      { name: "buyer", type: "address" },
    ],
    outputs: [
      { name: "joined", type: "bool" },
      { name: "refundClaimed", type: "bool" },
      { name: "refundAvailable", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getDeal",
    stateMutability: "view",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      {
        name: "view_",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "merchant", type: "address" },
          { name: "metadataURI", type: "string" },
          { name: "createdAt", type: "uint64" },
          { name: "endsAt", type: "uint64" },
          { name: "minBuyers", type: "uint32" },
          { name: "maxBuyers", type: "uint32" },
          { name: "buyerCount", type: "uint32" },
          { name: "maxPrice", type: "uint96" },
          { name: "currentPrice", type: "uint96" },
          { name: "clearingPrice", type: "uint96" },
          { name: "state", type: "uint8" },
          { name: "canFinalise", type: "bool" },
          { name: "proceedsWithdrawn", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getTiers",
    stateMutability: "view",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      { name: "thresholds", type: "uint32[]" },
      { name: "prices", type: "uint96[]" },
    ],
  },
  {
    type: "function",
    name: "joinDeal",
    stateMutability: "payable",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "merchantProceedsAvailable",
    stateMutability: "view",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "previewFinalisation",
    stateMutability: "view",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      { name: "canFinaliseNow", type: "bool" },
      { name: "wouldSucceed", type: "bool" },
      { name: "projectedClearingPrice", type: "uint96" },
      { name: "projectedMerchantProceeds", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "withdrawProceeds",
    stateMutability: "nonpayable",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
  },
] as const satisfies Abi;

export type DealPhase =
  | "preview"
  | "open"
  | "awaiting_finalisation"
  | "successful"
  | "cancelled"
  | "failed"
  | "unavailable";

export type DealSnapshot = Readonly<{
  id: bigint;
  merchant: Address;
  metadataURI: string;
  createdAt: bigint;
  endsAt: bigint;
  minBuyers: number;
  maxBuyers: number;
  buyerCount: number;
  maxPrice: bigint;
  currentPrice: bigint;
  clearingPrice: bigint;
  state: number;
  canFinalise: boolean;
  proceedsWithdrawn: boolean;
}>;

export type BuyerSnapshot = Readonly<{
  joined: boolean;
  refundClaimed: boolean;
  refundAvailable: bigint;
}>;

export type DisplayTier = Readonly<{
  buyers: number;
  price: bigint;
  label: string;
}>;

export type ProductMetadata = Readonly<{
  name?: string;
  description?: string;
  pickup?: string;
  image?: string;
}>;

const MAX_METADATA_URI_LENGTH = 128_000;

export function deriveDealPhase(
  state: number | bigint | null | undefined,
  canFinalise: boolean,
): DealPhase {
  if (state === null) return "preview";
  if (state === undefined) return "unavailable";

  switch (Number(state)) {
    case 1:
      return canFinalise ? "awaiting_finalisation" : "open";
    case 2:
      return "successful";
    case 3:
      return "cancelled";
    case 4:
      return "failed";
    default:
      return "unavailable";
  }
}

function readMetadataString(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximumLength) return undefined;
  return trimmed;
}

function decodeMetadataPayload(header: string, payload: string) {
  const headerParts = header.toLowerCase().split(";");
  const mediaType = headerParts.shift();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    return undefined;
  }

  if (headerParts.includes("base64")) {
    if (typeof globalThis.atob !== "function") return undefined;
    const binary = globalThis.atob(payload);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  return decodeURIComponent(payload);
}

export function parseProductMetadata(
  metadataURI: string,
): ProductMetadata | undefined {
  if (
    typeof metadataURI !== "string" ||
    metadataURI.length === 0 ||
    metadataURI.length > MAX_METADATA_URI_LENGTH ||
    !metadataURI.startsWith("data:")
  ) {
    return undefined;
  }

  const commaIndex = metadataURI.indexOf(",", 5);
  if (commaIndex === -1) return undefined;

  try {
    const decoded = decodeMetadataPayload(
      metadataURI.slice(5, commaIndex),
      metadataURI.slice(commaIndex + 1),
    );
    if (decoded === undefined) return undefined;

    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Record<string, unknown>;
    const name = readMetadataString(record.name, 160);
    const description = readMetadataString(record.description, 1_000);
    const pickup = readMetadataString(record.pickup, 240);
    const image = readMetadataString(record.image, 4_096);
    const metadata: ProductMetadata = {
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(pickup === undefined ? {} : { pickup }),
      ...(image === undefined ? {} : { image }),
    };

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  } catch {
    return undefined;
  }
}

export function toDisplayTiers(
  thresholds: readonly number[],
  prices: readonly bigint[],
): DisplayTier[] {
  if (thresholds.length === 0 || thresholds.length !== prices.length) {
    throw new RangeError("Tier thresholds and prices must have matching values.");
  }

  return thresholds.map((buyers, index) => {
    const price = prices[index];
    if (!Number.isSafeInteger(buyers) || buyers <= 0 || price <= BigInt(0)) {
      throw new RangeError("Tier thresholds and prices must be positive.");
    }

    return {
      buyers,
      price,
      label:
        index === 0
          ? "Opening price"
          : index === thresholds.length - 1
            ? "Best price"
            : `Price drop ${index}`,
    };
  });
}

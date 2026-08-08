import {
  createPublicClient,
  defineChain,
  fallback,
  getAddress,
  http,
  isAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";

export const MAX_TAPTAB_TIP_BPS = 3_000;
export const MAX_TAPTAB_PARTICIPANTS = 32;
export const MAX_TAPTAB_ITEMS = 32;
export const MAX_TAPTAB_SHARES_PER_ITEM = 32;
export const MAX_TAPTAB_TOTAL_SHARES = 128;
export const TAPTAB_SPLIT_APPROVAL_DOMAIN = "TapTab split approval v1";
export const TAPTAB_HTTP_BATCH_MAX_REQUESTS = 64;
export const TAPTAB_HTTP_BATCH_WAIT_MS = 10;
export const TAPTAB_MULTICALL_BATCH_SIZE_BYTES = 65_536;
const TAPTAB_PUBLIC_RPC_TIMEOUT_MS = 10_000;
const TAPTAB_PUBLIC_RPC_RETRY_COUNT = 2;

export const TAPTAB_MONAD_TESTNET = defineChain({
  id: 10_143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 251_449,
    },
  },
  testnet: true,
});

export const multicall3TimestampAbi = [
  {
    type: "function",
    name: "getCurrentBlockTimestamp",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "timestamp", type: "uint256" }],
  },
] as const satisfies Abi;

export const tapTabAbi = [
  {
    type: "event",
    name: "BillCreated",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "deadline", type: "uint64", indexed: false },
      { name: "subtotal", type: "uint256", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ParticipantJoined",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "fairRemainder", type: "bool", indexed: false },
      { name: "tipVoteBps", type: "uint16", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ParticipantInvited",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SplitVersionAdvanced",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "splitVersion", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SplitApproved",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "splitVersion", type: "uint64", indexed: false },
      { name: "splitDigest", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SplitApprovalRevoked",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "splitVersion", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ItemShareTransferred",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "itemIndex", type: "uint256", indexed: true },
      { name: "shareIndex", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: false },
      { name: "to", type: "address", indexed: false },
      { name: "shareValue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ParticipantLeft",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "transferRecipient", type: "address", indexed: true },
      { name: "transferredShareCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PreferencesUpdated",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "fairRemainder", type: "bool", indexed: false },
      { name: "tipVoteBps", type: "uint16", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ItemShareClaimed",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "itemIndex", type: "uint256", indexed: true },
      { name: "shareIndex", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: false },
      { name: "shareValue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ItemShareUnclaimed",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "itemIndex", type: "uint256", indexed: true },
      { name: "shareIndex", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: false },
      { name: "shareValue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ParticipantDueLocked",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "participant", type: "address", indexed: true },
      { name: "amountDue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FundingOpened",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "lockedTipBps", type: "uint16", indexed: false },
      { name: "subtotal", type: "uint256", indexed: false },
      { name: "tipAmount", type: "uint256", indexed: false },
      { name: "totalDue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ContributionReceived",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "beneficiary", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "beneficiaryFunded", type: "uint256", indexed: false },
      { name: "totalFunded", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BillSettled",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "totalFunded", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BillCancelled",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "BillExpired",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "caller", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "RefundClaimed",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "contributor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ProceedsWithdrawn",
    anonymous: false,
    inputs: [
      { name: "billId", type: "uint256", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "billCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "createBill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "payee", type: "address" },
      { name: "metadataURI", type: "string" },
      { name: "deadline", type: "uint64" },
      { name: "itemAmounts", type: "uint256[]" },
      { name: "shareCounts", type: "uint32[]" },
    ],
    outputs: [{ name: "billId", type: "uint256" }],
  },
  {
    type: "function",
    name: "inviteParticipant",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "participant", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "inviteMany",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "participants", type: "address[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "joinBill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "fairRemainder", type: "bool" },
      { name: "tipVoteBps", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "updatePreferences",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "fairRemainder", type: "bool" },
      { name: "tipVoteBps", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimItemShare",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "itemIndex", type: "uint256" },
      { name: "shareIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimMany",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "itemIndexes", type: "uint256[]" },
      { name: "shareIndexes", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unclaimItemShare",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "itemIndex", type: "uint256" },
      { name: "shareIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approveSplit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "expectedDigest", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeSplitApproval",
    stateMutability: "nonpayable",
    inputs: [{ name: "billId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "leaveBill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "transferRecipient", type: "address" },
    ],
    outputs: [],
  },
  ...["openFunding", "settleBill", "cancelBill", "expireBill", "claimRefund", "withdrawProceeds"].map(
    (name) => ({
      type: "function" as const,
      name,
      stateMutability: "nonpayable" as const,
      inputs: [{ name: "billId", type: "uint256" }],
      outputs: [],
    }),
  ),
  {
    type: "function",
    name: "fundParticipant",
    stateMutability: "payable",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getBill",
    stateMutability: "view",
    inputs: [{ name: "billId", type: "uint256" }],
    outputs: [
      {
        name: "view_",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "creator", type: "address" },
          { name: "payee", type: "address" },
          { name: "metadataURI", type: "string" },
          { name: "createdAt", type: "uint64" },
          { name: "deadline", type: "uint64" },
          { name: "participantCount", type: "uint32" },
          { name: "lockedTipBps", type: "uint16" },
          { name: "state", type: "uint8" },
          { name: "proceedsWithdrawn", type: "bool" },
          { name: "subtotal", type: "uint256" },
          { name: "totalDue", type: "uint256" },
          { name: "totalFunded", type: "uint256" },
          { name: "remainingToFund", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getItems",
    stateMutability: "view",
    inputs: [{ name: "billId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "amount", type: "uint256" },
          { name: "shareCount", type: "uint32" },
          { name: "claimedShareCount", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getParticipants",
    stateMutability: "view",
    inputs: [{ name: "billId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getParticipant",
    stateMutability: "view",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "joined", type: "bool" },
          { name: "fairRemainder", type: "bool" },
          { name: "tipVoteBps", type: "uint16" },
          { name: "baseDue", type: "uint256" },
          { name: "tipDue", type: "uint256" },
          { name: "amountDue", type: "uint256" },
          { name: "amountFunded", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isInvited",
    stateMutability: "view",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "currentSplitDigest",
    stateMutability: "view",
    inputs: [{ name: "billId", type: "uint256" }],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getSplitStatus",
    stateMutability: "view",
    inputs: [{ name: "billId", type: "uint256" }],
    outputs: [
      {
        name: "status",
        type: "tuple",
        components: [
          { name: "receiptDigest", type: "bytes32" },
          { name: "currentDigest", type: "bytes32" },
          { name: "splitVersion", type: "uint64" },
          { name: "approvalCount", type: "uint32" },
          { name: "requiredApprovals", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "hasApprovedCurrentSplit",
    stateMutability: "view",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getItemShareOwners",
    stateMutability: "view",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "itemIndex", type: "uint256" },
    ],
    outputs: [{ name: "owners", type: "address[]" }],
  },
  {
    type: "function",
    name: "itemShareValue",
    stateMutability: "view",
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "itemIndex", type: "uint256" },
      { name: "shareIndex", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  ...["remainingDue", "contributionOf", "claimableRefund"].map((name) => ({
    type: "function" as const,
    name,
    stateMutability: "view" as const,
    inputs: [
      { name: "billId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  })),
  {
    type: "function",
    name: "proceedsAvailable",
    stateMutability: "view",
    inputs: [{ name: "billId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

export type TapTabPhase =
  | "draft"
  | "funding"
  | "settled"
  | "cancelled"
  | "expired"
  | "unavailable";

export type TapTabSplitStatus = Readonly<{
  receiptDigest: Hex;
  currentDigest: Hex;
  splitVersion: bigint;
  approvalCount: number;
  requiredApprovals: number;
}>;

export type TapTabParticipantSnapshot = Readonly<{
  joined: boolean;
  fairRemainder: boolean;
  tipVoteBps: number;
  baseDue: bigint;
  tipDue: bigint;
  amountDue: bigint;
  amountFunded: bigint;
}>;

export type TapTabDeployment = Readonly<{
  status: "configured";
  address: Address;
  billId: bigint;
}>;

export type TapTabDeploymentResolution =
  | TapTabDeployment
  | Readonly<{ status: "unconfigured"; reason: string }>
  | Readonly<{ status: "invalid"; reason: string }>;

type PublicEnv = Readonly<{
  NEXT_PUBLIC_TAPTAB_ADDRESS?: string;
  NEXT_PUBLIC_TAPTAB_BILL_ID?: string;
}>;

export type TapTabContext = Readonly<{ address: Address; billId: bigint }>;

const ZERO = BigInt(0);
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function resolveTapTabDeployment(env: PublicEnv): TapTabDeploymentResolution {
  const rawAddress = env.NEXT_PUBLIC_TAPTAB_ADDRESS?.trim() ?? "";
  const rawBillId = env.NEXT_PUBLIC_TAPTAB_BILL_ID?.trim() ?? "";

  if (!rawAddress && !rawBillId) {
    return {
      status: "unconfigured",
      reason: "NEXT_PUBLIC_TAPTAB_ADDRESS and NEXT_PUBLIC_TAPTAB_BILL_ID are not set.",
    };
  }
  if (!rawAddress || !rawBillId) {
    return {
      status: "invalid",
      reason: "TapTab address and bill ID must be configured together.",
    };
  }
  if (!isAddress(rawAddress) || rawAddress.toLowerCase() === ZERO_ADDRESS) {
    return { status: "invalid", reason: "NEXT_PUBLIC_TAPTAB_ADDRESS is not an EVM address." };
  }
  if (!/^[1-9][0-9]*$/.test(rawBillId)) {
    return { status: "invalid", reason: "NEXT_PUBLIC_TAPTAB_BILL_ID must be a positive decimal integer." };
  }

  const billId = BigInt(rawBillId);
  if (billId > UINT256_MAX) {
    return { status: "invalid", reason: "NEXT_PUBLIC_TAPTAB_BILL_ID exceeds uint256." };
  }
  return { status: "configured", address: getAddress(rawAddress), billId };
}

export const tapTabDeployment = resolveTapTabDeployment({
  NEXT_PUBLIC_TAPTAB_ADDRESS: process.env.NEXT_PUBLIC_TAPTAB_ADDRESS,
  NEXT_PUBLIC_TAPTAB_BILL_ID: process.env.NEXT_PUBLIC_TAPTAB_BILL_ID,
});

export function requireTapTabContext(
  resolution: TapTabDeploymentResolution = tapTabDeployment,
): TapTabContext {
  if (resolution.status !== "configured") {
    throw new Error(`TapTab deployment is ${resolution.status}: ${resolution.reason}`);
  }
  return { address: resolution.address, billId: resolution.billId };
}

export function resolveTapTabPublicFallbackRpcUrl(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) return undefined;

  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function createTapTabHttpTransport(rpcUrl?: string) {
  return http(rpcUrl, {
    batch: {
      batchSize: TAPTAB_HTTP_BATCH_MAX_REQUESTS,
      wait: TAPTAB_HTTP_BATCH_WAIT_MS,
    },
    timeout: TAPTAB_PUBLIC_RPC_TIMEOUT_MS,
    retryCount: TAPTAB_PUBLIC_RPC_RETRY_COUNT,
  });
}

export function createTapTabPublicClient(
  rpcUrl?: string,
  fallbackRpcUrl = process.env.NEXT_PUBLIC_MONAD_TESTNET_FALLBACK_RPC_URL,
) {
  const primaryTransport = createTapTabHttpTransport(rpcUrl);
  const resolvedFallbackRpcUrl = resolveTapTabPublicFallbackRpcUrl(fallbackRpcUrl);
  const resolvedPrimaryRpcUrl = resolveTapTabPublicFallbackRpcUrl(
    rpcUrl ?? TAPTAB_MONAD_TESTNET.rpcUrls.default.http[0],
  );
  const readTransport =
    resolvedFallbackRpcUrl && resolvedFallbackRpcUrl !== resolvedPrimaryRpcUrl
      ? fallback(
          [primaryTransport, createTapTabHttpTransport(resolvedFallbackRpcUrl)],
          {
            rank: false,
            // Each bounded HTTP transport owns its retries. Do not repeat the
            // complete primary/fallback sequence after both endpoints fail.
            retryCount: 0,
          },
        )
      : primaryTransport;

  return createPublicClient({
    chain: TAPTAB_MONAD_TESTNET,
    // Only HTTPS fallbacks without URL credentials or fragments are admitted.
    // Ranking stays disabled so reads always try the canonical/explicit primary
    // first. Wallet writes use a separate EIP-1193 transport and are never
    // submitted or retried here.
    transport: readTransport,
  });
}

export function deriveTapTabPhase(state: number | bigint | null | undefined): TapTabPhase {
  switch (state === null || state === undefined ? -1 : Number(state)) {
    case 1:
      return "draft";
    case 2:
      return "funding";
    case 3:
      return "settled";
    case 4:
      return "cancelled";
    case 5:
      return "expired";
    default:
      return "unavailable";
  }
}

export function assertTipVoteBps(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TAPTAB_TIP_BPS) {
    throw new RangeError("Tip vote must be an integer from 0 to 3000 basis points.");
  }
  return value;
}

function checkedAddress(value: Address): Address {
  if (!isAddress(value)) throw new TypeError("Expected a valid EVM address.");
  return getAddress(value);
}

function checkedNonZeroAddress(value: Address, name: string): Address {
  const address = checkedAddress(value);
  if (address.toLowerCase() === ZERO_ADDRESS) throw new TypeError(`${name} cannot be zero.`);
  return address;
}

function checkedSplitDigest(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("Split digest must be exactly 32 bytes.");
  }
  return value;
}

function checkedUint(value: bigint, name: string): bigint {
  if (value < ZERO || value > UINT256_MAX) throw new RangeError(`${name} must fit uint256.`);
  return value;
}

function billRead(context: TapTabContext, functionName: string, args: readonly unknown[] = []) {
  return {
    address: checkedAddress(context.address),
    abi: tapTabAbi,
    functionName,
    args: [checkedUint(context.billId, "billId"), ...args],
  } as const;
}

function billWrite(context: TapTabContext, functionName: string, args: readonly unknown[] = []) {
  return billRead(context, functionName, args);
}

export const buildBillRead = (context: TapTabContext) => billRead(context, "getBill");
export const buildItemsRead = (context: TapTabContext) => billRead(context, "getItems");
export const buildParticipantsRead = (context: TapTabContext) =>
  billRead(context, "getParticipants");
export const buildProceedsRead = (context: TapTabContext) =>
  billRead(context, "proceedsAvailable");
export const buildSplitDigestRead = (context: TapTabContext) =>
  billRead(context, "currentSplitDigest");
export const buildSplitStatusRead = (context: TapTabContext) =>
  billRead(context, "getSplitStatus");

export function buildCurrentBlockTimestampRead() {
  return {
    address: TAPTAB_MONAD_TESTNET.contracts.multicall3.address,
    abi: multicall3TimestampAbi,
    functionName: "getCurrentBlockTimestamp",
    args: [],
  } as const;
}

export function buildParticipantRead(context: TapTabContext, account: Address) {
  return billRead(context, "getParticipant", [checkedAddress(account)]);
}

export function buildInvitationRead(context: TapTabContext, account: Address) {
  return billRead(context, "isInvited", [checkedAddress(account)]);
}

export function buildSplitApprovalRead(context: TapTabContext, account: Address) {
  return billRead(context, "hasApprovedCurrentSplit", [checkedAddress(account)]);
}

export function buildShareOwnersRead(context: TapTabContext, itemIndex: bigint) {
  return billRead(context, "getItemShareOwners", [checkedUint(itemIndex, "itemIndex")]);
}

export function buildShareValueRead(
  context: TapTabContext,
  itemIndex: bigint,
  shareIndex: bigint,
) {
  return billRead(context, "itemShareValue", [
    checkedUint(itemIndex, "itemIndex"),
    checkedUint(shareIndex, "shareIndex"),
  ]);
}

export function buildAccountReads(context: TapTabContext, account: Address) {
  const address = checkedAddress(account);
  return {
    participant: billRead(context, "getParticipant", [address]),
    remainingDue: billRead(context, "remainingDue", [address]),
    contribution: billRead(context, "contributionOf", [address]),
    claimableRefund: billRead(context, "claimableRefund", [address]),
  } as const;
}

export function buildCreateBillWrite(
  contractAddress: Address,
  input: Readonly<{
    payee: Address;
    metadataURI: string;
    deadline: bigint;
    itemAmounts: readonly bigint[];
    shareCounts: readonly number[];
    currentTimestamp?: bigint;
  }>,
) {
  const checkedContractAddress = checkedAddress(contractAddress);
  const checkedPayee = checkedNonZeroAddress(input.payee, "payee");
  if (checkedPayee.toLowerCase() === checkedContractAddress.toLowerCase()) {
    throw new TypeError("payee cannot be the TapTab contract itself.");
  }
  if (!input.itemAmounts.length || input.itemAmounts.length !== input.shareCounts.length) {
    throw new RangeError("Item amounts and share counts must be non-empty and have equal length.");
  }
  if (input.itemAmounts.length > MAX_TAPTAB_ITEMS) {
    throw new RangeError(`A bill can contain at most ${MAX_TAPTAB_ITEMS} items.`);
  }
  if (input.deadline <= ZERO || input.deadline > (BigInt(1) << BigInt(64)) - BigInt(1)) {
    throw new RangeError("deadline must fit non-zero uint64.");
  }
  if (input.currentTimestamp !== undefined) {
    if (input.currentTimestamp < ZERO || input.currentTimestamp > (BigInt(1) << BigInt(64)) - BigInt(1)) {
      throw new RangeError("currentTimestamp must fit uint64.");
    }
    if (input.deadline <= input.currentTimestamp) {
      throw new RangeError("deadline must be later than currentTimestamp.");
    }
  }

  let subtotal = ZERO;
  let totalShares = 0;
  input.itemAmounts.forEach((amount, index) => {
    checkedUint(amount, "item amount");
    if (amount === ZERO) throw new RangeError("item amounts must be non-zero.");
    const count = input.shareCounts[index];
    if (!Number.isInteger(count) || count <= 0 || count > MAX_TAPTAB_SHARES_PER_ITEM) {
      throw new RangeError(
        `share count must be from 1 to ${MAX_TAPTAB_SHARES_PER_ITEM}.`,
      );
    }
    if (BigInt(count) > amount) {
      throw new RangeError("share count cannot exceed the item's exact amount.");
    }
    subtotal += amount;
    if (subtotal > UINT256_MAX) throw new RangeError("item subtotal exceeds uint256.");
    totalShares += count;
  });
  if (totalShares > MAX_TAPTAB_TOTAL_SHARES) {
    throw new RangeError(`A bill can contain at most ${MAX_TAPTAB_TOTAL_SHARES} share slots.`);
  }
  return {
    address: checkedContractAddress,
    abi: tapTabAbi,
    functionName: "createBill",
    args: [
      checkedPayee,
      input.metadataURI,
      input.deadline,
      [...input.itemAmounts],
      [...input.shareCounts],
    ],
  } as const;
}

export function buildInviteWrite(context: TapTabContext, participant: Address) {
  return billWrite(context, "inviteParticipant", [
    checkedNonZeroAddress(participant, "participant"),
  ]);
}

export function buildInviteManyWrite(
  context: TapTabContext,
  participants: readonly Address[],
) {
  if (!participants.length || participants.length > MAX_TAPTAB_PARTICIPANTS) {
    throw new RangeError(
      `Invitation batch must contain from 1 to ${MAX_TAPTAB_PARTICIPANTS} participants.`,
    );
  }
  const checkedParticipants = participants.map((participant) =>
    checkedNonZeroAddress(participant, "participant"),
  );
  const uniqueParticipants = new Set(
    checkedParticipants.map((participant) => participant.toLowerCase()),
  );
  if (uniqueParticipants.size !== checkedParticipants.length) {
    throw new RangeError("Invitation batch cannot contain duplicate participants.");
  }
  return billWrite(context, "inviteMany", [checkedParticipants]);
}

export function buildJoinWrite(context: TapTabContext, fairRemainder: boolean, tipVoteBps: number) {
  return billWrite(context, "joinBill", [fairRemainder, assertTipVoteBps(tipVoteBps)]);
}

export function buildPreferencesWrite(
  context: TapTabContext,
  fairRemainder: boolean,
  tipVoteBps: number,
) {
  return billWrite(context, "updatePreferences", [
    fairRemainder,
    assertTipVoteBps(tipVoteBps),
  ]);
}

function shareWrite(
  context: TapTabContext,
  functionName: "claimItemShare" | "unclaimItemShare",
  itemIndex: bigint,
  shareIndex: bigint,
) {
  return billWrite(context, functionName, [
    checkedUint(itemIndex, "itemIndex"),
    checkedUint(shareIndex, "shareIndex"),
  ]);
}

export const buildClaimWrite = (
  context: TapTabContext,
  itemIndex: bigint,
  shareIndex: bigint,
) => shareWrite(context, "claimItemShare", itemIndex, shareIndex);

export function buildClaimManyWrite(
  context: TapTabContext,
  itemIndexes: readonly bigint[],
  shareIndexes: readonly bigint[],
) {
  if (
    !itemIndexes.length ||
    itemIndexes.length !== shareIndexes.length ||
    itemIndexes.length > MAX_TAPTAB_TOTAL_SHARES
  ) {
    throw new RangeError(
      `Claim batch must contain matching item and share indexes, from 1 to ${MAX_TAPTAB_TOTAL_SHARES} entries.`,
    );
  }

  const checkedItemIndexes = itemIndexes.map((itemIndex) =>
    checkedUint(itemIndex, "itemIndex"),
  );
  const checkedShareIndexes = shareIndexes.map((shareIndex) =>
    checkedUint(shareIndex, "shareIndex"),
  );
  const uniqueClaims = new Set(
    checkedItemIndexes.map(
      (itemIndex, index) => `${itemIndex.toString()}:${checkedShareIndexes[index].toString()}`,
    ),
  );
  if (uniqueClaims.size !== checkedItemIndexes.length) {
    throw new RangeError("Claim batch cannot contain the same share slot more than once.");
  }

  return billWrite(context, "claimMany", [checkedItemIndexes, checkedShareIndexes]);
}

export const buildUnclaimWrite = (
  context: TapTabContext,
  itemIndex: bigint,
  shareIndex: bigint,
) => shareWrite(context, "unclaimItemShare", itemIndex, shareIndex);

export function buildApproveSplitWrite(context: TapTabContext, splitDigest: Hex) {
  return billWrite(context, "approveSplit", [checkedSplitDigest(splitDigest)]);
}

export const buildRevokeSplitApprovalWrite = (context: TapTabContext) =>
  billWrite(context, "revokeSplitApproval");

export function buildLeaveWrite(
  context: TapTabContext,
  transferRecipient: Address = ZERO_ADDRESS,
) {
  return billWrite(context, "leaveBill", [checkedAddress(transferRecipient)]);
}

export const buildOpenFundingWrite = (context: TapTabContext) =>
  billWrite(context, "openFunding");
export const buildSettleWrite = (context: TapTabContext) => billWrite(context, "settleBill");
export const buildCancelWrite = (context: TapTabContext) => billWrite(context, "cancelBill");
export const buildExpireWrite = (context: TapTabContext) => billWrite(context, "expireBill");
export const buildRefundWrite = (context: TapTabContext) => billWrite(context, "claimRefund");
export const buildWithdrawWrite = (context: TapTabContext) =>
  billWrite(context, "withdrawProceeds");

export function buildFundWrite(context: TapTabContext, beneficiary: Address, value: bigint) {
  if (value <= ZERO) throw new RangeError("Funding value must be positive.");
  checkedUint(value, "value");
  return {
    ...billWrite(context, "fundParticipant", [checkedNonZeroAddress(beneficiary, "beneficiary")]),
    value,
  } as const;
}

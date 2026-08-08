"use client";

import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  TransactionNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  createWalletClient,
  custom,
  decodeEventLog,
  getAddress,
  isAddress,
  type Address,
  type Hash,
} from "viem";
import {
  MAX_TAPTAB_PARTICIPANTS,
  MAX_TAPTAB_TOTAL_SHARES,
  TAPTAB_MONAD_TESTNET,
  TAPTAB_MULTICALL_BATCH_SIZE_BYTES,
  buildAccountReads,
  buildBillRead,
  buildCurrentBlockTimestampRead,
  buildCancelWrite,
  buildClaimManyWrite,
  buildExpireWrite,
  buildFundWrite,
  buildInvitationRead,
  buildInviteManyWrite,
  buildItemsRead,
  buildJoinWrite,
  buildOpenFundingWrite,
  buildParticipantRead,
  buildParticipantsRead,
  buildPreferencesWrite,
  buildProceedsRead,
  buildApproveSplitWrite,
  buildLeaveWrite,
  buildRevokeSplitApprovalWrite,
  buildRefundWrite,
  buildSettleWrite,
  buildShareOwnersRead,
  buildSplitApprovalRead,
  buildSplitDigestRead,
  buildSplitStatusRead,
  buildUnclaimWrite,
  buildWithdrawWrite,
  createTapTabPublicClient,
  deriveTapTabPhase,
  tapTabAbi,
  tapTabDeployment,
  type TapTabContext,
  type TapTabParticipantSnapshot,
  type TapTabPhase,
  type TapTabSplitStatus,
} from "./taptab-chain";
import {
  PRIVATE_NAME_STORAGE_KEY,
  buildParticipantPaymentUrl,
  buildWhatsAppPaymentShareUrl,
  createVenueSettlementDownload,
  findPrivateDisplayName,
  parsePrivateNameMappings,
  resolveParticipantPaymentUrl,
  serialisePrivateNameMappings,
  upsertPrivateNameMapping,
  type PrivateNameMapping,
  type TrustedParticipantLinkContext,
  type VenueSettlementRecordInput,
} from "./taptab-identity";
import {
  allocateTapTabParticipantPence,
  allocateTapTabPence,
  allocateTapTabSponsorshipPence,
  buildTapTabShareUrl,
  formatMonAmount,
  formatTapTabAmount,
  formatTipBps,
  parseTapTabGbpMetadata,
  parseTipPercentToBps,
  presentTapTabChainEvent,
  quoteTapTabPence,
  resolveTrustedTapTabQuery,
  shortTapTabAddress,
  tapTabPhaseLabel,
  type TapTabGbpMetadata,
  type TapTabGbpMetadataOnchainEvidence,
  type TapTabGbpQuote,
} from "./taptab-live-helpers";
import {
  calculateTapTabPreflightCosts,
  describeTapTabPreflightError,
  describeTapTabSubmittedError,
  describeTapTabWalletError,
  type TapTabPreflightCosts,
} from "./taptab-transaction-preflight";
import {
  PENDING_TAPTAB_TRANSACTION_STORAGE_KEY,
  parsePendingTapTabTransactions,
  pendingTapTabTransactionScopeKey,
  pendingTapTabTransactionsForScope,
  removePendingTapTabTransaction,
  replacePendingTapTabTransactionHash,
  serialisePendingTapTabTransactions,
  upsertPendingTapTabTransaction,
  type PendingTapTabTransaction,
  type PendingTapTabTransactionScope,
} from "./taptab-pending-transactions";
import { useTapTabWallet } from "./wallet";
import {
  TAPTAB_MONAD_TESTNET_FAUCET_URL,
  describeTapTabNetworkSwitchError,
  readTapTabWalletChainId,
  switchTapTabWalletToMonadTestnet,
} from "./wallet/taptab-wallet-network";
import { TapTabSettlementReceipt } from "./TapTabSettlementReceipt";
import type { TapTabSettlementReceiptInput } from "./taptab-settlement-receipt";

const EXPLORER_URL = TAPTAB_MONAD_TESTNET.blockExplorers.default.url;
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const POLL_INTERVAL_MS = 4_000;
const PENDING_POLL_INTERVAL_MS = 1_000;
const EVENT_WATCH_INTERVAL_MS = 800;
const EVENT_LOOKBACK_BLOCKS = 10_000n;
const MAX_METADATA_BYTES = 64_000;
const TRANSACTION_RECEIPT_TIMEOUT_MS = 45_000;

type RawBill = Readonly<{
  id: bigint;
  creator: Address;
  payee: Address;
  metadataURI: string;
  createdAt: bigint;
  deadline: bigint;
  participantCount: number;
  lockedTipBps: number;
  state: number;
  proceedsWithdrawn: boolean;
  subtotal: bigint;
  totalDue: bigint;
  totalFunded: bigint;
  remainingToFund: bigint;
}>;

type RawItem = Readonly<{
  amount: bigint;
  shareCount: number;
  claimedShareCount: number;
}>;

type RawParticipant = TapTabParticipantSnapshot;

export type TapTabLiveItem = RawItem &
  Readonly<{
    index: number;
    owners: readonly Address[];
  }>;

export type TapTabLiveParticipant = RawParticipant &
  Readonly<{
    address: Address;
    remainingDue: bigint;
    approvedCurrentSplit: boolean;
  }>;

export type TapTabLiveAccount = Readonly<{
  address: Address;
  invited: boolean;
  participant: RawParticipant;
  remainingDue: bigint;
  contribution: bigint;
  claimableRefund: bigint;
  approvedCurrentSplit: boolean;
}>;

type LivePrimaryTaskAction =
  | "refresh-bill"
  | "connect-wallet"
  | "retry-wallet-setup"
  | "refresh-connection"
  | "switch-network"
  | "refresh-wallet-status"
  | "record-expiry"
  | "copy-wallet"
  | "open-funding"
  | "settle-bill"
  | "claim-refund"
  | "withdraw-proceeds";

type LivePrimaryTask = Readonly<{
  title: string;
  detail: string;
  label: string;
  href?: `#${string}`;
  action?: LivePrimaryTaskAction;
  disabled?: boolean;
}>;

export type TapTabLiveSnapshot = Readonly<{
  context: TapTabContext;
  bill: RawBill;
  chainTimestamp: bigint;
  phase: TapTabPhase;
  items: readonly TapTabLiveItem[];
  participants: readonly TapTabLiveParticipant[];
  splitStatus: TapTabSplitStatus;
  account?: TapTabLiveAccount;
  proceedsAvailable: bigint;
  fetchedAt: number;
}>;

export type TapTabLiveEvent = Readonly<{
  id: string;
  source: "chain" | "transaction";
  title: string;
  detail: string;
  tone: "neutral" | "positive" | "warning";
  transactionHash?: Hash;
  blockNumber?: bigint;
  explorerUrl?: string;
  eventName?: string;
  payerAddress?: Address;
  beneficiaryAddress?: Address;
  amountWei?: bigint;
  confirmationMs?: number;
}>;

export type TapTabPrivateName = Readonly<{
  address: Address;
  name: string;
}>;

export type TapTabConfirmationMeasurement = Readonly<{
  action: string;
  transactionHash: Hash;
  blockNumber: bigint;
  submittedAt: number;
  confirmedAt: number;
  confirmationMs: number;
}>;

export type TapTabLiveGbpDisplay = Readonly<{
  subtotalPence: number;
  items: readonly Readonly<{
    index: number;
    amountPence: number;
  }>[];
  tipPence?: number;
  totalDuePence?: number;
  participants?: readonly Readonly<{
    address: Address;
    baseDuePence: number;
    tipPence: number;
    totalDuePence: number;
  }>[];
}>;

export type TapTabLiveUpdate = Readonly<{
  snapshot: TapTabLiveSnapshot | null;
  events: readonly TapTabLiveEvent[];
  metadata?: TapTabGbpMetadata;
  quote?: TapTabGbpQuote;
  gbpDisplay?: TapTabLiveGbpDisplay;
  shareUrl: string;
  privateNames?: readonly TapTabPrivateName[];
  latestConfirmation?: TapTabConfirmationMeasurement;
  walletSessionStatus?: WalletSessionState["status"];
  walletChainId?: number;
}>;

type TransactionStatus =
  | "preflight"
  | "awaiting-wallet"
  | "pending"
  | "unverified"
  | "confirmed"
  | "blocked"
  | "error";

type WalletSessionState = Readonly<{
  scope: string;
  status: "idle" | "checking" | "switching" | "ready" | "wrong-network" | "error";
  chainId?: number;
  balanceWei?: bigint;
  checkedAt?: number;
  message?: string;
}>;

type TransactionPreflight =
  | Readonly<{ status: "checking"; message: string }>
  | Readonly<{
      status: "ready";
      checkedAt: number;
      costs?: TapTabPreflightCosts;
    }>
  | Readonly<{ status: "blocked"; message: string }>;

type LiveTransaction = Readonly<{
  id: number;
  action: string;
  status: TransactionStatus;
  hash?: Hash;
  blockNumber?: bigint;
  explorerUrl?: string;
  submittedAt?: number;
  confirmedAt?: number;
  confirmationMs?: number;
  preflight?: TransactionPreflight;
  message?: string;
  restored?: boolean;
}>;

type ScopedValue<T> = Readonly<{
  scope: string;
  value: T;
}>;

type InviteBatchValidation = Readonly<{
  addresses: readonly Address[];
  tokenCount: number;
  error?: string;
}>;

export type TapTabLivePanelProps = Readonly<{
  active: boolean;
  className?: string;
  onLiveUpdate?: (update: TapTabLiveUpdate) => void;
  onPaymentLinkState?: (state: TapTabPaymentLinkState) => void;
}>;

export type TapTabPaymentLinkState =
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "trusted"; participantAddress: Address }>
  | Readonly<{ status: "rejected"; reason: string }>;

type PublicClient = ReturnType<typeof createTapTabPublicClient>;

let clientIssueSequence = 0;

function createClientIssueId(prefix: string): string {
  clientIssueSequence += 1;
  try {
    const token = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    return `${prefix}-${token}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${clientIssueSequence.toString(36)}`;
  }
}

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return safeName || "UnknownError";
}

function mutateStoredPendingTransactions(
  mutate: (
    transactions: readonly PendingTapTabTransaction[],
  ) => readonly PendingTapTabTransaction[],
): void {
  try {
    const current = parsePendingTapTabTransactions(
      window.localStorage.getItem(PENDING_TAPTAB_TRANSACTION_STORAGE_KEY),
    );
    const next = [...mutate(current)];
    if (next.length === 0) {
      window.localStorage.removeItem(PENDING_TAPTAB_TRANSACTION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      PENDING_TAPTAB_TRANSACTION_STORAGE_KEY,
      serialisePendingTapTabTransactions(next),
    );
  } catch {
    // Persistence is best-effort; the visible in-memory transaction remains authoritative.
  }
}

async function describePendingReceiptError(
  client: PublicClient,
  error: unknown,
  hash: Hash,
): Promise<string> {
  const timedOut =
    error instanceof WaitForTransactionReceiptTimeoutError ||
    (error instanceof Error && error.name === "WaitForTransactionReceiptTimeoutError");
  if (!timedOut) {
    return `${describeTapTabSubmittedError(error)} Check MonadVision before trying the action again.`;
  }

  try {
    await client.getTransaction({ hash });
    return "The 45-second confirmation check ended while the transaction was still visible. It may still confirm. Check MonadVision or use ‘Check status again’ before trying the action again.";
  } catch (lookupError) {
    if (
      lookupError instanceof TransactionNotFoundError ||
      (lookupError instanceof Error && lookupError.name === "TransactionNotFoundError")
    ) {
      return "The transaction is not currently visible after the 45-second confirmation check. It may have been dropped or replaced. Check MonadVision or use ‘Check status again’ before trying the action again.";
    }
    return "The 45-second confirmation check ended and the RPC could not recheck the transaction. Check MonadVision or use ‘Check status again’ before trying the action again.";
  }
}

async function readContractsAtBlock<T extends readonly unknown[]>(
  client: PublicClient,
  contracts: readonly Readonly<Record<string, unknown>>[],
  blockNumber: bigint,
): Promise<T> {
  return (await client.multicall({
    contracts: contracts as never,
    allowFailure: false,
    blockNumber,
    batchSize: TAPTAB_MULTICALL_BATCH_SIZE_BYTES,
  })) as unknown as T;
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function safeCount(value: number | bigint): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function decodedAddress(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : undefined;
}

function validateInviteBatch(value: string): InviteBatchValidation {
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return { addresses: [], tokenCount: 0 };
  if (tokens.length > MAX_TAPTAB_PARTICIPANTS) {
    return {
      addresses: [],
      tokenCount: tokens.length,
      error: `A single invitation batch can contain at most ${MAX_TAPTAB_PARTICIPANTS} wallets. Nothing will be submitted.`,
    };
  }

  const addresses: Address[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!isAddress(token) || token.toLowerCase() === ZERO_ADDRESS) {
      return {
        addresses: [],
        tokenCount: tokens.length,
        error: `“${token.slice(0, 42)}” is not a valid non-zero EVM wallet. Nothing will be submitted.`,
      };
    }
    const address = getAddress(token);
    const key = address.toLowerCase();
    if (seen.has(key)) {
      return {
        addresses: [],
        tokenCount: tokens.length,
        error: `Wallet ${shortTapTabAddress(address)} appears more than once. Nothing will be submitted.`,
      };
    }
    seen.add(key);
    addresses.push(address);
  }
  return { addresses, tokenCount: tokens.length };
}

function claimSelectionKey(itemIndex: number, shareIndex: number): string {
  return `${itemIndex}:${shareIndex}`;
}

function fundingPercentage(funded: bigint, due: bigint): number {
  if (due <= 0n) return 0;
  const hundredths = (funded * 10_000n) / due;
  return Math.min(100, Number(hundredths) / 100);
}

function deadlineLabel(timestamp: bigint): string {
  const milliseconds = timestamp * 1_000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return "Unknown deadline";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(milliseconds)));
}

function quoteObservedLabel(timestamp: number): string | undefined {
  const milliseconds = timestamp * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return undefined;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function confirmationDurationLabel(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1_000;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1).replace(/\.0+$/, "")} s`;
}

function preflightDetail(preflight: TransactionPreflight): string {
  if (preflight.status === "checking") return preflight.message;
  if (preflight.status === "blocked") return preflight.message;
  if (!preflight.costs) {
    return "Simulation passed · gas and balance estimates were unavailable; the wallet will quote the fee.";
  }

  const costs = preflight.costs;
  const balance =
    costs.walletBalanceWei === undefined
      ? ""
      : ` · wallet ${formatMonAmount(costs.walletBalanceWei)}`;
  const bufferWarning =
    costs.coversEstimatedCost === true && costs.coversBufferedCost === false
      ? " · 25% fee buffer not fully covered"
      : "";
  return `Simulation passed · gas estimate ${costs.estimatedGas.toLocaleString("en-GB")} · estimated fee ${formatMonAmount(costs.estimatedNetworkFeeWei)}–${formatMonAmount(costs.bufferedNetworkFeeWei)} with 25% gas buffer · required balance ${formatMonAmount(costs.estimatedRequiredBalanceWei)}–${formatMonAmount(costs.bufferedRequiredBalanceWei)}${balance}${bufferWarning}`;
}

function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["shortMessage", "details", "message"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.split("\n")[0].slice(0, 240);
      }
    }
  }
  return "The transaction could not be completed.";
}

function decodeDataJson(uri: string): unknown {
  const separator = uri.indexOf(",");
  if (separator < 0) throw new Error("Invalid data URI");
  const header = uri.slice(0, separator).toLowerCase();
  const payload = uri.slice(separator + 1);
  if (payload.length > MAX_METADATA_BYTES * 2) throw new Error("Metadata is too large");

  let json: string;
  if (header.endsWith(";base64")) {
    const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
    json = new TextDecoder().decode(bytes);
  } else {
    json = decodeURIComponent(payload);
  }
  if (json.length > MAX_METADATA_BYTES) throw new Error("Metadata is too large");
  return JSON.parse(json) as unknown;
}

async function loadBillMetadata(
  uri: string,
  expectedItems: number,
  onchain: TapTabGbpMetadataOnchainEvidence,
  signal: AbortSignal,
): Promise<TapTabGbpMetadata | undefined> {
  if (uri.startsWith("data:application/json,")) {
    return parseTapTabGbpMetadata(decodeDataJson(uri), expectedItems, onchain);
  }
  if (uri.startsWith("data:application/json;base64,")) {
    return parseTapTabGbpMetadata(decodeDataJson(uri), expectedItems, onchain);
  }

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password) return undefined;

  const response = await fetch(url, {
    signal,
    headers: { accept: "application/json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) return undefined;
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_METADATA_BYTES
  ) {
    await response.body?.cancel();
    return undefined;
  }

  let text: string;
  if (!response.body) {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_METADATA_BYTES) return undefined;
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let byteLength = 0;
    let decoded = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        byteLength += chunk.value.byteLength;
        if (byteLength > MAX_METADATA_BYTES) {
          await reader.cancel();
          return undefined;
        }
        decoded += decoder.decode(chunk.value, { stream: true });
      }
      text = decoded + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  return parseTapTabGbpMetadata(JSON.parse(text) as unknown, expectedItems, onchain);
}

function mergeEvents(
  current: readonly TapTabLiveEvent[],
  incoming: readonly TapTabLiveEvent[],
): TapTabLiveEvent[] {
  const canonicalTransactionHashes = new Set(
    [...incoming, ...current].flatMap((event) =>
      event.source === "chain" && event.transactionHash
        ? [event.transactionHash.toLowerCase()]
        : [],
    ),
  );
  const seen = new Set<string>();
  return [...incoming, ...current]
    .filter((event) => {
      if (
        event.source === "transaction" &&
        event.transactionHash &&
        canonicalTransactionHashes.has(event.transactionHash.toLowerCase())
      ) {
        return false;
      }
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((left, right) => Number((right.blockNumber ?? 0n) - (left.blockNumber ?? 0n)))
    .slice(0, 24);
}

function subscribeToLocation(update: () => void) {
  window.addEventListener("popstate", update);
  window.addEventListener("hashchange", update);
  return () => {
    window.removeEventListener("popstate", update);
    window.removeEventListener("hashchange", update);
  };
}

function getLocationHref() {
  return window.location.href;
}

function getServerLocationHref() {
  return "";
}

function subscribeToDocumentVisibility(update: () => void) {
  document.addEventListener("visibilitychange", update);
  return () => document.removeEventListener("visibilitychange", update);
}

function getDocumentVisible() {
  return document.visibilityState !== "hidden";
}

function getServerDocumentVisible() {
  return true;
}

function Amount({
  wei,
  quote,
  className,
}: {
  wei: bigint;
  quote?: TapTabGbpQuote;
  className?: string;
}) {
  const amount = formatTapTabAmount(wei, quote);
  return (
    <span className={className}>
      <strong>{amount.primary}</strong>
      {amount.secondary ? <small>{amount.secondary}</small> : null}
    </span>
  );
}

function TransactionStatusList({
  transactions,
  onRecheck,
}: {
  transactions: readonly LiveTransaction[];
  onRecheck(transaction: LiveTransaction): void;
}) {
  if (!transactions.length) return null;
  return (
    <section className="live-transaction-card" aria-labelledby="live-transactions-title">
      <div className="live-card-heading">
        <div>
          <span className="section-kicker">Wallet activity</span>
          <h3 id="live-transactions-title">Transactions</h3>
        </div>
      </div>
      <ol className="live-transaction-list" aria-live="polite">
        {transactions.map((transaction) => (
          <li key={transaction.id} data-status={transaction.status}>
            <span className="live-transaction-dot" aria-hidden="true" />
            <div>
              <strong>{transaction.action}</strong>
              <span>
                {transaction.status === "preflight" ? "Checking before the wallet opens" : null}
                {transaction.status === "awaiting-wallet" ? "Confirm in your wallet" : null}
                {transaction.status === "pending"
                  ? transaction.message ?? "Submitted · waiting for Monad"
                  : null}
                {transaction.status === "unverified"
                  ? transaction.message ?? "Submitted · final status needs review"
                  : null}
                {transaction.status === "confirmed"
                  ? `Confirmed${
                      transaction.confirmationMs === undefined
                        ? ""
                        : ` in ${confirmationDurationLabel(transaction.confirmationMs)}`
                    }${transaction.blockNumber ? ` · block ${transaction.blockNumber}` : ""}`
                  : null}
                {transaction.status === "blocked" || transaction.status === "error"
                  ? transaction.message
                  : null}
              </span>
              {transaction.preflight ? <span>{preflightDetail(transaction.preflight)}</span> : null}
            </div>
            <div className="live-transaction-actions">
              {transaction.explorerUrl ? (
                <a href={transaction.explorerUrl} target="_blank" rel="noreferrer">
                  {transaction.hash ? shortTapTabAddress(transaction.hash) : "View transaction"}
                  <span className="sr-only"> on MonadVision</span>
                </a>
              ) : null}
              {transaction.status === "unverified" && transaction.hash ? (
                <button type="button" onClick={() => onRecheck(transaction)}>
                  Check status again
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TapTabLivePanel({
  active,
  className,
  onLiveUpdate,
  onPaymentLinkState,
}: TapTabLivePanelProps) {
  const wallet = useTapTabWallet();
  const publicClient = useMemo(() => createTapTabPublicClient(), []);
  const locationHref = useSyncExternalStore(
    subscribeToLocation,
    getLocationHref,
    getServerLocationHref,
  );
  const documentVisible = useSyncExternalStore(
    subscribeToDocumentVisibility,
    getDocumentVisible,
    getServerDocumentVisible,
  );
  const [snapshotState, setSnapshotState] = useState<TapTabLiveSnapshot | null>(null);
  const [scopedEvents, setScopedEvents] = useState<
    ScopedValue<readonly TapTabLiveEvent[]>
  >({ scope: "", value: [] });
  const [scopedTransactions, setScopedTransactions] = useState<
    ScopedValue<readonly LiveTransaction[]>
  >({ scope: "", value: [] });
  const [readState, setReadState] = useState<"idle" | "loading" | "live" | "error">("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [readError, setReadError] = useState<string>();
  const [eventReadError, setEventReadError] = useState<string>();
  const [eventWatchIssue, setEventWatchIssue] = useState<
    Readonly<{ scope: string; id: string }> | undefined
  >();
  const [metadataValue, setMetadataValue] = useState<TapTabGbpMetadata>();
  const [metadataReadState, setMetadataReadState] = useState<
    "idle" | "loading" | "ready" | "absent" | "invalid" | "error"
  >("idle");
  const [metadataError, setMetadataError] = useState<string>();
  const [metadataRetryNonce, setMetadataRetryNonce] = useState(0);
  const [metadataScope, setMetadataScope] = useState("");
  const [fairRemainder, setFairRemainder] = useState(true);
  const [tipPercent, setTipPercent] = useState("12.5");
  const [inviteAddress, setInviteAddress] = useState("");
  const [claimSelection, setClaimSelection] = useState<
    Readonly<{ scope: string; keys: readonly string[] }>
  >({ scope: "", keys: [] });
  const [chosenBeneficiary, setChosenBeneficiary] = useState<
    Readonly<{ scope: string; address: Address }>
  >();
  const [leaveRecipient, setLeaveRecipient] = useState<Address>();
  const [privateNameMappings, setPrivateNameMappings] = useState<
    readonly PrivateNameMapping[]
  >([]);
  const [privateNameDrafts, setPrivateNameDrafts] = useState<Readonly<Record<string, string>>>({});
  const [privateNameStorageState, setPrivateNameStorageState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [privateNameError, setPrivateNameError] = useState<string>();
  const [includePrivateNames, setIncludePrivateNames] = useState(false);
  const [venueExportError, setVenueExportError] = useState<string>();
  const [copied, setCopied] = useState<"share" | "wallet" | "payment">();
  const [copyError, setCopyError] = useState<string>();
  const [copyRecoveryValue, setCopyRecoveryValue] = useState<string>();
  const [transactionResumeRevision, setTransactionResumeRevision] = useState(0);
  const [walletSessionState, setWalletSessionState] = useState<WalletSessionState>({
    scope: "",
    status: "idle",
  });
  const walletSessionRequestSequence = useRef(0);
  const refreshInFlight = useRef<
    Readonly<{ scope: string; requestId: number }> | undefined
  >(undefined);
  const refreshSequence = useRef(0);
  const activeContextScope = useRef("");
  const activeTransactionScope = useRef("");
  const lastEventBlock = useRef<bigint | undefined>(undefined);
  const eventRetryAfterAt = useRef(0);
  const watchedEventIds = useRef(new Set<string>());
  const eventWatchIssueRef = useRef<
    Readonly<{ scope: string; id: string }> | undefined
  >(undefined);
  const transactionSequence = useRef(0);
  const transactionInFlight = useRef<
    Readonly<{ scope: string; id: number }> | undefined
  >(undefined);
  const automaticallyResumedTransactions = useRef(new Set<string>());
  const walletStateRef = useRef({
    account: wallet.account,
    provider: wallet.provider,
  });
  useEffect(() => {
    walletStateRef.current = {
      account: wallet.account,
      provider: wallet.provider,
    };
  }, [wallet.account, wallet.provider]);
  const walletSessionScope = wallet.account?.toLowerCase() ?? "";
  const walletSession =
    walletSessionState.scope === walletSessionScope
      ? walletSessionState
      : ({ scope: walletSessionScope, status: "idle" } satisfies WalletSessionState);

  const refreshWalletSession = useCallback(async () => {
    const account = wallet.account;
    const provider = wallet.provider;
    const scope = account?.toLowerCase() ?? "";
    const requestId = ++walletSessionRequestSequence.current;
    if (!account || !provider) {
      setWalletSessionState({ scope, status: "idle" });
      return;
    }

    setWalletSessionState((current) => ({
      scope,
      status: "checking",
      ...(current.scope === scope && current.balanceWei !== undefined
        ? { balanceWei: current.balanceWei }
        : {}),
      ...(current.scope === scope && current.chainId !== undefined
        ? { chainId: current.chainId }
        : {}),
    }));
    try {
      const [chainId, balanceWei] = await Promise.all([
        readTapTabWalletChainId(provider),
        publicClient.getBalance({ address: account }),
      ]);
      const currentWallet = walletStateRef.current;
      if (
        requestId !== walletSessionRequestSequence.current ||
        currentWallet.provider !== provider ||
        !sameAddress(currentWallet.account, account)
      ) {
        return;
      }
      setWalletSessionState({
        scope,
        status:
          chainId === TAPTAB_MONAD_TESTNET.id ? "ready" : "wrong-network",
        chainId,
        balanceWei,
        checkedAt: Date.now(),
      });
    } catch {
      const currentWallet = walletStateRef.current;
      if (
        requestId !== walletSessionRequestSequence.current ||
        currentWallet.provider !== provider ||
        !sameAddress(currentWallet.account, account)
      ) {
        return;
      }
      setWalletSessionState({
        scope,
        status: "error",
        message:
          "TapTab could not refresh this wallet’s Monad Testnet network and balance. No transaction was submitted.",
      });
    }
  }, [publicClient, wallet.account, wallet.provider]);

  useEffect(() => {
    if (!active || !documentVisible || !wallet.account || !wallet.provider) {
      return;
    }
    const provider = wallet.provider;
    const refresh = () => {
      wallet.refreshConnection();
      void refreshWalletSession();
    };
    const initialRefresh = window.requestAnimationFrame(() => {
      void refreshWalletSession();
    });
    provider.on("chainChanged", refresh);
    provider.on("accountsChanged", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.cancelAnimationFrame(initialRefresh);
      provider.removeListener("chainChanged", refresh);
      provider.removeListener("accountsChanged", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [
    active,
    documentVisible,
    refreshWalletSession,
    wallet,
    wallet.account,
    wallet.provider,
  ]);

  const requestMonadTestnetSwitch = useCallback(async () => {
    const account = wallet.account;
    const provider = wallet.provider;
    if (!account || !provider) return;
    const scope = account.toLowerCase();
    const requestId = ++walletSessionRequestSequence.current;
    setWalletSessionState((current) => ({
      scope,
      status: "switching",
      ...(current.scope === scope && current.balanceWei !== undefined
        ? { balanceWei: current.balanceWei }
        : {}),
      ...(current.scope === scope && current.chainId !== undefined
        ? { chainId: current.chainId }
        : {}),
    }));
    try {
      await switchTapTabWalletToMonadTestnet(provider);
      const currentWallet = walletStateRef.current;
      if (
        requestId !== walletSessionRequestSequence.current ||
        currentWallet.provider !== provider ||
        !sameAddress(currentWallet.account, account)
      ) {
        return;
      }
      wallet.refreshConnection();
      await refreshWalletSession();
    } catch (error) {
      const currentWallet = walletStateRef.current;
      if (
        requestId !== walletSessionRequestSequence.current ||
        currentWallet.provider !== provider ||
        !sameAddress(currentWallet.account, account)
      ) {
        return;
      }
      setWalletSessionState({
        scope,
        status: "error",
        message: describeTapTabNetworkSwitchError(error),
      });
    }
  }, [refreshWalletSession, wallet]);
  const syncedPreferences = useRef("");

  const browserLocation = useMemo(() => {
    if (!locationHref) return undefined;
    try {
      return new URL(locationHref);
    } catch {
      return undefined;
    }
  }, [locationHref]);
  const queryResolution = useMemo(
    () => resolveTrustedTapTabQuery(browserLocation?.search ?? "", tapTabDeployment),
    [browserLocation?.search],
  );
  const context = queryResolution.status === "trusted" ? queryResolution.context : undefined;
  const contextScope = context
    ? `${context.address.toLowerCase()}:${context.billId.toString()}`
    : "";
  const pendingTransactionScope = useMemo<
    PendingTapTabTransactionScope | undefined
  >(
    () =>
      context && wallet.account && isAddress(wallet.account)
        ? {
            chainId: TAPTAB_MONAD_TESTNET.id,
            contract: context.address,
            billId: context.billId.toString(),
            account: getAddress(wallet.account),
          }
        : undefined,
    [context, wallet.account],
  );
  const transactionScope = pendingTransactionScope
    ? pendingTapTabTransactionScopeKey(pendingTransactionScope)
    : "";
  const snapshot =
    context &&
    snapshotState &&
    sameAddress(context.address, snapshotState.context.address) &&
    context.billId === snapshotState.context.billId
      ? snapshotState
      : null;
  const events = useMemo<readonly TapTabLiveEvent[]>(
    () => (scopedEvents.scope === contextScope ? scopedEvents.value : []),
    [contextScope, scopedEvents],
  );
  const transactions = useMemo<readonly LiveTransaction[]>(
    () =>
      scopedTransactions.scope === transactionScope ? scopedTransactions.value : [],
    [scopedTransactions, transactionScope],
  );
  const visibleEventWatchIssue =
    eventWatchIssue?.scope === contextScope ? eventWatchIssue : undefined;
  const metadata = metadataScope === contextScope ? metadataValue : undefined;
  const metadataState =
    metadataScope === contextScope
      ? metadataReadState
      : context
        ? "loading"
        : "idle";
  const metadataIsImmutableInline = Boolean(
    snapshot?.bill.metadataURI.startsWith("data:application/json,") ||
      snapshot?.bill.metadataURI.startsWith("data:application/json;base64,"),
  );
  useEffect(() => {
    activeContextScope.current = contextScope;
  }, [contextScope]);
  useEffect(() => {
    activeTransactionScope.current = transactionScope;
  }, [transactionScope]);
  const shareUrl = useMemo(
    () =>
      context && browserLocation
        ? buildTapTabShareUrl(browserLocation.origin, browserLocation.pathname, context)
        : "",
    [browserLocation, context],
  );
  const hasPendingTransaction = transactions.some(
    (transaction) =>
      transaction.status === "pending" || transaction.status === "unverified",
  );
  const periodicReadsEnabled = active && documentVisible;

  useEffect(() => {
    const readNames = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(PRIVATE_NAME_STORAGE_KEY);
        setPrivateNameMappings(parsePrivateNameMappings(stored));
        setPrivateNameStorageState("ready");
      } catch {
        setPrivateNameMappings([]);
        setPrivateNameStorageState("unavailable");
      }
    }, 0);
    return () => window.clearTimeout(readNames);
  }, []);

  useEffect(() => {
    if (!pendingTransactionScope || !transactionScope) return;

    const restorePendingTransactions = window.setTimeout(() => {
      let stored: PendingTapTabTransaction[];
      try {
        stored = parsePendingTapTabTransactions(
          window.localStorage.getItem(PENDING_TAPTAB_TRANSACTION_STORAGE_KEY),
        );
      } catch {
        return;
      }
      if (activeTransactionScope.current !== transactionScope) return;

      const restored = pendingTapTabTransactionsForScope(
        stored,
        pendingTransactionScope,
      ).map<LiveTransaction>((transaction) => ({
        id: ++transactionSequence.current,
        action: transaction.action,
        status: "unverified",
        hash: transaction.hash,
        explorerUrl: `${EXPLORER_URL}/tx/${transaction.hash}`,
        submittedAt: transaction.submittedAt,
        restored: true,
        message:
          "Restored after refresh. TapTab will recheck it once; do not repeat the action until MonadVision shows the final result.",
      }));
      if (restored.length === 0) return;

      setScopedTransactions((current) => {
        if (activeTransactionScope.current !== transactionScope) return current;
        const currentTransactions =
          current.scope === transactionScope ? current.value : [];
        const currentHashes = new Set(
          currentTransactions.map((transaction) => transaction.hash?.toLowerCase()),
        );
        return {
          scope: transactionScope,
          value: [
            ...currentTransactions,
            ...restored.filter(
              (transaction) =>
                transaction.hash && !currentHashes.has(transaction.hash.toLowerCase()),
            ),
          ].slice(0, 10),
        };
      });
    }, 0);

    return () => window.clearTimeout(restorePendingTransactions);
  }, [pendingTransactionScope, transactionScope]);

  const refresh = useCallback(
    async (force = false) => {
      if (
        !context ||
        activeContextScope.current !== contextScope ||
        refreshInFlight.current?.scope === contextScope
      ) {
        return;
      }
      const requestId = ++refreshSequence.current;
      refreshInFlight.current = { scope: contextScope, requestId };
      setRefreshing(true);
      if (force) eventRetryAfterAt.current = 0;
      const isCurrentRequest = () =>
        activeContextScope.current === contextScope &&
        refreshInFlight.current?.scope === contextScope &&
        refreshInFlight.current.requestId === requestId;
      setReadState((current) => (current === "live" ? current : "loading"));

      try {
        const blockNumber = await publicClient.getBlockNumber();
        const [
          bill,
          rawItems,
          addresses,
          proceedsAvailable,
          splitStatus,
          currentSplitDigest,
          chainTimestamp,
        ] = await readContractsAtBlock<
          readonly [
            RawBill,
            readonly RawItem[],
            readonly Address[],
            bigint,
            TapTabSplitStatus,
            Hash,
            bigint,
          ]
        >(
          publicClient,
          [
            buildBillRead(context),
            buildItemsRead(context),
            buildParticipantsRead(context),
            buildProceedsRead(context),
            buildSplitStatusRead(context),
            buildSplitDigestRead(context),
            buildCurrentBlockTimestampRead(),
          ],
          blockNumber,
        );
        if (splitStatus.currentDigest.toLowerCase() !== currentSplitDigest.toLowerCase()) {
          throw new Error("The split changed while it was being read. Retrying will load one version.");
        }

        const accountAddress = wallet.account;
        const accountReads = accountAddress
          ? buildAccountReads(context, accountAddress)
          : undefined;
        const secondWaveContracts = [
          ...addresses.flatMap((address) => [
            buildParticipantRead(context, address),
            buildSplitApprovalRead(context, address),
          ]),
          ...rawItems.map((_, itemIndex) =>
            buildShareOwnersRead(context, BigInt(itemIndex)),
          ),
          ...(accountAddress && accountReads
            ? [
                accountReads.participant,
                accountReads.remainingDue,
                accountReads.contribution,
                accountReads.claimableRefund,
                buildInvitationRead(context, accountAddress),
                buildSplitApprovalRead(context, accountAddress),
              ]
            : []),
        ];
        const secondWaveResults = await readContractsAtBlock<readonly unknown[]>(
          publicClient,
          secondWaveContracts,
          blockNumber,
        );
        let resultIndex = 0;
        const takeResult = <T,>(): T => {
          if (resultIndex >= secondWaveResults.length) {
            throw new Error("The batched TapTab snapshot returned incomplete data.");
          }
          return secondWaveResults[resultIndex++] as T;
        };
        const participantRecords = addresses.map((address) => {
          const participant = takeResult<RawParticipant>();
          const approvedCurrentSplit = takeResult<boolean>();
          return {
            ...participant,
            address,
            remainingDue: participant.amountDue - participant.amountFunded,
            approvedCurrentSplit,
          } satisfies TapTabLiveParticipant;
        });
        const ownerRecords = rawItems.map(() => takeResult<readonly Address[]>());

        const items = rawItems.map((item, index) => ({
          ...item,
          index,
          shareCount: safeCount(item.shareCount),
          claimedShareCount: safeCount(item.claimedShareCount),
          owners: ownerRecords[index] ?? [],
        }));

        let account: TapTabLiveAccount | undefined;
        if (accountAddress && accountReads) {
          const [
            participant,
            remainingDue,
            contribution,
            claimableRefund,
            invited,
            approvedCurrentSplit,
          ] = [
            takeResult<RawParticipant>(),
            takeResult<bigint>(),
            takeResult<bigint>(),
            takeResult<bigint>(),
            takeResult<boolean>(),
            takeResult<boolean>(),
          ];
          account = {
            address: accountAddress,
            participant,
            remainingDue,
            contribution,
            claimableRefund,
            invited,
            approvedCurrentSplit,
          };
        }
        if (resultIndex !== secondWaveResults.length) {
          throw new Error("The batched TapTab snapshot returned unexpected data.");
        }

        const countedApprovals = participantRecords.filter(
          (participant) => participant.approvedCurrentSplit,
        ).length;
        if (
          safeCount(splitStatus.requiredApprovals) !== addresses.length ||
          safeCount(splitStatus.approvalCount) !== countedApprovals
        ) {
          throw new Error("The split changed while it was being read. Retrying will load one version.");
        }

        const nextSnapshot: TapTabLiveSnapshot = {
          context,
          bill,
          chainTimestamp,
          phase: deriveTapTabPhase(bill.state),
          items,
          participants: participantRecords,
          splitStatus,
          ...(account ? { account } : {}),
          proceedsAvailable,
          fetchedAt: Date.now(),
        };
        if (!isCurrentRequest()) return;
        setSnapshotState(nextSnapshot);
        setReadError(undefined);
        setReadState("live");

        const fromBlock =
          lastEventBlock.current === undefined
            ? blockNumber > EVENT_LOOKBACK_BLOCKS
              ? blockNumber - EVENT_LOOKBACK_BLOCKS
              : 0n
            : lastEventBlock.current + 1n;
        if (fromBlock <= blockNumber && Date.now() >= eventRetryAfterAt.current) {
          try {
            const logs = await publicClient.getLogs({
              address: context.address,
              fromBlock,
              toBlock: blockNumber,
            });
            const decodedEvents: TapTabLiveEvent[] = [];
            for (const log of logs) {
              try {
                const decoded = decodeEventLog({
                  abi: tapTabAbi,
                  data: log.data,
                  topics: log.topics,
                  strict: false,
                }) as unknown as {
                  eventName: string;
                  args: Readonly<Record<string, unknown>>;
                };
                if (decoded.args.billId !== context.billId) continue;
                const presented = presentTapTabChainEvent(decoded.eventName, decoded.args);
                const hash = log.transactionHash ?? undefined;
                const beneficiaryAddress =
                  decoded.eventName === "ContributionReceived"
                    ? decodedAddress(decoded.args.beneficiary)
                    : undefined;
                const payerAddress =
                  decoded.eventName === "ContributionReceived"
                    ? decodedAddress(decoded.args.payer)
                    : undefined;
                const amountWei =
                  decoded.eventName === "ContributionReceived" &&
                  typeof decoded.args.amount === "bigint" &&
                  decoded.args.amount > 0n
                    ? decoded.args.amount
                    : undefined;
                decodedEvents.push({
                  id: `chain:${hash ?? "pending"}:${log.logIndex ?? 0}`,
                  source: "chain",
                  ...presented,
                  eventName: decoded.eventName,
                  ...(payerAddress ? { payerAddress } : {}),
                  ...(beneficiaryAddress ? { beneficiaryAddress } : {}),
                  ...(amountWei ? { amountWei } : {}),
                  ...(hash ? { transactionHash: hash, explorerUrl: `${EXPLORER_URL}/tx/${hash}` } : {}),
                  ...(log.blockNumber !== null ? { blockNumber: log.blockNumber } : {}),
                });
              } catch {
                // The contract can emit unrelated events in a later compatible release.
              }
            }
            if (!isCurrentRequest()) return;
            if (decodedEvents.length) {
              setScopedEvents((current) => ({
                scope: contextScope,
                value: mergeEvents(
                  current.scope === contextScope ? current.value : [],
                  decodedEvents,
                ),
              }));
            }
            setEventReadError(undefined);
            eventRetryAfterAt.current = 0;
            lastEventBlock.current = blockNumber;
          } catch (error) {
            if (isCurrentRequest()) {
              setEventReadError(describeError(error));
              eventRetryAfterAt.current = Date.now() + 15_000;
            }
          }
        }
      } catch (error) {
        if (isCurrentRequest()) {
          setReadError(describeError(error));
          setReadState("error");
        }
      } finally {
        if (
          refreshInFlight.current?.scope === contextScope &&
          refreshInFlight.current.requestId === requestId
        ) {
          refreshInFlight.current = undefined;
          setRefreshing(false);
        }
      }
    },
    [context, contextScope, publicClient, wallet.account],
  );

  useEffect(() => {
    lastEventBlock.current = undefined;
    eventRetryAfterAt.current = 0;
    watchedEventIds.current.clear();
  }, [contextScope]);

  useEffect(() => {
    if (!context || !periodicReadsEnabled) return;

    const initial = window.setTimeout(() => {
      setEventReadError(undefined);
      void refresh();
    }, 0);
    const interval = window.setInterval(
      () => void refresh(),
      hasPendingTransaction ? PENDING_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    );
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [context, hasPendingTransaction, periodicReadsEnabled, refresh]);

  useEffect(() => {
    watchedEventIds.current.clear();
    if (!context || !periodicReadsEnabled) return;

    let watching = true;
    const unwatch = publicClient.watchContractEvent({
      address: context.address,
      abi: tapTabAbi,
      strict: true,
      pollingInterval: EVENT_WATCH_INTERVAL_MS,
      onLogs(logs) {
        if (!watching) return;
        if (eventWatchIssueRef.current?.scope === contextScope) {
          eventWatchIssueRef.current = undefined;
        }
        setEventWatchIssue((current) =>
          current?.scope === contextScope ? undefined : current,
        );
        let sawNewBillEvent = false;
        for (const log of logs) {
          try {
            const decoded = decodeEventLog({
              abi: tapTabAbi,
              data: log.data,
              topics: log.topics,
              strict: false,
            }) as unknown as { args: Readonly<Record<string, unknown>> };
            if (decoded.args.billId !== context.billId) continue;
            const eventId = `${log.transactionHash ?? log.blockNumber ?? "pending"}:${log.logIndex ?? 0}`;
            if (watchedEventIds.current.has(eventId)) continue;
            watchedEventIds.current.add(eventId);
            sawNewBillEvent = true;
          } catch {
            // A later compatible deployment may add events that this build does not know.
          }
        }
        if (watchedEventIds.current.size > 256) {
          watchedEventIds.current = new Set(
            [...watchedEventIds.current].slice(-128),
          );
        }
        if (sawNewBillEvent) void refresh(true);
      },
      onError(error) {
        if (!watching) return;
        const existingIssue = eventWatchIssueRef.current;
        if (existingIssue?.scope === contextScope) return;
        const issueId = createClientIssueId("event-watch");
        const issue = { scope: contextScope, id: issueId };
        eventWatchIssueRef.current = issue;
        setEventWatchIssue(issue);
        console.warn("TapTab event watcher encountered an error", {
          issueId,
          errorName: safeErrorName(error),
        });
      },
    });

    return () => {
      watching = false;
      unwatch();
      watchedEventIds.current.clear();
    };
  }, [context, contextScope, periodicReadsEnabled, publicClient, refresh]);

  const metadataUri = snapshot?.bill.metadataURI;
  const metadataItemCount = snapshot?.items.length ?? 0;
  const metadataSubtotalWei = snapshot?.bill.subtotal;
  const metadataItemAmountsKey =
    snapshot?.items.map((item) => item.amount.toString()).join(",") ?? "";
  useEffect(() => {
    if (!metadataUri || metadataSubtotalWei === undefined) {
      queueMicrotask(() => {
        setMetadataScope(contextScope);
        setMetadataValue(undefined);
        setMetadataError(undefined);
        setMetadataReadState(context ? "absent" : "idle");
      });
      return;
    }

    let active = true;
    let timedOut = false;
    const controller = new AbortController();
    const onchainEvidence: TapTabGbpMetadataOnchainEvidence = {
      subtotalWei: metadataSubtotalWei,
      itemAmountsWei: metadataItemAmountsKey
        ? metadataItemAmountsKey.split(",").map((amount) => BigInt(amount))
        : [],
    };
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 5_000);
    queueMicrotask(() => {
      if (active && !controller.signal.aborted) {
        setMetadataScope(contextScope);
        setMetadataValue(undefined);
        setMetadataError(undefined);
        setMetadataReadState("loading");
      }
    });
    void loadBillMetadata(metadataUri, metadataItemCount, onchainEvidence, controller.signal)
      .then((value) => {
        if (!active || controller.signal.aborted) return;
        setMetadataScope(contextScope);
        setMetadataValue(value);
        setMetadataError(
          value
            ? undefined
            : "The published receipt metadata failed TapTab’s size, format or GBP validation checks.",
        );
        setMetadataReadState(value ? "ready" : "invalid");
      })
      .catch(() => {
        if (!active) return;
        setMetadataScope(contextScope);
        setMetadataValue(undefined);
        setMetadataError(
          timedOut
            ? "The receipt metadata request timed out after five seconds."
            : "The receipt metadata could not be reached. The onchain MON amounts remain available.",
        );
        setMetadataReadState("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    context,
    contextScope,
    metadataItemAmountsKey,
    metadataItemCount,
    metadataRetryNonce,
    metadataSubtotalWei,
    metadataUri,
  ]);

  useEffect(() => {
    const account = snapshot?.account?.participant;
    const accountAddress = snapshot?.account?.address;
    if (!account?.joined || !sameAddress(accountAddress, wallet.account)) return;
    const key = `${accountAddress}:${account.fairRemainder}:${account.tipVoteBps}`;
    if (syncedPreferences.current === key) return;
    syncedPreferences.current = key;
    queueMicrotask(() => {
      setFairRemainder(account.fairRemainder);
      setTipPercent(String(account.tipVoteBps / 100));
    });
  }, [snapshot?.account?.address, snapshot?.account?.participant, wallet.account]);

  const quote = useMemo<TapTabGbpQuote | undefined>(() => {
    if (
      !metadataIsImmutableInline ||
      !metadata?.quote ||
      !snapshot ||
      snapshot.bill.subtotal <= 0n
    ) {
      return undefined;
    }
    const evidencedSubtotalWei =
      metadata.settlement?.subtotalWei ?? metadata.quote?.subtotalWei;
    if (evidencedSubtotalWei && evidencedSubtotalWei !== snapshot.bill.subtotal.toString()) {
      return undefined;
    }
    return {
      subtotalPence: metadata.subtotalPence,
      subtotalWei: snapshot.bill.subtotal,
    };
  }, [metadata, metadataIsImmutableInline, snapshot]);

  const gbpDisplay = useMemo<TapTabLiveGbpDisplay | undefined>(() => {
    if (!quote || !snapshot) return undefined;
    if (
      snapshot.items.reduce((total, item) => total + item.amount, 0n) !==
      snapshot.bill.subtotal
    ) {
      return undefined;
    }

    const itemAllocations = allocateTapTabPence(
      snapshot.items.map((item) => ({
        key: item.index.toString(),
        amountWei: item.amount,
      })),
      quote.subtotalPence,
    );
    if (!itemAllocations) return undefined;

    const itemDisplay = itemAllocations.map((allocation) => ({
      index: Number(allocation.key),
      amountPence: allocation.amountPence,
    }));
    const itemOnlyDisplay: TapTabLiveGbpDisplay = {
      subtotalPence: quote.subtotalPence,
      items: itemDisplay,
    };
    if (snapshot.bill.totalDue < snapshot.bill.subtotal) return itemOnlyDisplay;

    const tipWei = snapshot.bill.totalDue - snapshot.bill.subtotal;
    const participantBaseWei = snapshot.participants.reduce(
      (total, participant) => total + participant.baseDue,
      0n,
    );
    const participantTipWei = snapshot.participants.reduce(
      (total, participant) => total + participant.tipDue,
      0n,
    );
    if (
      participantBaseWei !== snapshot.bill.subtotal ||
      participantTipWei !== tipWei ||
      snapshot.participants.some(
        (participant) =>
          participant.baseDue + participant.tipDue !== participant.amountDue,
      )
    ) {
      return itemOnlyDisplay;
    }

    const tipPence = quoteTapTabPence(tipWei, quote);
    if (tipPence === undefined) return itemOnlyDisplay;
    const participantAllocations = allocateTapTabParticipantPence(
      snapshot.participants.map((participant) => ({
        key: participant.address.toLowerCase(),
        baseDueWei: participant.baseDue,
        tipDueWei: participant.tipDue,
      })),
      quote.subtotalPence,
      tipPence,
    );
    if (!participantAllocations) return itemOnlyDisplay;

    const participantByKey = new Map(
      snapshot.participants.map((participant) => [
        participant.address.toLowerCase(),
        participant,
      ]),
    );
    const participants = participantAllocations.flatMap((allocation) => {
      const participant = participantByKey.get(allocation.key);
      return participant
        ? [
            {
              address: participant.address,
              baseDuePence: allocation.baseDuePence,
              tipPence: allocation.tipPence,
              totalDuePence: allocation.totalDuePence,
            },
          ]
        : [];
    });
    if (participants.length !== snapshot.participants.length) return itemOnlyDisplay;

    return {
      ...itemOnlyDisplay,
      tipPence,
      totalDuePence: quote.subtotalPence + tipPence,
      participants,
    };
  }, [quote, snapshot]);

  const itemDisplayPenceByIndex = useMemo(
    () =>
      new Map(
        (gbpDisplay?.items ?? []).map((item) => [item.index, item.amountPence]),
      ),
    [gbpDisplay?.items],
  );
  const participantDisplayPenceByAddress = useMemo(
    () =>
      new Map(
        (gbpDisplay?.participants ?? []).map((participant) => [
          participant.address.toLowerCase(),
          participant,
        ]),
      ),
    [gbpDisplay?.participants],
  );

  const privateNamesForBill = useMemo<readonly TapTabPrivateName[]>(() => {
    if (!context || !snapshot) return [];
    return snapshot.participants.flatMap((participant) => {
      const name = findPrivateDisplayName(privateNameMappings, {
        contractAddress: context.address,
        billId: context.billId,
        walletAddress: participant.address,
      });
      return name ? [{ address: participant.address, name }] : [];
    });
  }, [context, privateNameMappings, snapshot]);

  const callbackSnapshot =
    context &&
    snapshot &&
    sameAddress(context.address, snapshot.context.address) &&
    context.billId === snapshot.context.billId
      ? snapshot
      : null;
  const latestConfirmation = useMemo<TapTabConfirmationMeasurement | undefined>(() => {
    let latest: TapTabConfirmationMeasurement | undefined;
    for (const transaction of transactions) {
      if (
        transaction.status !== "confirmed" ||
        !transaction.hash ||
        transaction.blockNumber === undefined ||
        transaction.submittedAt === undefined ||
        transaction.confirmedAt === undefined ||
        transaction.confirmationMs === undefined
      ) {
        continue;
      }
      if (!latest || transaction.confirmedAt > latest.confirmedAt) {
        latest = {
          action: transaction.action,
          transactionHash: transaction.hash,
          blockNumber: transaction.blockNumber,
          submittedAt: transaction.submittedAt,
          confirmedAt: transaction.confirmedAt,
          confirmationMs: transaction.confirmationMs,
        };
      }
    }
    return latest;
  }, [transactions]);

  useEffect(() => {
    onLiveUpdate?.({
      snapshot: callbackSnapshot,
      events,
      ...(callbackSnapshot && metadata ? { metadata } : {}),
      ...(callbackSnapshot && quote ? { quote } : {}),
      ...(callbackSnapshot && gbpDisplay ? { gbpDisplay } : {}),
      shareUrl: callbackSnapshot ? shareUrl : "",
      privateNames: callbackSnapshot ? privateNamesForBill : [],
      ...(latestConfirmation ? { latestConfirmation } : {}),
      walletSessionStatus: walletSession.status,
      ...(walletSession.chainId !== undefined
        ? { walletChainId: walletSession.chainId }
        : {}),
    });
  }, [
    callbackSnapshot,
    events,
    gbpDisplay,
    metadata,
    latestConfirmation,
    onLiveUpdate,
    privateNamesForBill,
    quote,
    shareUrl,
    walletSession.chainId,
    walletSession.status,
  ]);

  const submitTransaction = useCallback(
    async (action: string, request: Readonly<Record<string, unknown>>) => {
      if (
        !context ||
        !pendingTransactionScope ||
        !transactionScope ||
        !wallet.account ||
        !wallet.provider
      ) {
        wallet.open();
        return false;
      }
      if (transactionInFlight.current?.scope === transactionScope) return false;

      const account = wallet.account;
      const provider = wallet.provider;
      const persistedScope = pendingTransactionScope;
      const assertCurrentTransactionScope = () => {
        const currentWallet = walletStateRef.current;
        if (
          activeContextScope.current !== contextScope ||
          activeTransactionScope.current !== transactionScope ||
          currentWallet.account?.toLowerCase() !== account.toLowerCase() ||
          currentWallet.provider !== provider
        ) {
          throw new Error(
            "The bill or connected wallet changed before submission. Nothing was submitted.",
          );
        }
      };

      const id = ++transactionSequence.current;
      transactionInFlight.current = { scope: transactionScope, id };
      const releaseTransactionLock = () => {
        if (
          transactionInFlight.current?.scope === transactionScope &&
          transactionInFlight.current.id === id
        ) {
          transactionInFlight.current = undefined;
        }
      };
      const add = (transaction: LiveTransaction) =>
        setScopedTransactions((current) => {
          if (activeTransactionScope.current !== transactionScope) return current;
          const currentTransactions =
            current.scope === transactionScope ? current.value : [];
          return {
            scope: transactionScope,
            value: [transaction, ...currentTransactions].slice(0, 10),
          };
        });
      const update = (changes: Partial<LiveTransaction>) =>
        setScopedTransactions((current) => {
          if (
            activeTransactionScope.current !== transactionScope ||
            current.scope !== transactionScope
          ) {
            return current;
          }
          return {
            scope: transactionScope,
            value: current.value.map((transaction) =>
              transaction.id === id ? { ...transaction, ...changes } : transaction,
            ),
          };
        });

      add({
        id,
        action,
        status: "preflight",
        preflight: {
          status: "checking",
          message: "Checking the exact action on Monad Testnet before the wallet opens.",
        },
      });
      let stage: "preflight" | "network" | "wallet" | "submitted" = "preflight";
      let trackedHash: Hash | undefined;
      let replacementReason: "cancelled" | "replaced" | "repriced" | undefined;
      try {
        assertCurrentTransactionScope();
        if (!sameAddress(request.address as string | undefined, context.address)) {
          throw new Error("The transaction does not target this trusted TapTab contract");
        }

        const simulationInput = { ...request, account } as const;
        const simulateExactAction = async () => {
          const rpcChainId = await publicClient.getChainId();
          if (rpcChainId !== TAPTAB_MONAD_TESTNET.id) {
            throw new Error(
              `The public RPC returned chain ${rpcChainId}, not Monad Testnet ${TAPTAB_MONAD_TESTNET.id}`,
            );
          }
          await publicClient.simulateContract(simulationInput as never);
        };

        await simulateExactAction();
        assertCurrentTransactionScope();
        const [gasResult, feesResult, balanceResult] = await Promise.allSettled([
          publicClient.estimateContractGas(simulationInput as never),
          publicClient.estimateFeesPerGas(),
          publicClient.getBalance({ address: account }),
        ]);
        assertCurrentTransactionScope();
        const feeQuote =
          feesResult.status === "fulfilled"
            ? (feesResult.value as Readonly<{
                maxFeePerGas?: bigint;
                gasPrice?: bigint;
              }>)
            : undefined;
        const feePerGasWei = feeQuote?.maxFeePerGas ?? feeQuote?.gasPrice;
        const costs =
          gasResult.status === "fulfilled" && feePerGasWei !== undefined
            ? calculateTapTabPreflightCosts({
                estimatedGas: gasResult.value,
                feePerGasWei,
                transactionValueWei:
                  typeof request.value === "bigint" ? request.value : 0n,
                ...(balanceResult.status === "fulfilled"
                  ? { walletBalanceWei: balanceResult.value }
                  : {}),
              })
            : undefined;
        if (costs?.coversBufferedCost === false && costs.walletBalanceWei !== undefined) {
          throw new Error(
            `Wallet balance ${formatMonAmount(costs.walletBalanceWei)} is below the buffered requirement of ${formatMonAmount(costs.bufferedRequiredBalanceWei)}`,
          );
        }
        update({
          preflight: { status: "ready", checkedAt: Date.now(), ...(costs ? { costs } : {}) },
        });

        stage = "network";
        await switchTapTabWalletToMonadTestnet(provider);
        assertCurrentTransactionScope();
        const activeWalletChainId = await readTapTabWalletChainId(provider);
        assertCurrentTransactionScope();
        if (activeWalletChainId !== TAPTAB_MONAD_TESTNET.id) {
          throw new Error("The wallet did not switch to Monad Testnet. Nothing was submitted.");
        }

        stage = "preflight";
        update({
          status: "preflight",
          preflight: {
            status: "checking",
            message: "Rechecking the latest contract state immediately before submission.",
          },
        });
        await simulateExactAction();
        assertCurrentTransactionScope();
        update({
          preflight: { status: "ready", checkedAt: Date.now(), ...(costs ? { costs } : {}) },
        });

        stage = "wallet";
        update({ status: "awaiting-wallet" });
        const walletClient = createWalletClient({
          account,
          chain: TAPTAB_MONAD_TESTNET,
          transport: custom(provider),
        });
        assertCurrentTransactionScope();
        const hash = await walletClient.writeContract({
          ...request,
          account,
          ...(costs ? { gas: costs.bufferedGasLimit } : {}),
        } as never);
        stage = "submitted";
        trackedHash = hash;
        const submittedAt = Date.now();
        const explorerUrl = `${EXPLORER_URL}/tx/${hash}`;
        update({ status: "pending", hash, explorerUrl, submittedAt });
        mutateStoredPendingTransactions((current) =>
          upsertPendingTapTabTransaction(current, {
            ...persistedScope,
            action,
            hash,
            submittedAt,
          }),
        );

        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: TRANSACTION_RECEIPT_TIMEOUT_MS,
          checkReplacement: true,
          onReplaced(replacement) {
            const previousHash = trackedHash ?? hash;
            const replacementHash = replacement.transaction.hash;
            trackedHash = replacementHash;
            replacementReason = replacement.reason;
            const replacementExplorerUrl = `${EXPLORER_URL}/tx/${replacementHash}`;
            update({
              hash: replacementHash,
              explorerUrl: replacementExplorerUrl,
              message:
                replacement.reason === "repriced"
                  ? "The wallet repriced this transaction. Waiting for the replacement confirmation."
                  : "The wallet submitted a different replacement transaction. Checking its receipt.",
            });
            mutateStoredPendingTransactions((current) =>
              replacement.reason === "repriced"
                ? replacePendingTapTabTransactionHash(
                    current,
                    persistedScope,
                    previousHash,
                    replacementHash,
                  )
                : removePendingTapTabTransaction(
                    current,
                    persistedScope,
                    previousHash,
                  ),
            );
          },
        });
        if (replacementReason === "cancelled" || replacementReason === "replaced") {
          update({
            status: "error",
            message:
              replacementReason === "cancelled"
                ? "The wallet cancelled this transaction with a replacement. No TapTab confirmation was recorded."
                : "The wallet replaced this transaction with a different action. No TapTab confirmation was recorded; review the replacement in MonadVision.",
          });
          releaseTransactionLock();
          return false;
        }
        if (receipt.status !== "success") {
          if (trackedHash) {
            mutateStoredPendingTransactions((current) =>
              removePendingTapTabTransaction(current, persistedScope, trackedHash!),
            );
          }
          update({
            status: "error",
            message: "Monad confirmed that the transaction reverted. No TapTab state changed.",
          });
          releaseTransactionLock();
          return false;
        }
        const confirmedAt = Date.now();
        const confirmationMs = Math.max(0, confirmedAt - submittedAt);
        const confirmedHash = trackedHash ?? hash;
        const confirmedExplorerUrl = `${EXPLORER_URL}/tx/${confirmedHash}`;
        mutateStoredPendingTransactions((current) =>
          removePendingTapTabTransaction(current, persistedScope, confirmedHash),
        );
        update({
          status: "confirmed",
          hash: confirmedHash,
          explorerUrl: confirmedExplorerUrl,
          blockNumber: receipt.blockNumber,
          confirmedAt,
          confirmationMs,
          message: undefined,
        });
        const confirmation: TapTabLiveEvent = {
          id: `transaction:${confirmedHash}`,
          source: "transaction",
          title: `${action} confirmed`,
          detail: `Confirmed in ${confirmationDurationLabel(confirmationMs)} · block ${receipt.blockNumber}`,
          tone: "positive",
          transactionHash: confirmedHash,
          blockNumber: receipt.blockNumber,
          explorerUrl: confirmedExplorerUrl,
          confirmationMs,
        };
        setScopedEvents((current) => {
          if (activeContextScope.current !== contextScope) return current;
          return {
            scope: contextScope,
            value: mergeEvents(
              current.scope === contextScope ? current.value : [],
              [confirmation],
            ),
          };
        });
        await refresh(true);
        releaseTransactionLock();
        return true;
      } catch (error) {
        if (stage === "preflight") {
          const message = describeTapTabPreflightError(error);
          update({
            status: "blocked",
            message,
            preflight: { status: "blocked", message },
          });
        } else if (stage === "submitted") {
          if (
            trackedHash &&
            (replacementReason === "cancelled" || replacementReason === "replaced")
          ) {
            update({
              status: "error",
              message:
                replacementReason === "cancelled"
                  ? "The wallet cancelled this transaction with a replacement. No TapTab confirmation was recorded."
                  : "The wallet replaced this transaction with a different action. No TapTab confirmation was recorded; review the replacement in MonadVision.",
            });
          } else if (trackedHash) {
            update({
              status: "unverified",
              hash: trackedHash,
              explorerUrl: `${EXPLORER_URL}/tx/${trackedHash}`,
              message: await describePendingReceiptError(publicClient, error, trackedHash),
            });
          } else {
            update({ status: "unverified", message: describeTapTabSubmittedError(error) });
          }
        } else {
          update({ status: "error", message: describeTapTabWalletError(error) });
        }
        releaseTransactionLock();
        return false;
      }
    },
    [
      context,
      contextScope,
      pendingTransactionScope,
      publicClient,
      refresh,
      transactionScope,
      wallet,
    ],
  );

  const recheckTransaction = useCallback(
    async (transaction: LiveTransaction) => {
      if (
        !context ||
        !pendingTransactionScope ||
        !transactionScope ||
        !transaction.hash ||
        transaction.status !== "unverified" ||
        activeContextScope.current !== contextScope ||
        activeTransactionScope.current !== transactionScope
      ) {
        return;
      }
      const existingLock = transactionInFlight.current;
      if (existingLock?.scope === transactionScope) return;
      transactionInFlight.current = { scope: transactionScope, id: transaction.id };
      const persistedScope = pendingTransactionScope;
      const update = (changes: Partial<LiveTransaction>) =>
        setScopedTransactions((current) => {
          if (
            activeTransactionScope.current !== transactionScope ||
            current.scope !== transactionScope
          ) {
            return current;
          }
          return {
            scope: transactionScope,
            value: current.value.map((currentTransaction) =>
              currentTransaction.id === transaction.id
                ? { ...currentTransaction, ...changes }
                : currentTransaction,
            ),
          };
        });
      const release = () => {
        if (
          transactionInFlight.current?.scope === transactionScope &&
          transactionInFlight.current.id === transaction.id
        ) {
          transactionInFlight.current = undefined;
          setTransactionResumeRevision((current) => current + 1);
        }
      };

      const originalHash = transaction.hash;
      let trackedHash = originalHash;
      let replacementReason: "cancelled" | "replaced" | "repriced" | undefined;
      update({ status: "pending", message: undefined, restored: false });
      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: originalHash,
          timeout: TRANSACTION_RECEIPT_TIMEOUT_MS,
          checkReplacement: true,
          onReplaced(replacement) {
            const previousHash = trackedHash;
            trackedHash = replacement.transaction.hash;
            replacementReason = replacement.reason;
            update({
              hash: trackedHash,
              explorerUrl: `${EXPLORER_URL}/tx/${trackedHash}`,
              message:
                replacement.reason === "repriced"
                  ? "The wallet repriced this transaction. Waiting for the replacement confirmation."
                  : "The wallet submitted a different replacement transaction. Checking its receipt.",
            });
            mutateStoredPendingTransactions((current) =>
              replacement.reason === "repriced"
                ? replacePendingTapTabTransactionHash(
                    current,
                    persistedScope,
                    previousHash,
                    trackedHash,
                  )
                : removePendingTapTabTransaction(
                    current,
                    persistedScope,
                    previousHash,
                  ),
            );
          },
        });
        if (replacementReason === "cancelled" || replacementReason === "replaced") {
          update({
            status: "error",
            message:
              replacementReason === "cancelled"
                ? "The wallet cancelled this transaction with a replacement. No TapTab confirmation was recorded."
                : "The wallet replaced this transaction with a different action. No TapTab confirmation was recorded; review the replacement in MonadVision.",
          });
          return;
        }
        if (receipt.status !== "success") {
          mutateStoredPendingTransactions((current) =>
            removePendingTapTabTransaction(current, persistedScope, trackedHash),
          );
          update({
            status: "error",
            message: "Monad confirmed that the transaction reverted. No TapTab state changed.",
          });
          return;
        }
        const confirmedAt = Date.now();
        const submittedAt = transaction.submittedAt ?? confirmedAt;
        const confirmationMs = Math.max(0, confirmedAt - submittedAt);
        const explorerUrl = `${EXPLORER_URL}/tx/${trackedHash}`;
        mutateStoredPendingTransactions((current) =>
          removePendingTapTabTransaction(current, persistedScope, trackedHash),
        );
        update({
          status: "confirmed",
          hash: trackedHash,
          blockNumber: receipt.blockNumber,
          confirmedAt,
          confirmationMs,
          explorerUrl,
          message: undefined,
        });
        setScopedEvents((current) => {
          if (activeContextScope.current !== contextScope) return current;
          return {
            scope: contextScope,
            value: mergeEvents(
              current.scope === contextScope ? current.value : [],
              [
                {
                  id: `transaction:${trackedHash}`,
                  source: "transaction",
                  title: `${transaction.action} confirmed`,
                  detail: `Confirmed in ${confirmationDurationLabel(confirmationMs)} · block ${receipt.blockNumber}`,
                  tone: "positive",
                  transactionHash: trackedHash,
                  blockNumber: receipt.blockNumber,
                  explorerUrl,
                  confirmationMs,
                },
              ],
            ),
          };
        });
        await refresh(true);
      } catch (error) {
        if (replacementReason === "cancelled" || replacementReason === "replaced") {
          update({
            status: "error",
            message:
              replacementReason === "cancelled"
                ? "The wallet cancelled this transaction with a replacement. No TapTab confirmation was recorded."
                : "The wallet replaced this transaction with a different action. No TapTab confirmation was recorded; review the replacement in MonadVision.",
          });
        } else {
          update({
            status: "unverified",
            hash: trackedHash,
            explorerUrl: `${EXPLORER_URL}/tx/${trackedHash}`,
            message: await describePendingReceiptError(publicClient, error, trackedHash),
          });
        }
      } finally {
        release();
      }
    },
    [
      context,
      contextScope,
      pendingTransactionScope,
      publicClient,
      refresh,
      transactionScope,
    ],
  );

  useEffect(() => {
    if (
      !active ||
      !documentVisible ||
      !transactionScope ||
      transactionInFlight.current?.scope === transactionScope
    ) {
      return;
    }
    const transaction = transactions.find(
      (candidate) =>
        candidate.restored &&
        candidate.status === "unverified" &&
        candidate.hash &&
        !automaticallyResumedTransactions.current.has(
          `${transactionScope}:${candidate.hash.toLowerCase()}`,
        ),
    );
    if (!transaction?.hash) return;

    const resumeKey = `${transactionScope}:${transaction.hash.toLowerCase()}`;
    automaticallyResumedTransactions.current.add(resumeKey);
    const resume = window.setTimeout(() => void recheckTransaction(transaction), 0);
    return () => window.clearTimeout(resume);
  }, [
    active,
    documentVisible,
    recheckTransaction,
    transactionResumeRevision,
    transactionScope,
    transactions,
  ]);

  const transactionBusy = transactions.some(
    (transaction) =>
      transaction.status === "preflight" ||
      transaction.status === "awaiting-wallet" ||
      transaction.status === "pending" ||
      transaction.status === "unverified",
  );
  const tipVoteBps = parseTipPercentToBps(tipPercent);
  const participantByAddress = useMemo(
    () =>
      new Map(
        (snapshot?.participants ?? []).map((participant) => [
          participant.address.toLowerCase(),
          participant,
        ]),
      ),
    [snapshot?.participants],
  );
  const privateNameByAddress = useMemo(
    () =>
      new Map(
        privateNamesForBill.map(({ address, name }) => [address.toLowerCase(), name]),
      ),
    [privateNamesForBill],
  );
  const activeAccount =
    callbackSnapshot?.account && sameAddress(callbackSnapshot.account.address, wallet.account)
      ? callbackSnapshot.account
      : undefined;

  const paymentLinkContext = useMemo<TrustedParticipantLinkContext | undefined>(() => {
    if (!browserLocation || !context || !snapshot || snapshot.participants.length === 0) {
      return undefined;
    }
    return {
      origin: browserLocation.origin,
      pathname: browserLocation.pathname,
      contractAddress: context.address,
      billId: context.billId,
      participantAddresses: snapshot.participants.map((participant) => participant.address),
    };
  }, [browserLocation, context, snapshot]);
  const paymentShareLinkContext = useMemo<TrustedParticipantLinkContext | undefined>(() => {
    if (!paymentLinkContext) return undefined;
    return { ...paymentLinkContext, pathname: "/pay" };
  }, [paymentLinkContext]);
  const inboundPayRequested = browserLocation?.searchParams.has("pay") ?? false;
  const inboundPaymentResolution = useMemo(() => {
    if (!inboundPayRequested || !locationHref || !snapshot) return undefined;
    if (!paymentLinkContext) {
      return {
        status: "rejected" as const,
        reason: "Payment link ignored because this bill has no trusted joined participant.",
      };
    }
    try {
      return resolveParticipantPaymentUrl(locationHref, paymentLinkContext);
    } catch {
      return {
        status: "rejected" as const,
        reason: "Payment link could not be validated against this bill.",
      };
    }
  }, [inboundPayRequested, locationHref, paymentLinkContext, snapshot]);
  const trustedInboundBeneficiary =
    inboundPaymentResolution?.status === "trusted"
      ? getAddress(inboundPaymentResolution.participantAddress)
      : undefined;
  const paymentSelectionScope = context
    ? `${context.address.toLowerCase()}:${context.billId.toString()}:${trustedInboundBeneficiary?.toLowerCase() ?? "default"}`
    : "";
  const manuallyChosenBeneficiary =
    chosenBeneficiary?.scope === paymentSelectionScope &&
    participantByAddress.has(chosenBeneficiary.address.toLowerCase())
      ? chosenBeneficiary.address
      : undefined;
  const beneficiary =
    manuallyChosenBeneficiary
      ? manuallyChosenBeneficiary
      : trustedInboundBeneficiary &&
          participantByAddress.has(trustedInboundBeneficiary.toLowerCase())
        ? trustedInboundBeneficiary
      : activeAccount?.participant.joined
        ? activeAccount.address
        : snapshot?.participants[0]?.address;
  const selectedBeneficiary = beneficiary
    ? participantByAddress.get(beneficiary.toLowerCase())
    : undefined;
  const selectedPaymentPrincipalWei =
    snapshot?.phase === "funding" && selectedBeneficiary
      ? selectedBeneficiary.remainingDue
      : 0n;
  const walletBalanceWei = walletSession.balanceWei;
  const walletPrincipalShortfallWei =
    walletBalanceWei !== undefined && selectedPaymentPrincipalWei > walletBalanceWei
      ? selectedPaymentPrincipalWei - walletBalanceWei
      : 0n;
  const walletNeedsFaucet =
    walletBalanceWei !== undefined &&
    (walletBalanceWei === 0n ||
      (selectedPaymentPrincipalWei > 0n && walletBalanceWei <= selectedPaymentPrincipalWei));
  const paymentAnchorKey =
    inboundPaymentResolution?.status === "trusted" && context
      ? `${context.address.toLowerCase()}:${context.billId.toString()}:${inboundPaymentResolution.participantAddress.toLowerCase()}`
      : undefined;

  useEffect(() => {
    if (!onPaymentLinkState) return;

    if (!locationHref) {
      onPaymentLinkState({ status: "checking" });
      return;
    }
    if (queryResolution.status !== "trusted") {
      onPaymentLinkState({
        status: "rejected",
        reason:
          queryResolution.status === "rejected"
            ? queryResolution.reason
            : "This build does not have a trusted live contract configured.",
      });
      return;
    }
    if (!inboundPayRequested) {
      onPaymentLinkState({
        status: "rejected",
        reason: "This route needs a personal payment link containing a beneficiary.",
      });
      return;
    }
    if (readState === "error" && !snapshot) {
      onPaymentLinkState({
        status: "rejected",
        reason: "The linked bill could not be verified from the trusted contract.",
      });
      return;
    }
    if (!snapshot || !inboundPaymentResolution) {
      onPaymentLinkState({ status: "checking" });
      return;
    }
    if (inboundPaymentResolution.status === "trusted") {
      onPaymentLinkState({
        status: "trusted",
        participantAddress: getAddress(inboundPaymentResolution.participantAddress),
      });
      return;
    }
    onPaymentLinkState({
      status: "rejected",
      reason: inboundPaymentResolution.reason,
    });
  }, [
    inboundPayRequested,
    inboundPaymentResolution,
    locationHref,
    onPaymentLinkState,
    queryResolution,
    readState,
    snapshot,
  ]);

  useEffect(() => {
    if (!paymentAnchorKey || browserLocation?.hash !== "#pay") return;
    const frame = window.requestAnimationFrame(() => {
      const paymentPanel = document.getElementById("pay");
      paymentPanel?.focus({ preventScroll: true });
      paymentPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [browserLocation?.hash, paymentAnchorKey]);
  const isCreator = Boolean(
    callbackSnapshot && sameAddress(wallet.account, callbackSnapshot.bill.creator),
  );
  const isPayee = Boolean(
    callbackSnapshot && sameAddress(wallet.account, callbackSnapshot.bill.payee),
  );
  const deadlinePassed = snapshot
    ? snapshot.chainTimestamp >= snapshot.bill.deadline
    : false;
  const fullyFunded = Boolean(
    snapshot && snapshot.bill.totalDue > 0n && snapshot.bill.totalFunded === snapshot.bill.totalDue,
  );
  const progress = snapshot
    ? fundingPercentage(snapshot.bill.totalFunded, snapshot.bill.totalDue)
    : 0;
  const activeDraftClaimedWei =
    snapshot?.phase === "draft" && activeAccount?.participant.joined
      ? snapshot.items.reduce(
          (billTotal, item) =>
            billTotal +
            item.owners.reduce((itemTotal, owner, shareIndex) => {
              if (!sameAddress(owner, activeAccount.address)) return itemTotal;
              const shareCount = BigInt(item.shareCount);
              const shareValue =
                item.amount / shareCount +
                (BigInt(shareIndex) < item.amount % shareCount ? 1n : 0n);
              return itemTotal + shareValue;
            }, 0n),
          0n,
        )
      : undefined;
  const inviteBatch = validateInviteBatch(inviteAddress);
  const alreadyJoinedInvite = inviteBatch.addresses.find((address) =>
    participantByAddress.has(address.toLowerCase()),
  );
  const inviteBatchError =
    inviteBatch.error ??
    (alreadyJoinedInvite
      ? `${participantLabel(alreadyJoinedInvite)} is already joined. Nothing will be submitted.`
      : undefined);
  const validInviteBatch =
    inviteBatch.addresses.length > 0 && inviteBatchError === undefined;

  const claimSelectionScope =
    context &&
    snapshot?.phase === "draft" &&
    activeAccount?.participant.joined &&
    sameAddress(context.address, snapshot.context.address) &&
    context.billId === snapshot.context.billId
      ? `${context.address.toLowerCase()}:${context.billId.toString()}:${activeAccount.address.toLowerCase()}`
      : "";
  const availableClaimKeys = useMemo(() => {
    if (snapshot?.phase !== "draft" || !activeAccount?.participant.joined) return [];
    return snapshot.items.flatMap((item) =>
      item.owners.flatMap((owner, shareIndex) =>
        !owner || owner.toLowerCase() === ZERO_ADDRESS
          ? [claimSelectionKey(item.index, shareIndex)]
          : [],
      ),
    );
  }, [activeAccount?.participant.joined, snapshot]);
  const availableClaimKeySet = useMemo(
    () => new Set(availableClaimKeys),
    [availableClaimKeys],
  );
  const selectedClaimKeys =
    claimSelection.scope === claimSelectionScope
      ? claimSelection.keys.filter((key) => availableClaimKeySet.has(key))
      : [];

  useEffect(() => {
    let cancelled = false;
    const available = new Set(availableClaimKeys);
    queueMicrotask(() => {
      if (cancelled) return;
      setClaimSelection((current) => {
        const nextKeys =
          current.scope === claimSelectionScope && claimSelectionScope
            ? current.keys
                .filter((key) => available.has(key))
                .slice(0, MAX_TAPTAB_TOTAL_SHARES)
            : [];
        if (
          current.scope === claimSelectionScope &&
          current.keys.length === nextKeys.length &&
          current.keys.every((key, index) => key === nextKeys[index])
        ) {
          return current;
        }
        return { scope: claimSelectionScope, keys: nextKeys };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [availableClaimKeys, claimSelectionScope]);

  const unanimousSplitApproval = Boolean(
    snapshot &&
      snapshot.splitStatus.requiredApprovals > 0 &&
      snapshot.splitStatus.approvalCount === snapshot.splitStatus.requiredApprovals,
  );
  const ownsItemShares = Boolean(
    activeAccount?.participant.joined &&
      snapshot?.items.some((item) =>
        item.owners.some((owner) => sameAddress(owner, activeAccount.address)),
      ),
  );
  const leaveCandidates = (snapshot?.participants ?? []).filter(
    (participant) => !sameAddress(participant.address, activeAccount?.address),
  );
  const validLeaveRecipient =
    leaveRecipient &&
    leaveCandidates.some((participant) => sameAddress(participant.address, leaveRecipient))
      ? leaveRecipient
      : undefined;
  const selectedLeaveRecipient = validLeaveRecipient
    ? validLeaveRecipient
    : ownsItemShares
      ? undefined
      : ZERO_ADDRESS;
  const canLeaveDraft = Boolean(
    snapshot?.phase === "draft" &&
      activeAccount?.participant.joined &&
      (!ownsItemShares || selectedLeaveRecipient !== ZERO_ADDRESS),
  );

  const selectedPaymentUrl = useMemo(() => {
    if (snapshot?.phase !== "funding" || !paymentShareLinkContext || !selectedBeneficiary) {
      return undefined;
    }
    try {
      return buildParticipantPaymentUrl(paymentShareLinkContext, selectedBeneficiary.address);
    } catch {
      return undefined;
    }
  }, [paymentShareLinkContext, selectedBeneficiary, snapshot?.phase]);
  const selectedWhatsAppUrl = useMemo(() => {
    if (snapshot?.phase !== "funding" || !paymentShareLinkContext || !selectedBeneficiary) {
      return undefined;
    }
    try {
      return buildWhatsAppPaymentShareUrl(paymentShareLinkContext, selectedBeneficiary.address);
    } catch {
      return undefined;
    }
  }, [paymentShareLinkContext, selectedBeneficiary, snapshot?.phase]);

  const confirmedSettlementEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          event.source === "chain" &&
          Boolean(event.transactionHash) &&
          (event.eventName === "ContributionReceived" || event.eventName === "BillSettled"),
      ),
    [events],
  );
  const venueSettlementInput = useMemo<VenueSettlementRecordInput | undefined>(() => {
    if (
      !snapshot ||
      snapshot.phase !== "settled" ||
      !metadata ||
      !gbpDisplay?.participants ||
      gbpDisplay.tipPence === undefined ||
      gbpDisplay.totalDuePence === undefined ||
      !fullyFunded ||
      !confirmedSettlementEvents.some((event) => event.eventName === "BillSettled")
    ) {
      return undefined;
    }
    if (
      snapshot.participants.some(
        (participant) => participant.amountFunded !== participant.amountDue,
      )
    ) {
      return undefined;
    }

    const transactionHashes = Array.from(
      new Set(
        confirmedSettlementEvents.flatMap((event) =>
          event.transactionHash ? [event.transactionHash.toLowerCase()] : [],
        ),
      ),
    );
    if (transactionHashes.length === 0) return undefined;

    const allocations = snapshot.participants.map((participant) => {
      const key = participant.address.toLowerCase();
      const participantPence = participantDisplayPenceByAddress.get(key);
      if (!participantPence) {
        throw new Error("A participant could not be matched to the GBP allocation.");
      }
      const participantHashes = Array.from(
        new Set(
          confirmedSettlementEvents.flatMap((event) =>
            event.eventName === "ContributionReceived" &&
            event.transactionHash &&
            sameAddress(event.beneficiaryAddress, participant.address)
              ? [event.transactionHash.toLowerCase()]
              : [],
          ),
        ),
      );
      const privateName = privateNameByAddress.get(key);
      return {
        walletAddress: participant.address,
        baseDuePence: participantPence.baseDuePence,
        tipPence: participantPence.tipPence,
        totalDuePence: participantPence.totalDuePence,
        fundedPence: participantPence.totalDuePence,
        transactionHashes: participantHashes,
        ...(privateName ? { privateName } : {}),
      };
    });
    return {
      chainId: TAPTAB_MONAD_TESTNET.id,
      contractAddress: snapshot.context.address,
      billId: snapshot.context.billId,
      currency: "GBP",
      ...(metadata.merchant ? { merchant: metadata.merchant } : {}),
      subtotalPence: metadata.subtotalPence,
      tipPence: gbpDisplay.tipPence,
      totalDuePence: gbpDisplay.totalDuePence,
      fundedPence: gbpDisplay.totalDuePence,
      allocations,
      transactionHashes,
    };
  }, [
    confirmedSettlementEvents,
    fullyFunded,
    gbpDisplay,
    metadata,
    participantDisplayPenceByAddress,
    privateNameByAddress,
    snapshot,
  ]);
  const liveSettlementReceipt = useMemo<TapTabSettlementReceiptInput | undefined>(() => {
    if (!snapshot || !venueSettlementInput || !shareUrl || !quote) return undefined;
    const settlementEvent = confirmedSettlementEvents.find(
      (event) =>
        event.eventName === "BillSettled" &&
        event.transactionHash &&
        event.blockNumber !== undefined &&
        event.explorerUrl,
    );
    if (
      !settlementEvent?.transactionHash ||
      settlementEvent.blockNumber === undefined ||
      !settlementEvent.explorerUrl
    ) {
      return undefined;
    }

    const sponsorshipAllocations = allocateTapTabSponsorshipPence(
      venueSettlementInput.allocations.flatMap((allocation) => {
        const participant = snapshot.participants.find((candidate) =>
          sameAddress(candidate.address, allocation.walletAddress),
        );
        return participant
          ? [
              {
                key: allocation.walletAddress.toLowerCase(),
                totalDueWei: participant.amountDue,
                totalDuePence: allocation.totalDuePence,
              },
            ]
          : [];
      }),
      confirmedSettlementEvents.flatMap((event) =>
        event.eventName === "ContributionReceived" &&
        event.payerAddress &&
        event.beneficiaryAddress &&
        event.amountWei !== undefined
          ? [
              {
                key: event.id,
                payerKey: event.payerAddress.toLowerCase(),
                beneficiaryKey: event.beneficiaryAddress.toLowerCase(),
                amountWei: event.amountWei,
              },
            ]
          : [],
      ),
    );
    if (
      !sponsorshipAllocations ||
      sponsorshipAllocations.length !== venueSettlementInput.allocations.length
    ) {
      return undefined;
    }
    const sponsorshipByAddress = new Map(
      sponsorshipAllocations.map((allocation) => [allocation.key, allocation]),
    );
    const allocations = venueSettlementInput.allocations.flatMap((allocation, index) => {
      const sponsorship = sponsorshipByAddress.get(allocation.walletAddress.toLowerCase());
      return sponsorship
        ? [
            {
              id: allocation.walletAddress,
              displayName: allocation.privateName ?? `Diner ${index + 1}`,
              walletAddress: allocation.walletAddress,
              totalDuePence: allocation.totalDuePence,
              selfPaidPence: sponsorship.selfPaidPence,
              sponsoredByOthersPence: sponsorship.sponsoredByOthersPence,
              sponsoredForOthersPence: sponsorship.sponsoredForOthersPence,
            },
          ]
        : [];
    });
    if (allocations.length !== venueSettlementInput.allocations.length) return undefined;

    return {
      merchant: venueSettlementInput.merchant ?? "TapTab venue",
      tableLabel: `Bill ${venueSettlementInput.billId.toString()}`,
      subtotalPence: venueSettlementInput.subtotalPence,
      tipPence: venueSettlementInput.tipPence,
      totalDuePence: venueSettlementInput.totalDuePence,
      fundedPence: venueSettlementInput.fundedPence,
      allocations,
      evidence: {
        kind: "monad",
        chainId: venueSettlementInput.chainId,
        billId: venueSettlementInput.billId,
        transactionHash: settlementEvent.transactionHash,
        blockNumber: settlementEvent.blockNumber,
        explorerUrl: settlementEvent.explorerUrl,
      },
      receiptUrl: shareUrl,
      identityIsPrivate: true,
    };
  }, [
    confirmedSettlementEvents,
    quote,
    shareUrl,
    snapshot,
    venueSettlementInput,
  ]);

  async function copyText(kind: "share" | "wallet" | "payment", value: string) {
    setCopyError(undefined);
    setCopyRecoveryValue(undefined);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? undefined : current)), 1_800);
    } catch {
      setCopied(undefined);
      setCopyRecoveryValue(value);
      setCopyError(
        "The value could not be copied automatically. Select the complete value below and copy it manually.",
      );
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !validInviteBatch) return;
    const count = inviteBatch.addresses.length;
    const confirmed = await submitTransaction(
      `Invite ${count} ${count === 1 ? "participant" : "participants"}`,
      buildInviteManyWrite(context, inviteBatch.addresses),
    );
    if (confirmed) setInviteAddress("");
  }

  function toggleClaimSelection(itemIndex: number, shareIndex: number) {
    if (!claimSelectionScope || transactionBusy) return;
    const key = claimSelectionKey(itemIndex, shareIndex);
    if (!availableClaimKeySet.has(key)) return;
    setClaimSelection((current) => {
      const keys = current.scope === claimSelectionScope ? [...current.keys] : [];
      const existingIndex = keys.indexOf(key);
      if (existingIndex >= 0) {
        keys.splice(existingIndex, 1);
      } else if (keys.length < MAX_TAPTAB_TOTAL_SHARES) {
        keys.push(key);
      }
      return { scope: claimSelectionScope, keys };
    });
  }

  function submitSelectedClaims() {
    if (!context || !claimSelectionScope || selectedClaimKeys.length === 0) return;
    const itemIndexes: bigint[] = [];
    const shareIndexes: bigint[] = [];
    for (const key of selectedClaimKeys) {
      const match = /^(\d+):(\d+)$/.exec(key);
      if (!match) return;
      itemIndexes.push(BigInt(match[1]));
      shareIndexes.push(BigInt(match[2]));
    }
    const count = itemIndexes.length;
    void submitTransaction(
      `Claim ${count} item ${count === 1 ? "share" : "shares"}`,
      buildClaimManyWrite(context, itemIndexes, shareIndexes),
    );
  }

  function savePrivateName(event: FormEvent<HTMLFormElement>, address: Address) {
    event.preventDefault();
    if (!context || privateNameStorageState !== "ready") return;
    const key = address.toLowerCase();
    const draftKey = privateNameDraftKey(address);
    const currentName = privateNameByAddress.get(key) ?? "";
    const draft = privateNameDrafts[draftKey] ?? currentName;
    try {
      const next = upsertPrivateNameMapping(
        privateNameMappings,
        {
          contractAddress: context.address,
          billId: context.billId,
          walletAddress: address,
        },
        draft,
      );
      window.localStorage.setItem(
        PRIVATE_NAME_STORAGE_KEY,
        serialisePrivateNameMappings(next),
      );
      setPrivateNameMappings(next);
      setPrivateNameDrafts((current) => ({ ...current, [draftKey]: draft }));
      setPrivateNameError(undefined);
    } catch (error) {
      setPrivateNameError(describeError(error));
    }
  }

  function downloadVenueSettlement() {
    if (!venueSettlementInput) return;
    try {
      const download = createVenueSettlementDownload(venueSettlementInput, {
        includePrivateNames,
      });
      const url = URL.createObjectURL(
        new Blob([download.text], { type: download.mimeType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = download.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setVenueExportError(undefined);
    } catch (error) {
      setVenueExportError(describeError(error));
    }
  }

  function participantLabel(address: Address): string {
    const privateName = privateNameByAddress.get(address.toLowerCase());
    return privateName
      ? `${privateName} · ${shortTapTabAddress(address)}`
      : shortTapTabAddress(address);
  }

  function privateNameDraftKey(address: Address): string {
    return context
      ? `${context.address.toLowerCase()}:${context.billId.toString()}:${address.toLowerCase()}`
      : address.toLowerCase();
  }

  const venueExportUnavailableReason =
    snapshot?.phase !== "settled"
      ? undefined
      : !metadata || !quote
        ? "A verified GBP receipt is required before a venue record can be exported."
        : !fullyFunded
          ? "The settlement record stays locked until the bill is fully funded."
          : !confirmedSettlementEvents.some((event) => event.eventName === "BillSettled")
            ? "Waiting for the confirmed Monad settlement event before export."
            : !venueSettlementInput
              ? "The onchain participant ledger could not be reconciled to exact GBP pennies."
              : undefined;

  const shellClassName = ["taptab-live-panel", className].filter(Boolean).join(" ");

  if (!locationHref) {
    return (
      <section id="live" className={shellClassName} aria-busy="true">
        <span className="section-kicker">Monad Testnet</span>
        <h2>Checking the live bill</h2>
        <p>Validating the shared contract before loading any bill data.</p>
      </section>
    );
  }

  if (queryResolution.status === "unavailable") {
    return (
      <section id="live" className={shellClassName}>
        <span className="section-kicker">Live contract</span>
        <h2>Live mode is not configured</h2>
        <p>A public TapTab bill has not been connected to this local build.</p>
        <Link className="lock-button live-sample-return" href="/?workspace=preview&preview=table-7#bill">
          Open the sample bill
        </Link>
        <details className="live-setup-details">
          <summary>Technical setup details</summary>
          <p>{queryResolution.reason}</p>
          <dl className="live-setup-list">
            <div>
              <dt>Contract</dt>
              <dd>NEXT_PUBLIC_TAPTAB_ADDRESS</dd>
            </div>
            <div>
              <dt>Bill</dt>
              <dd>NEXT_PUBLIC_TAPTAB_BILL_ID</dd>
            </div>
          </dl>
        </details>
        <p className="live-honesty-note">
          No onchain confirmations are shown until both deployment values are valid.
        </p>
      </section>
    );
  }

  if (queryResolution.status === "rejected") {
    return (
      <section id="live" className={`${shellClassName} live-security-card`} role="alert">
        <span className="section-kicker">Link blocked</span>
        <h2>This bill link is not trusted</h2>
        <p>{queryResolution.reason}</p>
        <p>Open TapTab without the contract and bill query parameters to use the deployment pinned into this build.</p>
      </section>
    );
  }

  const trustedContext = queryResolution.context;
  const liveRoleLabel = !wallet.account
    ? "No wallet connected"
    : isCreator && isPayee
      ? "Bill creator and venue payee"
      : isCreator
        ? "Bill creator"
        : isPayee
          ? "Venue payee"
          : activeAccount?.participant.joined
            ? "Joined diner"
            : activeAccount?.invited
              ? "Invited diner"
              : "Connected viewer";
  const personalAmountWei =
    snapshot && activeAccount
      ? snapshot.phase === "cancelled" || snapshot.phase === "expired"
        ? activeAccount.claimableRefund
        : activeAccount.participant.joined
          ? snapshot.phase === "draft"
            ? activeDraftClaimedWei
            : snapshot.phase === "funding"
              ? activeAccount.remainingDue
              : activeAccount.participant.amountDue
          : undefined
      : undefined;
  const personalAmountLabel =
    snapshot?.phase === "draft"
      ? "Your claimed items so far"
      : snapshot?.phase === "funding"
        ? "Your exact amount still to fund"
        : snapshot?.phase === "cancelled" || snapshot?.phase === "expired"
          ? "Your claimable refund"
          : "Your final amount";
  const personalAmountNote = !wallet.account
    ? "Connect a wallet to match this bill to you."
    : !activeAccount?.participant.joined && personalAmountWei === undefined
      ? "This wallet has no personal allocation on the bill yet."
      : snapshot?.phase === "draft"
        ? "Claimed shares only; fair remainder and the group tip lock when funding opens."
        : snapshot?.phase === "funding"
          ? "The contract rejects overpayment beyond this remainder."
          : snapshot?.phase === "cancelled" || snapshot?.phase === "expired"
            ? "Only this wallet can claim its recorded contribution."
            : "The amount locked to this wallet in the final split.";

  const livePrimaryTask: LivePrimaryTask = (() => {
    if (!snapshot) {
      return {
        title: "Load the trusted bill",
        detail: "TapTab is reading the current bill before offering an action.",
        label: "Refresh bill",
        action: "refresh-bill",
        disabled: refreshing,
      };
    }
    if (!wallet.enabled) {
      return {
        title: "Inspect this public bill",
        detail: "Wallet actions are not configured in this build, but the public bill remains readable.",
        label: "Refresh public bill",
        action: "refresh-bill",
        disabled: refreshing,
      };
    }
    if (
      wallet.status === "error" &&
      !wallet.ready &&
      !wallet.account &&
      !wallet.provider
    ) {
      return {
        title: "Retry wallet setup",
        detail:
          wallet.setupMessage ??
          "TapTab could not prepare wallet sign-in. No bill action was submitted.",
        label: "Retry wallet setup",
        action: "retry-wallet-setup",
      };
    }
    if (!wallet.account) {
      return {
        title: "Connect to see your part",
        detail: "Connecting identifies your role; it does not submit a transaction or move MON.",
        label: wallet.isConnecting || !wallet.ready
          ? "Preparing wallet…"
          : wallet.onboarding.primaryLabel,
        action: "connect-wallet",
        disabled: wallet.isConnecting || !wallet.ready,
      };
    }
    if (!wallet.provider) {
      return {
        title: "Restore your wallet session",
        detail: "No bill action is available until the account and transaction provider match again.",
        label: "Refresh connection",
        action: "refresh-connection",
      };
    }
    if (walletSession.status === "wrong-network") {
      return {
        title: "Switch to Monad Testnet",
        detail: "The network switch needs wallet confirmation but does not submit a TapTab transaction.",
        label: "Switch network",
        action: "switch-network",
      };
    }
    if (walletSession.status === "switching") {
      return {
        title: "Confirm the network switch",
        detail: "Continue in your wallet. TapTab will recheck the network before enabling bill actions.",
        label: "Waiting for wallet…",
        disabled: true,
      };
    }
    if (walletSession.status === "checking" || walletSession.status === "idle") {
      return {
        title: "Check wallet readiness",
        detail: "TapTab is confirming the network and Testnet MON balance for this account.",
        label: "Check wallet again",
        action: "refresh-wallet-status",
      };
    }
    if (walletSession.status === "error") {
      return {
        title: "Restore wallet readiness",
        detail:
          walletSession.message ??
          "TapTab could not confirm this wallet’s network and Testnet MON balance.",
        label: "Refresh wallet status",
        action: "refresh-wallet-status",
      };
    }
    if (
      (snapshot.phase === "draft" || snapshot.phase === "funding") &&
      deadlinePassed &&
      !fullyFunded
    ) {
      return {
        title: "Record the expired bill",
        detail: "The onchain deadline has passed. Recording expiry unlocks each contributor’s refund path.",
        label: "Record expiry",
        action: "record-expiry",
        disabled: transactionBusy,
      };
    }
    if (snapshot.phase === "draft") {
      if (activeAccount?.invited && !activeAccount.participant.joined) {
        return {
          title: "Join this bill",
          detail: "Choose your fair-remainder and tip preferences before joining onchain.",
          label: "Review and join",
          href: "#live-preferences-title",
        };
      }
      if (
        activeAccount?.participant.joined &&
        !activeAccount.approvedCurrentSplit
      ) {
        if (!ownsItemShares && availableClaimKeys.length > 0) {
          return {
            title: "Claim items before approval",
            detail:
              "Select what you had first. Claiming later changes the split and invalidates every earlier approval.",
            label: "Claim my items",
            href: "#live-items-title",
          };
        }
        return {
          title: "Check and approve your split",
          detail: ownsItemShares
            ? "Review the claimed items and current digest before approving this exact version."
            : "No unclaimed item shares remain. You can still review and approve your zero-item allocation.",
          label: "Review my split",
          href: "#live-approval-title",
        };
      }
      if (isCreator && unanimousSplitApproval) {
        return {
          title: "Open protected payments",
          detail: "Every joined participant approved this exact split. Opening funding locks it onchain.",
          label: "Open funding",
          action: "open-funding",
          disabled: transactionBusy,
        };
      }
      if (isCreator) {
        return {
          title: "Finish the group split",
          detail: `${snapshot.splitStatus.approvalCount} of ${snapshot.splitStatus.requiredApprovals} joined participants approved the current version.`,
          label: "Review host controls",
          href: "#live-host-title",
        };
      }
      if (activeAccount?.participant.joined) {
        return {
          title: "Wait for the group",
          detail: `${snapshot.splitStatus.approvalCount} of ${snapshot.splitStatus.requiredApprovals} joined participants approved the current version.`,
          label: "Review approval progress",
          href: "#live-approval-title",
        };
      }
      return {
        title: "Ask the host to invite you",
        detail: "Only the creator wallet shown by the contract can invite a participant.",
        label: copied === "wallet" ? "Wallet copied" : "Copy my wallet",
        action: "copy-wallet",
      };
    }
    if (snapshot.phase === "funding") {
      if (fullyFunded) {
        return {
          title: "Settle the exact bill",
          detail: "Every participant is fully funded. Settlement is now permissionless.",
          label: "Settle bill",
          action: "settle-bill",
          disabled: transactionBusy,
        };
      }
      if (activeAccount?.participant.joined && activeAccount.remainingDue > 0n) {
        return {
          title: "Pay your part",
          detail: "The payment control sends only your exact remaining native MON amount.",
          label: "Pay my exact remainder",
          href: "#pay",
        };
      }
      return {
        title: "Help finish funding",
        detail: "You can sponsor any joined participant without changing who receives credit.",
        label: "Review remaining payments",
        href: "#pay",
      };
    }
    if (snapshot.phase === "cancelled" || snapshot.phase === "expired") {
      if (activeAccount && activeAccount.claimableRefund > 0n) {
        return {
          title: "Claim your refund",
          detail: "The contract has a recorded contribution available to this wallet.",
          label: "Claim refund",
          action: "claim-refund",
          disabled: transactionBusy,
        };
      }
      return {
        title: "Review the refund state",
        detail: "This wallet has no recorded contribution available to claim.",
        label: "Review refund controls",
        href: "#live-safety-title",
      };
    }
    if (snapshot.phase === "settled" && isPayee && snapshot.proceedsAvailable > 0n) {
      return {
        title: "Withdraw venue proceeds",
        detail: "Only the venue payee wallet recorded by the contract can withdraw these proceeds.",
        label: "Withdraw proceeds",
        action: "withdraw-proceeds",
        disabled: transactionBusy,
      };
    }
    return {
      title: "Review the settled bill",
      detail: "The final receipt is reconciled to confirmed Monad settlement evidence.",
      label: "Review settlement proof",
      href: "#live-settlement-proof",
    };
  })();

  function activateLivePrimaryTask(action: LivePrimaryTaskAction | undefined) {
    switch (action) {
      case "refresh-bill":
        void refresh(true);
        return;
      case "connect-wallet":
        wallet.open();
        return;
      case "retry-wallet-setup":
        wallet.retryInitialisation();
        return;
      case "refresh-connection":
        wallet.refreshConnection();
        return;
      case "switch-network":
        void requestMonadTestnetSwitch();
        return;
      case "refresh-wallet-status":
        void refreshWalletSession();
        return;
      case "record-expiry":
        void submitTransaction("Expire bill", buildExpireWrite(trustedContext));
        return;
      case "copy-wallet":
        if (wallet.account) void copyText("wallet", wallet.account);
        return;
      case "open-funding":
        void submitTransaction(
          "Open funding",
          buildOpenFundingWrite(trustedContext),
        );
        return;
      case "settle-bill":
        void submitTransaction("Settle bill", buildSettleWrite(trustedContext));
        return;
      case "claim-refund":
        void submitTransaction("Claim refund", buildRefundWrite(trustedContext));
        return;
      case "withdraw-proceeds":
        void submitTransaction(
          "Withdraw venue proceeds",
          buildWithdrawWrite(trustedContext),
        );
    }
  }

  return (
    <section id="live" className={shellClassName} aria-labelledby="live-panel-title">
      <header className="live-panel-header">
        <div>
          <span className="section-kicker">Monad Testnet · live bill</span>
          <h2 id="live-panel-title">Your live bill</h2>
          <p>
            See the current bill state, your wallet’s role and the safest next action before
            opening the detailed controls.
          </p>
        </div>
      </header>

      <p className="live-provenance-note" role="note">
        Contract and bill checks verify the code context, not the restaurant or creator’s
        identity. Confirm the venue and bill with your group before joining or paying. Wallet
        addresses, claims and payments are public onchain; local display names stay on this
        device unless you deliberately include them in an export. Testnet MON has no cash
        value.
      </p>

      {readError ? (
        <div className="live-read-error" role="alert">
          <strong>Live data could not be refreshed.</strong>
          <span>{readError}</span>
          {snapshot ? <small>The last successful snapshot remains visible.</small> : null}
        </div>
      ) : null}

      {eventReadError && snapshot ? (
        <div className="live-read-error" role="status">
          <strong>The bill is current; its activity feed is delayed.</strong>
          <span>{eventReadError}</span>
          <small>TapTab will retry the event history after a short backoff.</small>
        </div>
      ) : null}

      {visibleEventWatchIssue && snapshot ? (
        <div className="live-read-error" role="status">
          <strong>Instant activity alerts are temporarily delayed.</strong>
          <span>
            Snapshot polling continues every four seconds, or every second while a
            transaction is pending.
          </span>
          <small>Diagnostic reference: {visibleEventWatchIssue.id}</small>
        </div>
      ) : null}

      {copyError ? (
        <div className="live-read-error" role="alert">
          <strong>Copy failed.</strong>
          <span>{copyError}</span>
          {copyRecoveryValue ? (
            <label className="live-copy-recovery">
              Value to copy
              <input
                type="text"
                readOnly
                value={copyRecoveryValue}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {inboundPaymentResolution?.status === "rejected" ? (
        <div className="live-read-error" role="alert">
          <strong>Payment link ignored.</strong>
          <span>{inboundPaymentResolution.reason}</span>
          <small>The trusted contract and bill remain unchanged. Choose a participant below.</small>
        </div>
      ) : null}

      {!snapshot ? (
        <div className="live-loading-card" aria-busy="true">
          <strong>{readState === "error" ? "Bill unavailable" : "Loading bill from Monad Testnet"}</strong>
          <span>{readState === "error" ? "Check the deployment and RPC, then try again." : "Reading the bill, items and participants."}</span>
        </div>
      ) : (
        <>
          <section
            className="live-control-card live-current-task"
            aria-labelledby="live-current-task-title"
          >
            <div className="live-card-heading">
              <div>
                <span className="section-kicker">
                  {metadata?.merchant ?? "Trusted live bill"} · Bill #
                  {trustedContext.billId.toString()}
                </span>
                <h3 id="live-current-task-title">{livePrimaryTask.title}</h3>
              </div>
              <span className="live-phase-pill" data-phase={snapshot.phase}>
                {tapTabPhaseLabel(snapshot.phase)}
              </span>
            </div>
            <div className="live-account-row">
              <div>
                <span>Wallet identity and role</span>
                <strong>
                  {wallet.account ? participantLabel(wallet.account) : "Not connected"}
                </strong>
                <small>{liveRoleLabel}</small>
              </div>
            </div>
            <div className="live-beneficiary-due">
              <span>{personalAmountLabel}</span>
              {personalAmountWei !== undefined ? (
                <Amount wei={personalAmountWei} quote={quote} />
              ) : (
                <strong>Not allocated</strong>
              )}
            </div>
            <p className="live-action-hint">{personalAmountNote}</p>
            <p className="live-action-hint" id="live-current-task-detail">
              {livePrimaryTask.detail}
            </p>
            {livePrimaryTask.href ? (
              <a
                className="lock-button"
                href={livePrimaryTask.href}
                aria-describedby="live-current-task-detail"
              >
                {livePrimaryTask.label}
              </a>
            ) : (
              <button
                type="button"
                className="lock-button"
                onClick={() => activateLivePrimaryTask(livePrimaryTask.action)}
                disabled={livePrimaryTask.disabled}
                aria-describedby="live-current-task-detail"
              >
                {livePrimaryTask.label}
              </button>
            )}
          </section>

          <details
            className="tool-disclosure live-technical-details"
            id="live-technical-details"
          >
            <summary>
              <span>
                <strong>Bill and contract details</strong>
                <small>Trusted address, bill ID, network and data refresh</small>
              </span>
              <span aria-hidden="true">Open</span>
            </summary>
            <div className="tool-disclosure-content">
              <div className="live-trust-strip">
                <div>
                  <span>Trusted contract</span>
                  <a
                    href={`${EXPLORER_URL}/address/${trustedContext.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortTapTabAddress(trustedContext.address)}
                    <span className="sr-only"> on MonadVision</span>
                  </a>
                </div>
                <div>
                  <span>Bill</span>
                  <strong>#{trustedContext.billId.toString()}</strong>
                </div>
                <div>
                  <span>Network</span>
                  <strong>Monad Testnet</strong>
                </div>
              </div>
              <button
                type="button"
                className="quiet-button"
                onClick={() => void refresh(true)}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing…" : "Refresh bill data"}
              </button>
            </div>
          </details>

          <div className="live-overview-grid">
            <article>
              <span>{metadata?.merchant ?? "Bill total"}</span>
              <Amount wei={snapshot.bill.totalDue || snapshot.bill.subtotal} quote={quote} />
              <small>{snapshot.phase === "draft" ? "Tip is locked when funding opens" : `${formatTipBps(snapshot.bill.lockedTipBps)} group tip included`}</small>
            </article>
            <article>
              <span>Funded</span>
              <Amount wei={snapshot.bill.totalFunded} quote={quote} />
              <small>{progress.toFixed(progress % 1 ? 1 : 0)}% protected</small>
            </article>
            <article>
              <span>{snapshot.phase === "draft" ? "Receipt subtotal" : "Still needed"}</span>
              <Amount
                wei={snapshot.phase === "draft" ? snapshot.bill.subtotal : snapshot.bill.remainingToFund}
                quote={quote}
              />
              <small>
                {snapshot.phase === "draft"
                  ? "Funding has not opened"
                  : fullyFunded
                    ? "Ready to settle"
                    : "Settlement stays locked"}
              </small>
            </article>
            <article>
              <span>Deadline</span>
              <strong>{deadlineLabel(snapshot.bill.deadline)}</strong>
              <small>{deadlinePassed ? "Expiry can now be recorded" : "Refund path activates after this"}</small>
            </article>
          </div>

          <div className="live-progress-wrap">
            <div>
              <strong>Funding protection</strong>
              <span>{fullyFunded ? "Complete" : `${progress.toFixed(1)}% funded`}</span>
            </div>
            <progress max={100} value={progress} aria-label="Bill funding progress">
              {progress}%
            </progress>
            <p>
              The contract rejects settlement until the exact total is funded. It also rejects overpayments.
            </p>
          </div>

          <details className="tool-disclosure live-money-details">
            <summary>
              <span>
                <strong>GBP and MON amount details</strong>
                <small>Receipt quote, scaling and native settlement provenance</small>
              </span>
              <span aria-hidden="true">Open</span>
            </summary>
            <div className="tool-disclosure-content">
              <div className="live-money-note">
                <strong>
              {metadata?.settlement
                ? "Scaled Testnet demo"
                : quote
                  ? "GBP-first receipt"
                  : "Native MON bill"}
                </strong>
                <span>
              {quote && metadata?.settlement && metadata.quote
                ? (
                    <>
                      GBP uses the locked {metadata.quote.source}{" "}
                      {metadata.quote.basis} reference (£{metadata.quote.gbpPerMon} per
                      MON)
                      {quoteObservedLabel(metadata.quote.observedAtUnixSeconds)
                        ? (
                            <>
                              {" "}observed{" "}
                              {quoteObservedLabel(metadata.quote.observedAtUnixSeconds)}
                            </>
                          )
                        : null}
                      {quoteObservedLabel(metadata.quote.lockedAtUnixSeconds)
                        ? ` and fixed ${quoteObservedLabel(metadata.quote.lockedAtUnixSeconds)}`
                        : ""}
                      . Faucet-funded settlement on {metadata.settlement.network} is
                      scaled {metadata.settlement.divisor.toLocaleString("en-GB")}:1.
                      Testnet MON has no cash value.
                    </>
                  )
                : quote
                ? metadata?.quote
                  ? `Pound values use the ${metadata.quote.source} ${metadata.quote.basis} quote fixed when this bill was created${
                      quoteObservedLabel(metadata.quote.observedAtUnixSeconds)
                        ? `, observed ${quoteObservedLabel(metadata.quote.observedAtUnixSeconds)}`
                        : ""
                    }${
                      quoteObservedLabel(metadata.quote.lockedAtUnixSeconds)
                        ? ` and locked ${quoteObservedLabel(metadata.quote.lockedAtUnixSeconds)}`
                        : ""
                    }. Opening funding later locks the approved tip, shares and dues; it does not replace this quote. MON remains the settlement amount. Testnet MON has no cash value.`
                  : "Pound values come from the bill’s own GBP receipt metadata; MON is shown alongside as the settlement amount."
                : metadata && !metadataIsImmutableInline
                  ? "This bill points to changeable remote GBP metadata. TapTab keeps the contract-pinned native MON amounts primary instead of presenting an unlocked conversion."
                : metadata && !metadata.quote
                  ? "This bill’s metadata does not contain a valid locked quote, so TapTab shows the contract-pinned native MON amounts without inventing a GBP conversion."
                : metadataState === "loading"
                  ? "Checking the bill metadata for a GBP receipt. Until verified, all amounts stay in native MON."
                  : metadataState === "error"
                    ? "The GBP receipt is temporarily unreachable. TapTab keeps the verified onchain MON amounts visible without inventing a conversion."
                    : metadataState === "invalid"
                      ? "The published GBP receipt did not pass validation, so TapTab shows native MON and does not trust its conversion."
                      : "This bill does not publish GBP receipt metadata, so TapTab shows native MON and does not invent a conversion."}
                </span>
                {metadataError ? (
                  <small role={metadataState === "error" ? "alert" : "status"}>
                    {metadataError}
                    {metadataState === "error" ? (
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => setMetadataRetryNonce((current) => current + 1)}
                      >
                        Retry receipt metadata
                      </button>
                    ) : null}
                  </small>
                ) : null}
              </div>
            </div>
          </details>

          <div className="live-main-grid">
            <div className="live-control-stack">
              <section className="live-control-card" aria-labelledby="live-wallet-title">
                <div className="live-card-heading">
                  <div>
                    <span className="section-kicker">Your wallet</span>
                    <h3 id="live-wallet-title">Identity and invitation</h3>
                  </div>
                  {wallet.account && wallet.provider ? (
                    <span className="live-connected-dot">Connected</span>
                  ) : null}
                </div>
                {wallet.setupMessage ? (
                  <div className="live-read-error" role="alert">
                    <strong>Wallet action needs attention</strong>
                    <span>{wallet.setupMessage}</span>
                    {wallet.status === "error" && !wallet.ready && wallet.enabled ? (
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={wallet.retryInitialisation}
                      >
                        Retry wallet setup
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {!wallet.enabled ? (
                  <div className="live-invite-request">
                    <strong>Live wallet actions are unavailable in this build</strong>
                    <p>
                      You can still inspect the public bill. The organiser must configure TapTab’s
                      public Reown project before anyone can connect or submit a wallet action.
                    </p>
                  </div>
                ) : !wallet.account ? (
                  <div className="live-invite-request">
                    <strong>Inspect first. Connect only when you are ready to take part.</strong>
                    <p>
                      Email, supported social sign-in and normal EVM wallets are available. Simply
                      connecting does not submit a transaction or move any MON.
                    </p>
                    <div className="live-wallet-actions">
                      <button
                        type="button"
                        className="lock-button"
                        onClick={wallet.open}
                        disabled={wallet.isConnecting || !wallet.ready}
                      >
                        {wallet.isConnecting || !wallet.ready
                          ? "Preparing wallet…"
                          : wallet.onboarding.primaryLabel}
                      </button>
                      {wallet.onboarding.wallets ? (
                        <button
                          type="button"
                          className="quiet-button"
                          onClick={wallet.openWallets}
                          disabled={wallet.isConnecting || !wallet.ready}
                        >
                          Browse compatible wallets
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : !wallet.provider ? (
                  <div className="live-read-error" role="status">
                    <strong>Restoring the wallet session</strong>
                    <span>
                      TapTab remembers the connected account, but its transaction provider is not
                      ready yet. No action is available until both match again.
                    </span>
                    <div className="live-wallet-actions">
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={wallet.refreshConnection}
                      >
                        Refresh connection
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={wallet.openWallets}
                      >
                        Choose another wallet
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="live-account-row">
                      <div>
                        <span>Connected as</span>
                        <strong>{participantLabel(wallet.account)}</strong>
                      </div>
                      <button type="button" className="quiet-button" onClick={() => void wallet.disconnect()}>
                        Disconnect
                      </button>
                    </div>
                    {walletSession.status === "checking" || walletSession.status === "idle" ? (
                      <div className="live-invite-request" role="status">
                        <strong>Checking Monad Testnet</strong>
                        <p>Refreshing the active network and this account’s Testnet MON balance.</p>
                      </div>
                    ) : null}
                    {walletSession.status === "wrong-network" ? (
                      <div className="live-read-error" role="status">
                        <strong>Switch to Monad Testnet</strong>
                        <span>
                          This wallet is on chain {walletSession.chainId ?? "unknown"}. Switching
                          requires your confirmation and does not submit a TapTab transaction.
                        </span>
                        <button
                          type="button"
                          className="quiet-button"
                          onClick={() => void requestMonadTestnetSwitch()}
                        >
                          Switch to Monad Testnet
                        </button>
                      </div>
                    ) : null}
                    {walletSession.status === "switching" ? (
                      <div className="live-invite-request" role="status">
                        <strong>Confirm the network switch in your wallet</strong>
                        <p>No TapTab transaction will be submitted by this switch.</p>
                      </div>
                    ) : null}
                    {walletSession.status === "ready" ? (
                      <div className="live-wallet-readiness" role="status">
                        <div>
                          <span>Monad Testnet balance</span>
                          <strong>{formatMonAmount(walletSession.balanceWei ?? 0n)}</strong>
                        </div>
                        <button
                          type="button"
                          className="quiet-button"
                          onClick={() => {
                            wallet.refreshConnection();
                            void refreshWalletSession();
                          }}
                        >
                          Refresh balance
                        </button>
                      </div>
                    ) : null}
                    {walletSession.status === "error" ? (
                      <div className="live-read-error" role="alert">
                        <strong>Wallet status needs attention</strong>
                        <span>{walletSession.message}</span>
                        <button
                          type="button"
                          className="quiet-button"
                          onClick={() => void refreshWalletSession()}
                        >
                          Refresh wallet status
                        </button>
                      </div>
                    ) : null}
                    {walletNeedsFaucet ? (
                      <div className="live-invite-request" role="note">
                        <strong>More Testnet MON is needed</strong>
                        <p>
                          {walletPrincipalShortfallWei > 0n
                            ? `This wallet is at least ${formatMonAmount(walletPrincipalShortfallWei)} short of the selected payment before the network fee.`
                            : selectedPaymentPrincipalWei > 0n
                              ? "This balance leaves no room for the network fee after the selected payment."
                              : "This wallet has no MON on Monad Testnet."}
                          {" "}Use only the official faucet, then refresh the balance. Testnet MON has no cash value.
                        </p>
                        <div className="live-wallet-actions">
                          <a
                            className="quiet-button"
                            href={TAPTAB_MONAD_TESTNET_FAUCET_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open official Monad faucet
                          </a>
                          <button
                            type="button"
                            className="quiet-button"
                            onClick={() => void refreshWalletSession()}
                          >
                            Refresh balance
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {!activeAccount?.participant.joined && !activeAccount?.invited ? (
                      <div className="live-invite-request">
                        <strong>Ask the host to invite this wallet</strong>
                        <p>The contract only lets the bill creator approve participants. Share your address with the host.</p>
                        <button type="button" className="quiet-button" onClick={() => void copyText("wallet", wallet.account!)}>
                          {copied === "wallet" ? "Wallet copied" : "Copy my wallet"}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </section>

              <section className="live-control-card" aria-labelledby="live-private-names-title">
                <div className="live-card-heading">
                  <div>
                    <span className="section-kicker">Private on this device</span>
                    <h3 id="live-private-names-title">Name your table</h3>
                  </div>
                </div>
                <p className="live-action-hint">
                  Names stay only in this browser, scoped to this exact contract, bill and wallet.
                  They are never written onchain or added to payment links. Venue exports exclude
                  them unless you explicitly opt in.
                </p>
                {privateNameStorageState === "unavailable" ? (
                  <p className="field-error" role="alert">
                    Private browser storage is unavailable. No names have been loaded or saved.
                  </p>
                ) : null}
                <div className="live-action-list">
                  {snapshot.participants.map((participant, index) => {
                    const key = participant.address.toLowerCase();
                    const draftKey = privateNameDraftKey(participant.address);
                    const savedName = privateNameByAddress.get(key) ?? "";
                    return (
                      <form
                        key={participant.address}
                        className="live-inline-form"
                        onSubmit={(event) => savePrivateName(event, participant.address)}
                      >
                        <label htmlFor={`live-private-name-${index}`}>
                          {shortTapTabAddress(participant.address)}
                        </label>
                        <div>
                          <input
                            id={`live-private-name-${index}`}
                            value={privateNameDrafts[draftKey] ?? savedName}
                            onChange={(event) =>
                              setPrivateNameDrafts((current) => ({
                                ...current,
                                [draftKey]: event.target.value,
                              }))
                            }
                            placeholder="e.g. Alex"
                            autoComplete="off"
                            maxLength={40}
                            disabled={privateNameStorageState !== "ready"}
                          />
                          <button
                            type="submit"
                            disabled={privateNameStorageState !== "ready"}
                          >
                            Save
                          </button>
                        </div>
                      </form>
                    );
                  })}
                </div>
                {privateNameError ? (
                  <small className="field-error" role="alert">{privateNameError}</small>
                ) : null}
              </section>

              {snapshot.phase === "draft" ? (
                <section className="live-control-card" aria-labelledby="live-preferences-title">
                  <div className="live-card-heading">
                    <div>
                      <span className="section-kicker">Before the split locks</span>
                      <h3 id="live-preferences-title">Remainder and tip vote</h3>
                    </div>
                  </div>
                  <label className="live-toggle-row">
                    <input
                      type="checkbox"
                      checked={fairRemainder}
                      onChange={(event) => setFairRemainder(event.target.checked)}
                      disabled={!wallet.account || transactionBusy}
                    />
                    <span>
                      <strong>Opt into fair remainder</strong>
                      <small>Only opt-ins share item slots nobody claims.</small>
                    </span>
                  </label>
                  <fieldset className="live-tip-fieldset" disabled={!wallet.account || transactionBusy}>
                    <legend>Your tip vote</legend>
                    <div className="live-tip-presets">
                      {["0", "10", "12.5"].map((value) => (
                        <button
                          type="button"
                          key={value}
                          className={tipPercent === value ? "selected" : ""}
                          aria-pressed={tipPercent === value}
                          onClick={() => setTipPercent(value)}
                        >
                          {value}%
                        </button>
                      ))}
                    </div>
                    <label>
                      Custom percentage
                      <span className="live-percent-input">
                        <input
                          type="number"
                          min="0"
                          max="30"
                          step="0.01"
                          inputMode="decimal"
                          value={tipPercent}
                          onChange={(event) => setTipPercent(event.target.value)}
                          aria-invalid={tipVoteBps === undefined}
                        />
                        <span>%</span>
                      </span>
                    </label>
                    {tipVoteBps === undefined ? <small className="field-error">Enter a tip from 0% to 30%.</small> : null}
                  </fieldset>
                  {activeAccount?.invited && !activeAccount.participant.joined ? (
                    <button
                      type="button"
                      className="lock-button"
                      disabled={tipVoteBps === undefined || transactionBusy}
                      onClick={() => tipVoteBps !== undefined && void submitTransaction("Join bill", buildJoinWrite(trustedContext, fairRemainder, tipVoteBps))}
                    >
                      Join this bill
                    </button>
                  ) : activeAccount?.participant.joined ? (
                    <button
                      type="button"
                      className="lock-button"
                      disabled={tipVoteBps === undefined || transactionBusy}
                      onClick={() => tipVoteBps !== undefined && void submitTransaction("Update preferences", buildPreferencesWrite(trustedContext, fairRemainder, tipVoteBps))}
                    >
                      Save my vote
                    </button>
                  ) : (
                    <p className="live-action-hint">Connect an invited wallet before joining.</p>
                  )}
                </section>
              ) : null}

              {snapshot.phase === "draft" ? (
                <section className="live-control-card" aria-labelledby="live-approval-title">
                  <div className="live-card-heading">
                    <div>
                      <span className="section-kicker">Unanimous lock</span>
                      <h3 id="live-approval-title">
                        Approve split v{snapshot.splitStatus.splitVersion.toString()}
                      </h3>
                    </div>
                    <span>
                      {snapshot.splitStatus.approvalCount} / {snapshot.splitStatus.requiredApprovals}
                    </span>
                  </div>
                  <progress
                    max={Math.max(1, snapshot.splitStatus.requiredApprovals)}
                    value={snapshot.splitStatus.approvalCount}
                    aria-label="Current split approvals"
                  >
                    {snapshot.splitStatus.approvalCount} of {snapshot.splitStatus.requiredApprovals}
                  </progress>
                  <p className="live-action-hint">
                    Digest <code>{shortTapTabAddress(snapshot.splitStatus.currentDigest)}</code>.
                    Every joined person must approve this exact version before funding can open.
                  </p>
                  <ul className="live-event-list">
                    {snapshot.participants.map((participant) => (
                      <li key={participant.address} data-tone={participant.approvedCurrentSplit ? "positive" : "neutral"}>
                        <span className="live-event-dot" aria-hidden="true" />
                        <div>
                          <strong>{participantLabel(participant.address)}</strong>
                          <span>{participant.approvedCurrentSplit ? "Approved this version" : "Waiting for approval"}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {activeAccount?.participant.joined ? (
                    activeAccount.approvedCurrentSplit ? (
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={transactionBusy}
                        onClick={() =>
                          void submitTransaction(
                            "Revoke split approval",
                            buildRevokeSplitApprovalWrite(trustedContext),
                          )
                        }
                      >
                        Revoke my approval
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="lock-button"
                        disabled={transactionBusy}
                        onClick={() =>
                          void submitTransaction(
                            "Approve current split",
                            buildApproveSplitWrite(
                              trustedContext,
                              snapshot.splitStatus.currentDigest,
                            ),
                          )
                        }
                      >
                        Approve this exact split
                      </button>
                    )
                  ) : (
                    <p className="live-action-hint">Join with your invited wallet to approve.</p>
                  )}
                  <p className="live-action-hint">
                    A claim, tip, fair-remainder or membership change creates a new version and
                    clears every approval.
                  </p>
                </section>
              ) : null}

              {snapshot.phase === "draft" && activeAccount?.participant.joined ? (
                <section className="live-control-card" aria-labelledby="live-leave-title">
                  <div className="live-card-heading">
                    <div>
                      <span className="section-kicker">Leave safely</span>
                      <h3 id="live-leave-title">Leave this table</h3>
                    </div>
                  </div>
                  <label htmlFor="live-leave-recipient">
                    {ownsItemShares ? "Transfer all my claimed shares to" : "Optional transfer recipient"}
                  </label>
                  <select
                    id="live-leave-recipient"
                    value={selectedLeaveRecipient ?? ""}
                    onChange={(event) =>
                      setLeaveRecipient(
                        event.target.value === ZERO_ADDRESS
                          ? ZERO_ADDRESS
                          : getAddress(event.target.value),
                      )
                    }
                    disabled={transactionBusy || (ownsItemShares && leaveCandidates.length === 0)}
                  >
                    {ownsItemShares ? (
                      <option value="" disabled>Choose a joined participant</option>
                    ) : null}
                    {!ownsItemShares ? (
                      <option value={ZERO_ADDRESS}>Leave without transferring shares</option>
                    ) : null}
                    {leaveCandidates.map((participant) => (
                      <option key={participant.address} value={participant.address}>
                        {participantLabel(participant.address)}
                      </option>
                    ))}
                  </select>
                  {ownsItemShares && leaveCandidates.length === 0 ? (
                    <p className="field-error">
                      Another joined participant is required before your claimed shares can be transferred.
                    </p>
                  ) : (
                    <p className="live-action-hint">
                      {ownsItemShares
                        ? "This transfers every claimed item share to the selected participant."
                        : "You have no claimed shares, so the contract permits a clean exit."}
                      {" "}Leaving creates a new split version and clears approvals.
                    </p>
                  )}
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={!canLeaveDraft || transactionBusy || !selectedLeaveRecipient}
                    onClick={() =>
                      selectedLeaveRecipient &&
                      void submitTransaction(
                        "Leave table",
                        buildLeaveWrite(trustedContext, selectedLeaveRecipient),
                      )
                    }
                  >
                    Leave table
                  </button>
                </section>
              ) : null}

              {snapshot.phase === "draft" && isCreator ? (
                <section className="live-control-card" aria-labelledby="live-host-title">
                  <div className="live-card-heading">
                    <div>
                      <span className="section-kicker">Host controls</span>
                      <h3 id="live-host-title">Invite wallets together</h3>
                    </div>
                  </div>
                  <form onSubmit={invite} className="live-inline-form">
                    <label htmlFor="live-invite-address">Participant wallets</label>
                    <div>
                      <textarea
                        id="live-invite-address"
                        data-testid="participant-wallets-field"
                        value={inviteAddress}
                        onChange={(event) => setInviteAddress(event.target.value)}
                        placeholder={"0x…\n0x…"}
                        spellCheck={false}
                        autoComplete="off"
                        rows={3}
                        aria-describedby="live-invite-validation"
                        aria-invalid={Boolean(inviteAddress.trim()) && !validInviteBatch}
                        style={{
                          width: "100%",
                          minWidth: 0,
                          minHeight: 72,
                          padding: 10,
                          resize: "vertical",
                          border: "1px solid var(--line-strong)",
                          borderRadius: 8,
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 8,
                        }}
                      />
                      <button type="submit" disabled={!validInviteBatch || transactionBusy}>
                        {validInviteBatch
                          ? `Invite ${inviteBatch.addresses.length}`
                          : "Invite wallets"}
                      </button>
                    </div>
                    <p
                      id="live-invite-validation"
                      className={inviteBatchError ? "field-error" : "live-action-hint"}
                      {...(inviteBatchError ? { role: "alert" } : {})}
                    >
                      {inviteBatchError
                        ? inviteBatchError
                        : inviteBatch.addresses.length > 0
                          ? `${inviteBatch.addresses.length} ${inviteBatch.addresses.length === 1 ? "wallet" : "wallets"} ready. All invitations will use one atomic Monad transaction.`
                          : `Paste 1 to ${MAX_TAPTAB_PARTICIPANTS} wallet addresses separated by commas, spaces or new lines.`}
                    </p>
                  </form>
                </section>
              ) : null}
            </div>

            <section className="live-items-card" aria-labelledby="live-items-title">
              <div className="live-card-heading">
                <div>
                  <span className="section-kicker">Onchain receipt</span>
                  <h3 id="live-items-title">Claim item shares</h3>
                </div>
                <span>{snapshot.items.length} items</span>
              </div>
              <ol className="live-item-list">
                {snapshot.items.map((item) => {
                  const itemAmount = formatTapTabAmount(
                    item.amount,
                    quote,
                    itemDisplayPenceByIndex.get(item.index),
                  );
                  return (
                    <li key={item.index}>
                      <div className="live-item-heading">
                        <div>
                          <strong>{metadata?.items?.[item.index]?.name ?? `Receipt item ${item.index + 1}`}</strong>
                          <span>{item.claimedShareCount} of {item.shareCount} shares claimed</span>
                        </div>
                        <span>
                          <strong>{itemAmount.primary}</strong>
                          {itemAmount.secondary ? <small>{itemAmount.secondary}</small> : null}
                        </span>
                      </div>
                      <div className="live-share-slots" aria-label={`Share slots for item ${item.index + 1}`}>
                        {Array.from({ length: item.shareCount }, (_, shareIndex) => {
                          const owner = item.owners[shareIndex];
                          const isMine = sameAddress(owner, wallet.account);
                          const isFree = !owner || owner.toLowerCase() === ZERO_ADDRESS;
                          const selectionKey = claimSelectionKey(item.index, shareIndex);
                          const isSelected = selectedClaimKeys.includes(selectionKey);
                          const disabled =
                            snapshot.phase !== "draft" ||
                            !claimSelectionScope ||
                            !activeAccount?.participant.joined ||
                            (!isFree && !isMine) ||
                            transactionBusy;
                          return (
                            <button
                              type="button"
                              key={shareIndex}
                              className={isMine || isSelected ? "mine" : isFree ? "free" : "claimed"}
                              disabled={disabled}
                              aria-pressed={isFree ? isSelected : undefined}
                              aria-label={
                                isMine
                                  ? `Release share ${shareIndex + 1} of item ${item.index + 1}`
                                  : isSelected
                                    ? `Remove share ${shareIndex + 1} of item ${item.index + 1} from this claim batch`
                                  : isFree
                                    ? `Select share ${shareIndex + 1} of item ${item.index + 1} for this claim batch`
                                    : `Share ${shareIndex + 1} claimed by ${participantLabel(owner)}`
                              }
                              onClick={() => {
                                if (isMine) {
                                  void submitTransaction(
                                    "Release item share",
                                    buildUnclaimWrite(
                                      trustedContext,
                                      BigInt(item.index),
                                      BigInt(shareIndex),
                                    ),
                                  );
                                } else if (isFree) {
                                  toggleClaimSelection(item.index, shareIndex);
                                }
                              }}
                            >
                              <span>{shareIndex + 1}</span>
                              <small>
                                {isMine
                                  ? "Yours · release"
                                  : isSelected
                                    ? "Selected"
                                    : isFree
                                      ? "Select"
                                      : participantLabel(owner)}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {snapshot.phase === "draft" && activeAccount?.participant.joined ? (
                <div className="live-invite-request">
                  <strong>
                    {selectedClaimKeys.length} of {MAX_TAPTAB_TOTAL_SHARES} share slots selected
                  </strong>
                  <p>
                    Select any free slots, then claim them together in one atomic transaction.
                    Shares already owned by you still release one at a time.
                  </p>
                  <button
                    type="button"
                    className="lock-button"
                    disabled={selectedClaimKeys.length === 0 || transactionBusy}
                    onClick={submitSelectedClaims}
                  >
                    {selectedClaimKeys.length === 0
                      ? "Select shares to claim"
                      : `Claim ${selectedClaimKeys.length} ${selectedClaimKeys.length === 1 ? "share" : "shares"} together`}
                  </button>
                  {ownsItemShares ? (
                    <a className="quiet-button" href="#live-approval-title">
                      Review and approve my updated split
                    </a>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>

          <div
            className={`live-funding-grid ${
              inboundPaymentResolution?.status === "trusted" ? "is-payment-entry" : ""
            }`}
            id="pay"
            tabIndex={-1}
          >
            <section className="live-control-card" aria-labelledby="live-pay-title">
              <div className="live-card-heading">
                <div>
                  <span className="section-kicker">Pay or sponsor</span>
                  <h3 id="live-pay-title">Fund a participant</h3>
                </div>
              </div>
              {inboundPaymentResolution?.status === "trusted" ? (
                <div className="live-fixed-beneficiary">
                  <span>Payment protected for</span>
                  <strong>
                    {participantLabel(getAddress(inboundPaymentResolution.participantAddress))}
                  </strong>
                  <small>The beneficiary is fixed by this trusted link.</small>
                </div>
              ) : (
                <>
                  <label htmlFor="live-beneficiary">Whose remaining share?</label>
                  <select
                    id="live-beneficiary"
                    value={beneficiary ?? ""}
                    onChange={(event) =>
                      setChosenBeneficiary({
                        scope: paymentSelectionScope,
                        address: getAddress(event.target.value),
                      })
                    }
                    disabled={snapshot.phase !== "funding" || transactionBusy}
                  >
                    {snapshot.participants.map((participant) => (
                      <option key={participant.address} value={participant.address}>
                        {sameAddress(participant.address, wallet.account)
                          ? `My share · ${participantLabel(participant.address)}`
                          : participantLabel(participant.address)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {inboundPaymentResolution?.status === "trusted" ? (
                <p className="live-action-hint">
                  Trusted payment link: {participantLabel(getAddress(inboundPaymentResolution.participantAddress))} was preselected.
                </p>
              ) : null}
              {selectedBeneficiary ? (
                <div className="live-beneficiary-due">
                  <span>Remaining</span>
                  <Amount wei={selectedBeneficiary.remainingDue} quote={quote} />
                </div>
              ) : null}
              <button
                type="button"
                className="lock-button"
                disabled={
                  snapshot.phase !== "funding" ||
                  !wallet.account ||
                  !selectedBeneficiary ||
                  selectedBeneficiary.remainingDue <= 0n ||
                  transactionBusy
                }
                onClick={() =>
                  selectedBeneficiary &&
                  void submitTransaction(
                    sameAddress(selectedBeneficiary.address, wallet.account) ? "Pay my share" : "Sponsor participant",
                    buildFundWrite(trustedContext, selectedBeneficiary.address, selectedBeneficiary.remainingDue),
                  )
                }
              >
                {selectedBeneficiary && sameAddress(selectedBeneficiary.address, wallet.account)
                  ? "Pay my exact remainder"
                  : "Cover this person’s remainder"}
              </button>
              {snapshot.phase === "funding" && selectedPaymentUrl ? (
                <div className="live-invite-request">
                  <strong>
                    Personal payment link for {selectedBeneficiary ? participantLabel(selectedBeneficiary.address) : "participant"}
                  </strong>
                  <p>
                    The link contains only this trusted contract, bill and participant address. It cannot switch bill context.
                  </p>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => void copyText("payment", selectedPaymentUrl)}
                  >
                    {copied === "payment" ? "Payment link copied" : "Copy personal payment link"}
                  </button>
                  {selectedWhatsAppUrl ? (
                    <a
                      className="quiet-button"
                      href={selectedWhatsAppUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Share via WhatsApp
                    </a>
                  ) : null}
                </div>
              ) : null}
              <p className="live-action-hint">TapTab sends the exact remaining native MON amount. The contract rejects overfunding.</p>
            </section>

            <section className="live-control-card live-safety-controls" aria-labelledby="live-safety-title">
              <div className="live-card-heading">
                <div>
                  <span className="section-kicker">Protected outcomes</span>
                  <h3 id="live-safety-title">Settle, cancel or recover</h3>
                </div>
              </div>
              <div className="live-action-list">
                {snapshot.phase === "draft" && isCreator ? (
                  <button type="button" disabled={!unanimousSplitApproval || transactionBusy} onClick={() => void submitTransaction("Open funding", buildOpenFundingWrite(trustedContext))}>
                    <span>
                      <strong>Lock the unanimously approved split</strong>
                      <small>
                        {unanimousSplitApproval
                          ? "Everyone approved this exact digest. Opening funding now locks the median tip, shares and participant dues; the bill-creation quote is already fixed."
                          : `${snapshot.splitStatus.approvalCount} of ${snapshot.splitStatus.requiredApprovals} participants approved split v${snapshot.splitStatus.splitVersion.toString()}.`}
                      </small>
                    </span>
                    <span>{unanimousSplitApproval ? "Open funding" : "Waiting"}</span>
                  </button>
                ) : null}
                {snapshot.phase === "funding" ? (
                  <button type="button" disabled={!fullyFunded || transactionBusy} onClick={() => void submitTransaction("Settle bill", buildSettleWrite(trustedContext))}>
                    <span><strong>Settle the bill</strong><small>{fullyFunded ? "Every share is fully funded." : "Locked until the exact total is funded."}</small></span>
                    <span>Settle</span>
                  </button>
                ) : null}
                {(snapshot.phase === "draft" || snapshot.phase === "funding") && isCreator ? (
                  <button type="button" disabled={fullyFunded || transactionBusy} onClick={() => void submitTransaction("Cancel bill", buildCancelWrite(trustedContext))}>
                    <span><strong>Cancel incomplete bill</strong><small>All recorded contributions become refundable.</small></span>
                    <span>Cancel</span>
                  </button>
                ) : null}
                {(snapshot.phase === "draft" || snapshot.phase === "funding") ? (
                  <button type="button" disabled={!deadlinePassed || fullyFunded || transactionBusy} onClick={() => void submitTransaction("Expire bill", buildExpireWrite(trustedContext))}>
                    <span><strong>Record expiry</strong><small>Permissionless after the deadline; unlocks refunds.</small></span>
                    <span>{deadlinePassed ? "Expire" : "Not yet due"}</span>
                  </button>
                ) : null}
                {(snapshot.phase === "cancelled" || snapshot.phase === "expired") ? (
                  <button type="button" disabled={!activeAccount || activeAccount.claimableRefund <= 0n || transactionBusy} onClick={() => void submitTransaction("Claim refund", buildRefundWrite(trustedContext))}>
                    <span><strong>Claim my refund</strong><small>{activeAccount?.claimableRefund ? formatTapTabAmount(activeAccount.claimableRefund, quote).primary : "No contribution is claimable for this wallet."}</small></span>
                    <span>Refund</span>
                  </button>
                ) : null}
                {snapshot.phase === "settled" && isPayee ? (
                  <button type="button" disabled={snapshot.proceedsAvailable <= 0n || transactionBusy} onClick={() => void submitTransaction("Withdraw venue proceeds", buildWithdrawWrite(trustedContext))}>
                    <span><strong>Withdraw settled proceeds</strong><small>{formatTapTabAmount(snapshot.proceedsAvailable, quote).primary} available to the payee.</small></span>
                    <span>Withdraw</span>
                  </button>
                ) : null}
              </div>
            </section>

            <aside className="live-share-card" aria-labelledby="live-share-title">
              <div className="live-card-heading">
                <div>
                  <span className="section-kicker">Join this bill</span>
                  <h3 id="live-share-title">Trusted QR</h3>
                </div>
              </div>
              {shareUrl ? (
                <>
                  <div className="live-qr">
                    <QRCodeSVG value={shareUrl} size={148} marginSize={2} title="QR code for the trusted TapTab bill" />
                  </div>
                  <p>The QR repeats this build’s trusted contract and bill ID. A mismatched link is blocked before data loads.</p>
                  <button type="button" className="quiet-button" onClick={() => void copyText("share", shareUrl)}>
                    {copied === "share" ? "Invite link copied" : "Copy invite link"}
                  </button>
                </>
              ) : null}
            </aside>
          </div>

          {snapshot.phase === "settled" ? (
            <>
              <div id="live-settlement-proof">
                {liveSettlementReceipt ? (
                  <TapTabSettlementReceipt
                    receipt={liveSettlementReceipt}
                    onShare={() => copyText("share", shareUrl)}
                  />
                ) : null}
              </div>
              <details className="tool-disclosure live-settlement-export-details">
                <summary>
                  <span>
                    <strong>Venue settlement export</strong>
                    <small>Optional reconciled JSON hand-off for the venue</small>
                  </span>
                  <span aria-hidden="true">Open</span>
                </summary>
                <div className="tool-disclosure-content">
                  <section className="live-transaction-card" aria-labelledby="live-venue-export-title">
              <div className="live-card-heading">
                <div>
                  <span className="section-kicker">Venue hand-off</span>
                  <h3 id="live-venue-export-title">Verified GBP settlement record</h3>
                </div>
              </div>
              <p>
                Download the reconciled bill totals, each wallet’s base due, tip, total and funded
                amount, plus confirmed Monad transaction hashes.
              </p>
              <label className="live-toggle-row">
                <input
                  type="checkbox"
                  checked={includePrivateNames}
                  onChange={(event) => setIncludePrivateNames(event.target.checked)}
                />
                <span>
                  <strong>Include private display names</strong>
                  <small>
                    Off by default. Turning this on places this device’s private labels in the JSON file.
                  </small>
                </span>
              </label>
              <button
                type="button"
                className="lock-button"
                disabled={!venueSettlementInput}
                onClick={downloadVenueSettlement}
              >
                Download venue JSON
              </button>
              {venueExportUnavailableReason ? (
                <p className="live-action-hint">{venueExportUnavailableReason}</p>
              ) : null}
              {venueExportError ? (
                <small className="field-error" role="alert">{venueExportError}</small>
              ) : null}
                  </section>
                </div>
              </details>
            </>
          ) : null}

          <details className="tool-disclosure live-transaction-history-details">
            <summary>
              <span>
                <strong>Transaction history</strong>
                <small>
                  {transactions.length
                    ? `${transactions.length} wallet ${transactions.length === 1 ? "request" : "requests"}`
                    : "No wallet requests in this session"}
                </small>
              </span>
              <span aria-hidden="true">Open</span>
            </summary>
            <div className="tool-disclosure-content">
              <TransactionStatusList
                transactions={transactions}
                onRecheck={(transaction) => void recheckTransaction(transaction)}
              />
            </div>
          </details>

          <details
            className="tool-disclosure live-activity-details"
            data-testid="confirmed-testnet-activity"
          >
            <summary>
              <span>
                <strong>Confirmed Monad activity</strong>
                <small>
                  {events.length
                    ? `${events.length} confirmed ${events.length === 1 ? "event" : "events"}`
                    : "No recent confirmed events"}
                </small>
              </span>
              <span aria-hidden="true">Open</span>
            </summary>
            <div className="tool-disclosure-content">
              <section className="live-event-card" aria-labelledby="live-events-title">
            <div className="live-card-heading">
              <div>
                <span className="section-kicker">Stage-ready feed</span>
                <h3 id="live-events-title">Confirmed Monad activity</h3>
              </div>
              <span>Last read {new Date(snapshot.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
            {events.length ? (
              <ol className="live-event-list" aria-live="polite">
                {events.map((event) => (
                  <li key={event.id} data-tone={event.tone}>
                    <span className="live-event-dot" aria-hidden="true" />
                    <div>
                      <strong>{event.title}</strong>
                      <span>{event.detail}</span>
                    </div>
                    {event.explorerUrl ? (
                      <a href={event.explorerUrl} target="_blank" rel="noreferrer">
                        {event.blockNumber ? `Block ${event.blockNumber}` : "Explorer"}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="live-empty-feed">No recent TapTab events were found in the current block window. New confirmations will appear here.</p>
            )}
              </section>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

"use client";

import {
  Activity,
  ArrowDown,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  Flame,
  History,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  createWalletClient,
  custom,
  formatEther,
  getAddress,
  isAddress,
  maxUint256,
  numberToHex,
  parseEther,
  parseEventLogs,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MONAD_TESTNET,
  crowdCartAbi,
  deriveDealPhase,
  parseProductMetadata,
  publicClient,
  resolveCrowdCartAddress,
  toDisplayTiers,
  type BuyerSnapshot,
  type DealPhase,
  type DealSnapshot,
  type DisplayTier,
} from "./crowdcart-chain";
import {
  MONAD_TESTNET_CHAIN_ID,
  loadSavedBuyerDeals,
  removeSavedBuyerDeal,
  savedBuyerDealKey,
  updateSavedBuyerDealRefundHash,
  upsertConfirmedJoin,
  type SavedBuyerDeal,
} from "./buyer-storage";
import { useCrowdCartWallet } from "./wallet";
import {
  calculateBufferedGasLimit,
  getWalletReadiness,
  type WalletReadiness,
} from "./wallet-readiness";

type EventfulProvider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

const PREVIEW_TIERS: DisplayTier[] = [
  { buyers: 1, price: parseEther("0.01"), label: "Opening price" },
  { buyers: 2, price: parseEther("0.008"), label: "First drop" },
  { buyers: 4, price: parseEther("0.006"), label: "Crowd price" },
  { buyers: 7, price: parseEther("0.004"), label: "Best price" },
];

const environmentContractAddress = process.env.NEXT_PUBLIC_CROWDCART_ADDRESS;
const configuredContractAddress = resolveCrowdCartAddress(environmentContractAddress);
const demoDealId = BigInt(process.env.NEXT_PUBLIC_CROWDCART_DEAL_ID ?? "1");
const configuredSiteUrl = getPublicSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

const EMPTY_BUYER: BuyerSnapshot = {
  joined: false,
  refundClaimed: false,
  refundAvailable: 0n,
};

const MONAD_FAUCET_URL = "https://faucet.monad.xyz/";

type TxState = "idle" | "wallet" | "confirming" | "success" | "error";
type SyncStatus = "preview" | "loading" | "live" | "stale" | "unavailable";
type FiatStatus = "loading" | "live" | "stale" | "unavailable";

type FiatQuote = {
  usd: number;
  gbp: number;
  lastUpdatedAt: number;
  source: "CoinGecko" | "Coinbase";
  basis: "mainnet MON";
};

type ActivityItem = {
  id: string;
  label: string;
  detail?: string;
  transactionHash?: Hash;
  observedAt: number;
  preview: boolean;
};

type ContractActivityLog = {
  eventName: string;
  args: Record<string, unknown>;
  transactionHash: Hash | null;
  blockNumber: bigint | null;
  logIndex: number | null;
  removed?: boolean;
};

type WalletPreflight = {
  key?: string;
  chainId?: number;
  balanceWei?: bigint;
  gasUnits?: bigint;
  gasLimit?: bigint;
  feePerGasWei?: bigint;
  maxFeePerGasWei?: bigint;
  maxPriorityFeePerGasWei?: bigint;
  gasPriceWei?: bigint;
  checking: boolean;
  unavailable: boolean;
  failure?: string;
};

type WalletSubmissionOptions =
  | {
      gas: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
    }
  | {
      gas: bigint;
      gasPrice: bigint;
    };

function getPublicSiteUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function getInjectedEthereum() {
  return (window as unknown as { ethereum?: EventfulProvider }).ethereum;
}

function formatMon(value: bigint, digits = 3) {
  return Number(formatEther(value)).toFixed(digits);
}

function monNumber(value: bigint) {
  return Number(formatEther(value));
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function formatDate(timestampSeconds: bigint | number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(timestampSeconds) * 1000));
}

function formatFiat(value: number, currency: "GBP" | "USD") {
  const precision = value < 0.01 ? 6 : value < 1 ? 4 : 2;
  return new Intl.NumberFormat(currency === "GBP" ? "en-GB" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
}

function eventTimestamp() {
  return Date.now();
}

function deadlineAfter(seconds: number) {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "shortMessage" in error) {
    return String((error as { shortMessage: unknown }).shortMessage);
  }
  if (error instanceof Error) return error.message;
  return "The transaction could not be completed.";
}

function getWalletSubmissionOptions(
  preflight: WalletPreflight,
): WalletSubmissionOptions | undefined {
  if (preflight.gasLimit === undefined) return undefined;
  if (
    preflight.maxFeePerGasWei !== undefined &&
    preflight.maxPriorityFeePerGasWei !== undefined
  ) {
    return {
      gas: preflight.gasLimit,
      maxFeePerGas: preflight.maxFeePerGasWei,
      maxPriorityFeePerGas: preflight.maxPriorityFeePerGasWei,
    };
  }
  if (preflight.gasPriceWei !== undefined) {
    return {
      gas: preflight.gasLimit,
      gasPrice: preflight.gasPriceWei,
    };
  }
  return undefined;
}

function phaseLabel(phase: DealPhase, previewClosed: boolean) {
  if (phase === "preview") return previewClosed ? "Preview settled" : "Preview activity";
  if (phase === "open") return "Live drop";
  if (phase === "awaiting_finalisation") return "Ready to finalise";
  if (phase === "successful") return "Deal successful";
  if (phase === "cancelled") return "Deal cancelled";
  if (phase === "failed") return "Minimum not reached";
  return "Deal unavailable";
}

function phaseReceiptLabel(phase: DealPhase, buyer: BuyerSnapshot) {
  if (buyer.refundClaimed) return "Refund claimed";
  if (phase === "open") return buyer.joined ? "Deposit locked" : "Not joined";
  if (phase === "awaiting_finalisation") return "Settlement required";
  if (phase === "successful" && buyer.refundAvailable > 0n) return "Refund ready";
  if (phase === "successful") return "Settled";
  if ((phase === "cancelled" || phase === "failed") && buyer.joined) {
    return "Full refund ready";
  }
  return "Not participating";
}

function activityFromLog(
  log: ContractActivityLog,
  dealId: bigint,
  tiers: readonly DisplayTier[],
): ActivityItem | undefined {
  if (log.removed || log.args.dealId !== dealId) return undefined;

  const transactionHash = log.transactionHash ?? undefined;
  const id = `${transactionHash ?? log.blockNumber ?? "pending"}:${log.logIndex ?? 0}`;
  const observedAt = Date.now();

  if (log.eventName === "DealJoined") {
    const buyer = typeof log.args.buyer === "string" ? log.args.buyer : "A buyer";
    const buyerCount = Number(log.args.buyerCount ?? 0);
    const currentPrice =
      typeof log.args.currentPrice === "bigint" ? log.args.currentPrice : 0n;
    const unlockedTier = tiers.some(
      (tier, index) => index > 0 && tier.buyers === buyerCount,
    );
    return {
      id,
      label: unlockedTier
        ? `Price dropped to ${formatMon(currentPrice)} MON`
        : `${isAddress(buyer) ? shortenAddress(buyer) : buyer} joined`,
      detail: `${buyerCount} ${buyerCount === 1 ? "buyer" : "buyers"}`,
      transactionHash,
      observedAt,
      preview: false,
    };
  }

  if (log.eventName === "DealFinalised") {
    const successful = Boolean(log.args.successful);
    const buyerCount = Number(log.args.buyerCount ?? 0);
    const clearingPrice =
      typeof log.args.clearingPrice === "bigint" ? log.args.clearingPrice : 0n;
    return {
      id,
      label: successful
        ? `Deal settled at ${formatMon(clearingPrice)} MON`
        : "Deal closed without reaching the minimum",
      detail: successful ? `${buyerCount} buyers` : "Full refunds are claimable",
      transactionHash,
      observedAt,
      preview: false,
    };
  }

  if (log.eventName === "DealCancelled") {
    return {
      id,
      label: "Merchant cancelled the deal",
      detail: "Full refunds are claimable",
      transactionHash,
      observedAt,
      preview: false,
    };
  }

  if (log.eventName === "RefundClaimed") {
    const buyer = typeof log.args.buyer === "string" ? log.args.buyer : "A buyer";
    const amount = typeof log.args.amount === "bigint" ? log.args.amount : 0n;
    return {
      id,
      label: `${isAddress(buyer) ? shortenAddress(buyer) : buyer} claimed a refund`,
      detail: `${formatMon(amount)} MON`,
      transactionHash,
      observedAt,
      preview: false,
    };
  }

  return undefined;
}

function addUniqueActivity(
  existing: ActivityItem[],
  additions: ActivityItem[],
) {
  const known = new Set(existing.map((item) => item.id));
  return [
    ...additions.filter((item) => !known.has(item.id)).reverse(),
    ...existing,
  ].slice(0, 10);
}

export function CrowdCartApp() {
  const reownWallet = useCrowdCartWallet();
  const [injectedAccount, setInjectedAccount] = useState<Address>();
  const [injectedProvider, setInjectedProvider] = useState<EIP1193Provider>();
  const usingReownWallet = Boolean(reownWallet.account);
  const account = usingReownWallet ? reownWallet.account : injectedAccount;
  const walletProvider = usingReownWallet
    ? reownWallet.provider
    : injectedProvider;

  const [previewBuyerCount, setPreviewBuyerCount] = useState(3);
  const [previewSecondsLeft, setPreviewSecondsLeft] = useState(89);
  const [previewJoined, setPreviewJoined] = useState(false);
  const [previewFinalised, setPreviewFinalised] = useState(false);
  const [previewRefundClaimed, setPreviewRefundClaimed] = useState(false);

  const [activeDealId, setActiveDealId] = useState(demoDealId);
  const [activeContractAddress, setActiveContractAddress] =
    useState<Address | undefined>(configuredContractAddress);
  const [deal, setDeal] = useState<DealSnapshot>();
  const [dealTiers, setDealTiers] = useState<DisplayTier[]>([]);
  const [contractPresent, setContractPresent] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    configuredContractAddress ? "loading" : "preview",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number>();
  const [lastConfirmedBlock, setLastConfirmedBlock] = useState<bigint>();
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [connectedBuyer, setConnectedBuyer] = useState<BuyerSnapshot>(EMPTY_BUYER);
  const [savedReceiptBuyer, setSavedReceiptBuyer] = useState<BuyerSnapshot>();

  const [savedDeals, setSavedDeals] = useState<SavedBuyerDeal[]>([]);
  const [selectedSavedDeal, setSelectedSavedDeal] = useState<SavedBuyerDeal>();
  const [activities, setActivities] = useState<ActivityItem[]>([
    {
      id: "preview-start",
      label: "Preview activity",
      detail: "3 buyers are already in the crowd",
      observedAt: 0,
      preview: true,
    },
  ]);
  const [activityAnnouncement, setActivityAnnouncement] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [notice, setNotice] = useState(
    "Preview mode is ready. Link the deployed contract for live Testnet activity.",
  );
  const [transactionHash, setTransactionHash] = useState<Hash>();
  const [showCreate, setShowCreate] = useState(false);
  const [showContractSetup, setShowContractSetup] = useState(false);
  const [showPresenter, setShowPresenter] = useState(false);
  const [showWalletChooser, setShowWalletChooser] = useState(false);
  const [audienceMode, setAudienceMode] = useState(false);
  const [checkoutInView, setCheckoutInView] = useState(true);
  const [untrustedContractAttempt, setUntrustedContractAttempt] = useState<string>();
  const [productName, setProductName] = useState("The London Pizza Drop");
  const [productPickup, setProductPickup] = useState("Encode Hub · Today");
  const [draftName, setDraftName] = useState("The London Pizza Drop");
  const [draftContractAddress, setDraftContractAddress] = useState(
    configuredContractAddress ?? "",
  );
  const [draftDealId, setDraftDealId] = useState(demoDealId.toString());
  const [fiatQuote, setFiatQuote] = useState<FiatQuote>();
  const [fiatStatus, setFiatStatus] = useState<FiatStatus>("loading");
  const [walletPreflight, setWalletPreflight] = useState<WalletPreflight>({
    checking: false,
    unavailable: false,
  });
  const [walletReadinessRefresh, setWalletReadinessRefresh] = useState(0);

  const activeDealKey = activeContractAddress
    ? `${activeContractAddress.toLowerCase()}:${activeDealId}`
    : "preview";
  const activeDealKeyRef = useRef(activeDealKey);
  const checkoutButtonRef = useRef<HTMLButtonElement>(null);
  const walletPreflightRequestRef = useRef(0);

  useEffect(() => {
    activeDealKeyRef.current = activeDealKey;
  }, [activeDealKey]);

  const selectedSavedMatchesActive = Boolean(
    selectedSavedDeal &&
      activeContractAddress &&
      selectedSavedDeal.contractAddress.toLowerCase() ===
        activeContractAddress.toLowerCase() &&
      selectedSavedDeal.dealId === activeDealId.toString(),
  );

  const displayTiers = dealTiers.length > 0 ? dealTiers : PREVIEW_TIERS;
  const buyerCount = deal?.buyerCount ?? previewBuyerCount;
  const maxPriceWei = deal?.maxPrice ?? displayTiers[0].price;
  const walletPreflightKey = account && activeContractAddress
    ? `${account.toLowerCase()}:${activeContractAddress.toLowerCase()}:${activeDealId}:${maxPriceWei}`
    : undefined;
  const walletPreflightIsCurrent = Boolean(
    walletPreflightKey && walletPreflight.key === walletPreflightKey,
  );
  const walletReadiness: WalletReadiness = getWalletReadiness({
    connected: Boolean(account && walletProvider),
    checking: Boolean(
      account &&
        activeContractAddress &&
        (!walletPreflightIsCurrent || walletPreflight.checking),
    ),
    unavailable: walletPreflightIsCurrent && walletPreflight.unavailable,
    chainId: walletPreflightIsCurrent ? walletPreflight.chainId : undefined,
    balanceWei: walletPreflightIsCurrent ? walletPreflight.balanceWei : undefined,
    maxDepositWei: maxPriceWei,
    gasUnits: walletPreflightIsCurrent ? walletPreflight.gasUnits : undefined,
    feePerGasWei: walletPreflightIsCurrent
      ? walletPreflight.feePerGasWei
      : undefined,
  });
  const dealPhase = activeContractAddress
    ? deriveDealPhase(deal?.state, Boolean(deal?.canFinalise))
    : "preview";
  const currentPriceWei = (() => {
    if (!deal) {
      return (
        [...displayTiers]
          .reverse()
          .find((tier) => previewBuyerCount >= tier.buyers)?.price ??
        displayTiers[0].price
      );
    }
    if (dealPhase === "successful") return deal.clearingPrice;
    if (dealPhase === "cancelled" || dealPhase === "failed") return 0n;
    return deal.currentPrice;
  })();
  const nextTier = displayTiers.find((tier) => tier.buyers > buyerCount);
  const inviteBuyersNeeded = nextTier ? nextTier.buyers - buyerCount : 0;
  const nextTierSavingWei = nextTier && currentPriceWei > nextTier.price
    ? currentPriceWei - nextTier.price
    : 0n;
  const nextTierRefundWei = nextTier && maxPriceWei > nextTier.price
    ? maxPriceWei - nextTier.price
    : 0n;
  const projectedRefundWei = maxPriceWei > currentPriceWei
    ? maxPriceWei - currentPriceWei
    : 0n;
  const hasJoined = activeContractAddress ? connectedBuyer.joined : previewJoined;
  const refundClaimed = activeContractAddress
    ? connectedBuyer.refundClaimed
    : previewRefundClaimed;
  const claimableRefundWei = activeContractAddress
    ? connectedBuyer.refundAvailable
    : previewFinalised && previewJoined && !previewRefundClaimed
      ? projectedRefundWei
      : 0n;
  const totalSavedWei = projectedRefundWei * BigInt(buyerCount);
  const isConfigured = Boolean(activeContractAddress);
  const isOfficialDeployment = Boolean(
    configuredContractAddress &&
      activeContractAddress &&
      configuredContractAddress.toLowerCase() === activeContractAddress.toLowerCase() &&
      !untrustedContractAttempt,
  );
  const canInvite = Boolean(
    !untrustedContractAttempt &&
      nextTier &&
      hasJoined &&
      (dealPhase === "open" || (dealPhase === "preview" && !previewFinalised)),
  );
  const isBusy =
    txState === "wallet" || txState === "confirming" || reownWallet.isConnecting;

  const receiptOwner = selectedSavedMatchesActive
    ? getAddress(selectedSavedDeal!.buyerAddress)
    : account;
  const receiptBuyer = selectedSavedMatchesActive
    ? savedReceiptBuyer ?? EMPTY_BUYER
    : connectedBuyer;

  const shareUrl = useMemo(() => {
    const localOrigin =
      typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
    const audienceUrl = new URL(configuredSiteUrl ?? localOrigin);
    audienceUrl.searchParams.set("deal", activeDealId.toString());
    audienceUrl.searchParams.set("mode", "audience");
    if (activeContractAddress) {
      audienceUrl.searchParams.set("contract", activeContractAddress);
    }
    return audienceUrl.toString();
  }, [activeContractAddress, activeDealId]);

  const shareUrlIsPublic = useMemo(() => {
    const url = new URL(shareUrl);
    return url.protocol === "https:" && url.hostname !== "localhost";
  }, [shareUrl]);

  const metaMaskLink = useMemo(() => {
    if (!shareUrlIsPublic) return undefined;
    const target = new URL(shareUrl);
    return `https://link.metamask.io/dapp/${target.host}${target.pathname}${target.search}`;
  }, [shareUrl, shareUrlIsPublic]);

  const fiatPair = (amountWei: bigint) =>
    fiatQuote
      ? `${formatFiat(monNumber(amountWei) * fiatQuote.gbp, "GBP")} · ${formatFiat(
          monNumber(amountWei) * fiatQuote.usd,
          "USD",
        )}`
      : "Price feed loading";

  const quoteUpdatedAt = fiatQuote
    ? new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(fiatQuote.lastUpdatedAt * 1000))
    : undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedContract = params.get("contract");
      const requestedDeal = params.get("deal");
      setAudienceMode(params.get("mode") === "audience");

      const checkedAddress = resolveCrowdCartAddress(
        requestedContract ?? undefined,
        configuredContractAddress,
      );
      const blockedContract = Boolean(
        requestedContract &&
          isAddress(requestedContract) &&
          configuredContractAddress &&
          !checkedAddress,
      );

      if (checkedAddress) {
        setActiveContractAddress(checkedAddress);
        setDraftContractAddress(checkedAddress);
        setSyncStatus("loading");
      } else if (blockedContract && requestedContract) {
        setUntrustedContractAttempt(requestedContract);
        setTxState("error");
        setNotice(
          "This shared link names an unrecognised contract. Joining is blocked until you return to the official CrowdCart deal.",
        );
      }
      if (
        !blockedContract &&
        requestedDeal &&
        /^\d+$/.test(requestedDeal) &&
        BigInt(requestedDeal) > 0n
      ) {
        setActiveDealId(BigInt(requestedDeal));
        setDraftDealId(BigInt(requestedDeal).toString());
      }
      setSavedDeals(loadSavedBuyerDeals(window.localStorage));
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const checkoutButton = checkoutButtonRef.current;
    if (!checkoutButton) return;

    const observer = new IntersectionObserver(
      ([entry]) => setCheckoutInView(entry.isIntersecting),
      { threshold: 0.45 },
    );
    observer.observe(checkoutButton);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let requestInFlight = false;

    async function loadFiatQuote() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await fetch("/api/mon-price", {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("Price feed unavailable");
        const quote = (await response.json()) as FiatQuote;
        if (
          !Number.isFinite(quote.usd) ||
          quote.usd <= 0 ||
          !Number.isFinite(quote.gbp) ||
          quote.gbp <= 0 ||
          !Number.isFinite(quote.lastUpdatedAt) ||
          quote.lastUpdatedAt <= 0
        ) {
          throw new Error("Invalid price quote");
        }
        if (!active) return;
        const quoteAge = Date.now() - quote.lastUpdatedAt * 1000;
        setFiatQuote(quote);
        setFiatStatus(
          response.headers.get("x-crowdcart-price-status") === "stale" ||
            quoteAge > 5 * 60_000 ||
            quoteAge < -5 * 60_000
            ? "stale"
            : "live",
        );
      } catch {
        if (!active) return;
        setFiatStatus((current) =>
          current === "live" || current === "stale" ? "stale" : "unavailable",
        );
      } finally {
        requestInFlight = false;
      }
    }

    void loadFiatQuote();
    const timer = window.setInterval(loadFiatQuote, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const readBuyer = useCallback(
    async (buyerAddress: Address): Promise<BuyerSnapshot> => {
      if (!activeContractAddress) return EMPTY_BUYER;
      const buyer = await publicClient.readContract({
        address: activeContractAddress,
        abi: crowdCartAbi,
        functionName: "getBuyer",
        args: [activeDealId, buyerAddress],
      });
      return {
        joined: buyer[0],
        refundClaimed: buyer[1],
        refundAvailable: buyer[2],
      };
    },
    [activeContractAddress, activeDealId],
  );

  const syncDeal = useCallback(
    async (showLoading = false) => {
      if (!activeContractAddress) return;
      const requestKey = `${activeContractAddress.toLowerCase()}:${activeDealId}`;
      if (showLoading) setSyncStatus("loading");

      try {
        const [rawDeal, rawTiers, bytecode, blockNumber] = await Promise.all([
          publicClient.readContract({
            address: activeContractAddress,
            abi: crowdCartAbi,
            functionName: "getDeal",
            args: [activeDealId],
          }),
          publicClient.readContract({
            address: activeContractAddress,
            abi: crowdCartAbi,
            functionName: "getTiers",
            args: [activeDealId],
          }),
          publicClient.getBytecode({ address: activeContractAddress }),
          publicClient.getBlockNumber(),
        ]);

        if (activeDealKeyRef.current !== requestKey) return;

        const nextDeal: DealSnapshot = {
          id: rawDeal.id,
          merchant: rawDeal.merchant,
          metadataURI: rawDeal.metadataURI,
          createdAt: rawDeal.createdAt,
          endsAt: rawDeal.endsAt,
          minBuyers: Number(rawDeal.minBuyers),
          maxBuyers: Number(rawDeal.maxBuyers),
          buyerCount: Number(rawDeal.buyerCount),
          maxPrice: rawDeal.maxPrice,
          currentPrice: rawDeal.currentPrice,
          clearingPrice: rawDeal.clearingPrice,
          state: Number(rawDeal.state),
          canFinalise: rawDeal.canFinalise,
          proceedsWithdrawn: rawDeal.proceedsWithdrawn,
        };
        const nextTiers = toDisplayTiers(
          rawTiers[0].map(Number),
          rawTiers[1],
        );
        const metadata = parseProductMetadata(nextDeal.metadataURI);

        setDeal(nextDeal);
        setDealTiers(nextTiers);
        setContractPresent(Boolean(bytecode && bytecode !== "0x"));
        setLastConfirmedBlock(blockNumber);
        setLastSyncedAt(Date.now());
        setSecondsLeft(
          nextDeal.state === 1
            ? Math.max(
                0,
                Number(nextDeal.endsAt) - Math.floor(Date.now() / 1000),
              )
            : 0,
        );
        setSyncStatus("live");
        if (metadata?.name) setProductName(metadata.name);
        if (metadata?.pickup) setProductPickup(metadata.pickup);

        const buyerReads: Promise<void>[] = [];
        if (account) {
          buyerReads.push(
            readBuyer(account).then((buyer) => {
              if (activeDealKeyRef.current === requestKey) setConnectedBuyer(buyer);
            }),
          );
        } else {
          setConnectedBuyer(EMPTY_BUYER);
        }

        if (selectedSavedMatchesActive && selectedSavedDeal) {
          const savedBuyerAddress = getAddress(selectedSavedDeal.buyerAddress);
          if (!account || savedBuyerAddress.toLowerCase() !== account.toLowerCase()) {
            buyerReads.push(
              readBuyer(savedBuyerAddress).then((buyer) => {
                if (activeDealKeyRef.current === requestKey) {
                  setSavedReceiptBuyer(buyer);
                }
              }),
            );
          } else {
            buyerReads.push(
              readBuyer(account).then((buyer) => setSavedReceiptBuyer(buyer)),
            );
          }
        } else {
          setSavedReceiptBuyer(undefined);
        }
        await Promise.all(buyerReads);

        setActivities((current) =>
          current.some((item) => !item.preview)
            ? current
            : [
                {
                  id: `snapshot:${requestKey}:${blockNumber}`,
                  label: "Live contract synced",
                  detail: `${nextDeal.buyerCount} ${nextDeal.buyerCount === 1 ? "buyer" : "buyers"} already joined`,
                  observedAt: Date.now(),
                  preview: false,
                },
              ],
        );
      } catch (error) {
        if (activeDealKeyRef.current !== requestKey) return;
        setSyncStatus((current) =>
          current === "live" || current === "stale" ? "stale" : "unavailable",
        );
        if (showLoading) {
          setNotice(`Live deal could not be loaded: ${getErrorMessage(error)}`);
          setTxState("error");
        }
      }
    },
    [
      account,
      activeContractAddress,
      activeDealId,
      readBuyer,
      selectedSavedDeal,
      selectedSavedMatchesActive,
    ],
  );

  useEffect(() => {
    if (!activeContractAddress) return;

    const initialSync = window.setTimeout(() => void syncDeal(true), 0);
    const timer = window.setInterval(() => void syncDeal(false), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncDeal(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initialSync);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeContractAddress, activeDealId, syncDeal]);

  useEffect(() => {
    if (!activeContractAddress) return;

    const unwatch = publicClient.watchContractEvent({
      address: activeContractAddress,
      abi: crowdCartAbi,
      pollingInterval: 3_000,
      onLogs: (logs) => {
        const additions = (logs as unknown as ContractActivityLog[])
          .map((log) => activityFromLog(log, activeDealId, displayTiers))
          .filter((item): item is ActivityItem => Boolean(item));
        if (additions.length === 0) return;
        setActivities((current) => addUniqueActivity(current, additions));
        setActivityAnnouncement(additions.at(-1)?.label ?? "Crowd updated");
        void syncDeal(false);
      },
      onError: () => setSyncStatus((current) => (current === "live" ? "stale" : current)),
    });

    return unwatch;
  }, [activeContractAddress, activeDealId, displayTiers, syncDeal]);

  useEffect(() => {
    if (activeContractAddress) return;
    if (previewFinalised) return;
    const timer = window.setInterval(() => {
      setPreviewSecondsLeft((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activeContractAddress, previewFinalised]);

  useEffect(() => {
    if (!deal || deal.state !== 1) return;
    let lastRemaining = Math.max(
      0,
      Number(deal.endsAt) - Math.floor(Date.now() / 1000),
    );
    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Number(deal.endsAt) - Math.floor(Date.now() / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0 && lastRemaining > 0) void syncDeal(false);
      lastRemaining = remaining;
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [deal, syncDeal]);

  useEffect(() => {
    const provider = injectedProvider as EventfulProvider | undefined;
    if (!provider?.on || !provider.removeListener) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      const next = accounts[0];
      setInjectedAccount(next && isAddress(next) ? getAddress(next) : undefined);
      setConnectedBuyer(EMPTY_BUYER);
    };
    provider.on("accountsChanged", onAccountsChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, [injectedProvider]);

  useEffect(() => {
    const provider = walletProvider as EventfulProvider | undefined;
    if (!provider?.on || !provider.removeListener) return;

    const refresh = () => {
      setWalletReadinessRefresh((current) => current + 1);
      void syncDeal(false);
    };
    provider.on("chainChanged", refresh);
    provider.on("accountsChanged", refresh);
    return () => {
      provider.removeListener?.("chainChanged", refresh);
      provider.removeListener?.("accountsChanged", refresh);
    };
  }, [syncDeal, walletProvider]);

  const refreshWalletPreflight = useCallback(async (): Promise<WalletPreflight> => {
    const requestId = ++walletPreflightRequestRef.current;
    if (
      !account ||
      !walletProvider ||
      !activeContractAddress ||
      !walletPreflightKey ||
      dealPhase !== "open" ||
      hasJoined
    ) {
      const inactive: WalletPreflight = {
        checking: false,
        unavailable: false,
      };
      if (requestId === walletPreflightRequestRef.current) {
        setWalletPreflight(inactive);
      }
      return inactive;
    }

    const checking: WalletPreflight = {
      key: walletPreflightKey,
      checking: true,
      unavailable: false,
    };
    if (requestId === walletPreflightRequestRef.current) {
      setWalletPreflight(checking);
    }

    try {
      const walletClient = createWalletClient({
        chain: MONAD_TESTNET,
        transport: custom(walletProvider),
      });
      const chainId = await walletClient.getChainId();
      if (chainId !== MONAD_TESTNET.id) {
        const wrongNetwork: WalletPreflight = {
          key: walletPreflightKey,
          chainId,
          checking: false,
          unavailable: false,
        };
        if (requestId === walletPreflightRequestRef.current) {
          setWalletPreflight(wrongNetwork);
        }
        return wrongNetwork;
      }

      const [balanceWei, gasUnits] = await Promise.all([
        publicClient.getBalance({ address: account, blockTag: "pending" }),
        publicClient.estimateContractGas({
          account,
          address: activeContractAddress,
          abi: crowdCartAbi,
          functionName: "joinDeal",
          args: [activeDealId],
          value: maxPriceWei,
          stateOverride: [{ address: account, balance: maxUint256 }],
        }),
      ]);

      let feePerGasWei: bigint;
      let maxFeePerGasWei: bigint | undefined;
      let maxPriorityFeePerGasWei: bigint | undefined;
      let gasPriceWei: bigint | undefined;
      try {
        const eip1559Fees = await publicClient.estimateFeesPerGas({
          type: "eip1559",
        });
        feePerGasWei = eip1559Fees.maxFeePerGas;
        maxFeePerGasWei = eip1559Fees.maxFeePerGas;
        maxPriorityFeePerGasWei = eip1559Fees.maxPriorityFeePerGas;
      } catch {
        gasPriceWei = await publicClient.getGasPrice();
        feePerGasWei = gasPriceWei;
      }

      const readyCheck: WalletPreflight = {
        key: walletPreflightKey,
        chainId,
        balanceWei,
        gasUnits,
        gasLimit: calculateBufferedGasLimit(gasUnits),
        feePerGasWei,
        maxFeePerGasWei,
        maxPriorityFeePerGasWei,
        gasPriceWei,
        checking: false,
        unavailable: false,
      };
      if (requestId === walletPreflightRequestRef.current) {
        setWalletPreflight(readyCheck);
      }
      return readyCheck;
    } catch (error) {
      const unavailable: WalletPreflight = {
        key: walletPreflightKey,
        checking: false,
        unavailable: true,
        failure: getErrorMessage(error),
      };
      if (requestId === walletPreflightRequestRef.current) {
        setWalletPreflight(unavailable);
      }
      return unavailable;
    }
  }, [
    account,
    activeContractAddress,
    activeDealId,
    dealPhase,
    hasJoined,
    maxPriceWei,
    walletPreflightKey,
    walletProvider,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshWalletPreflight();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshWalletPreflight, walletReadinessRefresh]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setWalletReadinessRefresh((current) => current + 1);
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, []);

  async function ensureMonadNetwork(provider: EIP1193Provider) {
    const targetChainId = numberToHex(MONAD_TESTNET.id);
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainId }],
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: targetChainId,
            chainName: MONAD_TESTNET.name,
            nativeCurrency: MONAD_TESTNET.nativeCurrency,
            rpcUrls: MONAD_TESTNET.rpcUrls.default.http,
            blockExplorerUrls: [MONAD_TESTNET.blockExplorers.default.url],
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainId }],
      });
    }

    const selectedChainId = await createWalletClient({
      chain: MONAD_TESTNET,
      transport: custom(provider),
    }).getChainId();
    if (selectedChainId !== MONAD_TESTNET.id) {
      throw new Error("Wallet did not switch to Monad Testnet.");
    }
  }

  async function switchToMonadTestnet() {
    if (!walletProvider) {
      setShowWalletChooser(true);
      return;
    }

    try {
      setTxState("wallet");
      setNotice("Switching your wallet to Monad Testnet…");
      await ensureMonadNetwork(walletProvider);
      setWalletReadinessRefresh((current) => current + 1);
      setTxState("success");
      setNotice("Monad Testnet selected. Rechecking your available MON.");
    } catch (error) {
      setTxState("error");
      setNotice(getErrorMessage(error));
    }
  }

  function openMonadFaucet() {
    const faucetWindow = window.open(
      MONAD_FAUCET_URL,
      "_blank",
      "noopener,noreferrer",
    );
    if (faucetWindow) faucetWindow.opener = null;
    setTxState("success");
    setNotice("Monad Faucet opened. Return here and refresh the balance after funding.");
  }

  async function connectInjectedWallet() {
    const ethereum = getInjectedEthereum();
    if (!ethereum) {
      setTxState("error");
      setNotice("No browser wallet was found. Use WalletConnect or open CrowdCart in a mobile wallet.");
      return;
    }

    try {
      setTxState("wallet");
      setNotice("Connecting to Monad Testnet…");
      await ensureMonadNetwork(ethereum);
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as Address[];
      if (!accounts[0] || !isAddress(accounts[0])) {
        throw new Error("The wallet did not return an account.");
      }
      setInjectedProvider(ethereum);
      setInjectedAccount(getAddress(accounts[0]));
      setShowWalletChooser(false);
      setTxState("success");
      setNotice("Wallet connected to Monad Testnet.");
    } catch (error) {
      setTxState("error");
      setNotice(getErrorMessage(error));
    }
  }

  async function disconnectWallet() {
    if (reownWallet.account) await reownWallet.disconnect();
    setInjectedAccount(undefined);
    setInjectedProvider(undefined);
    setConnectedBuyer(EMPTY_BUYER);
    setShowWalletChooser(false);
    setTxState("idle");
    setNotice("Wallet disconnected. Saved receipts remain on this device.");
  }

  async function writeContract(
    functionName: "createDeal" | "joinDeal" | "finaliseDeal" | "claimRefund",
    args: readonly unknown[],
    value?: bigint,
    submissionOptions?: WalletSubmissionOptions,
  ) {
    if (!walletProvider || !account || !activeContractAddress) {
      throw new Error("Connect a wallet after the CrowdCart contract is deployed.");
    }

    await ensureMonadNetwork(walletProvider);
    const simulation = await publicClient.simulateContract({
      account,
      address: activeContractAddress,
      abi: crowdCartAbi,
      functionName,
      args,
      value,
      ...submissionOptions,
    } as Parameters<typeof publicClient.simulateContract>[0]);

    const walletClient = createWalletClient({
      account,
      chain: MONAD_TESTNET,
      transport: custom(walletProvider),
    });
    const hash = await walletClient.writeContract(
      simulation.request as Parameters<typeof walletClient.writeContract>[0],
    );
    setTransactionHash(hash);
    setTxState("confirming");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error("The transaction was included but did not succeed.");
    }
    setWalletReadinessRefresh((current) => current + 1);
    return { hash, receipt };
  }

  function addPreviewActivity(label: string, detail?: string) {
    const observedAt = eventTimestamp();
    const item: ActivityItem = {
      id: `preview:${observedAt}:${label}`,
      label,
      detail,
      observedAt,
      preview: true,
    };
    setActivities((current) => addUniqueActivity(current, [item]));
    setActivityAnnouncement(label);
  }

  async function joinCrowd() {
    if (untrustedContractAttempt) {
      setTxState("error");
      setNotice("Joining is blocked because this shared link names an unrecognised contract.");
      return;
    }
    if (hasJoined || (isConfigured && dealPhase !== "open") || previewFinalised) return;

    if (isConfigured && (!account || !walletProvider)) {
      setShowWalletChooser(true);
      setNotice("Choose a wallet to join this deal.");
      return;
    }

    let submissionOptions: WalletSubmissionOptions | undefined;
    if (isConfigured) {
      setTxState("wallet");
      setNotice("Rechecking your network, balance and gas allowance…");
      const freshPreflight = await refreshWalletPreflight();
      const freshReadiness = getWalletReadiness({
        connected: Boolean(account && walletProvider),
        checking: freshPreflight.checking,
        unavailable: freshPreflight.unavailable,
        chainId: freshPreflight.chainId,
        balanceWei: freshPreflight.balanceWei,
        maxDepositWei: maxPriceWei,
        gasUnits: freshPreflight.gasUnits,
        feePerGasWei: freshPreflight.feePerGasWei,
      });

      if (freshReadiness.status === "wrong_network") {
        await switchToMonadTestnet();
        return;
      }
      if (freshReadiness.status === "insufficient") {
        openMonadFaucet();
        return;
      }
      if (!freshReadiness.canJoin) {
        setTxState("error");
        setNotice(
          freshPreflight.failure
            ? `Wallet readiness check failed: ${freshPreflight.failure}`
            : "Wallet readiness could not be confirmed. Retry before joining.",
        );
        return;
      }

      submissionOptions = getWalletSubmissionOptions(freshPreflight);
      if (!submissionOptions) {
        setTxState("error");
        setNotice("The gas allowance could not be prepared. Retry before joining.");
        return;
      }
    }

    try {
      setTxState("wallet");
      if (isConfigured) {
        if (!deal || syncStatus === "unavailable") {
          throw new Error("The live deal is not available yet. Refresh it before joining.");
        }
        setNotice(`Confirm the exact ${formatMon(deal.maxPrice)} MON maximum deposit.`);
        const { hash } = await writeContract(
          "joinDeal",
          [activeDealId],
          deal.maxPrice,
          submissionOptions,
        );
        const nextSavedDeals = upsertConfirmedJoin(window.localStorage, {
          chainId: MONAD_TESTNET_CHAIN_ID,
          contractAddress: activeContractAddress!,
          dealId: activeDealId.toString(),
          buyerAddress: account!,
          joinTxHash: hash,
        });
        setSavedDeals(nextSavedDeals);
        setSelectedSavedDeal(
          nextSavedDeals.find(
            (item) =>
              item.contractAddress.toLowerCase() ===
                activeContractAddress!.toLowerCase() &&
              item.dealId === activeDealId.toString() &&
              item.buyerAddress.toLowerCase() === account!.toLowerCase(),
          ),
        );
        await syncDeal(false);
        setNotice("Confirmed on Monad Testnet. Your receipt is saved on this device.");
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        const previousPrice = currentPriceWei;
        const nextCount = Math.min(PREVIEW_TIERS.at(-1)!.buyers, previewBuyerCount + 1);
        const nextPrice =
          [...PREVIEW_TIERS]
            .reverse()
            .find((tier) => nextCount >= tier.buyers)?.price ?? previousPrice;
        setPreviewBuyerCount(nextCount);
        setPreviewJoined(true);
        addPreviewActivity(
          nextPrice < previousPrice
            ? `Preview price dropped to ${formatMon(nextPrice)} MON`
            : "You joined the preview crowd",
          `${nextCount} buyers`,
        );
        setNotice("Preview complete. A live contract will create a permanent receipt.");
      }
      setTxState("success");
    } catch (error) {
      setTxState("error");
      setNotice(getErrorMessage(error));
    }
  }

  async function finaliseDeal() {
    if (!isConfigured) {
      setPreviewFinalised(true);
      setPreviewSecondsLeft(0);
      setTxState("success");
      addPreviewActivity(
        `Preview settled at ${formatMon(currentPriceWei)} MON`,
        previewJoined ? `${formatMon(projectedRefundWei)} MON refund ready` : undefined,
      );
      setNotice(`Preview settled at ${formatMon(currentPriceWei)} MON.`);
      return;
    }

    if (dealPhase !== "awaiting_finalisation") return;
    if (!account || !walletProvider) {
      setShowWalletChooser(true);
      return;
    }

    try {
      setTxState("wallet");
      setNotice("Confirm permissionless settlement in your wallet.");
      await writeContract("finaliseDeal", [activeDealId]);
      await syncDeal(false);
      setTxState("success");
      setNotice("Deal settlement confirmed on Monad Testnet.");
    } catch (error) {
      setTxState("error");
      setNotice(getErrorMessage(error));
    }
  }

  async function claimRefund() {
    if (!hasJoined || refundClaimed || claimableRefundWei <= 0n) return;
    if (isConfigured && (!account || !walletProvider)) {
      setShowWalletChooser(true);
      return;
    }

    try {
      setTxState("wallet");
      if (isConfigured) {
        setNotice(`Confirm your ${formatMon(claimableRefundWei)} MON refund claim.`);
        const { hash } = await writeContract("claimRefund", [activeDealId]);
        const locator = {
          chainId: MONAD_TESTNET_CHAIN_ID,
          contractAddress: activeContractAddress!,
          dealId: activeDealId.toString(),
          buyerAddress: account!,
        } as const;
        setSavedDeals(
          updateSavedBuyerDealRefundHash(window.localStorage, locator, hash),
        );
        await syncDeal(false);
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        setPreviewRefundClaimed(true);
        addPreviewActivity(
          "Preview refund claimed",
          `${formatMon(claimableRefundWei)} MON`,
        );
      }
      setTxState("success");
      setNotice(`${formatMon(claimableRefundWei)} MON refund confirmed.`);
    } catch (error) {
      setTxState("error");
      setNotice(getErrorMessage(error));
    }
  }

  function addDemoBuyer() {
    if (isConfigured || previewFinalised) return;
    const previousPrice = currentPriceWei;
    const nextCount = Math.min(PREVIEW_TIERS.at(-1)!.buyers, previewBuyerCount + 1);
    const nextPrice =
      [...PREVIEW_TIERS]
        .reverse()
        .find((tier) => nextCount >= tier.buyers)?.price ?? previousPrice;
    setPreviewBuyerCount(nextCount);
    addPreviewActivity(
      nextPrice < previousPrice
        ? `Preview price dropped to ${formatMon(nextPrice)} MON`
        : "A preview buyer joined",
      `${nextCount} buyers`,
    );
    setTxState("success");
    setNotice("Preview crowd updated.");
  }

  function resetDemo() {
    const observedAt = eventTimestamp();
    if (isConfigured) return;
    setPreviewBuyerCount(3);
    setPreviewSecondsLeft(89);
    setPreviewJoined(false);
    setPreviewFinalised(false);
    setPreviewRefundClaimed(false);
    setTransactionHash(undefined);
    setTxState("idle");
    setActivities([
      {
        id: `preview-reset:${observedAt}`,
        label: "Preview reset",
        detail: "3 buyers are already in the crowd",
        observedAt,
        preview: true,
      },
    ]);
    setNotice("Preview reset. One more buyer unlocks the next price.");
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setTxState("success");
      setNotice("Audience link copied.");
    } catch {
      setTxState("error");
      setNotice("The browser could not copy the link. Copy it from the address bar instead.");
    }
  }

  async function shareDeal() {
    const nextStep = nextTier
      ? `${inviteBuyersNeeded} more ${inviteBuyersNeeded === 1 ? "buyer" : "buyers"} unlocks ${formatMon(nextTier.price)} MON for everyone. My projected refund becomes ${formatMon(nextTierRefundWei)} MON.`
      : "Join the CrowdCart drop and help everyone reach the best shared price.";
    const shareText = `${productName} on CrowdCart — ${nextStep}`;

    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: `${productName} · CrowdCart`,
          text: shareText,
          url: shareUrl,
        });
        setNotice("Deal shared. The next buyer can open the same live CrowdCart deal.");
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        setNotice("Invite copied. Paste it into your group chat to unlock the next price.");
      }
      setTxState("success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTxState("error");
      setNotice("The invite could not be shared. Use the audience link or QR code instead.");
    }
  }

  function useOfficialDeal() {
    if (!configuredContractAddress) return;

    const officialUrl = new URL(window.location.href);
    officialUrl.searchParams.delete("contract");
    officialUrl.searchParams.delete("deal");
    window.history.replaceState({}, "", officialUrl);
    setUntrustedContractAttempt(undefined);
    setActiveContractAddress(configuredContractAddress);
    setActiveDealId(demoDealId);
    setDraftContractAddress(configuredContractAddress);
    setDraftDealId(demoDealId.toString());
    setSelectedSavedDeal(undefined);
    setTxState("success");
    setNotice("Official CrowdCart deployment restored.");
  }

  async function linkContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checkedAddress = resolveCrowdCartAddress(
      draftContractAddress,
      configuredContractAddress,
    );
    if (!checkedAddress) {
      setTxState("error");
      setNotice(
        isAddress(draftContractAddress) && configuredContractAddress
          ? "That address is not the official CrowdCart deployment configured for this site."
          : "Enter a valid EVM contract address.",
      );
      return;
    }
    if (!/^\d+$/.test(draftDealId) || BigInt(draftDealId) <= 0n) {
      setTxState("error");
      setNotice("Deal ID must be a positive whole number.");
      return;
    }

    const checkedDealId = BigInt(draftDealId);
    try {
      setTxState("confirming");
      setNotice("Checking the deployed contract and deal…");
      const [bytecode] = await Promise.all([
        publicClient.getBytecode({ address: checkedAddress }),
        publicClient.readContract({
          address: checkedAddress,
          abi: crowdCartAbi,
          functionName: "getDeal",
          args: [checkedDealId],
        }),
      ]);
      if (!bytecode || bytecode === "0x") {
        throw new Error("No contract was found at that address on Monad Testnet.");
      }

      const linkedUrl = new URL(window.location.href);
      linkedUrl.searchParams.set("contract", checkedAddress);
      linkedUrl.searchParams.set("deal", checkedDealId.toString());
      window.history.replaceState({}, "", linkedUrl);
      setActiveContractAddress(checkedAddress);
      setActiveDealId(checkedDealId);
      setSelectedSavedDeal(undefined);
      setConnectedBuyer(EMPTY_BUYER);
      setDeal(undefined);
      setDealTiers([]);
      setSyncStatus("loading");
      setActivities([]);
      setShowContractSetup(false);
      setTxState("success");
      setNotice("Contract found. Loading the live deal from Monad Testnet.");
    } catch (error) {
      setTxState("error");
      setNotice(getErrorMessage(error));
    }
  }

  async function createDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = draftName.trim() || "The London Pizza Drop";

    try {
      if (isConfigured) {
        if (!account || !walletProvider) {
          setShowWalletChooser(true);
          return;
        }
        setTxState("wallet");
        setNotice("Confirm the new group deal in your wallet.");
        const metadata = encodeURIComponent(
          JSON.stringify({
            name: cleanName,
            pickup: "Encode Hub · Today",
            image: "crowdcart://pizza-drop",
          }),
        );
        const { receipt } = await writeContract("createDeal", [
          `data:application/json,${metadata}`,
          deadlineAfter(180),
          2,
          7,
          PREVIEW_TIERS.map((tier) => tier.buyers),
          PREVIEW_TIERS.map((tier) => tier.price),
        ]);
        const createdEvents = parseEventLogs({
          abi: crowdCartAbi,
          eventName: "DealCreated",
          logs: receipt.logs,
          strict: true,
        });
        const createdDealId = createdEvents[0]?.args.dealId;
        if (createdDealId === undefined) {
          throw new Error("The deal was created, but its ID could not be read.");
        }
        setActiveDealId(createdDealId);
        setDraftDealId(createdDealId.toString());
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("deal", createdDealId.toString());
        window.history.replaceState({}, "", nextUrl);
        setDeal(undefined);
        setDealTiers([]);
        setSyncStatus("loading");
        setActivities([]);
      } else {
        resetDemo();
      }

      setProductName(cleanName);
      setShowCreate(false);
      setTxState("success");
      setNotice(
        isConfigured
          ? "New CrowdCart deal created on Monad Testnet."
          : "New preview deal created. Link a contract to publish it on Testnet.",
      );
    } catch (error) {
      setTxState("error");
      setNotice(getErrorMessage(error));
    }
  }

  function openSavedDeal(saved: SavedBuyerDeal) {
    const address = resolveCrowdCartAddress(
      saved.contractAddress,
      configuredContractAddress,
    );
    if (!address) {
      setTxState("error");
      setNotice("This saved receipt belongs to a different contract and cannot be opened on the official CrowdCart site.");
      return;
    }
    const dealId = BigInt(saved.dealId);
    setSelectedSavedDeal(saved);
    setSavedReceiptBuyer(undefined);
    setActiveContractAddress(address);
    setActiveDealId(dealId);
    setDraftContractAddress(address);
    setDraftDealId(dealId.toString());
    setDeal(undefined);
    setDealTiers([]);
    setSyncStatus("loading");
    setActivities([]);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("contract", address);
    nextUrl.searchParams.set("deal", dealId.toString());
    window.history.replaceState({}, "", nextUrl);
    document.getElementById("deal-title")?.scrollIntoView({ behavior: "smooth" });
  }

  function removeSavedDeal(saved: SavedBuyerDeal) {
    const next = removeSavedBuyerDeal(window.localStorage, saved);
    setSavedDeals(next);
    if (selectedSavedDeal && savedBuyerDealKey(selectedSavedDeal) === savedBuyerDealKey(saved)) {
      setSelectedSavedDeal(undefined);
      setSavedReceiptBuyer(undefined);
    }
  }

  const checkoutAction = (() => {
    if (untrustedContractAttempt) return "Unrecognised contract link";
    if (isConfigured && syncStatus === "loading") return "Loading live deal…";
    if (isConfigured && (syncStatus === "unavailable" || dealPhase === "unavailable")) {
      return "Deal unavailable";
    }
    if (isConfigured && account && dealPhase === "open" && !hasJoined) {
      if (walletReadiness.status === "checking") return "Checking wallet balance…";
      if (walletReadiness.status === "wrong_network") return "Switch to Monad Testnet";
      if (walletReadiness.status === "insufficient") {
        return `Add ${formatMon(walletReadiness.shortfallWei ?? 0n, 5)} MON to join`;
      }
      if (walletReadiness.status === "unavailable") return "Retry wallet check";
    }
    if (!isConfigured && previewFinalised && hasJoined && claimableRefundWei > 0n) {
      return `Claim ${formatMon(claimableRefundWei)} MON refund`;
    }
    if (dealPhase === "awaiting_finalisation") return "Finalise deal for the crowd";
    if (
      (dealPhase === "successful" || dealPhase === "cancelled" || dealPhase === "failed") &&
      hasJoined &&
      !refundClaimed &&
      claimableRefundWei > 0n
    ) {
      return `Claim ${formatMon(claimableRefundWei)} MON refund`;
    }
    if (refundClaimed) return "Refund received";
    if (canInvite && nextTier) {
      return `Invite ${inviteBuyersNeeded} more · unlock ${formatMon(nextTier.price)} MON`;
    }
    if (dealPhase === "successful" && hasJoined) return "Purchase settled";
    if (hasJoined) return "Deposit locked until settlement";
    if (dealPhase === "successful" || dealPhase === "cancelled" || dealPhase === "failed") {
      return "Deal closed";
    }
    if (isConfigured && !account) return "Connect wallet to join";
    return `Join at ${formatMon(maxPriceWei)} MON max`;
  })();

  const checkoutDisabled =
    isBusy ||
    Boolean(untrustedContractAttempt) ||
    (isConfigured && (syncStatus === "loading" || syncStatus === "unavailable")) ||
    (isConfigured &&
      Boolean(account) &&
      dealPhase === "open" &&
      !hasJoined &&
      walletReadiness.status === "checking") ||
    refundClaimed ||
    (hasJoined && !canInvite && (dealPhase === "open" || (!isConfigured && !previewFinalised))) ||
    ((dealPhase === "successful" || dealPhase === "cancelled" || dealPhase === "failed") &&
      (!hasJoined || claimableRefundWei === 0n));

  const handleCheckoutAction = () => {
    if (walletReadiness.status === "wrong_network" && dealPhase === "open") {
      void switchToMonadTestnet();
    } else if (walletReadiness.status === "insufficient" && dealPhase === "open") {
      openMonadFaucet();
    } else if (walletReadiness.status === "unavailable" && dealPhase === "open") {
      setWalletReadinessRefresh((current) => current + 1);
    } else if (dealPhase === "awaiting_finalisation") {
      void finaliseDeal();
    } else if (
      (previewFinalised ||
        dealPhase === "successful" ||
        dealPhase === "cancelled" ||
        dealPhase === "failed") &&
      claimableRefundWei > 0n
    ) {
      void claimRefund();
    } else if (canInvite) {
      void shareDeal();
    } else {
      void joinCrowd();
    }
  };

  const anyModalOpen = showWalletChooser || showCreate || showContractSetup;
  const showMobileBuyerAction =
    !checkoutInView &&
    !anyModalOpen &&
    (canInvite || !checkoutDisabled || isBusy);
  const mobileCheckoutAction = canInvite
    ? `Invite ${inviteBuyersNeeded} more`
    : checkoutAction;

  const showWalletReadiness = Boolean(
    isConfigured && dealPhase === "open" && !hasJoined && !untrustedContractAttempt,
  );
  const walletReadinessCopy = (() => {
    if (walletReadiness.status === "disconnected") {
      return {
        title: "Connect to check your wallet",
        detail: "CrowdCart checks the network, maximum deposit and a gas allowance before joining.",
      };
    }
    if (walletReadiness.status === "checking") {
      return {
        title: "Checking network and funds",
        detail: "Reading your Monad Testnet balance and estimating the join transaction.",
      };
    }
    if (walletReadiness.status === "wrong_network") {
      return {
        title: "Wrong wallet network",
        detail: `Your wallet reports chain ${walletReadiness.chainId ?? "unknown"}; this deal uses Monad Testnet (10143).`,
      };
    }
    if (walletReadiness.status === "insufficient") {
      return {
        title: "More Testnet MON needed",
        detail: `Balance ${formatMon(walletReadiness.balanceWei ?? 0n, 5)} MON · short by ${formatMon(walletReadiness.shortfallWei ?? 0n, 5)} MON.`,
      };
    }
    if (walletReadiness.status === "ready") {
      return {
        title: "Ready to join",
        detail: `Balance ${formatMon(walletReadiness.balanceWei ?? 0n, 5)} MON · estimated total ${formatMon(walletReadiness.requiredBalanceWei ?? maxPriceWei, 5)} MON, including a 25% gas buffer.`,
      };
    }
    return {
      title: "Balance check unavailable",
      detail: "The live check could not complete. CrowdCart will still simulate the transaction before asking your wallet to confirm.",
    };
  })();

  const receiptFinalCostWei =
    dealPhase === "successful"
      ? deal?.clearingPrice ?? currentPriceWei
      : dealPhase === "cancelled" || dealPhase === "failed"
        ? 0n
        : currentPriceWei;
  const receiptEntitlementWei =
    dealPhase === "cancelled" || dealPhase === "failed"
      ? maxPriceWei
      : maxPriceWei > receiptFinalCostWei
        ? maxPriceWei - receiptFinalCostWei
        : 0n;

  return (
    <main className={`site-shell ${audienceMode ? "audience-mode" : ""}`}>
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="CrowdCart home">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>CROWD<span>CART</span></span>
        </a>

        <div className="topbar-actions">
          <a className="purchase-link" href="#my-purchases">
            <ReceiptText size={15} /> My purchases
            {savedDeals.length > 0 ? <span>{savedDeals.length}</span> : null}
          </a>
          <span className={`network-pill ${syncStatus}`}>
            <span className="network-dot" />
            {syncStatus === "live"
              ? "Live contract"
              : syncStatus === "stale"
                ? "Last sync"
                : "Monad Testnet"}
          </span>
          <button className="text-button desktop-only" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New deal
          </button>
          <button className="wallet-button" onClick={() => setShowWalletChooser(true)} disabled={isBusy}>
            <Wallet size={16} />
            {account ? shortenAddress(account) : "Connect wallet"}
          </button>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={15} /> Fair group buying, onchain</div>
          <h1>The price drops when the <em>crowd</em> shows up.</h1>
          <p>
            Join at the maximum price. Every new buyer unlocks a better price for
            everyone. After settlement, the difference becomes claimable from the contract.
          </p>
        </div>

        <div className="hero-proof" aria-label="Product benefits">
          <div><strong>400 ms</strong><span>Monad blocks</span></div>
          <div><strong>1 price</strong><span>shared by all</span></div>
          <div><strong>1 claim</strong><span>buyer-controlled refund</span></div>
        </div>
      </section>

      <section className="deal-stage" aria-labelledby="deal-title">
        <div className="deal-topline">
          <div className="live-label">
            <span className={dealPhase === "open" || dealPhase === "preview" && !previewFinalised ? "pulse" : "closed-dot"} />
            {phaseLabel(dealPhase, previewFinalised)}
          </div>
          <div className="deal-code">DEAL {activeDealId.toString().padStart(3, "0")} · ENCODE HUB</div>
        </div>

        {untrustedContractAttempt ? (
          <div className="contract-warning" role="alert">
            <ShieldAlert size={20} />
            <div>
              <strong>Unrecognised contract link</strong>
              <span>This site is pinned to the official CrowdCart deployment. No wallet action will be requested for {shortenAddress(untrustedContractAttempt)}.</span>
            </div>
            <button onClick={useOfficialDeal}>Use official deal</button>
          </div>
        ) : null}

        <div className="deal-grid">
          <div className="product-panel">
            <div className="product-visual" aria-label="Illustration of a pizza box">
              <div className="pizza-box">
                <span className="box-stamp">SLICE<br />HOUSE</span>
                <div className="pizza">
                  <span className="topping topping-one" />
                  <span className="topping topping-two" />
                  <span className="topping topping-three" />
                  <span className="topping topping-four" />
                  <span className="pizza-cut pizza-cut-one" />
                  <span className="pizza-cut pizza-cut-two" />
                </div>
              </div>
              <div className="product-badge"><Flame size={14} /> Hackathon special</div>
            </div>

            <div className="product-copy">
              <span className="product-kicker">Slice House × CrowdCart</span>
              <h2 id="deal-title">{productName}</h2>
              <p>One margherita pizza · Pickup from {productPickup}</p>
              <div className="product-meta">
                <span><ShieldCheck size={15} /> {contractPresent ? isOfficialDeployment ? "Official contract" : "Contract found" : isConfigured ? "Checking contract" : "Preview mode"}</span>
                <span><Users size={15} /> {buyerCount} joined</span>
              </div>
            </div>
          </div>

          <div className="price-panel">
            <div className="price-heading">
              <div>
                <span>{dealPhase === "cancelled" || dealPhase === "failed" ? "Final buyer cost" : "Everyone pays"}</span>
                <div className="price-value" key={currentPriceWei.toString()}>
                  {formatMon(currentPriceWei)} <small>MON</small>
                </div>
                <div className={`fiat-conversion ${fiatStatus}`} aria-live="polite">
                  <span className="fiat-status-dot" />
                  <div>
                    <strong>
                      {fiatQuote
                        ? `Est. ${fiatPair(currentPriceWei)}`
                        : fiatStatus === "unavailable"
                          ? "Fiat reference unavailable"
                          : "Loading fiat estimate…"}
                    </strong>
                    <small>
                      {fiatQuote
                        ? `${fiatStatus === "stale" ? "Last known" : "Mainnet spot-price equivalent"} · as of ${quoteUpdatedAt}`
                        : "Waiting for the mainnet MON market price"}
                    </small>
                  </div>
                </div>
              </div>
              <div className="countdown">
                <Clock3 size={17} />
                <span>
                  {dealPhase === "open"
                    ? formatTime(secondsLeft)
                    : dealPhase === "preview" && !previewFinalised
                      ? formatTime(previewSecondsLeft)
                      : dealPhase === "awaiting_finalisation"
                        ? "SETTLE"
                        : "CLOSED"}
                </span>
              </div>
            </div>

            <div className="price-drop-note">
              <ArrowDown size={16} /> Down {maxPriceWei === 0n ? 0 : Math.round(Number((maxPriceWei - currentPriceWei) * 100n / maxPriceWei))}% from {formatMon(maxPriceWei)} MON
            </div>

            <div className="tier-track" aria-label="Price tier progress">
              <div className="tier-line">
                <span style={{ width: `${Math.min(100, (buyerCount / displayTiers.at(-1)!.buyers) * 100)}%` }} />
              </div>
              <div className="tier-points">
                {displayTiers.map((tier) => {
                  const reached = buyerCount >= tier.buyers;
                  return (
                    <div className={`tier-point ${reached ? "reached" : ""}`} key={tier.buyers}>
                      <span className="tier-node">{reached ? <Check size={13} /> : tier.buyers}</span>
                      <strong>{formatMon(tier.price)}</strong>
                      <small>{tier.buyers} {tier.buyers === 1 ? "buyer" : "buyers"}</small>
                      {fiatQuote ? <em className="tier-fiat">mainnet ≈ {fiatPair(tier.price)}</em> : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="next-drop">
              {dealPhase === "awaiting_finalisation" ? (
                <>
                  <div className="next-drop-icon"><LockKeyhole size={19} /></div>
                  <div><strong>Settlement is ready</strong><span>Anyone can finalise and unlock buyer refunds.</span></div>
                </>
              ) : nextTier && (dealPhase === "open" || dealPhase === "preview") ? (
                <>
                  <div className="next-drop-icon"><Users size={19} /></div>
                  <div>
                    <strong>{nextTier.buyers - buyerCount} more {nextTier.buyers - buyerCount === 1 ? "buyer" : "buyers"} unlocks {formatMon(nextTier.price)} MON</strong>
                    <span>Invite the room. Everyone saves together.</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="next-drop-icon"><Sparkles size={19} /></div>
                  <div><strong>{dealPhase === "successful" ? "Final price confirmed" : "Best price unlocked"}</strong><span>The crowd reached its shared outcome.</span></div>
                </>
              )}
            </div>

            <div className="crowd-row">
              <div className="crowd-faces" aria-label={`${buyerCount} buyers in the crowd`}>
                {Array.from({ length: Math.min(buyerCount, 8) }).map((_, index) => (
                  <span className={`face face-${["lime", "coral", "lavender", "cream"][index % 4]}`} key={index}>{index + 1}</span>
                ))}
              </div>
              <div className="crowd-saving">
                <strong>{formatMon(totalSavedWei)} MON</strong>
                <span>{dealPhase === "cancelled" || dealPhase === "failed" ? "returning to the crowd" : "saved by this crowd"}</span>
                {fiatQuote ? <small>mainnet ≈ {fiatPair(totalSavedWei)}</small> : null}
              </div>
            </div>
          </div>

          <aside className="checkout-panel">
            <div className="checkout-heading">
              <div className="checkout-icon"><ShoppingBag size={20} /></div>
              <div><span>Your place in the crowd</span><strong>1 × Pizza drop</strong></div>
            </div>

            <div className="receipt-lines">
              <div><span>Maximum deposit</span><strong>{formatMon(maxPriceWei)} MON{fiatQuote ? <small>mainnet ≈ {fiatPair(maxPriceWei)}</small> : null}</strong></div>
              <div><span>{dealPhase === "successful" ? "Final cost" : "Price right now"}</span><strong>{formatMon(currentPriceWei)} MON{fiatQuote ? <small>mainnet ≈ {fiatPair(currentPriceWei)}</small> : null}</strong></div>
              <div className="refund-line">
                <span>{dealPhase === "open" || dealPhase === "preview" && !previewFinalised ? "Projected refund" : "Refund claimable"}</span>
                <strong>+{formatMon(dealPhase === "open" || dealPhase === "preview" && !previewFinalised ? projectedRefundWei : claimableRefundWei)} MON</strong>
              </div>
            </div>

            {showWalletReadiness ? (
              <div
                className={`wallet-readiness wallet-readiness-${walletReadiness.status}`}
                role="status"
                aria-live="polite"
              >
                <div className="wallet-readiness-icon" aria-hidden="true">
                  {walletReadiness.status === "checking" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : walletReadiness.status === "ready" ? (
                    <Check size={17} />
                  ) : walletReadiness.status === "disconnected" ? (
                    <Wallet size={17} />
                  ) : (
                    <ShieldAlert size={17} />
                  )}
                </div>
                <div className="wallet-readiness-copy">
                  <span>Wallet readiness</span>
                  <strong>{walletReadinessCopy.title}</strong>
                  <small>{walletReadinessCopy.detail}</small>
                  {walletReadiness.gasReserveWei !== null ? (
                    <em>
                      Live fee-cap allowance · {formatMon(walletReadiness.gasReserveWei, 6)} MON
                    </em>
                  ) : null}
                </div>
                <div className="wallet-readiness-actions">
                  {walletReadiness.status === "disconnected" ? (
                    <button type="button" onClick={() => setShowWalletChooser(true)}>
                      <Wallet size={13} /> Connect
                    </button>
                  ) : walletReadiness.status === "wrong_network" ? (
                    <button type="button" onClick={() => void switchToMonadTestnet()}>
                      <RefreshCw size={13} /> Switch
                    </button>
                  ) : walletReadiness.status === "insufficient" ? (
                    <>
                      <button type="button" onClick={openMonadFaucet}>
                        <ExternalLink size={13} /> Faucet
                      </button>
                      <button
                        type="button"
                        className="wallet-readiness-retry"
                        onClick={() => setWalletReadinessRefresh((current) => current + 1)}
                        aria-label="Refresh wallet balance"
                      >
                        <RefreshCw size={13} />
                      </button>
                    </>
                  ) : walletReadiness.status === "unavailable" ? (
                    <button
                      type="button"
                      onClick={() => setWalletReadinessRefresh((current) => current + 1)}
                    >
                      <RefreshCw size={13} /> Retry
                    </button>
                  ) : walletReadiness.status === "ready" ? (
                    <button
                      type="button"
                      className="wallet-readiness-retry"
                      onClick={() => setWalletReadinessRefresh((current) => current + 1)}
                      aria-label="Refresh wallet readiness"
                    >
                      <RefreshCw size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {canInvite && nextTier ? (
              <div className="invite-outcome">
                <Share2 size={17} />
                <div>
                  <strong>You&apos;re in. Bring {inviteBuyersNeeded} more.</strong>
                  <span>
                    Everyone saves another {formatMon(nextTierSavingWei)} MON; your projected refund becomes {formatMon(nextTierRefundWei)} MON.
                  </span>
                </div>
              </div>
            ) : null}

            <button
              ref={checkoutButtonRef}
              className={`join-button ${canInvite ? "invite" : hasJoined ? "joined" : ""}`}
              onClick={handleCheckoutAction}
              disabled={checkoutDisabled}
              data-testid="join-button"
            >
              {isBusy ? <LoaderCircle className="spin" size={19} /> : canInvite ? <Share2 size={19} /> : hasJoined || refundClaimed ? <Check size={19} /> : <Users size={19} />}
              {checkoutAction}
              {!checkoutDisabled && !isBusy ? <ChevronRight size={18} /> : null}
            </button>

            <p className="checkout-note"><LockKeyhole size={13} /> Deposits remain in the contract until settlement; refunds require a buyer claim.</p>
            <p className="fiat-disclaimer"><CircleDollarSign size={13} /> Estimated equivalent only. GBP and USD use a current mainnet MON spot reference, checked every 30 seconds; testnet MON is not redeemable for cash.</p>

            <details className="trust-panel">
              <summary>
                <ShieldCheck size={14} />
                <span>{contractPresent ? `${isOfficialDeployment ? "Official contract" : "On-chain proof"} · Deal #${activeDealId}` : "On-chain proof · Preview only"}</span>
                <ChevronDown size={14} />
              </summary>
              <div className="trust-grid">
                <div><span>Contract</span><strong>{activeContractAddress ? shortenAddress(activeContractAddress) : "Not linked"}</strong></div>
                <div><span>State</span><strong>{phaseLabel(dealPhase, previewFinalised)}</strong></div>
                <div><span>Fixed tiers</span><strong>{displayTiers.length}</strong></div>
                <div><span>Buyer limits</span><strong>{deal ? `${deal.minBuyers}–${deal.maxBuyers}` : "2–7 preview"}</strong></div>
                <div><span>Deadline</span><strong>{deal ? formatDate(deal.endsAt) : "Preview timer"}</strong></div>
                <div>
                  <span>Last confirmed</span>
                  <strong>
                    {lastConfirmedBlock
                      ? `Block ${lastConfirmedBlock}${lastSyncedAt ? ` · ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(lastSyncedAt))}` : ""}`
                      : "Not synced"}
                  </strong>
                </div>
              </div>
              {activeContractAddress ? (
                <a href={`${MONAD_TESTNET.blockExplorers.default.url}/address/${activeContractAddress}`} target="_blank" rel="noreferrer">
                  View contract on {MONAD_TESTNET.blockExplorers.default.name} <ExternalLink size={12} />
                </a>
              ) : (
                <button onClick={() => setShowContractSetup(true)}><Link2 size={12} /> Link live contract</button>
              )}
              <p>{contractPresent ? isOfficialDeployment ? "This address matches the CrowdCart deployment configured for this site. Source-verification status is shown in the linked explorer." : "Contract bytecode found on Monad Testnet. Source-verification status is shown in the linked explorer." : "Preview values are illustrative and are not onchain."}</p>
            </details>

            <div className="qr-card">
              <div className="qr-wrap"><QRCodeSVG value={shareUrl} size={78} bgColor="#f4ebdd" fgColor="#171315" level="M" /></div>
              <div>
                <span><QrCode size={14} /> Bring in the crowd</span>
                <strong>Scan to join this drop</strong>
                <button onClick={copyShareLink}><Copy size={12} /> Copy audience link</button>
                {!shareUrlIsPublic ? <small>Publish to HTTPS before scanning on another phone.</small> : null}
              </div>
            </div>
          </aside>
        </div>

        <div className="activity-strip">
          <div className="activity-title"><Activity size={15} /><span>Live activity</span></div>
          <ol aria-label="Recent deal activity">
            {activities.length > 0 ? activities.map((item) => (
              <li key={item.id}>
                <span className={item.preview ? "preview-event" : "chain-event"}>{item.preview ? "Preview" : "Onchain"}</span>
                <strong>{item.label}</strong>
                {item.detail ? <small>{item.detail}</small> : null}
                {item.transactionHash ? (
                  <a href={`${MONAD_TESTNET.blockExplorers.default.url}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer" aria-label={`View transaction for ${item.label}`}>
                    <ExternalLink size={12} />
                  </a>
                ) : null}
              </li>
            )) : <li><strong>Watching for new on-chain activity…</strong></li>}
          </ol>
          <button onClick={() => setShowPresenter((value) => !value)}>
            Presenter controls <ChevronRight size={14} />
          </button>
          <span className="sr-only" aria-live="polite">{activityAnnouncement}</span>
        </div>

        {showPresenter ? (
          <div className="presenter-panel" data-testid="presenter-panel">
            <div><span>{isConfigured ? "Live controls" : "Demo fallback"}</span><strong>{isConfigured ? "Uses the linked Testnet contract" : "Keep this open during the pitch"}</strong></div>
            <button onClick={() => setShowCreate(true)}><Plus size={15} /> New deal</button>
            <button onClick={addDemoBuyer} disabled={isConfigured || previewFinalised || previewBuyerCount >= PREVIEW_TIERS.at(-1)!.buyers}><Plus size={15} /> Add preview buyer</button>
            <button onClick={finaliseDeal} disabled={isBusy || isConfigured && dealPhase !== "awaiting_finalisation" || !isConfigured && previewFinalised}><LockKeyhole size={15} /> Finalise deal</button>
            <button onClick={() => setShowContractSetup(true)}><Link2 size={15} /> Link contract</button>
            <button onClick={() => void syncDeal(true)} disabled={!isConfigured}><RefreshCw size={15} /> Refresh chain</button>
            <button onClick={resetDemo} disabled={isConfigured}><RotateCcw size={15} /> Reset</button>
          </div>
        ) : null}

        <section className="buyer-centre" id="my-purchases" aria-labelledby="buyer-centre-title">
          <div className="buyer-centre-heading">
            <div>
              <span>BUYER CENTRE</span>
              <h2 id="buyer-centre-title">My purchase and refunds</h2>
            </div>
            <div className={`receipt-status ${phaseReceiptLabel(dealPhase, receiptBuyer).toLowerCase().replaceAll(" ", "-")}`}>
              {phaseReceiptLabel(dealPhase, receiptBuyer)}
            </div>
          </div>

          {receiptOwner && receiptBuyer.joined ? (
            <div className="buyer-receipt">
              <div className="receipt-summary">
                <div><span>Participant</span><strong>{shortenAddress(receiptOwner)}</strong></div>
                <div><span>Maximum deposit</span><strong>{formatMon(maxPriceWei)} MON</strong></div>
                <div><span>{dealPhase === "open" ? "Projected cost" : "Final cost"}</span><strong>{formatMon(receiptFinalCostWei)} MON</strong></div>
                <div><span>{dealPhase === "open" ? "Projected refund" : "Total refund entitlement"}</span><strong>{formatMon(receiptEntitlementWei)} MON</strong></div>
                <div><span>Claimable now</span><strong>{formatMon(receiptBuyer.refundAvailable)} MON</strong></div>
                <div><span>Receipt source</span><strong>{syncStatus === "live" ? "Monad Testnet" : "Last confirmed data"}</strong></div>
              </div>
              <div className="receipt-actions">
                {dealPhase === "awaiting_finalisation" ? (
                  <button onClick={finaliseDeal} disabled={isBusy}><LockKeyhole size={15} /> Finalise now</button>
                ) : receiptBuyer.refundAvailable > 0n && !receiptBuyer.refundClaimed ? (
                  account && receiptOwner.toLowerCase() === account.toLowerCase() ? (
                    <button onClick={claimRefund} disabled={isBusy}><CircleDollarSign size={15} /> Claim {formatMon(receiptBuyer.refundAvailable)} MON</button>
                  ) : (
                    <button onClick={() => setShowWalletChooser(true)}><Wallet size={15} /> Connect {shortenAddress(receiptOwner)}</button>
                  )
                ) : null}
                {selectedSavedDeal?.joinTxHash ? (
                  <a href={`${MONAD_TESTNET.blockExplorers.default.url}/tx/${selectedSavedDeal.joinTxHash}`} target="_blank" rel="noreferrer">Join receipt <ExternalLink size={12} /></a>
                ) : transactionHash ? (
                  <a href={`${MONAD_TESTNET.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">Latest transaction <ExternalLink size={12} /></a>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty-receipt">
              <ReceiptText size={24} />
              <div><strong>No purchase selected</strong><span>Join a live deal or open a saved receipt below. Confirmed joins are stored only on this device.</span></div>
            </div>
          )}

          <div className="saved-deals-heading"><Bookmark size={15} /><span>Saved on this device</span><small>{savedDeals.length}/20</small></div>
          {savedDeals.length > 0 ? (
            <div className="saved-deals-list">
              {savedDeals.map((saved) => (
                <article key={savedBuyerDealKey(saved)} className={selectedSavedDeal && savedBuyerDealKey(selectedSavedDeal) === savedBuyerDealKey(saved) ? "selected" : ""}>
                  <button className="saved-deal-open" onClick={() => openSavedDeal(saved)}>
                    <History size={16} />
                    <span><strong>Deal #{saved.dealId}</strong><small>{shortenAddress(saved.contractAddress)} · {shortenAddress(saved.buyerAddress)}</small></span>
                    <ChevronRight size={15} />
                  </button>
                  <a href={`${MONAD_TESTNET.blockExplorers.default.url}/tx/${saved.joinTxHash}`} target="_blank" rel="noreferrer" aria-label={`Open join transaction for deal ${saved.dealId}`}><ExternalLink size={13} /></a>
                  <button className="saved-deal-remove" onClick={() => removeSavedDeal(saved)} aria-label={`Remove deal ${saved.dealId} from this device`}><Trash2 size={13} /></button>
                </article>
              ))}
            </div>
          ) : <p className="saved-deals-empty">A confirmed on-chain join will appear here automatically.</p>}
        </section>
      </section>

      <section className="mechanics" aria-labelledby="mechanics-title">
        <div className="mechanics-intro">
          <span className="section-number">01 / HOW IT WORKS</span>
          <h2 id="mechanics-title">A better price is a shared outcome.</h2>
          <p>No coupon codes, private negotiations or faith in a merchant’s spreadsheet.</p>
        </div>
        <div className="mechanic-cards">
          <article><span className="mechanic-icon"><CircleDollarSign size={21} /></span><small>01</small><h3>Deposit the ceiling</h3><p>Each buyer commits the same visible maximum price to the deal contract.</p></article>
          <article><span className="mechanic-icon"><Users size={21} /></span><small>02</small><h3>Grow one crowd</h3><p>Every threshold lowers one transparent clearing price for every participant.</p></article>
          <article><span className="mechanic-icon"><ArrowDown size={21} /></span><small>03</small><h3>Claim the difference</h3><p>After settlement, each buyer can claim excess deposit directly from the contract.</p></article>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">C</span><span>CROWD<span>CART</span></span></div>
        <p>Built for Monad Blitz London · Hackathon software · Testnet funds only</p>
        <a href="https://docs.monad.xyz/developer-essentials/testnet" target="_blank" rel="noreferrer">Monad Testnet <ExternalLink size={13} /></a>
      </footer>

      <div className={`tx-toast ${txState}`} role="status" aria-live="polite">
        <span className="toast-icon">
          {txState === "wallet" || txState === "confirming" ? <LoaderCircle className="spin" size={18} /> : txState === "error" ? <X size={18} /> : txState === "success" ? <Check size={18} /> : <Sparkles size={18} />}
        </span>
        <div>
          <strong>{txState === "wallet" ? "Check your wallet" : txState === "confirming" ? "Confirming on Monad" : txState === "error" ? "Action needed" : txState === "success" ? "Crowd updated" : "Preview ready"}</strong>
          <span>{notice}</span>
          {transactionHash ? <a href={`${MONAD_TESTNET.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11} /></a> : null}
        </div>
        {txState !== "wallet" && txState !== "confirming" ? <button aria-label="Dismiss notification" onClick={() => setTxState("idle")}><X size={15} /></button> : null}
      </div>

      {showMobileBuyerAction ? (
        <div className="mobile-buyer-action" aria-label="CrowdCart buyer action">
          <div>
            <span>{canInvite ? "Next crowd saving" : "Price now"}</span>
            <strong>{canInvite ? `+${formatMon(nextTierSavingWei)}` : formatMon(currentPriceWei)} MON</strong>
            <small>Maximum deposit {formatMon(maxPriceWei)} MON</small>
          </div>
          <button onClick={handleCheckoutAction} disabled={checkoutDisabled}>
            {isBusy ? <LoaderCircle className="spin" size={18} /> : canInvite ? <Share2 size={18} /> : <ShoppingBag size={18} />}
            <span>{mobileCheckoutAction}</span>
          </button>
        </div>
      ) : null}

      {showWalletChooser ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowWalletChooser(false)}>
          <div className="create-modal wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" aria-label="Close wallet chooser" onClick={() => setShowWalletChooser(false)}><X size={18} /></button>
            <span className="modal-kicker">MOBILE-READY CHECKOUT</span>
            <h2 id="wallet-title">{account ? "Wallet connected." : "Choose how to join."}</h2>
            <p className="wallet-modal-intro">Your deal and contract stay attached when you continue in a wallet.</p>
            {account ? (
              <div className="connected-wallet-card">
                {walletReadiness.status === "wrong_network" ? <ShieldAlert size={18} /> : <Check size={18} />}
                <div>
                  <strong>{shortenAddress(account)}</strong>
                  <span>
                    {walletReadiness.status === "wrong_network"
                      ? `Wrong network · chain ${walletReadiness.chainId ?? "unknown"}`
                      : walletPreflightIsCurrent && walletPreflight.chainId === MONAD_TESTNET.id
                        ? "Monad Testnet"
                        : "Network check pending"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="wallet-options">
                {reownWallet.enabled ? (
                  <button onClick={() => { reownWallet.open(); setShowWalletChooser(false); }}><QrCode size={19} /><span><strong>WalletConnect</strong><small>Choose a mobile or desktop wallet</small></span><ChevronRight size={16} /></button>
                ) : null}
                <button onClick={connectInjectedWallet}><Wallet size={19} /><span><strong>Browser wallet</strong><small>MetaMask or another installed EVM wallet</small></span><ChevronRight size={16} /></button>
                {metaMaskLink ? (
                  <a href={metaMaskLink}><Smartphone size={19} /><span><strong>Open in MetaMask</strong><small>Continue in the mobile wallet browser</small></span><ChevronRight size={16} /></a>
                ) : (
                  <button disabled><Smartphone size={19} /><span><strong>Mobile hand-off needs HTTPS</strong><small>Available after the public site is configured</small></span></button>
                )}
              </div>
            )}
            <div className="wallet-modal-actions">
              <button onClick={copyShareLink}><Copy size={14} /> Copy deal link</button>
              {account ? <button onClick={disconnectWallet}><X size={14} /> Disconnect</button> : null}
            </div>
            {!reownWallet.enabled ? <p className="wallet-setup-note"><ShieldCheck size={13} /> WalletConnect activates only on the published HTTPS site with its public Reown project identifier.</p> : null}
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}>
          <div className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" aria-label="Close create deal form" onClick={() => setShowCreate(false)}><X size={18} /></button>
            <span className="modal-kicker">NEW GROUP DROP</span>
            <h2 id="create-title">Create a deal people can move together.</h2>
            <form onSubmit={createDeal}>
              <label>Product name<input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={52} required /></label>
              <div className="form-row"><label>Maximum price<input value="0.010 MON" disabled /></label><label>Deal duration<input value="3 minutes" disabled /></label></div>
              <div className="modal-tiers"><span>Price tiers</span>{PREVIEW_TIERS.map((tier) => <div key={tier.buyers}><span>{tier.buyers}+ buyers</span><strong>{formatMon(tier.price)} MON</strong></div>)}</div>
              <button className="join-button" type="submit" disabled={isBusy}><Plus size={18} /> {isConfigured && account ? "Create on Monad" : "Create preview deal"}</button>
              <p><ShieldCheck size={13} /> These fixed tiers become immutable once published.</p>
            </form>
          </div>
        </div>
      ) : null}

      {showContractSetup ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowContractSetup(false)}>
          <div className="create-modal setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" aria-label="Close contract setup" onClick={() => setShowContractSetup(false)}><X size={18} /></button>
            <span className="modal-kicker">PRESENTER SETUP</span>
            <h2 id="setup-title">Link the live Monad deal.</h2>
            <form onSubmit={linkContract}>
              <label>CrowdCart contract address<input value={draftContractAddress} onChange={(event) => setDraftContractAddress(event.target.value)} placeholder="0x…" spellCheck={false} required /></label>
              <label className="setup-deal-field">Deal ID<input value={draftDealId} onChange={(event) => setDraftDealId(event.target.value)} inputMode="numeric" pattern="[0-9]+" required /></label>
              <button className="join-button" type="submit"><Link2 size={18} /> Verify and link Testnet deal</button>
              <p className="setup-help"><ShieldCheck size={13} /> CrowdCart checks the contract code and deal before updating the audience link.</p>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}

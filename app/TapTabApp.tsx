"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  CirclePoundSterling,
  Clock3,
  Copy,
  ExternalLink,
  HandCoins,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Split,
  Users,
  Vote,
  Wallet,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  calculateTapTabPreview,
  type BillParticipant,
  type BillPayment,
  type ItemClaim,
  type ReceiptItem,
} from "./taptab-model";
import { tapTabDeployment, type TapTabContext } from "./taptab-chain";
import {
  TapTabLivePanel,
  type TapTabLiveUpdate,
} from "./TapTabLivePanel";
import {
  TapTabCreateBillPanel,
  type TapTabCreatedBill,
} from "./TapTabCreateBillPanel";
import { TapTabDemoResiliencePanel } from "./TapTabDemoResiliencePanel";
import { TapTabLocalEvidencePanel } from "./TapTabLocalEvidencePanel";
import {
  finiteNumberToPlainDecimal,
  type TapTabCreateBillQuote,
} from "./taptab-create-bill";
import type { TapTabDemoRecoveryEvidenceInput } from "./taptab-demo-resilience";
import {
  TAPTAB_PRICE_MAX_AGE_SECONDS,
  lockTapTabPriceReference,
  parseTapTabPriceReference,
  type TapTabLockedPriceReference,
  type TapTabPriceReference,
} from "./taptab-price-reference";
import {
  formatTapTabAmount,
  shortTapTabAddress,
  tapTabPhaseLabel,
} from "./taptab-live-helpers";
import {
  ReceiptImportPanel,
  type AppliedReceipt,
} from "./ReceiptImportPanel";
import { TapTabJudgeGuide } from "./TapTabJudgeGuide";
import { TapTabHostJourney } from "./TapTabHostJourney";
import { useTapTabPwa } from "./TapTabPwaBridge";
import { TapTabSettlementReceipt } from "./TapTabSettlementReceipt";
import type { TapTabSettlementReceiptInput } from "./taptab-settlement-receipt";
import { useTapTabWallet } from "./wallet";

type BillPhase =
  | "claiming"
  | "funding"
  | "settled"
  | "cancelled"
  | "expired";

type WorkspaceMode = "preview" | "live";

type DinerClaimStep = "claim" | "shared" | "review";

type Participant = BillParticipant & {
  initials: string;
  colour: string;
};

type FeedEvent = {
  id: number;
  title: string;
  detail: string;
  kind: "join" | "claim" | "vote" | "payment" | "safety";
};

const INITIAL_RECEIPT_ITEMS: readonly ReceiptItem[] = [
  { id: "margherita", name: "Wood-fired margherita", pricePence: 1_200, shareSlots: 1 },
  { id: "fries", name: "Truffle fries", pricePence: 750, shareSlots: 2 },
  { id: "burrata", name: "Burrata & tomatoes", pricePence: 900, shareSlots: 2 },
  { id: "house-red", name: "Bottle of house red", pricePence: 1_400, shareSlots: 4 },
  { id: "gelato", name: "Pistachio gelato", pricePence: 600, shareSlots: 2 },
];

const INITIAL_PARTICIPANTS: readonly Participant[] = [
  {
    id: "you",
    name: "You",
    initials: "YO",
    colour: "#5f4cf6",
    remainderOptIn: true,
    tipVoteBps: 1_250,
  },
  {
    id: "amina",
    name: "Amina",
    initials: "AM",
    colour: "#c84f3a",
    remainderOptIn: true,
    tipVoteBps: 1_000,
  },
  {
    id: "theo",
    name: "Theo",
    initials: "TH",
    colour: "#11866f",
    remainderOptIn: false,
    tipVoteBps: 1_250,
  },
  {
    id: "jules",
    name: "Jules",
    initials: "JU",
    colour: "#a65f00",
    remainderOptIn: false,
    tipVoteBps: 0,
  },
];

const PREVIEW_PAYMENT_TOKEN_BY_ID = new Map(
  INITIAL_PARTICIPANTS.map((participant, index) => [participant.id, `p${index + 1}`]),
);
const PREVIEW_PARTICIPANT_ID_BY_TOKEN = new Map(
  [...PREVIEW_PAYMENT_TOKEN_BY_ID].map(([participantId, token]) => [
    token,
    participantId,
  ]),
);

const INITIAL_CLAIMS: readonly ItemClaim[] = [
  { participantId: "you", itemId: "margherita", shareIndexes: [0] },
  { participantId: "you", itemId: "fries", shareIndexes: [0] },
  { participantId: "amina", itemId: "fries", shareIndexes: [1] },
  { participantId: "theo", itemId: "burrata", shareIndexes: [0] },
  { participantId: "amina", itemId: "house-red", shareIndexes: [0] },
  { participantId: "theo", itemId: "house-red", shareIndexes: [1] },
  { participantId: "jules", itemId: "house-red", shareIndexes: [2] },
  { participantId: "jules", itemId: "gelato", shareIndexes: [0] },
];

const INITIAL_FEED: readonly FeedEvent[] = [
  {
    id: 3,
    title: "Theo claimed a shared item",
    detail: "1 of 2 Burrata shares",
    kind: "claim",
  },
  {
    id: 2,
    title: "Amina joined Table 7",
    detail: "Fair remainder is on",
    kind: "join",
  },
  {
    id: 1,
    title: "Bill created",
    detail: "Five items · £48.50 subtotal",
    kind: "safety",
  },
];

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

const GBP_SPOT = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const USD_SPOT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const PHASE_LABELS: Record<BillPhase, string> = {
  claiming: "Claiming items",
  funding: "Collecting payments",
  settled: "Settled",
  cancelled: "Cancelled",
  expired: "Expired",
};

const TIP_PRESETS = [0, 1_000, 1_250] as const;
const STAGE_AVATAR_COLOURS = ["#5f4cf6", "#c84f3a", "#11866f", "#a65f00"] as const;

const GUIDED_DEMO_STEPS = [
  {
    title: "Claim a shared item",
    description:
      "Add the remaining gelato share to your items and watch the GBP split update.",
    action: "Show a shared claim",
  },
  {
    title: "Approve one exact split",
    description:
      "Record every diner’s approval for this version so later changes cannot go unnoticed.",
    action: "Approve the split",
  },
  {
    title: "Sponsor someone",
    description:
      "Open protected payments and let you cover Theo’s remaining share.",
    action: "Sponsor Theo",
  },
  {
    title: "Fund the exact remainder",
    description:
      "Simulate the remaining diners paying their own parts. Overpayment is never added.",
    action: "Fund the exact remainder",
  },
  {
    title: "Settle and prove it",
    description:
      "Settlement unlocks only after the bill is fully funded, then produces a shareable receipt.",
    action: "Settle and open receipt",
  },
] as const;

function money(pence: number) {
  return GBP.format(pence / 100);
}

function percentage(basisPoints: number) {
  return `${Number((basisPoints / 100).toFixed(2))}%`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function buildCanonicalPreviewUrl(origin: string) {
  const url = new URL("/", origin);
  url.searchParams.set("workspace", "preview");
  url.searchParams.set("preview", "table-7");
  url.hash = "bill";
  return url.toString();
}

function quoteTime(timestamp: number | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp * 1_000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function confirmationTime(milliseconds: number) {
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(2)} s`;
}

function copyParticipants(participants: readonly Participant[]) {
  return participants.map((participant) => ({ ...participant }));
}

function copyClaims(claims: readonly ItemClaim[]) {
  return claims.map((claim) => ({
    ...claim,
    shareIndexes: [...claim.shareIndexes],
  }));
}

function feedIcon(kind: FeedEvent["kind"]) {
  if (kind === "payment") return <Check size={14} strokeWidth={2.7} />;
  if (kind === "vote") return <Vote size={14} />;
  if (kind === "join") return <Users size={14} />;
  if (kind === "claim") return <ReceiptText size={14} />;
  return <ShieldCheck size={14} />;
}

export function TapTabApp() {
  const wallet = useTapTabWallet();
  const {
    canPromptInstall,
    installError,
    requestInstall,
    serviceWorkerStatus,
    shareAvailability,
    shareStatus,
    shareError,
    share,
  } = useTapTabPwa();
  const liveConfigured = tapTabDeployment.status === "configured";
  const [merchant, setMerchant] = useState("Lina Stores");
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>(() =>
    INITIAL_RECEIPT_ITEMS.map((item) => ({ ...item })),
  );
  const [participants, setParticipants] = useState<Participant[]>(() =>
    copyParticipants(INITIAL_PARTICIPANTS),
  );
  const [claims, setClaims] = useState<ItemClaim[]>(() => copyClaims(INITIAL_CLAIMS));
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [phase, setPhase] = useState<BillPhase>("claiming");
  const [sponsorId, setSponsorId] = useState("theo");
  const [leavingParticipantId, setLeavingParticipantId] = useState("theo");
  const [transferTargetId, setTransferTargetId] = useState("amina");
  const [feed, setFeed] = useState<FeedEvent[]>(() => [...INITIAL_FEED]);
  const [stageMode, setStageMode] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("preview");
  const [guidedDemoActive, setGuidedDemoActive] = useState(false);
  const [guidedDemoStep, setGuidedDemoStep] = useState(0);
  const [dinerClaimStep, setDinerClaimStep] = useState<DinerClaimStep>("claim");
  const [receiptStudioOpen, setReceiptStudioOpen] = useState(false);
  const [receiptAppliedStatus, setReceiptAppliedStatus] = useState("");
  const [dinerFeedback, setDinerFeedback] = useState<{
    tone: "ready" | "warning";
    message: string;
  }>();
  const [inviteUrl, setInviteUrl] = useState(
    "http://localhost:3000/?workspace=preview&preview=table-7#bill",
  );
  const [copied, setCopied] = useState(false);
  const [copiedPaymentId, setCopiedPaymentId] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const [copyRecoveryUrl, setCopyRecoveryUrl] = useState<string>();
  const [targetedParticipantId, setTargetedParticipantId] = useState<string>();
  const [price, setPrice] = useState<TapTabPriceReference>();
  const [priceState, setPriceState] = useState<
    "loading" | "live" | "stale" | "unavailable"
  >("loading");
  const [manualCreateBillQuote, setManualCreateBillQuote] =
    useState<TapTabCreateBillQuote>();
  const [lockedPriceReference, setLockedPriceReference] =
    useState<TapTabLockedPriceReference>();
  const [refundedPayers, setRefundedPayers] = useState<string[]>([]);
  const [approvedParticipantIds, setApprovedParticipantIds] = useState<string[]>([]);
  const [splitRevision, setSplitRevision] = useState(1);
  const [liveUpdate, setLiveUpdate] = useState<TapTabLiveUpdate>({
    snapshot: null,
    events: [],
    shareUrl: "",
  });
  const [lastCreatedBill, setLastCreatedBill] = useState<TapTabCreatedBill>();
  const stageDialogRef = useRef<HTMLDivElement>(null);
  const stageCloseButtonRef = useRef<HTMLButtonElement>(null);
  const receiptSummaryRef = useRef<HTMLElement>(null);

  const handleLiveUpdate = useCallback((update: TapTabLiveUpdate) => {
    setLiveUpdate(update);
  }, []);

  const input = useMemo(
    () => ({ items: receiptItems, participants, claims, payments }),
    [claims, participants, payments, receiptItems],
  );
  const preview = useMemo(() => calculateTapTabPreview(input), [input]);

  const participantById = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant])),
    [participants],
  );
  const participantPreviewById = useMemo(
    () =>
      new Map(
        preview.participants.map((participant) => [participant.participantId, participant]),
      ),
    [preview.participants],
  );
  const currentUser = participantPreviewById.get("you");
  const claimedSlotsByItem = useMemo(() => {
    const result = new Map<string, number>();
    for (const claim of claims) {
      result.set(
        claim.itemId,
        (result.get(claim.itemId) ?? 0) + claim.shareIndexes.length,
      );
    }
    return result;
  }, [claims]);
  const hasUnclaimedSlots = receiptItems.some(
    (item) => (claimedSlotsByItem.get(item.id) ?? 0) < item.shareSlots,
  );
  const allParticipantsApproved = participants.every((participant) =>
    approvedParticipantIds.includes(participant.id),
  );
  const progress = preview.totalDuePence
    ? Math.round((preview.funding.fundedPence / preview.totalDuePence) * 100)
    : 0;
  const liveCreateBillQuote = useMemo(
    () => {
      if (!price || priceState !== "live") return undefined;
      try {
        return {
          gbpPerMon: finiteNumberToPlainDecimal(price.gbp),
          source: price.source,
          basis: price.basis,
          observedAtUnixSeconds: price.lastUpdatedAt,
        };
      } catch {
        return undefined;
      }
    },
    [price, priceState],
  );
  const activeManualCreateBillQuote = liveCreateBillQuote
    ? undefined
    : manualCreateBillQuote;
  const createBillQuote = liveCreateBillQuote ?? activeManualCreateBillQuote;
  const rateForEstimate =
    lockedPriceReference?.gbpPerMon ??
    (createBillQuote ? Number(createBillQuote.gbpPerMon) : price?.gbp);
  const sponsorableParticipants = preview.participants.filter(
    (participant) =>
      participant.participantId !== "you" && participant.unpaidPence > 0,
  );
  const activeSponsorId = sponsorableParticipants.some(
    (participant) => participant.participantId === sponsorId,
  )
    ? sponsorId
    : sponsorableParticipants[0]?.participantId;
  const sponsor = activeSponsorId
    ? participantPreviewById.get(activeSponsorId)
    : undefined;
  const contributorTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const payment of payments) {
      totals.set(payment.payerId, (totals.get(payment.payerId) ?? 0) + payment.amountPence);
    }
    return totals;
  }, [payments]);
  const failed = phase === "cancelled" || phase === "expired";
  const refundedPence = refundedPayers.reduce(
    (total, payerId) => total + (contributorTotals.get(payerId) ?? 0),
    0,
  );
  const refundableRemainingPence = Math.max(
    0,
    preview.funding.fundedPence - refundedPence,
  );
  const stageProgress = failed
    ? preview.funding.fundedPence > 0
      ? Math.round((refundedPence / preview.funding.fundedPence) * 100)
      : 0
    : phase === "claiming"
      ? Math.round((approvedParticipantIds.length / participants.length) * 100)
      : progress;
  const liveSnapshot = liveUpdate.snapshot;
  const liveStage =
    workspaceMode === "live" && liveConfigured && liveSnapshot !== null;
  const lastCreatedBillMatchesLiveContext = Boolean(
    lastCreatedBill &&
      (!liveSnapshot ||
        (lastCreatedBill.context.billId === liveSnapshot.context.billId &&
          lastCreatedBill.context.address.toLowerCase() ===
            liveSnapshot.context.address.toLowerCase())),
  );
  const hostQuote =
    liveUpdate.metadata?.quote ??
    (lastCreatedBillMatchesLiveContext ? lastCreatedBill?.quote : undefined) ??
    createBillQuote;
  const hostBillContext = liveSnapshot?.context ?? lastCreatedBill?.context;
  const hostQuoteDetail = hostQuote
    ? `£${hostQuote.gbpPerMon} per MON · ${hostQuote.source}`
    : "Wait for a current or acknowledged fallback quote.";
  const hostBillDetail = liveSnapshot
    ? `Trusted bill #${liveSnapshot.context.billId.toString()} loaded from Monad Testnet.`
    : lastCreatedBill
      ? `Bill #${lastCreatedBill.context.billId.toString()} confirmed in block ${lastCreatedBill.blockNumber.toString()}.`
      : "Create or recover a trusted contract-backed bill.";
  const hostCanInvite = Boolean(
    wallet.account &&
      liveSnapshot?.phase === "draft" &&
      wallet.account.toLowerCase() === liveSnapshot.bill.creator.toLowerCase(),
  );
  const hostInvitationDetail = liveSnapshot
    ? liveSnapshot.participants.length > 1
      ? `${liveSnapshot.participants.length} wallets have joined this bill.`
      : hostCanInvite
        ? "The host invitation form is ready for wallet addresses."
        : liveSnapshot.phase === "draft"
          ? "Connect the bill creator wallet to open invitations."
          : "This bill has moved beyond its invitation phase."
    : "Load a trusted bill before inviting wallet addresses.";
  const latestMeasuredConfirmation =
    lastCreatedBill &&
    (!liveUpdate.latestConfirmation ||
      lastCreatedBill.confirmedAt > liveUpdate.latestConfirmation.confirmedAt)
      ? {
          action: "Create live bill",
          blockNumber: lastCreatedBill.blockNumber,
          confirmationMs: lastCreatedBill.confirmationMs,
        }
      : liveUpdate.latestConfirmation;
  const liveFailed =
    liveSnapshot?.phase === "cancelled" || liveSnapshot?.phase === "expired";
  const liveTerminal = liveFailed || liveSnapshot?.phase === "settled";
  const liveStageTotal = liveSnapshot
    ? liveSnapshot.bill.totalDue || liveSnapshot.bill.subtotal
    : 0n;
  const liveClaimedShares =
    liveSnapshot?.items.reduce((total, item) => total + item.claimedShareCount, 0) ?? 0;
  const liveTotalShares =
    liveSnapshot?.items.reduce((total, item) => total + item.shareCount, 0) ?? 0;
  const liveApprovalCount = liveSnapshot?.splitStatus.approvalCount ?? 0;
  const liveRequiredApprovals = liveSnapshot?.splitStatus.requiredApprovals ?? 0;
  const livePrivateNameByAddress = useMemo(
    () =>
      new Map(
        (liveUpdate.privateNames ?? []).map((entry) => [
          entry.address.toLowerCase(),
          entry.name,
        ]),
      ),
    [liveUpdate.privateNames],
  );
  const liveParticipantDisplayPenceByAddress = useMemo(
    () =>
      new Map(
        (liveUpdate.gbpDisplay?.participants ?? []).map((participant) => [
          participant.address.toLowerCase(),
          participant,
        ]),
      ),
    [liveUpdate.gbpDisplay?.participants],
  );
  const liveStageProgress =
    liveSnapshot?.phase === "draft"
      ? liveRequiredApprovals > 0
        ? Math.min(100, (liveApprovalCount / liveRequiredApprovals) * 100)
        : 0
      : liveSnapshot && liveStageTotal > 0n
        ? Math.min(
            100,
            Number((liveSnapshot.bill.totalFunded * 10_000n) / liveStageTotal) / 100,
          )
      : 0;

  const dinerJourneyStage =
    phase === "settled"
      ? "receipt"
      : phase === "funding" || failed
        ? "fund"
        : dinerClaimStep;
  const dinerJourneyStages = [
    { id: "claim", label: "Claim yours" },
    { id: "shared", label: "Tip & extras" },
    { id: "review", label: "Review" },
    { id: "fund", label: "Pay" },
    { id: "receipt", label: "Receipt" },
  ] as const;
  const dinerJourneyIndex = dinerJourneyStages.findIndex(
    (stage) => stage.id === dinerJourneyStage,
  );
  const currentUserApproved = approvedParticipantIds.includes("you");
  const otherApprovalsOutstanding = Math.max(
    0,
    participants.length - approvedParticipantIds.length,
  );
  const dinerStatus = failed
    ? {
        tone: "warning",
        message:
          (contributorTotals.get("you") ?? 0) > 0 && !refundedPayers.includes("you")
            ? `This bill ended safely. Your ${money(contributorTotals.get("you") ?? 0)} refund is ready.`
            : "This bill ended safely. Contributions remain with their original payers.",
      }
    : phase === "settled"
      ? {
          tone: "ready",
          message: `Payment complete. Table 7 settled for ${money(preview.totalDuePence)}.`,
        }
      : phase === "funding"
        ? (currentUser?.unpaidPence ?? 0) > 0
          ? {
              tone: "ready",
              message: `Your protected payment of ${money(currentUser?.unpaidPence ?? 0)} is ready.`,
            }
          : preview.funding.canSettle
            ? {
                tone: "ready",
                message: "Everyone is covered. The organiser can now settle the exact bill.",
              }
            : {
                tone: "warning",
                message: `Your share is covered. The group still needs ${money(preview.funding.remainingPence)}.`,
              }
        : dinerClaimStep === "claim"
          ? {
              tone: "ready",
              message: "Choose Mine beside each thing you had. You can change it until the split is approved.",
            }
          : dinerClaimStep === "shared"
            ? {
                tone: "ready",
                message: "Choose your tip and volunteer only if you are happy to share anything unclaimed.",
              }
            : currentUserApproved
              ? {
                  tone: allParticipantsApproved ? "ready" : "warning",
                  message: allParticipantsApproved
                    ? "Everyone approved this version. Payments can now open."
                    : `You approved version ${splitRevision}. Waiting for ${otherApprovalsOutstanding} other diner${otherApprovalsOutstanding === 1 ? "" : "s"}.`,
                }
              : {
                  tone: "ready",
                  message: "Check your pound total, then approve this version of the split.",
                };
  const visibleDinerStatus = dinerFeedback ?? dinerStatus;
  const previewSettlementReceipt = useMemo<TapTabSettlementReceiptInput>(
    () => ({
      merchant,
      tableLabel: "Table 7",
      subtotalPence: preview.subtotalPence,
      tipPence: preview.tipPence,
      totalDuePence: preview.totalDuePence,
      fundedPence: preview.funding.fundedPence,
      allocations: preview.participants.map((allocation) => ({
        id: allocation.participantId,
        displayName:
          participantById.get(allocation.participantId)?.name ?? "Diner",
        totalDuePence: allocation.totalDuePence,
        selfPaidPence: allocation.selfPaidPence,
        sponsoredByOthersPence: allocation.sponsoredByOthersPence,
        sponsoredForOthersPence: allocation.sponsoredForOthersPence,
      })),
      evidence: {
        kind: "preview",
        message:
          "This is a deterministic local rehearsal. It is not a Monad transaction or proof of payment.",
      },
      receiptUrl: inviteUrl,
    }),
    [inviteUrl, merchant, participantById, preview],
  );

  const recoveryContext = useMemo<TapTabContext | undefined>(() => {
    if (liveSnapshot) return liveSnapshot.context;
    if (lastCreatedBill) return lastCreatedBill.context;
    return tapTabDeployment.status === "configured"
      ? { address: tapTabDeployment.address, billId: tapTabDeployment.billId }
      : undefined;
  }, [lastCreatedBill, liveSnapshot]);
  const recoveryQuote = useMemo(() => {
    if (liveCreateBillQuote) {
      return { ...liveCreateBillQuote, mode: "live" as const };
    }
    if (activeManualCreateBillQuote) {
      return { ...activeManualCreateBillQuote, mode: "manual" as const };
    }
    if (!price) return undefined;
    try {
      return {
        gbpPerMon: finiteNumberToPlainDecimal(price.gbp),
        source: price.source,
        basis: price.basis,
        observedAtUnixSeconds: price.lastUpdatedAt,
        mode: "stale" as const,
      };
    } catch {
      return undefined;
    }
  }, [activeManualCreateBillQuote, liveCreateBillQuote, price]);
  const recoveryEvidence = useMemo<readonly TapTabDemoRecoveryEvidenceInput[]>(() => {
    const evidence: TapTabDemoRecoveryEvidenceInput[] = [];
    const seen = new Set<string>();
    const add = (entry: TapTabDemoRecoveryEvidenceInput) => {
      const key = entry.transactionHash.toLowerCase();
      if (seen.has(key) || evidence.length >= 10) return;
      seen.add(key);
      evidence.push(entry);
    };

    if (lastCreatedBill) {
      add({
        action: "Create live bill",
        transactionHash: lastCreatedBill.transactionHash,
        blockNumber: lastCreatedBill.blockNumber,
        confirmedAtUnixSeconds: Math.floor(lastCreatedBill.confirmedAt / 1_000),
        confirmationMs: lastCreatedBill.confirmationMs,
      });
    }
    if (liveUpdate.latestConfirmation) {
      add({
        action: liveUpdate.latestConfirmation.action,
        transactionHash: liveUpdate.latestConfirmation.transactionHash,
        blockNumber: liveUpdate.latestConfirmation.blockNumber,
        confirmedAtUnixSeconds: Math.floor(
          liveUpdate.latestConfirmation.confirmedAt / 1_000,
        ),
        confirmationMs: liveUpdate.latestConfirmation.confirmationMs,
      });
    }
    for (const event of liveUpdate.events) {
      if (!event.transactionHash || event.blockNumber === undefined) continue;
      add({
        action: event.eventName ?? "Confirmed Monad transaction",
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        ...(event.confirmationMs === undefined
          ? {}
          : { confirmationMs: event.confirmationMs }),
      });
    }
    return evidence;
  }, [lastCreatedBill, liveUpdate.events, liveUpdate.latestConfirmation]);
  const recoverySource = useMemo(
    () => ({
      merchant,
      items: receiptItems,
      audienceUrl: liveUpdate.shareUrl || inviteUrl,
      ...(recoveryContext ? { context: recoveryContext } : {}),
      ...(recoveryQuote ? { quote: recoveryQuote } : {}),
      evidence: recoveryEvidence,
    }),
    [
      inviteUrl,
      liveUpdate.shareUrl,
      merchant,
      receiptItems,
      recoveryContext,
      recoveryEvidence,
      recoveryQuote,
    ],
  );

  useEffect(() => {
    const syncWorkspaceFromLocation = () => {
      setInviteUrl(buildCanonicalPreviewUrl(window.location.origin));
      const params = new URLSearchParams(window.location.search);
      const requestedWorkspace = params.get("workspace");
      const liveEntry = params.has("contract") || params.has("bill");
      setWorkspaceMode(
        requestedWorkspace === "preview" || requestedWorkspace === "live"
          ? requestedWorkspace
          : liveEntry
            ? "live"
            : "preview",
      );
      const targets = params.getAll("pay");
      const participantId =
        targets.length === 1
          ? PREVIEW_PARTICIPANT_ID_BY_TOKEN.get(targets[0])
          : undefined;
      if (
        params.get("preview") === "table-7" &&
        participantId &&
        INITIAL_PARTICIPANTS.some((participant) => participant.id === participantId)
      ) {
        setSponsorId(participantId);
        setTargetedParticipantId(participantId);
      } else {
        setTargetedParticipantId(undefined);
      }
    };

    const frame = window.requestAnimationFrame(syncWorkspaceFromLocation);
    window.addEventListener("popstate", syncWorkspaceFromLocation);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("popstate", syncWorkspaceFromLocation);
    };
  }, []);

  useEffect(() => {
    if (!stageMode) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backgroundElements = Array.from(
      document.querySelectorAll<HTMLElement>(".taptab-shell > :not(.stage-overlay)"),
    );
    for (const element of backgroundElements) element.setAttribute("inert", "");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      stageCloseButtonRef.current?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStageMode(false);
      if (event.key !== "Tab") return;

      const dialog = stageDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const element of backgroundElements) element.removeAttribute("inert");
      previouslyFocused?.focus();
    };
  }, [stageMode]);

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let hasPrice = false;
    let lastPrice: TapTabPriceReference | undefined;

    const loadPrice = async () => {
      controller = new AbortController();
      const abortTimer = window.setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch("/api/mon-price", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("price unavailable");
        const candidate = await response.json();
        const nextPrice = parseTapTabPriceReference(candidate, {
          responseStatus: response.headers.get("x-taptab-price-status"),
        });
        if (!active) return;
        setPrice(nextPrice);
        setPriceState(nextPrice.state);
        failures = 0;
        hasPrice = true;
        lastPrice = nextPrice;
        if (nextPrice.state === "live") setManualCreateBillQuote(undefined);
      } catch {
        if (active) {
          failures += 1;
          const cachedAge = lastPrice
            ? Math.floor(Date.now() / 1_000) - lastPrice.lastUpdatedAt
            : Number.POSITIVE_INFINITY;
          if (hasPrice && cachedAge <= TAPTAB_PRICE_MAX_AGE_SECONDS) {
            setPriceState("stale");
          } else {
            setPrice(undefined);
            setPriceState("unavailable");
            hasPrice = false;
            lastPrice = undefined;
          }
        }
      } finally {
        window.clearTimeout(abortTimer);
        controller = undefined;
        if (active) {
          const backoff = Math.min(120_000, 30_000 * 2 ** Math.min(failures, 2));
          const jitter = Math.round(Math.random() * 5_000);
          timeout = setTimeout(loadPrice, backoff + jitter);
        }
      }
    };

    void loadPrice();
    return () => {
      active = false;
      controller?.abort();
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  const addFeed = (
    title: string,
    detail: string,
    kind: FeedEvent["kind"],
  ) => {
    setFeed((current) => [
      { id: (current[0]?.id ?? 0) + 1, title, detail, kind },
      ...current,
    ].slice(0, 8));
  };

  const openCreatedBill = (created: TapTabCreatedBill) => {
    setLastCreatedBill(created);
    setWorkspaceMode("live");
    setReceiptStudioOpen(false);
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("contract", created.context.address);
    url.searchParams.set("bill", created.context.billId.toString());
    url.hash = "live";
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    addFeed(
      `Live bill #${created.context.billId.toString()} created`,
      `Receipt confirmed in Monad block ${created.blockNumber.toString()}`,
      "safety",
    );
    window.requestAnimationFrame(() => {
      document.getElementById("live")?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const restoreRecoveryReceipt = (receipt: Readonly<{
    merchant: string;
    items: readonly ReceiptItem[];
  }>) => {
    setMerchant(receipt.merchant);
    setReceiptItems(receipt.items.map((item) => ({ ...item })));
    setClaims([]);
    setPayments([]);
    setPhase("claiming");
    setLockedPriceReference(undefined);
    setRefundedPayers([]);
    setApprovedParticipantIds([]);
    setSplitRevision((current) => current + 1);
    setCopiedPaymentId(undefined);
    setTargetedParticipantId(undefined);
    setManualCreateBillQuote(undefined);
    setDinerClaimStep("claim");
    setReceiptAppliedStatus("");
    setDinerFeedback(undefined);
    setReceiptStudioOpen(false);
    addFeed(
      "Recovery receipt restored",
      `${receipt.items.length} verified row${receipt.items.length === 1 ? "" : "s"} · claims, funding and approvals cleared`,
      "safety",
    );
  };

  const openRecoveredBill = (context: TapTabContext) => {
    setWorkspaceMode("live");
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("contract", context.address);
    url.searchParams.set("bill", context.billId.toString());
    url.hash = "live";
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    addFeed(
      `Trusted bill #${context.billId.toString()} restored`,
      "The live panel will read its state again from Monad Testnet.",
      "safety",
    );
    window.requestAnimationFrame(() => {
      document.getElementById("live")?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const invalidateSplitApprovals = () => {
    setApprovedParticipantIds([]);
    setSplitRevision((current) => current + 1);
  };

  const toggleClaim = (participantId: string, itemId: string) => {
    if (phase !== "claiming") return;
    const item = receiptItems.find((candidate) => candidate.id === itemId);
    const participant = participantById.get(participantId);
    if (!item || !participant) return;

    const existing = claims.find(
      (claim) => claim.itemId === itemId && claim.participantId === participantId,
    );
    if (existing) {
      if (
        participants.every((candidate) => !candidate.remainderOptIn) &&
        (claimedSlotsByItem.get(itemId) ?? 0) === item.shareSlots
      ) {
        setDinerFeedback({
          tone: "warning",
          message: "Choose at least one volunteer for unclaimed extras before releasing this share.",
        });
        addFeed(
          "Choose a remainder volunteer first",
          "The contract will not lock a bill with nowhere fair to send an unclaimed share.",
          "safety",
        );
        return;
      }
      setClaims((current) =>
        current.filter(
          (claim) =>
            !(claim.itemId === itemId && claim.participantId === participantId),
        ),
      );
      setDinerFeedback(undefined);
      invalidateSplitApprovals();
      addFeed(`${participant.name} released ${item.name}`, "Share is unclaimed", "claim");
      return;
    }

    if ((claimedSlotsByItem.get(itemId) ?? 0) >= item.shareSlots) {
      setDinerFeedback({
        tone: "warning",
        message: `${item.name} is fully claimed. Ask someone to release a share first.`,
      });
      addFeed(`${item.name} is fully claimed`, "Release a share before assigning it", "safety");
      return;
    }

    const ownedIndexes = new Set(
      claims
        .filter((claim) => claim.itemId === itemId)
        .flatMap((claim) => claim.shareIndexes),
    );
    const shareIndex = Array.from({ length: item.shareSlots }, (_, index) => index).find(
      (index) => !ownedIndexes.has(index),
    );
    if (shareIndex === undefined) return;

    setClaims((current) => [
      ...current,
      { participantId, itemId, shareIndexes: [shareIndex] },
    ]);
    setDinerFeedback(undefined);
    invalidateSplitApprovals();
    addFeed(
      `${participant.name} claimed ${item.name}`,
      item.shareSlots > 1 ? `One of ${item.shareSlots} equal shares` : "Whole item",
      "claim",
    );
  };

  const toggleRemainder = (participantId: string) => {
    if (phase !== "claiming") return;
    const participant = participantById.get(participantId);
    if (!participant) return;

    const optedInCount = participants.filter((candidate) => candidate.remainderOptIn).length;
    if (participant.remainderOptIn && optedInCount === 1 && hasUnclaimedSlots) {
      setDinerFeedback({
        tone: "warning",
        message: "At least one volunteer is needed while receipt items remain unclaimed.",
      });
      addFeed(
        "One volunteer must remain",
        "Only opted-in diners can receive the unclaimed remainder.",
        "safety",
      );
      return;
    }

    setParticipants((current) =>
      current.map((candidate) =>
        candidate.id === participantId
          ? { ...candidate, remainderOptIn: !candidate.remainderOptIn }
          : candidate,
      ),
    );
    setDinerFeedback(undefined);
    invalidateSplitApprovals();
    addFeed(
      `${participant.name} ${participant.remainderOptIn ? "left" : "joined"} fair remainder`,
      "Only volunteers share anything left over",
      "claim",
    );
  };

  const setTipVote = (participantId: string, tipVoteBps: number) => {
    if (phase !== "claiming") return;
    const boundedVote = Math.max(0, Math.min(3_000, Math.round(tipVoteBps)));
    const participant = participantById.get(participantId);
    if (!participant || participant.tipVoteBps === boundedVote) return;
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === participantId
          ? { ...participant, tipVoteBps: boundedVote }
          : participant,
      ),
    );
    setDinerFeedback(undefined);
    invalidateSplitApprovals();
    addFeed(
      `${participant?.name ?? "Diner"} voted ${percentage(boundedVote)} tip`,
      `Group result is the median, not the loudest voice`,
      "vote",
    );
  };

  const toggleSplitApproval = (participantId: string) => {
    if (phase !== "claiming") return;
    const participant = participantById.get(participantId);
    if (!participant) return;
    const approved = approvedParticipantIds.includes(participantId);
    setApprovedParticipantIds((current) =>
      approved
        ? current.filter((candidate) => candidate !== participantId)
        : [...current, participantId],
    );
    setDinerFeedback(undefined);
    addFeed(
      `${participant.name} ${approved ? "withdrew approval" : "approved split version " + splitRevision}`,
      approved
        ? "Funding remains locked until everyone approves again"
        : "Any allocation change will clear this approval",
      "safety",
    );
  };

  const transferClaimsAndLeave = () => {
    if (phase !== "claiming") return;
    const leaving = participantById.get(leavingParticipantId);
    const target = participantById.get(transferTargetId);
    if (!leaving || !target || leaving.id === target.id || participants.length <= 1) return;

    const otherRemainderVolunteers = participants.filter(
      (participant) => participant.id !== leaving.id && participant.remainderOptIn,
    );
    if (
      leaving.remainderOptIn &&
      otherRemainderVolunteers.length === 0 &&
      hasUnclaimedSlots
    ) {
      addFeed(
        "Choose another remainder volunteer first",
        `${target.name} can opt in before ${leaving.name} leaves.`,
        "safety",
      );
      return;
    }

    const mergedClaims = new Map<string, ItemClaim>();
    let transferredShares = 0;
    for (const claim of claims) {
      const participantId =
        claim.participantId === leaving.id ? target.id : claim.participantId;
      if (claim.participantId === leaving.id) {
        transferredShares += claim.shareIndexes.length;
      }
      const key = `${participantId}\u0000${claim.itemId}`;
      const existing = mergedClaims.get(key);
      mergedClaims.set(key, {
        participantId,
        itemId: claim.itemId,
        shareIndexes: [...(existing?.shareIndexes ?? []), ...claim.shareIndexes].sort(
          (left, right) => left - right,
        ),
      });
    }

    const remaining = participants.filter((participant) => participant.id !== leaving.id);
    setClaims([...mergedClaims.values()]);
    setParticipants(remaining);
    setSponsorId((current) => (current === leaving.id ? target.id : current));
    setLeavingParticipantId(remaining.find((participant) => participant.id !== target.id)?.id ?? target.id);
    setTransferTargetId(target.id);
    invalidateSplitApprovals();
    addFeed(
      `${leaving.name} transferred ${transferredShares} share${transferredShares === 1 ? "" : "s"} and left`,
      `${target.name} now owns the transferred claims; join order for everyone else is preserved`,
      "claim",
    );
  };

  const applyImportedReceipt = (receipt: AppliedReceipt) => {
    if (phase !== "claiming") return;
    const nextItems = receipt.items.map((item) => ({ ...item }));
    const changed =
      receipt.merchant !== merchant ||
      JSON.stringify(nextItems) !== JSON.stringify(receiptItems);
    if (!changed) {
      setReceiptStudioOpen(false);
      setReceiptAppliedStatus("Receipt already up to date.");
      setDinerFeedback(undefined);
      window.requestAnimationFrame(() => receiptSummaryRef.current?.focus());
      addFeed("Receipt already verified", "No split state changed", "safety");
      return;
    }
    setMerchant(receipt.merchant);
    setReceiptItems(nextItems);
    setClaims([]);
    setPayments([]);
    setDinerClaimStep("claim");
    setReceiptStudioOpen(false);
    setDinerFeedback(undefined);
    setReceiptAppliedStatus(
      `Receipt applied. ${nextItems.length} verified row${nextItems.length === 1 ? "" : "s"} ready to claim.`,
    );
    window.requestAnimationFrame(() => receiptSummaryRef.current?.focus());
    invalidateSplitApprovals();
    addFeed(
      `${receipt.merchant} receipt applied`,
      `${nextItems.length} verified row${nextItems.length === 1 ? "" : "s"} · claims and approvals cleared`,
      "safety",
    );
  };

  const currentPreviewPriceLock = () => {
    if (!createBillQuote) return undefined;
    try {
      return lockTapTabPriceReference({
        gbpPerMon: Number(createBillQuote.gbpPerMon),
        ...(liveCreateBillQuote && price ? { usdPerMon: price.usd } : {}),
        observedAtUnixSeconds: createBillQuote.observedAtUnixSeconds,
        source: createBillQuote.source,
        basis: createBillQuote.basis,
        mode: liveCreateBillQuote ? "live" : "manual",
      });
    } catch {
      return undefined;
    }
  };

  const lockSplit = () => {
    if (phase !== "claiming") return;
    if (!allParticipantsApproved) {
      setDinerFeedback({
        tone: "warning",
        message: `Waiting for ${participants.length - approvedParticipantIds.length} diner${participants.length - approvedParticipantIds.length === 1 ? "" : "s"} to approve this bill.`,
      });
      addFeed(
        "Everyone must approve this split",
        `${approvedParticipantIds.length} of ${participants.length} diners are ready on version ${splitRevision}.`,
        "safety",
      );
      return;
    }
    const nextLockedPriceReference = currentPreviewPriceLock();
    if (!nextLockedPriceReference) {
      setDinerFeedback({
        tone: "warning",
        message:
          "A current MON/GBP quote is required before protected payments can open. Refresh the rate or confirm the manual fallback.",
      });
      addFeed(
        "Protected payments stayed closed",
        "No live or explicitly confirmed manual MON/GBP quote was available.",
        "safety",
      );
      return;
    }
    setLockedPriceReference(nextLockedPriceReference);
    setDinerFeedback(undefined);
    setPhase("funding");
    addFeed(
      `Split locked at ${money(preview.totalDuePence)}`,
      `${percentage(preview.medianTipVoteBps)} group tip · ${nextLockedPriceReference.source} quote fixed · payment protection on`,
      "safety",
    );
  };

  const payRemaining = (beneficiaryId: string, payerId = beneficiaryId) => {
    if (phase !== "funding") return;
    const beneficiary = participantPreviewById.get(beneficiaryId);
    const payer = participantById.get(payerId);
    const beneficiaryPerson = participantById.get(beneficiaryId);
    if (!beneficiary || !payer || !beneficiaryPerson || beneficiary.unpaidPence <= 0) return;

    const amountPence = beneficiary.unpaidPence;
    setPayments((current) => [
      ...current,
      { payerId, beneficiaryId, amountPence },
    ]);
    addFeed(
      payerId === beneficiaryId
        ? `${beneficiaryPerson.name} paid ${money(amountPence)}`
        : `${payer.name} sponsored ${beneficiaryPerson.name}`,
      payerId === beneficiaryId
        ? "Preview payment added to the funding total"
        : `${money(amountPence)} covered · refund belongs to the sponsor if the bill fails`,
      "payment",
    );
  };

  const settleBill = () => {
    if (phase !== "funding" || !preview.funding.canSettle) return;
    setPhase("settled");
    addFeed(
      `Table 7 settled for ${money(preview.totalDuePence)}`,
      "The payee can now withdraw the exact proceeds",
      "payment",
    );
  };

  const failBill = (nextPhase: "cancelled" | "expired") => {
    if (phase !== "funding") return;
    setPhase(nextPhase);
    addFeed(
      nextPhase === "cancelled" ? "Bill cancelled" : "Bill deadline expired",
      `${money(preview.funding.fundedPence)} is now claimable by its original contributors`,
      "safety",
    );
  };

  const claimRefund = (payerId: string) => {
    if (!failed || refundedPayers.includes(payerId)) return;
    const amount = contributorTotals.get(payerId) ?? 0;
    if (amount <= 0) return;
    setRefundedPayers((current) => [...current, payerId]);
    addFeed(
      `${participantById.get(payerId)?.name ?? "Contributor"} claimed ${money(amount)}`,
      "Refund returned to the wallet that contributed it",
      "payment",
    );
  };

  const resetDemo = () => {
    setMerchant("Lina Stores");
    setReceiptItems(INITIAL_RECEIPT_ITEMS.map((item) => ({ ...item })));
    setParticipants(copyParticipants(INITIAL_PARTICIPANTS));
    setClaims(copyClaims(INITIAL_CLAIMS));
    setPayments([]);
    setPhase("claiming");
    setSponsorId("theo");
    setLeavingParticipantId("theo");
    setTransferTargetId("amina");
    setFeed([...INITIAL_FEED]);
    setLockedPriceReference(undefined);
    setRefundedPayers([]);
    setApprovedParticipantIds([]);
    setSplitRevision(1);
    setCopiedPaymentId(undefined);
    setTargetedParticipantId(undefined);
    setDinerClaimStep("claim");
    setReceiptAppliedStatus("");
    setDinerFeedback(undefined);
    setReceiptStudioOpen(false);
    setGuidedDemoActive(false);
    setGuidedDemoStep(0);
    const url = new URL(window.location.href);
    url.searchParams.delete("pay");
    if (url.hash === "#current-action") url.hash = "#bill";
    window.history.replaceState({}, "", url);
  };

  const startGuidedDemo = () => {
    resetDemo();
    setGuidedDemoActive(true);
    setGuidedDemoStep(0);
    openWorkspace("preview");
  };

  const advanceGuidedDemo = () => {
    if (!guidedDemoActive) return;

    if (guidedDemoStep === 0) {
      const item = receiptItems.find((candidate) => candidate.id === "gelato");
      const alreadyClaimed = claims.some(
        (claim) => claim.itemId === "gelato" && claim.participantId === "you",
      );
      if (item && !alreadyClaimed) {
        const owned = new Set(
          claims
            .filter((claim) => claim.itemId === item.id)
            .flatMap((claim) => claim.shareIndexes),
        );
        const shareIndex = Array.from(
          { length: item.shareSlots },
          (_, index) => index,
        ).find((index) => !owned.has(index));
        if (shareIndex !== undefined) {
          setClaims((current) => [
            ...current,
            { participantId: "you", itemId: item.id, shareIndexes: [shareIndex] },
          ]);
          addFeed(
            "You claimed a shared gelato",
            `Share ${shareIndex + 1} of ${item.shareSlots} · your GBP total updated`,
            "claim",
          );
        }
      }
      setDinerClaimStep("review");
      setGuidedDemoStep(1);
      return;
    }

    if (guidedDemoStep === 1) {
      setApprovedParticipantIds(participants.map((participant) => participant.id));
      setDinerClaimStep("review");
      setDinerFeedback(undefined);
      addFeed(
        `All ${participants.length} diners approved version ${splitRevision}`,
        "The exact split can now open protected payments",
        "safety",
      );
      setGuidedDemoStep(2);
      return;
    }

    if (guidedDemoStep === 2) {
      const theo = participantPreviewById.get("theo");
      const nextLockedPriceReference = currentPreviewPriceLock();
      if (!nextLockedPriceReference) {
        setDinerFeedback({
          tone: "warning",
          message:
            "The guided demo needs a live or explicitly confirmed manual MON/GBP quote before protected payments can open.",
        });
        addFeed(
          "Guided demo paused safely",
          "Refresh the rate or confirm the manual fallback; no payment state changed.",
          "safety",
        );
        return;
      }
      setLockedPriceReference(nextLockedPriceReference);
      setPhase("funding");
      if (theo && theo.unpaidPence > 0) {
        setPayments((current) => [
          ...current,
          { payerId: "you", beneficiaryId: "theo", amountPence: theo.unpaidPence },
        ]);
        addFeed(
          `You sponsored Theo for ${money(theo.unpaidPence)}`,
          "The sponsor owns this contribution if the bill later becomes refundable",
          "payment",
        );
      }
      setGuidedDemoStep(3);
      return;
    }

    if (guidedDemoStep === 3) {
      const remainingPayments = preview.participants
        .filter((allocation) => allocation.unpaidPence > 0)
        .map((allocation) => ({
          payerId: allocation.participantId,
          beneficiaryId: allocation.participantId,
          amountPence: allocation.unpaidPence,
        }));
      setPayments((current) => [...current, ...remainingPayments]);
      addFeed(
        `Exact remainder funded by ${remainingPayments.length} diners`,
        `${money(preview.funding.remainingPence)} added · settlement protection can unlock`,
        "payment",
      );
      setGuidedDemoStep(4);
      return;
    }

    if (guidedDemoStep === 4 && preview.funding.canSettle) {
      setPhase("settled");
      addFeed(
        `Table 7 settled for ${money(preview.totalDuePence)}`,
        "A privacy-safe receipt is ready to share or download",
        "payment",
      );
      setGuidedDemoStep(GUIDED_DEMO_STEPS.length);
      window.requestAnimationFrame(() => {
        document
          .getElementById("sample-settlement-receipt")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  const copyInvite = async () => {
    const previewUrl = buildCanonicalPreviewUrl(window.location.origin);
    setCopyError(undefined);
    setCopyRecoveryUrl(undefined);
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
      setCopyRecoveryUrl(previewUrl);
      setCopyError("The preview link could not be copied automatically. Select the exact link below.");
    }
  };

  const shareCurrentBill = async () => {
    const liveShareUrl = workspaceMode === "live" ? liveUpdate.shareUrl : "";
    if (workspaceMode === "live" && !liveShareUrl) return;
    const url = liveShareUrl || buildCanonicalPreviewUrl(window.location.origin);
    setCopyError(undefined);
    setCopyRecoveryUrl(undefined);
    const result = await share({
      title: "TapTab shared bill",
      text: liveShareUrl
        ? "Join this TapTab bill and claim your share."
        : "Try the TapTab shared-bill preview.",
      url,
    });
    if (result === "cancelled" || result === "failed" || result === "unavailable") {
      setCopyRecoveryUrl(url);
    }
  };

  const previewPaymentUrl = (participantId: string) => {
    const token = PREVIEW_PAYMENT_TOKEN_BY_ID.get(participantId);
    if (!token) throw new Error("Unknown preview participant.");
    const url = new URL(buildCanonicalPreviewUrl(window.location.origin));
    url.searchParams.set("pay", token);
    url.hash = "current-action";
    return url.toString();
  };

  const copyPreviewPaymentLink = async (participantId: string) => {
    if (!participantById.has(participantId)) return;

    const paymentUrl = previewPaymentUrl(participantId);
    setCopyError(undefined);
    setCopyRecoveryUrl(undefined);
    try {
      await navigator.clipboard.writeText(paymentUrl);
      setCopiedPaymentId(participantId);
      window.setTimeout(() => {
        setCopiedPaymentId((current) =>
          current === participantId ? undefined : current,
        );
      }, 1_500);
    } catch {
      setCopiedPaymentId(undefined);
      setCopyRecoveryUrl(paymentUrl);
      setCopyError(
        "The personal payment link could not be copied automatically. Select the exact link below.",
      );
    }
  };

  const openPreviewWhatsAppLink = (participantId: string) => {
    if (!participantById.has(participantId)) return;

    const share = new URL("https://wa.me/");
    share.searchParams.set(
      "text",
      `Open your TapTab payment link: ${previewPaymentUrl(participantId)}`,
    );
    window.open(share.toString(), "_blank", "noopener,noreferrer");
  };

  const monEstimate = (pence: number) => {
    if (!rateForEstimate) return "—";
    const mon = pence / 100 / rateForEstimate;
    return mon >= 1_000
      ? `${mon.toLocaleString("en-GB", { maximumFractionDigits: 1 })} MON`
      : `${mon.toLocaleString("en-GB", { maximumFractionDigits: 3 })} MON`;
  };

  const nextUnpaid = preview.participants.find((participant) => participant.unpaidPence > 0);
  const nextUnapproved = participants.find(
    (participant) => !approvedParticipantIds.includes(participant.id),
  );

  const openWorkspace = (
    nextMode: WorkspaceMode,
    targetId = "bill",
    preserveTrustedContext = false,
  ) => {
    setWorkspaceMode(nextMode);
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", nextMode);
    if (nextMode === "preview") {
      url.searchParams.set("preview", "table-7");
      if (!preserveTrustedContext) {
        url.searchParams.delete("contract");
        url.searchParams.delete("bill");
      }
      url.searchParams.delete("pay");
      setTargetedParticipantId(undefined);
    } else {
      url.searchParams.delete("preview");
      url.searchParams.delete("pay");
      setTargetedParticipantId(undefined);
    }
    url.hash = targetId;
    window.history.replaceState(
      { ...window.history.state, taptabWorkspace: nextMode },
      "",
      url,
    );
    window.requestAnimationFrame(() => {
      const target =
        document.getElementById(targetId) ??
        document.getElementById(nextMode === "live" ? "live" : "bill");
      let disclosure =
        target instanceof HTMLDetailsElement
          ? target
          : target?.closest<HTMLDetailsElement>("details") ?? null;
      while (disclosure) {
        disclosure.open = true;
        disclosure = disclosure.parentElement?.closest<HTMLDetailsElement>("details") ?? null;
      }
      target?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  return (
    <div className="taptab-shell">
      <header className="tap-nav">
        <a className="tap-brand" href="#top" aria-label="TapTab home">
          <span className="tap-brand-mark" aria-hidden="true">
            T
          </span>
          <span>TapTab</span>
        </a>
        <nav className="tap-nav-links" aria-label="Primary navigation">
          <a
            href="#bill"
            onClick={(event) => {
              event.preventDefault();
              openWorkspace("preview");
            }}
          >
            Sample bill
          </a>
          <a
            href="#bill"
            onClick={(event) => {
              event.preventDefault();
              openWorkspace("live");
            }}
          >
            Monad Testnet
          </a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <details className="tap-mobile-nav">
          <summary aria-label="Open navigation">Menu</summary>
          <nav className="tap-mobile-nav-panel" aria-label="Mobile navigation">
            <button
              type="button"
              onClick={(event) => {
                openWorkspace("preview");
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              Sample bill
            </button>
            <button
              type="button"
              onClick={(event) => {
                openWorkspace("live");
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              Monad Testnet
            </button>
            <a
              href="#how-it-works"
              onClick={(event) =>
                event.currentTarget.closest("details")?.removeAttribute("open")
              }
            >
              How it works
            </a>
          </nav>
        </details>
        <div className="tap-nav-actions">
          <span className={`network-chip ${workspaceMode === "live" && liveConfigured ? "" : "preview"}`}>
            <span className="network-dot" />
            {workspaceMode === "live"
              ? liveConfigured
                ? "Monad Testnet live"
                : "Testnet setup"
              : "Sample preview"}
          </span>
          <button
            className="wallet-control"
            type="button"
            onClick={
              wallet.status === "error" && !wallet.ready
                ? wallet.retryInitialisation
                : wallet.enabled
                ? wallet.open
                : () => openWorkspace("live", "live")
            }
            disabled={
              wallet.isConnecting ||
              (wallet.enabled && !wallet.ready && wallet.status !== "error")
            }
            title={
              wallet.status === "error" && !wallet.ready
                ? "Retry wallet sign-in setup"
                : wallet.enabled
                ? wallet.onboarding.primaryLabel
                : "Open the live-mode setup requirements"
            }
          >
            <Wallet size={15} />
            {wallet.account && wallet.provider
              ? shortAddress(wallet.account)
              : wallet.account
                ? "Restoring wallet…"
              : wallet.isConnecting
                ? "Connecting…"
                : wallet.status === "error" && !wallet.ready
                  ? "Retry wallet"
                : wallet.enabled && !wallet.ready
                  ? "Preparing sign-in…"
                : wallet.enabled
                  ? wallet.onboarding.primaryLabel
                  : "Open Testnet"}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="tap-hero diner-entry">
          <div className="hero-copy diner-entry-copy">
            <p className="eyebrow">
              <span>You’re joining Table 7</span>
              <span>{participants.length} diners</span>
            </p>
            <h1>Claim what you had. Pay only your part.</h1>
            <p className="hero-lede">
              Start with your items. TapTab then guides you through shared extras, the
              group tip, your pound total and a protected payment.
            </p>
            <div className="hero-actions">
              <button
                className="primary-cta"
                type="button"
                onClick={startGuidedDemo}
              >
                Try TapTab <ArrowRight size={17} />
              </button>
              <button className="secondary-cta" type="button" onClick={() => setStageMode(true)}>
                <Maximize2 size={16} /> Guided demo
              </button>
              {canPromptInstall ? (
                <button
                  className="secondary-cta"
                  type="button"
                  onClick={() => void requestInstall()}
                >
                  <Smartphone size={16} /> Install TapTab
                </button>
              ) : null}
            </div>
            {installError ? (
              <p className="field-error" role="alert">{installError}</p>
            ) : serviceWorkerStatus === "failed" ? (
              <p className="live-action-hint" role="status">
                Offline support is unavailable in this browser; TapTab still works while online.
              </p>
            ) : null}
            <div className="hero-proof" aria-label="TapTab protections">
              <span>
                <ShieldCheck size={16} /> Correct amount protected
              </span>
              <span>
                <RefreshCw size={15} /> Refunds if it ends
              </span>
              <span>
                <CirclePoundSterling size={16} /> GBP first
              </span>
            </div>
          </div>

          <div className="hero-demo diner-entry-summary" aria-label="Your Table 7 summary">
            <div className="hero-demo-top">
              <div>
                <span className="micro-label">Table 7</span>
                <strong>{merchant}</strong>
              </div>
              <span className="preview-badge">Ready to claim</span>
            </div>
            <div className="hero-total-row">
              <div>
                <span>Group total</span>
                <strong>{money(preview.totalDuePence)}</strong>
              </div>
              <div className="avatar-stack" aria-label="Four diners joined">
                {participants.map((participant) => (
                  <span
                    key={participant.id}
                    style={{ "--avatar-colour": participant.colour } as CSSProperties}
                  >
                    {participant.initials}
                  </span>
                ))}
              </div>
            </div>
            <div className="hero-rule" />
            <div className="hero-split-row">
                <span>Your current total</span>
              <strong>{money(currentUser?.totalDuePence ?? 0)}</strong>
            </div>
            <div className="hero-mini-items">
              <span>{receiptItems[0]?.name ?? "Receipt item"}</span>
              <span>{receiptItems.length} verified rows</span>
              <span>Unclaimed extras shared by volunteers</span>
              <span>{percentage(preview.medianTipVoteBps)} tip</span>
            </div>
            <div className="protection-banner">
              <LockKeyhole size={17} />
              <div>
                <strong>You will see the exact pound total before paying</strong>
                <span>The bill cannot complete until every share is covered.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="feature-rail" aria-label="Key features">
          <div>
            <Split size={20} />
            <span>
              <strong>Split shared things</strong>
              Choose who shared food, wine or the taxi
            </span>
          </div>
          <div>
            <Vote size={20} />
            <span>
              <strong>Choose the tip together</strong>
              Everyone gets an equal vote
            </span>
          </div>
          <div>
            <HandCoins size={20} />
            <span>
              <strong>Sponsor a friend</strong>
              Cover any remaining share
            </span>
          </div>
          <div>
            <RefreshCw size={20} />
            <span>
              <strong>Payments stay protected</strong>
              Cancelled contributions can be refunded
            </span>
          </div>
        </section>

        <section className="bill-section" id="bill">
          <div className="section-heading">
            <div>
              <span className="section-kicker">
                {workspaceMode === "preview" ? "Sample bill · local only" : "Monad Testnet · contract backed"}
              </span>
              <h2>{workspaceMode === "preview" ? "Split tonight’s receipt" : "Open the live bill"}</h2>
              <p>
                {workspaceMode === "preview"
                  ? "Claim items, agree the split and see the protected payment flow without connecting a wallet."
                  : "Read and write the trusted TapTab contract with confirmed Monad Testnet transactions."}
              </p>
            </div>
            <div className="section-actions" data-workspace={workspaceMode}>
              <div className="workspace-switcher" role="group" aria-label="Bill workspace">
                <button
                  type="button"
                  className={workspaceMode === "preview" ? "active" : ""}
                  aria-pressed={workspaceMode === "preview"}
                  onClick={() => openWorkspace("preview")}
                >
                  Sample bill
                </button>
                <button
                  type="button"
                  className={workspaceMode === "live" ? "active" : ""}
                  aria-pressed={workspaceMode === "live"}
                  onClick={() => openWorkspace("live")}
                >
                  Monad Testnet
                </button>
              </div>
              {shareAvailability !== "unavailable" ? (
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => void shareCurrentBill()}
                  disabled={
                    shareAvailability === "checking" ||
                    shareStatus === "sharing" ||
                    (workspaceMode === "live" && !liveUpdate.shareUrl)
                  }
                  title={
                    workspaceMode === "live" && !liveUpdate.shareUrl
                      ? "A trusted live bill link is not available yet"
                      : shareError ?? "Share the current non-personalised bill link"
                  }
                >
                  <Share2 size={15} />
                  {shareStatus === "sharing"
                    ? "Sharing…"
                    : shareStatus === "shared"
                      ? "Shared"
                      : shareStatus === "copied"
                        ? "Copied"
                        : shareStatus === "cancelled"
                          ? "Share cancelled"
                        : "Share bill"}
                </button>
              ) : null}
            </div>
          </div>

          {shareError || copyError || shareStatus === "cancelled" ? (
            <div className="share-recovery" role={shareError || copyError ? "alert" : "status"}>
              <p className="field-error workspace-action-error">
                {shareError ??
                  copyError ??
                  "Sharing was cancelled. Nothing was sent; the canonical link remains available below."}
              </p>
              <label>
                <span>
                  {copyRecoveryUrl?.includes("pay=")
                    ? "Personal payment link"
                    : "Canonical bill link"}
                </span>
                <input
                  type="url"
                  readOnly
                  value={
                    copyRecoveryUrl ??
                    (workspaceMode === "live" ? liveUpdate.shareUrl : inviteUrl)
                  }
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label={
                    copyRecoveryUrl?.includes("pay=")
                      ? "Personal payment link ready to select"
                      : "Canonical bill link ready to select"
                  }
                />
              </label>
            </div>
          ) : null}

          <div
            className="workspace-view preview-workspace"
            hidden={workspaceMode !== "preview"}
          >
          <div className="preview-notice">
            <Sparkles size={16} />
            <span>
              Try this table without connecting a wallet. Your changes stay in this local preview.
            </span>
          </div>

          {guidedDemoActive ? (
            <aside className="try-taptab-guide" aria-labelledby="try-taptab-guide-title">
              <header>
                <span className="try-taptab-guide-kicker">
                  Guided sample · {Math.min(guidedDemoStep + 1, GUIDED_DEMO_STEPS.length)} of {GUIDED_DEMO_STEPS.length}
                </span>
                <h3 id="try-taptab-guide-title">
                  {guidedDemoStep < GUIDED_DEMO_STEPS.length
                    ? GUIDED_DEMO_STEPS[guidedDemoStep].title
                    : "Sample complete"}
                </h3>
                <p>
                  {guidedDemoStep < GUIDED_DEMO_STEPS.length
                    ? GUIDED_DEMO_STEPS[guidedDemoStep].description
                    : "The exact bill is settled. Review the GBP breakdown, sponsorship and privacy-safe receipt below."}
                </p>
              </header>
              <ol className="try-taptab-progress" aria-label="Guided sample progress">
                {GUIDED_DEMO_STEPS.map((step, index) => (
                  <li
                    key={step.title}
                    className={
                      index < guidedDemoStep
                        ? "complete"
                        : index === guidedDemoStep
                          ? "current"
                          : undefined
                    }
                    aria-current={index === guidedDemoStep ? "step" : undefined}
                  >
                    <span aria-hidden="true">{index < guidedDemoStep ? <Check size={13} /> : index + 1}</span>
                    <small>{step.title}</small>
                  </li>
                ))}
              </ol>
              <div className="try-taptab-actions">
                {guidedDemoStep < GUIDED_DEMO_STEPS.length ? (
                  <button type="button" className="lock-button" onClick={advanceGuidedDemo}>
                    {GUIDED_DEMO_STEPS[guidedDemoStep].action} <ArrowRight size={16} />
                  </button>
                ) : (
                  <a className="lock-button" href="#sample-settlement-receipt">
                    View settlement receipt <ArrowRight size={16} />
                  </a>
                )}
                <button type="button" className="secondary-detail" onClick={resetDemo}>
                  <RotateCcw size={14} /> Reset sample
                </button>
              </div>
            </aside>
          ) : null}

          <div
            className="bill-command-bar journey-strip"
            id="current-action"
            aria-label="Your bill progress"
          >
            <div className={`phase-pill phase-${phase}`}>
              <span /> {PHASE_LABELS[phase]}
            </div>
            <div
              className="phase-steps"
              aria-label="Five-step diner journey"
              tabIndex={0}
            >
              {dinerJourneyStages.map((stage, index) => {
                const current = index === dinerJourneyIndex;
                const complete = index < dinerJourneyIndex;
                return (
                  <span
                    className={`journey-step ${current ? "journey-step-current" : ""} ${complete ? "journey-step-complete" : ""}`}
                    aria-current={current ? "step" : undefined}
                    key={stage.id}
                  >
                    <span className="journey-step-number" aria-hidden="true">
                      {complete ? <Check size={12} /> : index + 1}
                    </span>
                    <span className="journey-step-copy">{stage.label}</span>
                  </span>
                );
              })}
            </div>
            <button className="invite-button" type="button" onClick={copyInvite}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy preview link"}
            </button>
          </div>

          <div
            id="diner-waiting-status"
            className={`diner-blocked-status diner-blocked-status-${visibleDinerStatus.tone}`}
            role="status"
            aria-live="polite"
          >
            {visibleDinerStatus.tone === "ready" ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
            <span>{visibleDinerStatus.message}</span>
          </div>

          {targetedParticipantId && participantById.has(targetedParticipantId) ? (
            <div className="personal-payment-arrival current-payment-arrival" role="status">
              <HandCoins size={18} />
              <span>
                <strong>
                  Sample payment link for {participantById.get(targetedParticipantId)?.name}
                </strong>
                <small>
                  {phase === "funding"
                    ? "Their exact remaining amount is ready in the funding step."
                    : "This sample starts before funding; approve the split to open payments."}
                </small>
              </span>
            </div>
          ) : null}

          <article
            className="your-share-card current-task-card"
            hidden={phase !== "claiming"}
          >
            <div className="your-share-top">
              <div>
                <span className="micro-label">Your total so far</span>
                <strong>{money(currentUser?.totalDuePence ?? 0)}</strong>
              </div>
              <div className="you-avatar">YO</div>
            </div>
            <div className="share-breakdown">
              <div>
                <span>Claimed items</span>
                <strong>{money(currentUser?.claimedPence ?? 0)}</strong>
              </div>
              <div>
                <span>Unclaimed extras</span>
                <strong>{money(currentUser?.remainderPence ?? 0)}</strong>
              </div>
              <div>
                <span>Tip</span>
                <strong>{money(currentUser?.tipPence ?? 0)}</strong>
              </div>
            </div>
            {phase === "claiming" && dinerClaimStep === "claim" ? (
              <button
                className="lock-button"
                type="button"
                onClick={() => setDinerClaimStep("shared")}
              >
                Continue to tip &amp; extras <ArrowRight size={16} />
              </button>
            ) : null}
            {phase === "claiming" && dinerClaimStep === "shared" ? (
              <>
                <button
                  className="lock-button"
                  type="button"
                  onClick={() => setDinerClaimStep("review")}
                >
                  Review my {money(currentUser?.totalDuePence ?? 0)} <ArrowRight size={16} />
                </button>
                <button
                  className="secondary-detail"
                  type="button"
                  onClick={() => setDinerClaimStep("claim")}
                >
                  Change my items
                </button>
              </>
            ) : null}
            {phase === "claiming" && dinerClaimStep === "review" && !currentUserApproved ? (
              <button
                className="lock-button"
                type="button"
                onClick={() => toggleSplitApproval("you")}
              >
                Approve this {money(currentUser?.totalDuePence ?? 0)} split <ShieldCheck size={16} />
              </button>
            ) : null}
            {phase === "claiming" && dinerClaimStep === "review" && currentUserApproved ? (
              <button
                className="lock-button"
                type="button"
                onClick={lockSplit}
                disabled={!allParticipantsApproved}
                aria-describedby={!allParticipantsApproved ? "diner-waiting-status" : undefined}
              >
                {allParticipantsApproved
                  ? "Open protected payments"
                  : `Waiting for ${otherApprovalsOutstanding}`}
                <LockKeyhole size={16} />
              </button>
            ) : null}
            {phase === "funding" && (currentUser?.unpaidPence ?? 0) > 0 ? (
              <button className="lock-button" type="button" onClick={() => payRemaining("you")}>
                Pay your {money(currentUser?.unpaidPence ?? 0)} <ArrowRight size={16} />
              </button>
            ) : null}
            {phase === "funding" && currentUser?.unpaidPence === 0 ? (
              <div className="paid-confirmation">
                <CheckCircle2 size={18} /> Your share is covered
              </div>
            ) : null}
            {phase === "settled" ? (
              <div className="paid-confirmation">
                <CheckCircle2 size={18} /> Receipt ready below
              </div>
            ) : null}
          </article>

          <div className="mobile-personal-action" aria-label="Your current bill action">
            <span>
              <small>Your share</small>
              <strong>{money(currentUser?.totalDuePence ?? 0)}</strong>
            </span>
            {phase === "claiming" && dinerClaimStep === "claim" ? (
              <button type="button" onClick={() => setDinerClaimStep("shared")}>
                Tip &amp; extras
              </button>
            ) : null}
            {phase === "claiming" && dinerClaimStep === "shared" ? (
              <button type="button" onClick={() => setDinerClaimStep("review")}>
                Review total
              </button>
            ) : null}
            {phase === "claiming" && dinerClaimStep === "review" && !currentUserApproved ? (
              <button type="button" onClick={() => toggleSplitApproval("you")}>
                Approve
              </button>
            ) : null}
            {phase === "claiming" && dinerClaimStep === "review" && currentUserApproved ? (
              <button type="button" onClick={lockSplit} disabled={!allParticipantsApproved}>
                {allParticipantsApproved
                  ? "Start payments"
                  : `Waiting for ${otherApprovalsOutstanding}`}
              </button>
            ) : null}
            {phase === "funding" && (currentUser?.unpaidPence ?? 0) > 0 ? (
              <button type="button" onClick={() => payRemaining("you")}>
                Pay {money(currentUser?.unpaidPence ?? 0)}
              </button>
            ) : null}
            {phase === "funding" && currentUser?.unpaidPence === 0 ? (
              <strong className="mobile-action-status">Covered</strong>
            ) : null}
            {phase === "settled" ? (
              <strong className="mobile-action-status">Settled</strong>
            ) : null}
            {failed ? <strong className="mobile-action-status">Refunds open</strong> : null}
          </div>

          <div className="bill-grid" hidden={phase !== "claiming"}>
            <article className="receipt-card">
              <div className="receipt-heading">
                <div>
                  <span className="micro-label">Receipt 00412</span>
                  <h3>{merchant}</h3>
                  <p>Shoreditch · 6 August 2026 · Table 7</p>
                </div>
                <div className="receipt-qr">
                  <QRCodeSVG
                    value={inviteUrl}
                    size={54}
                    level="M"
                    title="Preview QR code for Table 7"
                  />
                </div>
              </div>

              <div className="receipt-instruction" aria-live="polite">
                <Users size={16} />
                {phase === "claiming"
                  ? dinerClaimStep === "claim"
                    ? "Tap Mine beside each thing you had. Shared things can have more than one person."
                    : "Your claims stay editable until everyone approves the split."
                  : phase === "funding"
                    ? "Claims are locked while the group funds the bill."
                    : phase === "settled"
                      ? "This receipt settled with the exact total funded."
                      : "This bill ended safely; contributor refunds are available."}
              </div>

              <div className="receipt-items">
                {receiptItems.map((item) => {
                  const claimedSlots = claimedSlotsByItem.get(item.id) ?? 0;
                  const itemPreview = preview.items.find((candidate) => candidate.itemId === item.id);
                  const youClaimed = claims.some(
                    (claim) =>
                      claim.itemId === item.id && claim.participantId === "you",
                  );
                  return (
                    <div className="receipt-item" key={item.id}>
                      <div className="item-mainline">
                        <div>
                          <strong>{item.name}</strong>
                          <span>
                            {item.shareSlots === 1
                              ? "Whole item"
                              : `${item.shareSlots} equal shares · ${money(
                                  Math.floor(item.pricePence / item.shareSlots),
                                )} each`}
                          </span>
                        </div>
                        <strong>{money(item.pricePence)}</strong>
                      </div>
                      <div
                        className="claim-row item-claim-actions"
                        hidden={phase !== "claiming" || dinerClaimStep !== "claim"}
                      >
                        {(() => {
                          const mineDisabled =
                            phase !== "claiming" ||
                            (claimedSlots >= item.shareSlots && !youClaimed);
                          return (
                            <button
                              type="button"
                              className={`claim-chip mine-button ${youClaimed ? "selected mine-button-selected" : ""}`}
                              onClick={() => toggleClaim("you", item.id)}
                              disabled={mineDisabled}
                              aria-pressed={youClaimed}
                              aria-label={`${youClaimed ? "Release" : "Claim"} ${item.name} for yourself`}
                              aria-describedby={mineDisabled ? `${item.id}-claim-status` : undefined}
                              style={{ "--chip-colour": participantById.get("you")?.colour } as CSSProperties}
                            >
                              <span>YO</span>
                              {youClaimed ? "Mine ✓" : "Mine"}
                            </button>
                          );
                        })()}
                        <details className="other-diners-disclosure">
                          <summary className="other-diners-summary">
                            Assign another diner
                          </summary>
                          <div className="other-diners-list">
                            {participants
                              .filter((participant) => participant.id !== "you")
                              .map((participant) => {
                                const selected = claims.some(
                                  (claim) =>
                                    claim.itemId === item.id &&
                                    claim.participantId === participant.id,
                                );
                                const atCapacity =
                                  claimedSlots >= item.shareSlots && !selected;
                                return (
                                  <button
                                    type="button"
                                    className={`claim-chip ${selected ? "selected" : ""}`}
                                    key={participant.id}
                                    onClick={() => toggleClaim(participant.id, item.id)}
                                    disabled={phase !== "claiming" || atCapacity}
                                    aria-pressed={selected}
                                    aria-label={`${selected ? "Release" : "Assign"} ${item.name} ${selected ? "from" : "to"} ${participant.name}`}
                                    style={{ "--chip-colour": participant.colour } as CSSProperties}
                                  >
                                    <span>{participant.initials}</span>
                                    {participant.name}
                                    {selected && <Check size={12} />}
                                  </button>
                                );
                              })}
                          </div>
                        </details>
                        <span className={`slot-count ${claimedSlots === item.shareSlots ? "full" : ""}`}>
                          {claimedSlots}/{item.shareSlots} claimed
                        </span>
                        {claimedSlots >= item.shareSlots && !youClaimed ? (
                          <span id={`${item.id}-claim-status`} className="secondary-detail" role="status">
                            All shares are taken. Ask someone to release one before claiming this item.
                          </span>
                        ) : null}
                      </div>
                      {(itemPreview?.unclaimedPence ?? 0) > 0 && (
                        <div className="unclaimed-line">
                          <span>{money(itemPreview?.unclaimedPence ?? 0)} unclaimed</span>
                          <span>→ shared only by diners who volunteer</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="receipt-totals">
                <div>
                  <span>Subtotal</span>
                  <strong>{money(preview.subtotalPence)}</strong>
                </div>
                <div>
                  <span>Group tip · {percentage(preview.medianTipVoteBps)}</span>
                  <strong>{money(preview.tipPence)}</strong>
                </div>
                <div className="grand-total">
                  <span>Total</span>
                  <strong>{money(preview.totalDuePence)}</strong>
                </div>
              </div>
            </article>

            <div
              className="control-column diner-task-panel"
              hidden={phase !== "claiming" || dinerClaimStep === "claim"}
            >
              <div className="diner-task-heading">
                <span className="section-kicker">
                  {dinerClaimStep === "shared" ? "Step 2 · Tip and extras" : "Step 3 · Review"}
                </span>
                <h3>
                  {dinerClaimStep === "shared"
                    ? "Finish your choices"
                    : "Check your total before approving"}
                </h3>
              </div>
              <article className="control-card" hidden={dinerClaimStep !== "shared"}>
                <div className="card-title-row">
                  <div className="icon-box violet">
                    <Vote size={18} />
                  </div>
                  <div>
                    <h3>Choose your tip</h3>
                    <p>Everyone votes. The middle choice becomes the group tip.</p>
                  </div>
                  <span className="result-chip">Result {percentage(preview.medianTipVoteBps)}</span>
                </div>

                <div className="your-vote">
                  <span>Your vote</span>
                  <div className="tip-options">
                    {TIP_PRESETS.map((tip) => (
                      <button
                        key={tip}
                        className={participants[0].tipVoteBps === tip ? "selected" : ""}
                        type="button"
                        onClick={() => setTipVote("you", tip)}
                        disabled={phase !== "claiming"}
                        aria-pressed={participants[0].tipVoteBps === tip}
                      >
                        {percentage(tip)}
                      </button>
                    ))}
                    <label className="custom-tip">
                      <span>Custom</span>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        step="0.01"
                        value={participants[0].tipVoteBps / 100}
                        onChange={(event) => setTipVote("you", Number(event.target.value) * 100)}
                        disabled={phase !== "claiming"}
                        aria-label="Custom tip percentage"
                      />
                      <span>%</span>
                    </label>
                  </div>
                </div>

                <div className="vote-list">
                  {participants.map((participant) => (
                    <div key={participant.id}>
                      <span
                        className="mini-avatar"
                        style={{ "--avatar-colour": participant.colour } as CSSProperties}
                      >
                        {participant.initials}
                      </span>
                      <span>{participant.name}</span>
                      <strong>{percentage(participant.tipVoteBps)}</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article
                className="control-card remainder-card"
                hidden={dinerClaimStep !== "shared"}
              >
                <div className="card-title-row">
                  <div className="icon-box mint">
                    <Split size={18} />
                  </div>
                  <div>
                    <h3>Volunteer for unclaimed extras</h3>
                    <p>{money(preview.unclaimedPence)} is shared only by people who opt in.</p>
                  </div>
                </div>
                <div className="remainder-people">
                  {participants
                    .filter((participant) => participant.id === "you")
                    .map((participant) => (
                    <button
                      type="button"
                      key={participant.id}
                      className={participant.remainderOptIn ? "opted" : ""}
                      onClick={() => toggleRemainder(participant.id)}
                      disabled={phase !== "claiming"}
                      aria-pressed={participant.remainderOptIn}
                    >
                      <span
                        className="mini-avatar"
                        style={{ "--avatar-colour": participant.colour } as CSSProperties}
                      >
                        {participant.initials}
                      </span>
                      <span>Include me</span>
                      <span className="toggle-track">
                        <span />
                      </span>
                    </button>
                    ))}
                  <div className="secondary-detail" aria-label="Other diners' choices">
                    {participants
                      .filter((participant) => participant.id !== "you")
                      .map((participant) => (
                        <span key={participant.id}>
                          {participant.name}: {participant.remainderOptIn ? "volunteered" : "not included"}
                        </span>
                      ))}
                  </div>
                </div>
              </article>

              <article
                className="control-card approval-card diner-review-summary"
                hidden={dinerClaimStep !== "review"}
              >
                <div className="card-title-row">
                  <div className="icon-box amber">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h3>Your final check</h3>
                    <p>Payments open only after every diner approves the same version.</p>
                  </div>
                  <span className={`result-chip ${allParticipantsApproved ? "complete" : ""}`}>
                    {approvedParticipantIds.length}/{participants.length} ready
                  </span>
                </div>
                <div className="approval-version">
                  <span>Split version {splitRevision}</span>
                  <small>Claims, tip or remainder changes clear every approval.</small>
                </div>
                <div className="approval-list">
                  <div className="diner-review-row">
                    <span>Items you claimed</span>
                    <strong>{money(currentUser?.claimedPence ?? 0)}</strong>
                  </div>
                  <div className="diner-review-row">
                    <span>Unclaimed extras</span>
                    <strong>{money(currentUser?.remainderPence ?? 0)}</strong>
                  </div>
                  <div className="diner-review-row">
                    <span>Group tip · {percentage(preview.medianTipVoteBps)}</span>
                    <strong>{money(currentUser?.tipPence ?? 0)}</strong>
                  </div>
                  <div className="diner-review-row grand-total">
                    <span>You will pay</span>
                    <strong>{money(currentUser?.totalDuePence ?? 0)}</strong>
                  </div>
                </div>
                <button
                  className="secondary-detail"
                  type="button"
                  onClick={() => setDinerClaimStep("shared")}
                >
                  Change tip or extras
                </button>
              </article>

            </div>
          </div>

          <article
            className="funding-card diner-task-panel"
            id="protection"
            hidden={phase === "claiming" || phase === "settled"}
          >
            <div className="funding-header">
              <div>
                <span className="section-kicker">Step 4 · Protected payment</span>
                <h3>{failed ? "Your refund" : "Pay your part"}</h3>
                <p>
                  {failed
                    ? "A refund can only return to the person who made that contribution."
                    : "Your payment covers only your agreed share. You can sponsor someone separately if you choose."}
                </p>
              </div>
              {!failed && (
                <div className="funding-total">
                  <span>{money(preview.funding.fundedPence)} funded</span>
                  <strong>{progress}%</strong>
                </div>
              )}
            </div>

            {!failed && (
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Bill funding progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
            )}

            {!failed ? (
              <>
                {targetedParticipantId && participantById.has(targetedParticipantId) && (
                  <div className="personal-payment-arrival" role="status">
                    <HandCoins size={18} />
                    <span>
                      <strong>
                        {participantById.get(targetedParticipantId)?.name}&apos;s payment link
                      </strong>
                      <small>
                        {phase === "funding"
                          ? "Their exact remaining amount is ready below."
                          : "The organiser must finish approvals before payments open."}
                      </small>
                    </span>
                  </div>
                )}

                <div className="participant-funding-grid">
                  {preview.participants
                    .filter((participantPreview) => participantPreview.participantId === "you")
                    .map((participantPreview) => {
                    const person = participantById.get(participantPreview.participantId);
                    return (
                      <div
                        className={`participant-funding ${
                          targetedParticipantId === participantPreview.participantId
                            ? "is-targeted"
                            : ""
                        }`}
                        key={participantPreview.participantId}
                      >
                        <div className="participant-identity">
                          <span
                            className="person-avatar"
                            style={{ "--avatar-colour": person?.colour } as CSSProperties}
                          >
                            {person?.initials}
                          </span>
                          <span>
                            <strong>{person?.name}</strong>
                            <small>{money(participantPreview.totalDuePence)} due</small>
                          </span>
                        </div>
                        <div className="participant-funding-action">
                          {participantPreview.unpaidPence === 0 ? (
                            <span className="covered-pill">
                              <Check size={13} /> Covered
                            </span>
                          ) : phase === "funding" ? (
                            <button
                              type="button"
                              className="pay-person-button"
                              onClick={() => payRemaining(participantPreview.participantId)}
                            >
                              Pay {money(participantPreview.unpaidPence)}
                            </button>
                          ) : (
                            <span className="waiting-pill">Waiting</span>
                          )}

                          {phase === "funding" && participantPreview.unpaidPence > 0 && (
                            <span className="personal-link-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  void copyPreviewPaymentLink(
                                    participantPreview.participantId,
                                  )
                                }
                                aria-label={`Copy ${person?.name ?? "participant"} payment link`}
                              >
                                <Copy size={13} />
                                {copiedPaymentId === participantPreview.participantId
                                  ? "Copied"
                                  : "Link"}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openPreviewWhatsAppLink(
                                    participantPreview.participantId,
                                  )
                                }
                                aria-label={`Share ${person?.name ?? "participant"} payment link on WhatsApp`}
                              >
                                <MessageCircle size={13} /> WhatsApp
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="refund-grid">
                {(contributorTotals.get("you") ?? 0) === 0 ? (
                  <div className="empty-refund">
                    <ShieldCheck size={22} /> You did not contribute, so you do not need to claim a refund.
                  </div>
                ) : (
                  <div className="refund-row">
                    <span>
                      <strong>Your contribution</strong>
                      <small>{money(contributorTotals.get("you") ?? 0)} refundable</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => claimRefund("you")}
                      disabled={refundedPayers.includes("you")}
                      aria-label={`Claim your ${money(contributorTotals.get("you") ?? 0)} refund`}
                    >
                      {refundedPayers.includes("you")
                        ? "Refund claimed"
                        : `Claim ${money(contributorTotals.get("you") ?? 0)}`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {!failed && (
              <div className="funding-actions">
                <div className="sponsor-control">
                  <HandCoins size={18} />
                  <div>
                    <strong>Sponsor someone</strong>
                    <span>Cover another diner&apos;s remaining share.</span>
                  </div>
                  <select
                    value={activeSponsorId ?? ""}
                    onChange={(event) => setSponsorId(event.target.value)}
                    disabled={phase !== "funding"}
                    aria-label="Person to sponsor"
                  >
                    {sponsorableParticipants.length === 0 ? (
                      <option value="">Everyone else is covered</option>
                    ) : (
                      sponsorableParticipants.map((participant) => (
                        <option key={participant.participantId} value={participant.participantId}>
                          {participantById.get(participant.participantId)?.name} · {money(participant.unpaidPence)}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeSponsorId) payRemaining(activeSponsorId, "you");
                    }}
                    disabled={
                      phase !== "funding" ||
                      !activeSponsorId ||
                      !sponsor ||
                      sponsor.unpaidPence <= 0
                    }
                  >
                    Cover share
                  </button>
                </div>

              </div>
            )}
          </article>

          {phase === "settled" ? (
            <div id="sample-settlement-receipt">
              <TapTabSettlementReceipt
                receipt={previewSettlementReceipt}
                onShare={shareCurrentBill}
                onReset={resetDemo}
              />
            </div>
          ) : null}

          <details className="organiser-area" id="host-receipt-controls">
            <summary className="organiser-heading">
              <span>
                <strong>Organiser &amp; demo controls</strong>
                <small>Edit the receipt, manage diners and rehearse protected outcomes.</small>
              </span>
              <span aria-hidden="true">Open organiser area</span>
            </summary>
            <div className="organiser-tools-grid">
              <details
                id="host-verify-receipt"
                className="tool-disclosure receipt-tool"
                open={receiptStudioOpen}
                onToggle={(event) => setReceiptStudioOpen(event.currentTarget.open)}
              >
                <summary ref={receiptSummaryRef} tabIndex={-1}>
                  <span>
                    <strong>Verified receipt · {merchant}</strong>
                    <small>
                      {receiptItems.length} rows · {money(preview.subtotalPence)} subtotal
                    </small>
                  </span>
                  <span aria-hidden="true">
                    {receiptStudioOpen ? "Close editor" : "Scan or edit"}
                  </span>
                </summary>
                <div className="tool-disclosure-content">
                  <ReceiptImportPanel
                    key={`${merchant}\u0000${receiptItems
                      .map((item) => `${item.id}:${item.name}:${item.pricePence}:${item.shareSlots}`)
                      .join("|")}`}
                    currentMerchant={merchant}
                    currentItems={receiptItems}
                    disabled={phase !== "claiming"}
                    onApply={applyImportedReceipt}
                  />
                </div>
              </details>
              {receiptAppliedStatus ? (
                <p
                  className="secondary-detail receipt-applied-status"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {receiptAppliedStatus}
                </p>
              ) : null}

              <article className="control-card approval-card">
                <div className="card-title-row">
                  <div className="icon-box amber">
                    <Users size={18} />
                  </div>
                  <div>
                    <h3>Manage diner approvals</h3>
                    <p>Demo another diner approving the current split.</p>
                  </div>
                  <span className={`result-chip ${allParticipantsApproved ? "complete" : ""}`}>
                    {approvedParticipantIds.length}/{participants.length} ready
                  </span>
                </div>
                <div className="approval-list">
                  {participants.map((participant) => {
                    const approved = approvedParticipantIds.includes(participant.id);
                    return (
                      <button
                        type="button"
                        key={participant.id}
                        className={approved ? "approved" : ""}
                        onClick={() => toggleSplitApproval(participant.id)}
                        disabled={phase !== "claiming"}
                        aria-pressed={approved}
                        aria-label={`${approved ? "Withdraw" : "Record"} ${participant.name}'s approval for split version ${splitRevision}`}
                      >
                        <span
                          className="mini-avatar"
                          style={{ "--avatar-colour": participant.colour } as CSSProperties}
                        >
                          {participant.initials}
                        </span>
                        <span>
                          <strong>{participant.name}</strong>
                          <small>{approved ? `Approved version ${splitRevision}` : "Review needed"}</small>
                        </span>
                        {approved ? <CheckCircle2 size={17} /> : <span className="approval-dot" />}
                      </button>
                    );
                  })}
                </div>

                <div className="remainder-people">
                  <strong>Demo unclaimed-extra volunteers</strong>
                  {participants
                    .filter((participant) => participant.id !== "you")
                    .map((participant) => (
                      <button
                        type="button"
                        key={participant.id}
                        className={participant.remainderOptIn ? "opted" : ""}
                        onClick={() => toggleRemainder(participant.id)}
                        disabled={phase !== "claiming"}
                        aria-pressed={participant.remainderOptIn}
                        aria-label={`${participant.remainderOptIn ? "Remove" : "Add"} ${participant.name} ${participant.remainderOptIn ? "from" : "to"} the unclaimed extras volunteers`}
                      >
                        <span
                          className="mini-avatar"
                          style={{ "--avatar-colour": participant.colour } as CSSProperties}
                        >
                          {participant.initials}
                        </span>
                        <span>{participant.name}</span>
                        <span className="toggle-track" aria-hidden="true">
                          <span />
                        </span>
                      </button>
                    ))}
                </div>

                <div className="leave-transfer">
                  <div>
                    <strong>Transfer a departing diner’s items</strong>
                    <small>Move every claimed share before removing that diner.</small>
                  </div>
                  <div className="leave-transfer-controls">
                    <label>
                      <span>Diner leaving</span>
                      <select
                        value={leavingParticipantId}
                        onChange={(event) => {
                          const nextLeaving = event.target.value;
                          setLeavingParticipantId(nextLeaving);
                          if (transferTargetId === nextLeaving) {
                            setTransferTargetId(
                              participants.find((participant) => participant.id !== nextLeaving)?.id ?? "",
                            );
                          }
                        }}
                        disabled={phase !== "claiming" || participants.length <= 1}
                      >
                        {participants
                          .filter((participant) => participant.id !== "you")
                          .map((participant) => (
                          <option key={participant.id} value={participant.id}>
                            {participant.name}
                          </option>
                          ))}
                      </select>
                    </label>
                    <ArrowRight size={15} />
                    <label>
                      <span>Transfer to</span>
                      <select
                        value={transferTargetId}
                        onChange={(event) => setTransferTargetId(event.target.value)}
                        disabled={phase !== "claiming" || participants.length <= 1}
                      >
                        {participants
                          .filter((participant) => participant.id !== leavingParticipantId)
                          .map((participant) => (
                            <option key={participant.id} value={participant.id}>
                              {participant.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={transferClaimsAndLeave}
                      disabled={
                        phase !== "claiming" ||
                        participants.length <= 1 ||
                        leavingParticipantId === transferTargetId
                      }
                    >
                      Transfer and remove
                    </button>
                  </div>
                </div>
              </article>

              <article className="control-card">
                <div className="card-title-row">
                  <div className="icon-box violet">
                    <HandCoins size={18} />
                  </div>
                  <div>
                    <h3>Payment rehearsal</h3>
                    <p>Simulate diners paying, settlement or the safe failure path.</p>
                  </div>
                </div>
                <div className="participant-funding-grid">
                  {preview.participants.map((participantPreview) => {
                    const person = participantById.get(participantPreview.participantId);
                    return (
                      <div className="participant-funding" key={participantPreview.participantId}>
                        <span>
                          <strong>{person?.name}</strong>
                          <small>{money(participantPreview.unpaidPence)} left</small>
                        </span>
                        <button
                          type="button"
                          onClick={() => payRemaining(participantPreview.participantId)}
                          disabled={phase !== "funding" || participantPreview.unpaidPence <= 0}
                          aria-label={`Simulate ${person?.name ?? "diner"} paying ${money(participantPreview.unpaidPence)}`}
                        >
                          {participantPreview.unpaidPence <= 0 ? "Covered" : "Simulate payment"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="settle-control">
                  <span className="settle-protection">
                    <ShieldCheck size={17} />
                    {preview.funding.canSettle
                      ? "Exact total reached"
                      : `${money(preview.funding.remainingPence)} must still be covered`}
                  </span>
                  <button
                    className="settle-button"
                    type="button"
                    onClick={settleBill}
                    disabled={phase !== "funding" || !preview.funding.canSettle}
                    aria-describedby="diner-waiting-status"
                  >
                    Confirm settlement <LockKeyhole size={15} />
                  </button>
                </div>
                <div className="failure-actions">
                  <span>
                    <Clock3 size={15} /> Safe ending rehearsal
                  </span>
                  <button
                    type="button"
                    onClick={() => failBill("cancelled")}
                    disabled={phase !== "funding"}
                  >
                    Cancel bill
                  </button>
                  <button
                    type="button"
                    onClick={() => failBill("expired")}
                    disabled={phase !== "funding"}
                  >
                    Simulate expiry
                  </button>
                </div>
              </article>

              <div className="section-actions">
                <button className="quiet-button" type="button" onClick={resetDemo}>
                  <RotateCcw size={15} /> Reset sample
                </button>
                <button className="stage-button" type="button" onClick={() => setStageMode(true)}>
                  <Maximize2 size={15} /> Open Stage mode
                </button>
              </div>
            </div>
          </details>

          <details className="tool-disclosure proof-tools organiser-area">
            <summary>
              <span>
                <strong>Organiser proof · conversion and activity</strong>
                <small>Inspect the GBP/MON quote and the latest sample events.</small>
              </span>
              <span aria-hidden="true">View proof</span>
            </summary>
            <div className="tool-disclosure-content">
          <div className="under-grid">
            <article className="activity-card">
              <div className="under-card-heading">
                <div>
                  <span className="section-kicker">Stage-ready activity</span>
                  <h3>Every change tells the room what happened</h3>
                </div>
                <span className="preview-badge">Preview events</span>
              </div>
              <div className="activity-list" aria-live="polite" aria-relevant="additions">
                {feed.slice(0, 5).map((event) => (
                  <div key={event.id} className={`activity-row activity-${event.kind}`}>
                    <span className="activity-icon">{feedIcon(event.kind)}</span>
                    <span>
                      <strong>{event.title}</strong>
                      <small>{event.detail}</small>
                    </span>
                    <span className="activity-status">Preview</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="rate-card">
              <div className="rate-orb">
                <CirclePoundSterling size={28} />
              </div>
              <span className="section-kicker">GBP-first by design</span>
              <h3>Pounds stay readable. MON stays accountable.</h3>
              <p>
                Diners see familiar pound values. The live MON figure is a reference from the
                mainnet spot price; a deployed bill must lock its quote before creating native-MON
                contract amounts.
              </p>
              <div className="rate-readout">
                <div>
                  <span>{lockedPriceReference ? "£1 locked quote" : "£1 live reference"}</span>
                  <strong>{monEstimate(100)}</strong>
                </div>
                <div>
                  <span>1 MON current spot</span>
                  <strong>
                    {price
                      ? `${GBP_SPOT.format(price.gbp)} · ${USD_SPOT.format(price.usd)}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>{lockedPriceReference ? "Protected quote" : "Price status"}</span>
                  <strong
                    className={`price-${
                      lockedPriceReference
                        ? lockedPriceReference.mode === "live"
                          ? "live"
                          : "stale"
                        : priceState
                    }`}
                  >
                    <span />{" "}
                    {lockedPriceReference
                      ? `Fixed · ${lockedPriceReference.mode}`
                      : priceState === "live"
                        ? "Live"
                        : priceState}
                  </strong>
                </div>
              </div>
              <small className="rate-footnote">
                Testnet MON is not cash and cannot be redeemed at this displayed value.
              </small>
              <small className="rate-quote-time">
                {lockedPriceReference
                  ? `Protected quote fixed for payments · ${lockedPriceReference.source} · ${lockedPriceReference.basis} · observed ${quoteTime(lockedPriceReference.observedAtUnixSeconds) ?? "time unavailable"} · locked ${quoteTime(lockedPriceReference.lockedAtUnixSeconds) ?? "time unavailable"}`
                  : price?.lastUpdatedAt
                  ? `${priceState === "live" ? "Live" : "Stale"} ${price.source} ${price.basis} reference · observed ${quoteTime(price.lastUpdatedAt)} · checked every 30 seconds`
                  : "Waiting for a source timestamp"}
              </small>
              {lockedPriceReference && price ? (
                <small className="rate-quote-time">
                  Current spot: {priceState} · {price.source} · observed {quoteTime(price.lastUpdatedAt)}. It cannot change the protected payment totals.
                </small>
              ) : null}
            </article>
          </div>
            </div>
          </details>

          </div>

          {workspaceMode === "live" ? (
            <div className="workspace-view live-workspace">
              <div className="preview-notice live-notice">
                <ShieldCheck size={16} />
                <span>
                  Live mode uses the contract pinned into this build. Mismatched contract and bill links are rejected before any wallet action.
                </span>
              </div>

              <TapTabHostJourney
                receipt={{
                  detail: `${receiptItems.length} verified row${receiptItems.length === 1 ? "" : "s"} · ${merchant}`,
                  status: "complete",
                  href: "#host-verify-receipt",
                  onOpen: () =>
                    openWorkspace("preview", "host-verify-receipt", true),
                }}
                quote={{
                  detail: hostQuoteDetail,
                  status:
                    liveUpdate.metadata?.quote || lastCreatedBillMatchesLiveContext
                      ? "complete"
                      : hostQuote
                        ? "ready"
                        : "waiting",
                  href: "#host-create-testnet-bill",
                  onOpen: () => openWorkspace("live", "host-create-testnet-bill"),
                  disabled: tapTabDeployment.status !== "configured",
                }}
                createBill={{
                  detail: hostBillDetail,
                  status: hostBillContext
                    ? "complete"
                    : hostQuote
                      ? "ready"
                      : "waiting",
                  href: "#host-create-testnet-bill",
                  onOpen: () => openWorkspace("live", "host-create-testnet-bill"),
                  disabled: tapTabDeployment.status !== "configured",
                }}
                invitations={{
                  detail: hostInvitationDetail,
                  status:
                    (liveSnapshot?.participants.length ?? 0) > 1
                      ? "complete"
                      : hostCanInvite
                        ? "ready"
                        : "waiting",
                  href: "#live-host-title",
                  onOpen: () => openWorkspace("live", "live-host-title"),
                  disabled: !hostCanInvite,
                }}
                audience={{
                  detail: liveUpdate.shareUrl
                    ? "The canonical trusted contract and bill link is ready."
                    : "Wait for the trusted live snapshot and canonical link.",
                  status: liveUpdate.shareUrl ? "ready" : "waiting",
                  href: liveUpdate.shareUrl || "#live",
                  external: Boolean(liveUpdate.shareUrl),
                  disabled: !liveUpdate.shareUrl,
                }}
              />

              <TapTabLivePanel active onLiveUpdate={handleLiveUpdate} />

              {tapTabDeployment.status === "configured" ? (
                <details
                  className="tool-disclosure host-chain-tools organiser-area"
                  id="host-create-testnet-bill"
                >
                  <summary>
                    <span>
                      <strong>Organiser tools · create a live bill</strong>
                      <small>Create a new contract-backed bill from the verified receipt.</small>
                    </span>
                    <span aria-hidden="true">Open</span>
                  </summary>
                  <div className="tool-disclosure-content">
                    <TapTabCreateBillPanel
                      key={wallet.account ?? "disconnected"}
                      receipt={{ merchant, items: receiptItems }}
                      trustedContract={{
                        address: tapTabDeployment.address,
                        chainId: 10_143,
                      }}
                      wallet={wallet}
                      quote={createBillQuote}
                      initialPayee={wallet.account}
                      onCreated={openCreatedBill}
                    />
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          <details className="tool-disclosure presenter-tools organiser-area">
            <summary>
              <span>
                <strong>Organiser tools · presenter and recovery</strong>
                <small>Judge rehearsal, price fallback and recovery evidence.</small>
              </span>
              <span aria-hidden="true">Open</span>
            </summary>
            <div className="tool-disclosure-content presenter-tool-content">
              {workspaceMode === "preview" ? (
                <>
                  <TapTabJudgeGuide />
                  <TapTabLocalEvidencePanel
                    merchant={merchant}
                    items={receiptItems}
                    participants={participants}
                    claims={claims}
                    payments={payments}
                    approvedParticipantIds={approvedParticipantIds}
                    refundedPayerIds={refundedPayers}
                    splitRevision={splitRevision}
                    phase={phase}
                  />
                </>
              ) : (
                <TapTabDemoResiliencePanel
                  liveQuoteStatus={priceState}
                  manualQuote={activeManualCreateBillQuote}
                  recoverySource={recoverySource}
                  trustedContractAddress={
                    tapTabDeployment.status === "configured"
                      ? tapTabDeployment.address
                      : undefined
                  }
                  onManualQuoteConfirmed={setManualCreateBillQuote}
                  onUseLiveQuote={() => setManualCreateBillQuote(undefined)}
                  onRestoreReceipt={restoreRecoveryReceipt}
                  onOpenRecoveredBill={openRecoveredBill}
                />
              )}
            </div>
          </details>
        </section>

        <section className="how-section" id="how-it-works">
          <div className="section-heading light">
            <div>
              <span className="section-kicker">One bill, three moments</span>
              <h2>From camera roll to paid table</h2>
            </div>
          </div>
          <div className="how-grid">
            <article>
              <span className="step-number">01</span>
              <ReceiptText size={25} />
              <h3>Open and claim</h3>
              <p>Open the shared receipt. Each diner claims whole or shared items.</p>
            </article>
            <article>
              <span className="step-number">02</span>
              <Vote size={25} />
              <h3>Agree and fund</h3>
              <p>The median tip locks with the split. Pay yourself or quietly sponsor a friend.</p>
            </article>
            <article>
              <span className="step-number">03</span>
              <ShieldCheck size={25} />
              <h3>Settle or refund</h3>
              <p>The payee receives the exact total only when complete. Otherwise everyone can exit.</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="tap-footer">
        <a className="tap-brand footer-brand" href="#top">
          <span className="tap-brand-mark" aria-hidden="true">
            T
          </span>
          <span>TapTab</span>
        </a>
        <p>Built for Monad Blitz London. Hackathon software, not audited.</p>
        <a href="#bill">
          Open the demo <ExternalLink size={14} />
        </a>
      </footer>

      {stageMode && (
        <div
          className="stage-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="TapTab stage mode"
          ref={stageDialogRef}
          tabIndex={-1}
        >
          <header className="stage-header">
            <div className="stage-brand">
              <span className="tap-brand-mark">T</span>
              <span>
                <strong>{liveStage ? "TapTab Live" : "TapTab Local Demo"}</strong>
                <small>
                  {liveStage && liveSnapshot
                    ? `Bill #${liveSnapshot.bill.id.toString()} · ${liveUpdate.metadata?.merchant ?? "Monad Testnet"}`
                    : `Table 7 · ${merchant}`}
                </small>
              </span>
            </div>
            <div className="stage-header-status">
              <span
                className={`phase-pill phase-${
                  liveStage && liveSnapshot ? liveSnapshot.phase : phase
                }`}
              >
                <span />
                {liveStage && liveSnapshot
                  ? tapTabPhaseLabel(liveSnapshot.phase)
                  : PHASE_LABELS[phase]}
              </span>
              <span
                className={`stage-preview-warning ${liveStage ? "confirmed" : ""}`}
              >
                {liveStage ? "Confirmed Monad data" : "Preview activity"}
              </span>
              {liveStage && latestMeasuredConfirmation ? (
                <span
                  className="stage-latency-chip"
                  title={`${latestMeasuredConfirmation.action} · block ${latestMeasuredConfirmation.blockNumber.toString()}`}
                >
                  Monad confirmation {confirmationTime(latestMeasuredConfirmation.confirmationMs)}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setStageMode(false)}
                aria-label="Exit stage mode"
                ref={stageCloseButtonRef}
              >
                <X size={20} /> Exit
              </button>
            </div>
          </header>

          <div className="stage-main">
            <section className="stage-progress-panel">
              {liveStage && liveSnapshot ? (
                <>
                  <span className="stage-label">
                    {liveSnapshot.phase === "draft"
                      ? "Live split approval"
                      : liveSnapshot.phase === "settled"
                        ? "Settlement confirmed"
                        : liveFailed
                          ? "Refund protection active"
                          : "Confirmed funding progress"}
                  </span>
                  <div className="stage-amounts">
                    <strong>
                      {formatTapTabAmount(
                        liveSnapshot.phase === "draft"
                          ? liveSnapshot.bill.subtotal
                          : liveSnapshot.bill.totalFunded,
                        liveUpdate.quote,
                      ).primary}
                    </strong>
                    <span>
                      {liveSnapshot.phase === "draft"
                        ? "receipt subtotal"
                        : liveFailed
                          ? "contributed before failure"
                          : `of ${formatTapTabAmount(liveStageTotal, liveUpdate.quote).primary}`}
                    </span>
                  </div>
                  {liveUpdate.quote && liveUpdate.metadata?.quote ? (
                    <div className="stage-money-disclosure" role="note">
                      <strong>
                        {liveUpdate.metadata.settlement
                          ? "Scaled Testnet demo"
                          : "GBP quote fixed for this bill"}
                      </strong>
                      <span>
                        GBP uses the {liveUpdate.metadata.quote.source} {liveUpdate.metadata.quote.basis}
                        {" "}reference fixed when the bill was created.
                        {liveUpdate.metadata.settlement
                          ? ` Faucet-funded settlement is scaled ${liveUpdate.metadata.settlement.divisor.toLocaleString("en-GB")}:1 on Monad Testnet.`
                          : " MON remains the onchain settlement amount."}
                        {" "}Testnet MON has no cash value.
                      </span>
                    </div>
                  ) : null}
                  <div
                    className="stage-progress-track"
                    role="progressbar"
                    aria-label={
                      liveSnapshot.phase === "draft"
                        ? "Live split approval progress"
                        : "Live funding progress"
                    }
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={liveStageProgress}
                  >
                    <span style={{ width: `${liveStageProgress}%` }} />
                  </div>
                  <div className="stage-progress-meta">
                    <span>
                      {liveSnapshot.phase === "draft"
                        ? `${liveApprovalCount} of ${liveRequiredApprovals} diners approved`
                        : liveFailed
                          ? "Contributors can claim their own refunds"
                          : `${Math.round(liveStageProgress)}% funded`}
                    </span>
                    <span>
                      {liveSnapshot.phase === "draft"
                        ? `${liveClaimedShares} of ${liveTotalShares} item shares claimed`
                        : `${liveSnapshot.participants.length} joined`}
                    </span>
                    <span>
                      {liveSnapshot.phase === "draft"
                        ? `Split version ${liveSnapshot.splitStatus.splitVersion.toString()}`
                        : `${percentage(liveSnapshot.bill.lockedTipBps)} group tip`}
                    </span>
                  </div>

                  <div className="stage-people">
                    {liveSnapshot.participants.map((participant, index) => {
                      const privateName = livePrivateNameByAddress.get(
                        participant.address.toLowerCase(),
                      );
                      const participantDisplayPence =
                        liveParticipantDisplayPenceByAddress.get(
                          participant.address.toLowerCase(),
                        );
                      const displayName =
                        privateName ?? shortTapTabAddress(participant.address);
                      const initials = privateName
                        ? privateName
                            .split(/\s+/u)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase()
                        : participant.address.slice(2, 4).toUpperCase();

                      return (
                        <div
                          className={`stage-person ${
                            liveSnapshot.phase === "settled" ||
                            (liveSnapshot.phase === "funding" &&
                              participant.remainingDue === 0n)
                              ? "paid"
                              : ""
                          }`}
                          key={participant.address}
                        >
                          <span
                            className="stage-avatar"
                            style={
                              {
                                "--avatar-colour":
                                  STAGE_AVATAR_COLOURS[
                                    index % STAGE_AVATAR_COLOURS.length
                                  ],
                              } as CSSProperties
                            }
                          >
                            {initials}
                          </span>
                          <span>
                            <strong>{displayName}</strong>
                            <small>
                              {liveSnapshot.phase === "settled"
                                ? "Settled on Monad"
                                : liveFailed
                                  ? "Payer refunds are tracked separately"
                                  : liveSnapshot.phase === "draft"
                                    ? participant.approvedCurrentSplit
                                      ? `Approved version ${liveSnapshot.splitStatus.splitVersion.toString()}`
                                      : `${percentage(participant.tipVoteBps)} tip · reviewing split`
                                    : participant.remainingDue === 0n
                                      ? "Fully funded"
                                      : "Funding still needed"}
                            </small>
                          </span>
                          <strong>
                            {liveSnapshot.phase === "draft"
                              ? participant.approvedCurrentSplit
                                ? "Ready"
                                : "Reviewing"
                              : liveFailed
                                ? "Not a refund"
                                : formatTapTabAmount(
                                    participant.amountDue,
                                    liveUpdate.quote,
                                    participantDisplayPence?.totalDuePence,
                                  ).primary}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <span className="stage-label">
                    {phase === "settled"
                      ? "Settlement complete"
                      : failed
                        ? "Refund protection"
                        : phase === "claiming"
                          ? "Unanimous ready check"
                          : "Funding progress"}
                  </span>
                  <div className="stage-amounts">
                    <strong>
                      {phase === "claiming"
                        ? `${approvedParticipantIds.length}/${participants.length}`
                        : money(
                            failed
                              ? refundableRemainingPence
                              : preview.funding.fundedPence,
                          )}
                    </strong>
                    <span>
                      {phase === "claiming"
                        ? `diners approved version ${splitRevision}`
                        : failed
                          ? "still claimable"
                          : `of ${money(preview.totalDuePence)}`}
                    </span>
                  </div>
                  <div
                    className="stage-progress-track"
                    role="progressbar"
                    aria-label={
                      failed
                        ? "Refund claim progress"
                        : phase === "claiming"
                          ? "Split approval progress"
                          : "Stage funding progress"
                    }
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={stageProgress}
                  >
                    <span style={{ width: `${stageProgress}%` }} />
                  </div>
                  <div className="stage-progress-meta">
                    <span>
                      {phase === "settled"
                        ? "100% settled"
                        : failed
                          ? refundableRemainingPence > 0
                            ? "Refunds remain claimable"
                            : "All refunds returned"
                          : phase === "claiming"
                            ? `${approvedParticipantIds.length} ready · changes clear approvals`
                            : `${progress}% funded`}
                    </span>
                    <span>{percentage(preview.medianTipVoteBps)} group tip</span>
                    <span>{money(preview.unclaimedPence)} fair remainder</span>
                  </div>

                  <div className="stage-people">
                    {preview.participants.map((participantPreview) => {
                      const person = participantById.get(participantPreview.participantId);
                      const contribution =
                        contributorTotals.get(participantPreview.participantId) ?? 0;
                      const refundClaimed = refundedPayers.includes(
                        participantPreview.participantId,
                      );
                      return (
                        <div
                          className={`stage-person ${
                            phase === "settled" ||
                            (phase === "funding" && participantPreview.unpaidPence === 0)
                              ? "paid"
                              : failed && contribution > 0
                                ? "refundable"
                                : ""
                          }`}
                          key={participantPreview.participantId}
                        >
                          <span
                            className="stage-avatar"
                            style={{ "--avatar-colour": person?.colour } as CSSProperties}
                          >
                            {person?.initials}
                          </span>
                          <span>
                            <strong>{person?.name}</strong>
                            <small>
                              {phase === "settled"
                                ? "Settled"
                                : failed
                                  ? contribution > 0
                                    ? refundClaimed
                                      ? "Refund claimed"
                                      : `${money(contribution)} refundable`
                                    : "No contribution"
                                  : phase === "claiming"
                                    ? approvedParticipantIds.includes(
                                        participantPreview.participantId,
                                      )
                                      ? `Approved version ${splitRevision}`
                                      : "Reviewing the split"
                                  : participantPreview.unpaidPence === 0
                                    ? "Paid"
                                    : `${money(participantPreview.unpaidPence)} left`}
                            </small>
                          </span>
                          <strong>{money(participantPreview.totalDuePence)}</strong>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            <section
              className={`stage-join-panel ${
                liveStage ? (liveTerminal ? "terminal" : "") : failed || phase === "settled" ? "terminal" : ""
              }`}
            >
              {liveStage && liveSnapshot ? (
                <>
                  {liveTerminal ? (
                    <div className="stage-terminal-visual">
                      {liveSnapshot.phase === "settled" ? (
                        <CheckCircle2 size={74} />
                      ) : (
                        <RefreshCw size={70} />
                      )}
                    </div>
                  ) : liveUpdate.shareUrl ? (
                    <div className="stage-qr-wrap">
                      <QRCodeSVG
                        value={liveUpdate.shareUrl}
                        size={174}
                        level="M"
                        title="QR code for the confirmed live TapTab bill"
                      />
                    </div>
                  ) : null}
                  <span className="stage-label">
                    {liveSnapshot.phase === "draft"
                      ? "Trusted link to join and claim"
                      : liveSnapshot.phase === "funding"
                        ? "Trusted link to fund the bill"
                        : liveSnapshot.phase === "settled"
                          ? "Settlement confirmed on Monad"
                          : "Contract refund path active"}
                  </span>
                  <h2>
                    {liveSnapshot.phase === "settled" ? (
                      <>Paid together.<br />Confirmed on-chain.</>
                    ) : liveFailed ? (
                      <>Contributions<br />stay protected.</>
                    ) : liveSnapshot.phase === "draft" ? (
                      <>Join the tab.<br />Claim your items.</>
                    ) : (
                      <>Fund your share.<br />Or sponsor someone.</>
                    )}
                  </h2>
                  <p>
                    {liveFailed
                      ? "Each refund remains claimable only by its original payer"
                      : `${liveSnapshot.participants.length} diners joined · ${
                          liveUpdate.quote
                            ? "verified GBP receipt values shown first"
                            : "native MON settlement values"
                        }`}
                  </p>
                </>
              ) : (
                <>
                  {failed || phase === "settled" ? (
                    <div className="stage-terminal-visual">
                      {phase === "settled" ? <CheckCircle2 size={74} /> : <RefreshCw size={70} />}
                    </div>
                  ) : (
                    <div className="stage-qr-wrap">
                      <QRCodeSVG
                        value={inviteUrl}
                        size={174}
                        level="M"
                        title="Preview QR code for Table 7"
                      />
                    </div>
                  )}
                  <span className="stage-label">
                    {phase === "claiming"
                      ? "Preview QR for Table 7"
                      : phase === "funding"
                        ? "Preview QR to open Table 7"
                        : phase === "settled"
                          ? "Exact total received"
                          : "Contributions stay protected"}
                  </span>
                  <h2>
                    {phase === "settled" ? (
                      <>Paid together.<br />Nobody chased.</>
                    ) : failed ? (
                      refundableRemainingPence > 0 ? (
                        <>Refunds are<br />ready to claim.</>
                      ) : (
                        <>Every refund<br />was returned.</>
                      )
                    ) : (
                      <>Claim your items.<br />Pay your part.</>
                    )}
                  </h2>
                  <p>
                    {failed
                      ? "The original contributor owns each refund"
                      : phase === "settled"
                        ? `${participants.length} diners · one settled bill`
                        : `${participants.length} diners joined · GBP values shown first`}
                  </p>
                </>
              )}
            </section>

            <section className="stage-feed-panel">
              <div className="stage-feed-heading">
                <span className="stage-label">
                  {liveStage ? "Confirmed Monad activity" : "Simulated table activity"}
                </span>
                <span>
                  {liveStage
                    ? "Joining, approvals, claims, funding and settlement update from the chain"
                    : "Deterministic local actions appear here; no Monad receipt is claimed"}
                </span>
              </div>
              <div className="stage-feed" aria-live="polite" aria-relevant="additions">
                {liveStage ? (
                  liveUpdate.events.length ? (
                    liveUpdate.events.slice(0, 7).map((event) => (
                      <div key={event.id}>
                        <span className="stage-feed-icon">
                          <CheckCircle2 size={15} />
                        </span>
                        <span>
                          <strong>{event.title}</strong>
                          <small>{event.detail}</small>
                        </span>
                        {event.explorerUrl ? (
                          <a
                            className="stage-confirmed-tag"
                            href={event.explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Confirmed <ExternalLink size={9} />
                          </a>
                        ) : (
                          <span className="stage-confirmed-tag">Confirmed</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="stage-empty-feed">
                      No recent events were found in the current block window. New confirmations
                      will appear automatically.
                    </p>
                  )
                ) : (
                  feed.slice(0, 6).map((event) => (
                    <div key={event.id}>
                      <span className="stage-feed-icon">{feedIcon(event.kind)}</span>
                      <span>
                        <strong>{event.title}</strong>
                        <small>{event.detail}</small>
                      </span>
                      <span className="stage-preview-tag">Preview</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <footer className="stage-controls">
            <span>
              <ShieldCheck size={17} />
              {liveStage
                ? "The contract cannot settle an incomplete bill."
                : "The local model blocks incomplete settlement; Solidity parity is covered by the local contract rehearsal."}
            </span>
            <div>
              {liveStage ? (
                <button
                  type="button"
                  onClick={() => {
                    setStageMode(false);
                    window.requestAnimationFrame(() => {
                      document.getElementById("live")?.scrollIntoView({ behavior: "smooth" });
                    });
                  }}
                >
                  Open live controls <ArrowRight size={16} />
                </button>
              ) : (
                <>
                  {phase === "claiming" && nextUnapproved && (
                    <button
                      type="button"
                      onClick={() => toggleSplitApproval(nextUnapproved.id)}
                    >
                      Approve {nextUnapproved.name} <Check size={16} />
                    </button>
                  )}
                  {phase === "claiming" && !nextUnapproved && (
                    <button type="button" onClick={lockSplit}>
                      Lock split <ArrowRight size={16} />
                    </button>
                  )}
                  {phase === "funding" && nextUnpaid && (
                    <button type="button" onClick={() => payRemaining(nextUnpaid.participantId)}>
                      Simulate next payment <ArrowRight size={16} />
                    </button>
                  )}
                  {phase === "funding" && !nextUnpaid && (
                    <button type="button" onClick={settleBill}>
                      Settle together <Check size={16} />
                    </button>
                  )}
                  {(phase === "settled" || failed) && (
                    <button type="button" onClick={resetDemo}>
                      Run demo again <RotateCcw size={16} />
                    </button>
                  )}
                </>
              )}
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}

import { formatEther, getAddress, isAddress } from "viem";
import type {
  TapTabContext,
  TapTabDeploymentResolution,
  TapTabPhase,
} from "./taptab-chain";
import { allocateReceiptPenceToWei } from "./taptab-create-bill.ts";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

const UINT256_MAX = (1n << 256n) - 1n;
const SCALED_TESTNET_DIVISOR = 1_000n;

export type TrustedTapTabContext = Readonly<{
  status: "trusted";
  context: TapTabContext;
  source: "configured" | "query";
}>;

export type TapTabQueryResolution =
  | TrustedTapTabContext
  | Readonly<{
      status: "unavailable";
      reason: string;
    }>
  | Readonly<{
      status: "rejected";
      reason: string;
    }>;

export type TapTabGbpMetadata = Readonly<{
  currency: "GBP";
  merchant?: string;
  subtotalPence: number;
  items?: readonly Readonly<{ name: string; amountPence: number }>[];
  quote?: Readonly<{
    gbpPerMon: string;
    source: string;
    basis: string;
    observedAtUnixSeconds: number;
    lockedAtUnixSeconds: number;
    subtotalWei?: string;
    referenceSubtotalWei?: string;
  }>;
  settlement?: Readonly<{
    mode: "scaled-testnet-demo";
    divisor: 1_000;
    allocation: "largest-remainder-half-up";
    subtotalWei: string;
    network: "Monad Testnet";
  }>;
}>;

export type TapTabGbpMetadataOnchainEvidence = Readonly<{
  subtotalWei: bigint;
  itemAmountsWei: readonly bigint[];
}>;

export type TapTabGbpQuote = Readonly<{
  subtotalPence: number;
  subtotalWei: bigint;
}>;

export type TapTabAmountPresentation = Readonly<{
  primary: string;
  secondary?: string;
  unit: "GBP" | "MON";
}>;

export type TapTabPenceAllocationSource = Readonly<{
  key: string;
  amountWei: bigint;
}>;

export type TapTabPenceAllocation = TapTabPenceAllocationSource &
  Readonly<{
    amountPence: number;
  }>;

export type TapTabParticipantPenceAllocationSource = Readonly<{
  key: string;
  baseDueWei: bigint;
  tipDueWei: bigint;
}>;

export type TapTabParticipantPenceAllocation = Readonly<{
  key: string;
  baseDuePence: number;
  tipPence: number;
  totalDuePence: number;
}>;

export type TapTabSponsorshipParticipantSource = Readonly<{
  key: string;
  totalDueWei: bigint;
  totalDuePence: number;
}>;

export type TapTabContributionPenceSource = Readonly<{
  key: string;
  payerKey: string;
  beneficiaryKey: string;
  amountWei: bigint;
}>;

export type TapTabSponsorshipPenceAllocation = Readonly<{
  key: string;
  selfPaidPence: number;
  sponsoredByOthersPence: number;
  sponsoredForOthersPence: number;
}>;

export type PresentableChainEvent = Readonly<{
  title: string;
  detail: string;
  tone: "neutral" | "positive" | "warning";
}>;

function parsePositiveUint(value: string): bigint | undefined {
  if (!/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed <= UINT256_MAX ? parsed : undefined;
}

/**
 * Shared links may select any positive bill ID created by the exact contract
 * pinned into the build. The contract address remains the trust boundary, so a
 * link cannot silently swap in a lookalike deployment.
 */
export function resolveTrustedTapTabQuery(
  search: string,
  deployment: TapTabDeploymentResolution,
): TapTabQueryResolution {
  if (deployment.status !== "configured") {
    return { status: "unavailable", reason: deployment.reason };
  }

  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const contracts = params.getAll("contract");
  const bills = params.getAll("bill");
  const hasSharedContext = contracts.length > 0 || bills.length > 0;
  const configured: TapTabContext = {
    address: deployment.address,
    billId: deployment.billId,
  };

  if (!hasSharedContext) {
    return { status: "trusted", context: configured, source: "configured" };
  }

  if (contracts.length !== 1 || bills.length !== 1) {
    return {
      status: "rejected",
      reason: "The shared link must contain one contract and one bill ID.",
    };
  }

  const rawContract = contracts[0]?.trim() ?? "";
  const rawBill = bills[0]?.trim() ?? "";
  if (!isAddress(rawContract)) {
    return { status: "rejected", reason: "The shared link contains an invalid contract." };
  }

  const billId = parsePositiveUint(rawBill);
  if (billId === undefined) {
    return { status: "rejected", reason: "The shared link contains an invalid bill ID." };
  }

  if (getAddress(rawContract) !== deployment.address) {
    return {
      status: "rejected",
      reason: "This link does not use the TapTab contract trusted by this build.",
    };
  }

  return {
    status: "trusted",
    context: { address: deployment.address, billId },
    source: "query",
  };
}

export function buildTapTabShareUrl(
  origin: string,
  pathname: string,
  context: TapTabContext,
): string {
  const url = new URL(pathname || "/", origin);
  url.search = "";
  url.hash = "live";
  url.searchParams.set("contract", context.address);
  url.searchParams.set("bill", context.billId.toString());
  return url.toString();
}

/**
 * Returns a same-origin, non-personalised route back to the exact live bill.
 * Invalid or partial payment-link context fails closed to the configured live
 * workspace instead of carrying untrusted parameters into the main app.
 */
export function buildTapTabFullBillHref(locationHref: string): string {
  const fallback = "/?workspace=live#bill";
  try {
    const current = new URL(locationHref);
    const contracts = current.searchParams.getAll("contract");
    const bills = current.searchParams.getAll("bill");
    if (contracts.length !== 1 || bills.length !== 1) return fallback;

    const rawContract = contracts[0]?.trim() ?? "";
    const billId = parsePositiveUint(bills[0]?.trim() ?? "");
    if (!isAddress(rawContract) || billId === undefined) return fallback;

    const destination = new URL("/", current.origin);
    destination.searchParams.set("workspace", "live");
    destination.searchParams.set("contract", getAddress(rawContract));
    destination.searchParams.set("bill", billId.toString());
    destination.hash = "bill";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

export function shortTapTabAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}\u2026${address.slice(-4)}`
    : address;
}

export function formatMonAmount(amountWei: bigint): string {
  const raw = formatEther(amountWei);
  const [whole, fraction = ""] = raw.split(".");
  const compactFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return `${whole}${compactFraction ? `.${compactFraction}` : ""} MON`;
}

/**
 * Converts one wei value against a verified bill quote. Grouped values should
 * use `allocateTapTabPence` instead so their displayed pennies conserve the
 * bill-wide target.
 */
export function quoteTapTabPence(
  amountWei: bigint,
  quote: TapTabGbpQuote,
): number | undefined {
  if (
    amountWei < 0n ||
    quote.subtotalWei <= 0n ||
    !Number.isSafeInteger(quote.subtotalPence) ||
    quote.subtotalPence <= 0
  ) {
    return undefined;
  }

  const pence =
    (amountWei * BigInt(quote.subtotalPence) + quote.subtotalWei / 2n) /
    quote.subtotalWei;
  return pence <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(pence) : undefined;
}

/**
 * Allocates an integer-penny target by largest remainder. Equal remainders are
 * resolved in source order, so the result is deterministic without inventing
 * a second ordering rule for bill rows.
 */
export function allocateTapTabPence(
  sources: readonly TapTabPenceAllocationSource[],
  totalPence: number,
): readonly TapTabPenceAllocation[] | undefined {
  if (!Number.isSafeInteger(totalPence) || totalPence < 0) return undefined;

  const seenKeys = new Set<string>();
  for (const source of sources) {
    if (
      typeof source.key !== "string" ||
      !source.key ||
      seenKeys.has(source.key) ||
      typeof source.amountWei !== "bigint" ||
      source.amountWei < 0n
    ) {
      return undefined;
    }
    seenKeys.add(source.key);
  }

  const totalWei = sources.reduce((total, source) => total + source.amountWei, 0n);
  if (totalWei === 0n) {
    if (totalPence !== 0) return undefined;
    return Object.freeze(
      sources.map((source) => Object.freeze({ ...source, amountPence: 0 })),
    );
  }

  const target = BigInt(totalPence);
  const rows = sources.map((source, index) => {
    const numerator = source.amountWei * target;
    return {
      source,
      index,
      amountPence: numerator / totalWei,
      remainder: numerator % totalWei,
    };
  });
  const floorTotal = rows.reduce((total, row) => total + row.amountPence, 0n);
  const undistributed = target - floorTotal;
  if (undistributed < 0n || undistributed > BigInt(rows.length)) return undefined;

  const priority = [...rows].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    return left.index - right.index;
  });
  for (let index = 0; index < Number(undistributed); index += 1) {
    priority[index].amountPence += 1n;
  }

  const allocations = rows.map(({ source, amountPence }) => {
    const safeAmount = Number(amountPence);
    if (!Number.isSafeInteger(safeAmount) || safeAmount < 0) return undefined;
    return Object.freeze({ ...source, amountPence: safeAmount });
  });
  if (
    allocations.some((allocation) => allocation === undefined) ||
    allocations.reduce(
      (total, allocation) => total + (allocation?.amountPence ?? 0),
      0,
    ) !== totalPence
  ) {
    return undefined;
  }

  return Object.freeze(allocations as TapTabPenceAllocation[]);
}

/** Allocates the participant base and tip ledgers against their own bill totals. */
export function allocateTapTabParticipantPence(
  sources: readonly TapTabParticipantPenceAllocationSource[],
  subtotalPence: number,
  tipPence: number,
): readonly TapTabParticipantPenceAllocation[] | undefined {
  if (!Number.isSafeInteger(subtotalPence + tipPence)) return undefined;

  const base = allocateTapTabPence(
    sources.map((source) => ({ key: source.key, amountWei: source.baseDueWei })),
    subtotalPence,
  );
  const tips = allocateTapTabPence(
    sources.map((source) => ({ key: source.key, amountWei: source.tipDueWei })),
    tipPence,
  );
  if (!base || !tips) return undefined;

  const allocations = base.map((baseAllocation, index) => {
    const tipAllocation = tips[index];
    if (!tipAllocation || tipAllocation.key !== baseAllocation.key) return undefined;
    const totalDuePence = baseAllocation.amountPence + tipAllocation.amountPence;
    if (!Number.isSafeInteger(totalDuePence) || totalDuePence < 0) return undefined;
    return Object.freeze({
      key: baseAllocation.key,
      baseDuePence: baseAllocation.amountPence,
      tipPence: tipAllocation.amountPence,
      totalDuePence,
    });
  });
  if (allocations.some((allocation) => allocation === undefined)) return undefined;
  return Object.freeze(allocations as TapTabParticipantPenceAllocation[]);
}

/**
 * Allocates each beneficiary's confirmed contribution events against that
 * participant's conserved GBP total before deriving sponsorship. This avoids
 * independently rounding partial payments and misclassifying sub-penny events.
 */
export function allocateTapTabSponsorshipPence(
  participants: readonly TapTabSponsorshipParticipantSource[],
  contributions: readonly TapTabContributionPenceSource[],
): readonly TapTabSponsorshipPenceAllocation[] | undefined {
  const participantByKey = new Map<string, TapTabSponsorshipParticipantSource>();
  for (const participant of participants) {
    if (
      typeof participant.key !== "string" ||
      !participant.key ||
      participantByKey.has(participant.key) ||
      typeof participant.totalDueWei !== "bigint" ||
      participant.totalDueWei < 0n ||
      !Number.isSafeInteger(participant.totalDuePence) ||
      participant.totalDuePence < 0
    ) {
      return undefined;
    }
    participantByKey.set(participant.key, participant);
  }

  const contributionKeys = new Set<string>();
  const contributionsByBeneficiary = new Map<string, TapTabContributionPenceSource[]>();
  for (const contribution of contributions) {
    if (
      typeof contribution.key !== "string" ||
      !contribution.key ||
      contributionKeys.has(contribution.key) ||
      typeof contribution.payerKey !== "string" ||
      !contribution.payerKey ||
      typeof contribution.beneficiaryKey !== "string" ||
      !contribution.beneficiaryKey ||
      !participantByKey.has(contribution.beneficiaryKey) ||
      typeof contribution.amountWei !== "bigint" ||
      contribution.amountWei <= 0n
    ) {
      return undefined;
    }
    contributionKeys.add(contribution.key);
    const beneficiaryContributions =
      contributionsByBeneficiary.get(contribution.beneficiaryKey) ?? [];
    beneficiaryContributions.push(contribution);
    contributionsByBeneficiary.set(contribution.beneficiaryKey, beneficiaryContributions);
  }

  const sponsorshipByParticipant = new Map(
    participants.map((participant) => [
      participant.key,
      {
        selfPaidPence: 0,
        sponsoredByOthersPence: 0,
        sponsoredForOthersPence: 0,
      },
    ]),
  );

  for (const participant of participants) {
    const beneficiaryContributions = [
      ...(contributionsByBeneficiary.get(participant.key) ?? []),
    ].sort((left, right) => left.key.localeCompare(right.key, "en"));
    if (
      beneficiaryContributions.reduce(
        (total, contribution) => total + contribution.amountWei,
        0n,
      ) !== participant.totalDueWei
    ) {
      return undefined;
    }
    const allocated = allocateTapTabPence(
      beneficiaryContributions.map((contribution) => ({
        key: contribution.key,
        amountWei: contribution.amountWei,
      })),
      participant.totalDuePence,
    );
    if (!allocated) return undefined;

    const allocationByKey = new Map(
      allocated.map((allocation) => [allocation.key, allocation.amountPence]),
    );
    const beneficiaryTotals = sponsorshipByParticipant.get(participant.key);
    if (!beneficiaryTotals) return undefined;
    for (const contribution of beneficiaryContributions) {
      const amountPence = allocationByKey.get(contribution.key);
      if (amountPence === undefined) return undefined;
      if (contribution.payerKey === contribution.beneficiaryKey) {
        beneficiaryTotals.selfPaidPence += amountPence;
      } else {
        beneficiaryTotals.sponsoredByOthersPence += amountPence;
        const payerTotals = sponsorshipByParticipant.get(contribution.payerKey);
        if (payerTotals) payerTotals.sponsoredForOthersPence += amountPence;
      }
    }
    if (
      beneficiaryTotals.selfPaidPence + beneficiaryTotals.sponsoredByOthersPence !==
      participant.totalDuePence
    ) {
      return undefined;
    }
  }

  const result = participants.map((participant) => {
    const allocation = sponsorshipByParticipant.get(participant.key);
    if (
      !allocation ||
      !Number.isSafeInteger(allocation.sponsoredForOthersPence) ||
      allocation.sponsoredForOthersPence < 0
    ) {
      return undefined;
    }
    return Object.freeze({ key: participant.key, ...allocation });
  });
  if (result.some((allocation) => allocation === undefined)) return undefined;
  return Object.freeze(result as TapTabSponsorshipPenceAllocation[]);
}

export function formatTapTabAmount(
  amountWei: bigint,
  quote?: TapTabGbpQuote,
  allocatedPence?: number,
): TapTabAmountPresentation {
  const mon = formatMonAmount(amountWei);
  if (!quote) {
    return { primary: mon, unit: "MON" };
  }

  const pence =
    allocatedPence === undefined
      ? quoteTapTabPence(amountWei, quote)
      : amountWei >= 0n &&
          quoteTapTabPence(0n, quote) !== undefined &&
          Number.isSafeInteger(allocatedPence) &&
          allocatedPence >= 0
        ? allocatedPence
        : undefined;
  if (pence === undefined) {
    return { primary: mon, unit: "MON" };
  }

  return {
    primary: GBP.format(pence / 100),
    secondary: mon,
    unit: "GBP",
  };
}

export function parseTipPercentToBps(value: string): number | undefined {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const whole = Number(match[1]);
  const decimal = Number((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100 + decimal;
  return basisPoints <= 3_000 ? basisPoints : undefined;
}

export function formatTipBps(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2).replace(/0$/, "")}%`;
}

function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
}

function safePence(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 1_000_000_000
    ? Number(value)
    : undefined;
}

function safeUnixSeconds(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

type ParsedQuoteBase = Readonly<{
  gbpPerMon: string;
  source: string;
  basis: string;
  observedAtUnixSeconds: number;
  lockedAtUnixSeconds: number;
}>;

function parseQuoteBase(value: unknown): ParsedQuoteBase | undefined {
  if (!value || typeof value !== "object") return undefined;
  const quote = value as Record<string, unknown>;
  const gbpPerMon = safeText(quote.gbpPerMon, 64);
  const source = safeText(quote.source, 100);
  const basis = safeText(quote.basis, 100);
  const observedAtUnixSeconds = safeUnixSeconds(quote.observedAtUnixSeconds);
  const lockedAtUnixSeconds = safeUnixSeconds(quote.lockedAtUnixSeconds);
  if (
    !gbpPerMon ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(gbpPerMon) ||
    BigInt(gbpPerMon.replace(".", "")) <= 0n ||
    !source ||
    !basis ||
    observedAtUnixSeconds === undefined ||
    lockedAtUnixSeconds === undefined ||
    lockedAtUnixSeconds < observedAtUnixSeconds
  ) {
    return undefined;
  }
  return {
    gbpPerMon,
    source,
    basis,
    observedAtUnixSeconds,
    lockedAtUnixSeconds,
  };
}

function parseLegacyQuoteMetadata(
  value: unknown,
  subtotalPence: number,
  items: TapTabGbpMetadata["items"],
): TapTabGbpMetadata["quote"] {
  const base = parseQuoteBase(value);
  if (!base || !value || typeof value !== "object") return undefined;
  const quote = value as Record<string, unknown>;
  const subtotalWei = safeText(quote.subtotalWei, 100);
  if (!subtotalWei || !/^[1-9][0-9]*$/.test(subtotalWei)) return undefined;

  try {
    const expectedSubtotalWei =
      quote.allocation === "per-row-half-up" && items
        ? items.reduce(
            (total, item) =>
              total + allocateReceiptPenceToWei([item.amountPence], base.gbpPerMon).subtotalWei,
            0n,
          )
        : allocateReceiptPenceToWei([subtotalPence], base.gbpPerMon).subtotalWei;
    if (expectedSubtotalWei.toString() !== subtotalWei) return undefined;
    return { ...base, subtotalWei };
  } catch {
    return undefined;
  }
}

function scaledReferenceAmounts(
  items: NonNullable<TapTabGbpMetadata["items"]>,
  gbpPerMon: string,
) {
  const referenceItemAmountsWei = items.map(
    (item) => allocateReceiptPenceToWei([item.amountPence], gbpPerMon).subtotalWei,
  );
  const referenceSubtotalWei = referenceItemAmountsWei.reduce(
    (total, amount) => total + amount,
    0n,
  );
  const subtotalWei =
    (referenceSubtotalWei + SCALED_TESTNET_DIVISOR / 2n) /
    SCALED_TESTNET_DIVISOR;
  const rows = referenceItemAmountsWei.map((amount, index) => ({
    index,
    floor: amount / SCALED_TESTNET_DIVISOR,
    remainder: amount % SCALED_TESTNET_DIVISOR,
  }));
  const itemAmountsWei = rows.map((row) => row.floor);
  const remaining = subtotalWei - rows.reduce((total, row) => total + row.floor, 0n);
  if (remaining < 0n || remaining > BigInt(rows.length)) return undefined;
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
    return undefined;
  }
  return { referenceItemAmountsWei, referenceSubtotalWei, itemAmountsWei, subtotalWei };
}

function parseScaledTestnetMetadata(
  record: Record<string, unknown>,
  merchant: string | undefined,
  subtotalPence: number,
  items: TapTabGbpMetadata["items"],
  onchain: TapTabGbpMetadataOnchainEvidence | undefined,
): TapTabGbpMetadata | undefined {
  if (
    record.schema !== "taptab-gbp-receipt" ||
    record.version !== 2 ||
    !items ||
    !onchain ||
    onchain.subtotalWei <= 0n ||
    onchain.itemAmountsWei.length !== items.length ||
    onchain.itemAmountsWei.some((amount) => amount <= 0n)
  ) {
    return undefined;
  }

  const quoteValue = record.quote;
  const quote = parseQuoteBase(quoteValue);
  if (!quote || !quoteValue || typeof quoteValue !== "object") return undefined;
  const quoteRecord = quoteValue as Record<string, unknown>;
  const referenceSubtotalWei = safeText(quoteRecord.referenceSubtotalWei, 100);
  if (
    quoteRecord.allocation !== "per-row-half-up" ||
    quoteRecord.subtotalWei !== undefined ||
    !referenceSubtotalWei ||
    !/^[1-9][0-9]*$/.test(referenceSubtotalWei)
  ) {
    return undefined;
  }

  const settlementValue = record.settlement;
  if (!settlementValue || typeof settlementValue !== "object") return undefined;
  const settlement = settlementValue as Record<string, unknown>;
  const settlementSubtotalWei = safeText(settlement.subtotalWei, 100);
  if (
    settlement.mode !== "scaled-testnet-demo" ||
    settlement.divisor !== Number(SCALED_TESTNET_DIVISOR) ||
    settlement.allocation !== "largest-remainder-half-up" ||
    settlement.network !== "Monad Testnet" ||
    !settlementSubtotalWei ||
    !/^[1-9][0-9]*$/.test(settlementSubtotalWei)
  ) {
    return undefined;
  }

  try {
    const derived = scaledReferenceAmounts(items, quote.gbpPerMon);
    if (
      !derived ||
      derived.referenceSubtotalWei.toString() !== referenceSubtotalWei ||
      derived.subtotalWei.toString() !== settlementSubtotalWei ||
      onchain.subtotalWei !== derived.subtotalWei ||
      onchain.itemAmountsWei.some(
        (amount, index) => amount !== derived.itemAmountsWei[index],
      )
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return {
    currency: "GBP",
    ...(merchant ? { merchant } : {}),
    subtotalPence,
    items,
    quote: { ...quote, referenceSubtotalWei },
    settlement: {
      mode: "scaled-testnet-demo",
      divisor: 1_000,
      allocation: "largest-remainder-half-up",
      subtotalWei: settlementSubtotalWei,
      network: "Monad Testnet",
    },
  };
}

/** Accepts the deliberately small public metadata shape used by TapTab bills. */
export function parseTapTabGbpMetadata(
  value: unknown,
  expectedItemCount: number,
  onchain?: TapTabGbpMetadataOnchainEvidence,
): TapTabGbpMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.currency !== "GBP") return undefined;

  const merchant = safeText(record.merchant, 100);
  let items: TapTabGbpMetadata["items"];
  if (Array.isArray(record.items) && record.items.length === expectedItemCount) {
    const parsedItems = record.items.map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const item = entry as Record<string, unknown>;
      const name = safeText(item.name, 100);
      const amountPence = safePence(item.amountPence);
      return name && amountPence ? { name, amountPence } : undefined;
    });
    if (parsedItems.every((item) => item !== undefined)) {
      items = parsedItems as readonly Readonly<{ name: string; amountPence: number }>[];
    }
  }

  const declaredSubtotal = safePence(record.subtotalPence);
  const itemSubtotal = items?.reduce((total, item) => total + item.amountPence, 0);
  const subtotalPence = declaredSubtotal ?? itemSubtotal;
  if (!subtotalPence || !Number.isSafeInteger(subtotalPence)) return undefined;
  if (declaredSubtotal && itemSubtotal && declaredSubtotal !== itemSubtotal) return undefined;

  const quoteRecord =
    record.quote && typeof record.quote === "object"
      ? (record.quote as Record<string, unknown>)
      : undefined;
  const hasScaledMarker =
    record.version === 2 ||
    record.settlement !== undefined ||
    quoteRecord?.referenceSubtotalWei !== undefined;
  if (hasScaledMarker) {
    return parseScaledTestnetMetadata(record, merchant, subtotalPence, items, onchain);
  }

  const quote = parseLegacyQuoteMetadata(record.quote, subtotalPence, items);

  return {
    currency: "GBP",
    ...(merchant ? { merchant } : {}),
    subtotalPence,
    ...(items ? { items } : {}),
    ...(quote ? { quote } : {}),
  };
}

export function tapTabPhaseLabel(phase: TapTabPhase): string {
  switch (phase) {
    case "draft":
      return "Claiming items";
    case "funding":
      return "Collecting payments";
    case "settled":
      return "Settled";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return "Unavailable";
  }
}

export function presentTapTabChainEvent(
  eventName: string,
  args: Readonly<Record<string, unknown>>,
): PresentableChainEvent {
  const participant =
    typeof args.participant === "string"
      ? shortTapTabAddress(args.participant)
      : "A participant";
  const payer =
    typeof args.payer === "string" ? shortTapTabAddress(args.payer) : "A payer";
  const beneficiary =
    typeof args.beneficiary === "string"
      ? shortTapTabAddress(args.beneficiary)
      : "a participant";

  switch (eventName) {
    case "ParticipantInvited":
      return { title: "Invitation confirmed", detail: participant, tone: "neutral" };
    case "ParticipantJoined":
      return { title: "Participant joined", detail: participant, tone: "positive" };
    case "SplitVersionAdvanced":
      return {
        title: "Split changed",
        detail: `Approvals cleared for version ${String(args.splitVersion ?? "?")}`,
        tone: "warning",
      };
    case "SplitApproved":
      return {
        title: "Split approved",
        detail: `${participant} · version ${String(args.splitVersion ?? "?")}`,
        tone: "positive",
      };
    case "SplitApprovalRevoked":
      return {
        title: "Approval withdrawn",
        detail: `${participant} · version ${String(args.splitVersion ?? "?")}`,
        tone: "neutral",
      };
    case "ItemShareClaimed":
      return {
        title: "Item share claimed",
        detail: `${participant} · item ${String(args.itemIndex ?? "?")} · share ${String(args.shareIndex ?? "?")}`,
        tone: "positive",
      };
    case "ItemShareUnclaimed":
      return {
        title: "Item share released",
        detail: `${participant} · item ${String(args.itemIndex ?? "?")} · share ${String(args.shareIndex ?? "?")}`,
        tone: "neutral",
      };
    case "ItemShareTransferred":
      return {
        title: "Item share transferred",
        detail: `${
          typeof args.from === "string" ? shortTapTabAddress(args.from) : "A diner"
        } to ${typeof args.to === "string" ? shortTapTabAddress(args.to) : "another diner"}`,
        tone: "neutral",
      };
    case "ParticipantLeft":
      return {
        title: "Participant left safely",
        detail: `${participant} transferred ${String(
          args.transferredShareCount ?? 0,
        )} shares to ${
          typeof args.transferRecipient === "string"
            ? shortTapTabAddress(args.transferRecipient)
            : "another diner"
        }`,
        tone: "neutral",
      };
    case "PreferencesUpdated":
      return {
        title: "Split preference updated",
        detail: `${participant} · ${formatTipBps(Number(args.tipVoteBps ?? 0))} tip vote`,
        tone: "neutral",
      };
    case "FundingOpened":
      return {
        title: "Split locked",
        detail: `${formatTipBps(Number(args.lockedTipBps ?? 0))} group tip`,
        tone: "positive",
      };
    case "ContributionReceived":
      return {
        title: "Payment confirmed",
        detail: `${payer} paid for ${beneficiary}`,
        tone: "positive",
      };
    case "BillSettled":
      return { title: "Bill settled", detail: "The full bill is protected and funded", tone: "positive" };
    case "BillCancelled":
      return { title: "Bill cancelled", detail: "Contributions can now be refunded", tone: "warning" };
    case "BillExpired":
      return { title: "Bill expired", detail: "Contributions can now be refunded", tone: "warning" };
    case "RefundClaimed":
      return {
        title: "Refund confirmed",
        detail:
          typeof args.contributor === "string"
            ? shortTapTabAddress(args.contributor)
            : participant,
        tone: "positive",
      };
    case "ProceedsWithdrawn":
      return { title: "Venue paid", detail: "The payee withdrew the settled proceeds", tone: "positive" };
    default:
      return { title: eventName.replace(/([a-z])([A-Z])/g, "$1 $2"), detail: "Confirmed on Monad Testnet", tone: "neutral" };
  }
}

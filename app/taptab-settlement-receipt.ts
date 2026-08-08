/** Pure validation and presentation helpers for shareable TapTab receipts. */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_RECEIPT_PARTICIPANTS = 32;

export type TapTabSettlementAllocation = Readonly<{
  id: string;
  displayName: string;
  walletAddress?: string;
  totalDuePence: number;
  selfPaidPence: number;
  sponsoredByOthersPence: number;
  sponsoredForOthersPence: number;
}>;

export type TapTabSettlementEvidence =
  | Readonly<{
      kind: "preview";
      message: string;
    }>
  | Readonly<{
      kind: "monad";
      chainId: number;
      billId: bigint;
      transactionHash: string;
      blockNumber: bigint;
      explorerUrl: string;
    }>;

export type TapTabSettlementReceiptInput = Readonly<{
  merchant: string;
  tableLabel: string;
  subtotalPence: number;
  tipPence: number;
  totalDuePence: number;
  fundedPence: number;
  allocations: readonly TapTabSettlementAllocation[];
  evidence: TapTabSettlementEvidence;
  receiptUrl: string;
  /** Device-local labels and wallet addresses are hidden unless explicitly included. */
  identityIsPrivate?: boolean;
}>;

export type TapTabSettlementReceiptOptions = Readonly<{
  includePrivateIdentity?: boolean;
}>;

export type TapTabSettlementReceiptLine = Readonly<{
  label: string;
  totalDuePence: number;
  selfPaidPence: number;
  sponsoredByOthersPence: number;
  sponsoredForOthersPence: number;
  walletAddress?: string;
}>;

function checkedPence(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function checkedText(value: string, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim() !== value ||
    Array.from(value).length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value.normalize("NFC");
}

function checkedReceiptUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Receipt URL must be absolute.");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new TypeError("Receipt URL must use HTTPS, except on a loopback host.");
  }
  return url.toString();
}

function checkedExplorerUrl(value: string, transactionHash: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Explorer URL must be absolute.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.pathname.toLowerCase().includes(transactionHash.toLowerCase())
  ) {
    throw new TypeError("Explorer URL must be HTTPS and identify the settlement transaction.");
  }
  return url.toString();
}

function checkedAllocation(
  allocation: TapTabSettlementAllocation,
  index: number,
): TapTabSettlementAllocation {
  const totalDuePence = checkedPence(allocation.totalDuePence, "Allocation total");
  const selfPaidPence = checkedPence(allocation.selfPaidPence, "Self-paid amount");
  const sponsoredByOthersPence = checkedPence(
    allocation.sponsoredByOthersPence,
    "Sponsored amount received",
  );
  const sponsoredForOthersPence = checkedPence(
    allocation.sponsoredForOthersPence,
    "Sponsored amount paid",
  );
  if (selfPaidPence + sponsoredByOthersPence !== totalDuePence) {
    throw new RangeError(
      "Each settled allocation must be covered by self-payment and sponsorship.",
    );
  }
  const walletAddress = allocation.walletAddress;
  if (walletAddress !== undefined && !EVM_ADDRESS.test(walletAddress)) {
    throw new TypeError("Settlement wallet address is invalid.");
  }
  return Object.freeze({
    id: checkedText(allocation.id, `Allocation ${index + 1} ID`, 100),
    displayName: checkedText(
      allocation.displayName,
      `Allocation ${index + 1} display name`,
      60,
    ),
    ...(walletAddress ? { walletAddress: walletAddress.toLowerCase() } : {}),
    totalDuePence,
    selfPaidPence,
    sponsoredByOthersPence,
    sponsoredForOthersPence,
  });
}

export function validateTapTabSettlementReceipt(
  input: TapTabSettlementReceiptInput,
): TapTabSettlementReceiptInput {
  if (!input || typeof input !== "object") {
    throw new TypeError("Settlement receipt input is required.");
  }
  const merchant = checkedText(input.merchant, "Receipt merchant", 100);
  const tableLabel = checkedText(input.tableLabel, "Receipt table label", 80);
  const subtotalPence = checkedPence(input.subtotalPence, "Receipt subtotal");
  const tipPence = checkedPence(input.tipPence, "Receipt tip");
  const totalDuePence = checkedPence(input.totalDuePence, "Receipt total");
  const fundedPence = checkedPence(input.fundedPence, "Receipt funded amount");
  if (subtotalPence + tipPence !== totalDuePence) {
    throw new RangeError("Receipt subtotal and tip must equal its total.");
  }
  if (fundedPence !== totalDuePence) {
    throw new RangeError("A settlement receipt requires the exact total to be funded.");
  }
  if (
    !Array.isArray(input.allocations) ||
    input.allocations.length === 0 ||
    input.allocations.length > MAX_RECEIPT_PARTICIPANTS
  ) {
    throw new RangeError(
      `Settlement receipt allocations must contain 1 to ${MAX_RECEIPT_PARTICIPANTS} participants.`,
    );
  }
  const allocations = input.allocations.map(checkedAllocation);
  if (
    allocations.reduce((total, allocation) => total + allocation.totalDuePence, 0) !==
    totalDuePence
  ) {
    throw new RangeError("Settlement allocation totals do not match the receipt total.");
  }

  let evidence: TapTabSettlementEvidence;
  if (input.evidence.kind === "preview") {
    evidence = Object.freeze({
      kind: "preview",
      message: checkedText(input.evidence.message, "Preview evidence message", 180),
    });
  } else if (input.evidence.kind === "monad") {
    if (!Number.isSafeInteger(input.evidence.chainId) || input.evidence.chainId <= 0) {
      throw new RangeError("Settlement chain ID must be a positive safe integer.");
    }
    if (typeof input.evidence.billId !== "bigint" || input.evidence.billId <= 0n) {
      throw new RangeError("Settlement bill ID must be a positive integer.");
    }
    const transactionHash = input.evidence.transactionHash.toLowerCase();
    if (!TRANSACTION_HASH.test(transactionHash)) {
      throw new TypeError("Settlement transaction hash is invalid.");
    }
    if (typeof input.evidence.blockNumber !== "bigint" || input.evidence.blockNumber <= 0n) {
      throw new RangeError("Settlement block number must be a positive integer.");
    }
    evidence = Object.freeze({
      kind: "monad",
      chainId: input.evidence.chainId,
      billId: input.evidence.billId,
      transactionHash,
      blockNumber: input.evidence.blockNumber,
      explorerUrl: checkedExplorerUrl(input.evidence.explorerUrl, transactionHash),
    });
  } else {
    throw new TypeError("Settlement evidence kind is invalid.");
  }

  return Object.freeze({
    merchant,
    tableLabel,
    subtotalPence,
    tipPence,
    totalDuePence,
    fundedPence,
    allocations: Object.freeze(allocations),
    evidence,
    receiptUrl: checkedReceiptUrl(input.receiptUrl),
    identityIsPrivate: input.identityIsPrivate === true,
  });
}

export function tapTabSettlementReceiptLines(
  input: TapTabSettlementReceiptInput,
  options: TapTabSettlementReceiptOptions = {},
): readonly TapTabSettlementReceiptLine[] {
  const receipt = validateTapTabSettlementReceipt(input);
  const revealIdentity =
    receipt.identityIsPrivate !== true || options.includePrivateIdentity === true;
  return Object.freeze(
    receipt.allocations.map((allocation, index) =>
      Object.freeze({
        label: revealIdentity ? allocation.displayName : `Diner ${index + 1}`,
        totalDuePence: allocation.totalDuePence,
        selfPaidPence: allocation.selfPaidPence,
        sponsoredByOthersPence: allocation.sponsoredByOthersPence,
        sponsoredForOthersPence: allocation.sponsoredForOthersPence,
        ...(revealIdentity && allocation.walletAddress
          ? { walletAddress: allocation.walletAddress }
          : {}),
      }),
    ),
  );
}

export function createTapTabSettlementReceiptText(
  input: TapTabSettlementReceiptInput,
  options: TapTabSettlementReceiptOptions = {},
): string {
  const receipt = validateTapTabSettlementReceipt(input);
  const lines = tapTabSettlementReceiptLines(receipt, options);
  const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`;
  const evidence =
    receipt.evidence.kind === "monad"
      ? [
          `Confirmed on Monad Testnet (chain ${receipt.evidence.chainId})`,
          `Bill ${receipt.evidence.billId.toString()} · block ${receipt.evidence.blockNumber.toString()}`,
          `Transaction ${receipt.evidence.transactionHash}`,
          receipt.evidence.explorerUrl,
        ]
      : [receipt.evidence.message];
  return [
    "TapTab settlement receipt",
    `${receipt.merchant} · ${receipt.tableLabel}`,
    `Subtotal ${pounds(receipt.subtotalPence)}`,
    `Tip ${pounds(receipt.tipPence)}`,
    `Settled total ${pounds(receipt.totalDuePence)}`,
    "",
    ...lines.flatMap((line) => [
      `${line.label} · ${pounds(line.totalDuePence)}`,
      `  Self-paid ${pounds(line.selfPaidPence)} · sponsored by others ${pounds(line.sponsoredByOthersPence)} · sponsored for others ${pounds(line.sponsoredForOthersPence)}`,
      ...(line.walletAddress ? [`  Wallet ${line.walletAddress}`] : []),
    ]),
    "",
    ...evidence,
    `Open receipt ${receipt.receiptUrl}`,
    "",
  ].join("\n");
}

export function tapTabSettlementReceiptFileName(
  input: Pick<TapTabSettlementReceiptInput, "merchant" | "evidence">,
): string {
  const merchant = checkedText(input.merchant, "Receipt merchant", 100)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "bill";
  const suffix =
    input.evidence.kind === "monad"
      ? `bill-${input.evidence.billId.toString()}`
      : "sample";
  return `taptab-${merchant}-${suffix}-receipt.png`;
}

import {
  calculateBufferedGasLimit,
  calculateBufferedGasReserve,
} from "./wallet-readiness.ts";

export type TapTabPreflightCosts = Readonly<{
  estimatedGas: bigint;
  bufferedGasLimit: bigint;
  feePerGasWei: bigint;
  transactionValueWei: bigint;
  estimatedNetworkFeeWei: bigint;
  bufferedNetworkFeeWei: bigint;
  estimatedRequiredBalanceWei: bigint;
  bufferedRequiredBalanceWei: bigint;
  walletBalanceWei?: bigint;
  coversEstimatedCost?: boolean;
  coversBufferedCost?: boolean;
}>;

function assertNonNegative(value: bigint, label: string): void {
  if (typeof value !== "bigint") throw new TypeError(`${label} must be a bigint.`);
  if (value < 0n) throw new RangeError(`${label} cannot be negative.`);
}

/**
 * Calculates a current fee estimate and a 25% gas-buffer reserve without
 * converting bigint values through floating point.
 */
export function calculateTapTabPreflightCosts(input: Readonly<{
  estimatedGas: bigint;
  feePerGasWei: bigint;
  transactionValueWei?: bigint;
  walletBalanceWei?: bigint;
}>): TapTabPreflightCosts {
  const transactionValueWei = input.transactionValueWei ?? 0n;
  assertNonNegative(input.estimatedGas, "estimatedGas");
  assertNonNegative(input.feePerGasWei, "feePerGasWei");
  assertNonNegative(transactionValueWei, "transactionValueWei");
  if (input.walletBalanceWei !== undefined) {
    assertNonNegative(input.walletBalanceWei, "walletBalanceWei");
  }

  const estimatedNetworkFeeWei = input.estimatedGas * input.feePerGasWei;
  const bufferedGasLimit = calculateBufferedGasLimit(input.estimatedGas);
  const bufferedNetworkFeeWei = calculateBufferedGasReserve(
    input.estimatedGas,
    input.feePerGasWei,
  );
  const estimatedRequiredBalanceWei = transactionValueWei + estimatedNetworkFeeWei;
  const bufferedRequiredBalanceWei = transactionValueWei + bufferedNetworkFeeWei;
  const walletBalanceWei = input.walletBalanceWei;

  return {
    estimatedGas: input.estimatedGas,
    bufferedGasLimit,
    feePerGasWei: input.feePerGasWei,
    transactionValueWei,
    estimatedNetworkFeeWei,
    bufferedNetworkFeeWei,
    estimatedRequiredBalanceWei,
    bufferedRequiredBalanceWei,
    ...(walletBalanceWei === undefined
      ? {}
      : {
          walletBalanceWei,
          coversEstimatedCost: walletBalanceWei >= estimatedRequiredBalanceWei,
          coversBufferedCost: walletBalanceWei >= bufferedRequiredBalanceWei,
        }),
  };
}

const TAPTAB_REVERT_MESSAGES = new Map<string, string>([
  ["0xcf897cfb", "Bill not found"],
  ["0xb387a238", "The payee wallet is invalid"],
  ["0x769d11e4", "The deadline is invalid"],
  ["0xc54735d5", "The receipt items are invalid"],
  ["0xc38f8e29", "The batch is empty, mismatched or too large"],
  ["0x2866cffb", "The tip vote is outside the permitted range"],
  ["0x5649f63b", "This action is not allowed in the bill’s current stage"],
  ["0x70fe87b1", "The draft has closed"],
  ["0x66ec4ee6", "The bill deadline has not been reached"],
  ["0x93687c0b", "Only the bill creator can do this"],
  ["0x56cab67b", "Only the venue payee can do this"],
  ["0x003b2682", "This wallet has already joined"],
  ["0x68454194", "This wallet is already invited"],
  ["0x22ce1a07", "This wallet previously participated and cannot rejoin"],
  ["0x779a6f41", "This wallet has not been invited"],
  ["0xe438f8ce", "This wallet has not joined the bill"],
  ["0xa145c43e", "The participant wallet is invalid"],
  ["0x56f6dc6c", "The bill has reached its participant limit"],
  ["0x9b7cfcb7", "Choose another joined participant as the transfer recipient"],
  ["0x30c6e816", "Claimed shares require a transfer recipient before leaving"],
  ["0x0c74bddf", "These preferences would not change the split"],
  ["0x6f6ed587", "The split changed; refresh and approve the latest version"],
  ["0x44432f0b", "This wallet already approved the current split"],
  ["0x7c1aff7b", "Every participant must approve the current split first"],
  ["0x100d5f74", "This item share does not exist"],
  ["0xd1deddb6", "This item share was already claimed"],
  ["0x7e7f50e0", "Only the current owner can release this share"],
  ["0x8b6a4730", "At least one participant must join first"],
  ["0x2c9ddfa3", "Unclaimed items need at least one fair-remainder opt-in"],
  ["0x5566df5c", "The funding beneficiary has not joined"],
  ["0x8f28ea88", "The payment amount must be positive"],
  ["0xa23f7214", "The payment exceeds the participant’s remaining amount"],
  ["0x487ec984", "The bill is not fully funded"],
  ["0xd6273bbc", "The bill is already fully funded"],
  ["0xe49c14cb", "This wallet has no refund available"],
  ["0xaa6d7ff9", "There are no venue proceeds available"],
  ["0x90b8ec18", "The native MON transfer failed"],
  ["0xab143c06", "The contract rejected a re-entrant call"],
]);

const ERROR_NAME_MESSAGES = new Map<string, string>([
  ["BillNotFound", "Bill not found"],
  ["InvalidPayee", "The payee wallet is invalid"],
  ["InvalidDeadline", "The deadline is invalid"],
  ["InvalidItemConfiguration", "The receipt items are invalid"],
  ["InvalidBatchConfiguration", "The batch is empty, mismatched or too large"],
  ["InvalidTipVote", "The tip vote is outside the permitted range"],
  ["WrongState", "This action is not allowed in the bill’s current stage"],
  ["DraftClosed", "The draft has closed"],
  ["DeadlineNotReached", "The bill deadline has not been reached"],
  ["NotCreator", "Only the bill creator can do this"],
  ["NotPayee", "Only the venue payee can do this"],
  ["AlreadyJoined", "This wallet has already joined"],
  ["AlreadyInvited", "This wallet is already invited"],
  ["AlreadyParticipated", "This wallet previously participated and cannot rejoin"],
  ["NotInvited", "This wallet has not been invited"],
  ["NotParticipant", "This wallet has not joined the bill"],
  ["InvalidParticipant", "The participant wallet is invalid"],
  ["ParticipantLimitReached", "The bill has reached its participant limit"],
  ["InvalidTransferRecipient", "Choose another joined participant as the transfer recipient"],
  ["ClaimedSharesRequireRecipient", "Claimed shares require a transfer recipient before leaving"],
  ["NoSplitChange", "These preferences would not change the split"],
  ["SplitDigestMismatch", "The split changed; refresh and approve the latest version"],
  ["SplitAlreadyApproved", "This wallet already approved the current split"],
  ["SplitNotUnanimouslyApproved", "Every participant must approve the current split first"],
  ["InvalidShare", "This item share does not exist"],
  ["ShareAlreadyClaimed", "This item share was already claimed"],
  ["NotShareOwner", "Only the current owner can release this share"],
  ["NoParticipants", "At least one participant must join first"],
  ["UnclaimedValueWithoutOptIn", "Unclaimed items need at least one fair-remainder opt-in"],
  ["InvalidBeneficiary", "The funding beneficiary has not joined"],
  ["ZeroPayment", "The payment amount must be positive"],
  ["PaymentExceedsRemaining", "The payment exceeds the participant’s remaining amount"],
  ["BillNotFullyFunded", "The bill is not fully funded"],
  ["BillAlreadyFullyFunded", "The bill is already fully funded"],
  ["NoRefundAvailable", "This wallet has no refund available"],
  ["NoProceedsAvailable", "There are no venue proceeds available"],
  ["TransferFailed", "The native MON transfer failed"],
  ["Reentrancy", "The contract rejected a re-entrant call"],
]);

function collectErrorStrings(error: unknown): string[] {
  const strings: string[] = [];
  const visited = new Set<object>();

  function visit(value: unknown, depth: number): void {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["errorName", "reason", "data", "shortMessage", "details", "message", "cause"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  }

  visit(error, 0);
  return strings;
}

function findProviderErrorCode(error: unknown): number | undefined {
  const visited = new Set<object>();

  function visit(value: unknown, depth: number): number | undefined {
    if (depth > 6 || !value || typeof value !== "object" || visited.has(value)) {
      return undefined;
    }
    visited.add(value);
    const record = value as Record<string, unknown>;
    const code = record.code;
    if (typeof code === "number" && Number.isSafeInteger(code)) return code;
    if (typeof code === "string" && /^-?\d+$/.test(code)) return Number(code);
    for (const key of ["cause", "error", "details"]) {
      const nested = visit(record[key], depth + 1);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  return visit(error, 0);
}

export function describeTapTabPreflightError(error: unknown): string {
  const strings = collectErrorStrings(error);

  for (const value of strings) {
    const selector = value.match(/0x[0-9a-fA-F]{8}/)?.[0]?.toLowerCase();
    const decoded = selector ? TAPTAB_REVERT_MESSAGES.get(selector) : undefined;
    if (decoded) return `${decoded}. Nothing was submitted.`;

    const named = ERROR_NAME_MESSAGES.get(value.trim().replace(/\(.*$/, ""));
    if (named) return `${named}. Nothing was submitted.`;
  }

  for (const value of strings) {
    const reason = /reverted with (?:the following )?reason:\s*([^\n]+)/i.exec(value)?.[1];
    const candidate = (reason ?? value.split("\n").find((line) => line.trim()))?.trim();
    if (
      candidate &&
      candidate.length <= 180 &&
      !/^0x[0-9a-fA-F]+$/.test(candidate) &&
      !candidate.startsWith("The contract function")
    ) {
      return `${candidate.replace(/[.\s]+$/, "")}. Nothing was submitted.`;
    }
  }

  return "The Monad Testnet simulation was rejected. Nothing was submitted.";
}

export function describeTapTabWalletError(error: unknown): string {
  const code = findProviderErrorCode(error);
  const messages = collectErrorStrings(error).join("\n");
  if (code === 4_001 || /user (?:rejected|denied)|request rejected/i.test(messages)) {
    return "You rejected the wallet request. Nothing was submitted.";
  }
  if (code === 4_100) {
    return "This wallet has not authorised TapTab. Reconnect it and try again. Nothing was submitted.";
  }
  if (code === 4_900) {
    return "The wallet disconnected before submission. Reconnect it and try again.";
  }
  if (code === 4_901) {
    return "The wallet is not connected to Monad Testnet. Switch network and try again. Nothing was submitted.";
  }
  return "The wallet request failed before submission. Reconnect, confirm Monad Testnet and try again.";
}

export function describeTapTabSubmittedError(error: unknown): string {
  const messages = collectErrorStrings(error).join("\n");
  if (/revert(?:ed)?|status[^\n]*reverted/i.test(messages)) {
    return "Monad confirmed that the transaction reverted. No TapTab state changed.";
  }
  return "The transaction was submitted, but TapTab could not verify its final status. Check MonadVision before trying again.";
}

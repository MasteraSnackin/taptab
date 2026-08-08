export const MONAD_TESTNET_CHAIN_ID = 10_143 as const;
export const GAS_RESERVE_BUFFER_PERCENT = 25n;

export type WalletReadinessStatus =
  | "disconnected"
  | "checking"
  | "wrong_network"
  | "insufficient"
  | "ready"
  | "unavailable";

export type WalletReadinessInput = Readonly<{
  connected: boolean;
  checking?: boolean;
  unavailable?: boolean;
  chainId?: number | null;
  balanceWei?: bigint | null;
  maxDepositWei: bigint;
  gasUnits?: bigint | null;
  feePerGasWei?: bigint | null;
}>;

export type WalletReadiness = Readonly<{
  status: WalletReadinessStatus;
  canJoin: boolean;
  targetChainId: typeof MONAD_TESTNET_CHAIN_ID;
  chainId: number | null;
  balanceWei: bigint | null;
  maxDepositWei: bigint;
  gasReserveWei: bigint | null;
  requiredBalanceWei: bigint | null;
  shortfallWei: bigint | null;
}>;

function assertNonNegativeBigInt(value: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`${label} must be a bigint`);
  }
  if (value < 0n) {
    throw new RangeError(`${label} must not be negative`);
  }
}

function divideWithCeiling(dividend: bigint, divisor: bigint): bigint {
  if (dividend === 0n) return 0n;
  return (dividend + divisor - 1n) / divisor;
}

/**
 * Adds the gas reserve to the estimated units before pricing the transaction.
 * Monad charges by gas limit, so this is also the limit used at submission.
 */
export function calculateBufferedGasLimit(gasUnits: bigint): bigint {
  assertNonNegativeBigInt(gasUnits, "gasUnits");
  const bufferUnits = divideWithCeiling(
    gasUnits * GAS_RESERVE_BUFFER_PERCENT,
    100n,
  );
  return gasUnits + bufferUnits;
}

/**
 * Returns the cost of the buffered gas limit at the quoted fee cap.
 */
export function calculateBufferedGasReserve(
  gasUnits: bigint,
  feePerGasWei: bigint,
): bigint {
  assertNonNegativeBigInt(feePerGasWei, "feePerGasWei");
  return calculateBufferedGasLimit(gasUnits) * feePerGasWei;
}

export function calculateRequiredWalletBalance(
  maxDepositWei: bigint,
  gasUnits: bigint,
  feePerGasWei: bigint,
): bigint {
  assertNonNegativeBigInt(maxDepositWei, "maxDepositWei");
  return (
    maxDepositWei + calculateBufferedGasReserve(gasUnits, feePerGasWei)
  );
}

function incompleteReadiness(
  input: WalletReadinessInput,
  status: Extract<
    WalletReadinessStatus,
    "disconnected" | "checking" | "wrong_network" | "unavailable"
  >,
): WalletReadiness {
  return {
    status,
    canJoin: false,
    targetChainId: MONAD_TESTNET_CHAIN_ID,
    chainId: input.chainId ?? null,
    balanceWei: input.balanceWei ?? null,
    maxDepositWei: input.maxDepositWei,
    gasReserveWei: null,
    requiredBalanceWei: null,
    shortfallWei: null,
  };
}

/**
 * Classifies whether a connected wallet can fund the maximum CrowdCart deposit
 * and a buffered transaction fee on Monad Testnet.
 */
export function getWalletReadiness(
  input: WalletReadinessInput,
): WalletReadiness {
  assertNonNegativeBigInt(input.maxDepositWei, "maxDepositWei");

  if (!input.connected) {
    return incompleteReadiness(
      input,
      input.checking ? "checking" : "disconnected",
    );
  }

  if (
    input.chainId !== undefined &&
    input.chainId !== null &&
    input.chainId !== MONAD_TESTNET_CHAIN_ID
  ) {
    return incompleteReadiness(input, "wrong_network");
  }

  if (input.unavailable) {
    return incompleteReadiness(input, "unavailable");
  }

  const balanceWei = input.balanceWei;
  const gasUnits = input.gasUnits;
  const feePerGasWei = input.feePerGasWei;
  if (
    input.checking ||
    input.chainId === undefined ||
    input.chainId === null ||
    balanceWei === undefined ||
    balanceWei === null ||
    gasUnits === undefined ||
    gasUnits === null ||
    feePerGasWei === undefined ||
    feePerGasWei === null
  ) {
    return incompleteReadiness(input, "checking");
  }

  assertNonNegativeBigInt(balanceWei, "balanceWei");
  const gasReserveWei = calculateBufferedGasReserve(gasUnits, feePerGasWei);
  const requiredBalanceWei = input.maxDepositWei + gasReserveWei;
  const shortfallWei =
    balanceWei < requiredBalanceWei ? requiredBalanceWei - balanceWei : 0n;
  const status = shortfallWei > 0n ? "insufficient" : "ready";

  return {
    status,
    canJoin: status === "ready",
    targetChainId: MONAD_TESTNET_CHAIN_ID,
    chainId: input.chainId,
    balanceWei,
    maxDepositWei: input.maxDepositWei,
    gasReserveWei,
    requiredBalanceWei,
    shortfallWei,
  };
}

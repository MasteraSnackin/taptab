import {
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  resolveTapTabDeployment,
  type TapTabDeployment,
} from "../../app/taptab-chain.ts";

export const MONAD_TESTNET_CHAIN_ID = 10_143;
export const DEFAULT_MONAD_TESTNET_RPC_URL = "https://testnet-rpc.monad.xyz";
export const DEFAULT_READINESS_TIMEOUT_MS = 5_000;

export type TapTabReadinessEnvironment = Readonly<{
  NEXT_PUBLIC_TAPTAB_ADDRESS?: string;
  NEXT_PUBLIC_TAPTAB_BILL_ID?: string;
  MONAD_TESTNET_RPC_URL?: string;
  MONAD_TESTNET_FALLBACK_RPC_URL?: string;
}>;

export type TapTabReadinessProbe = Readonly<{
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBytecode(address: Address): Promise<Hex | undefined>;
  getBill(address: Address, billId: bigint): Promise<unknown>;
}>;

export type TapTabReadinessProbeFactory = (
  rpcUrl: string,
) => TapTabReadinessProbe;

type CheckState = "pass" | "fail" | "skipped";

export type TapTabReadinessReason =
  | "configuration_missing"
  | "configuration_invalid"
  | "rpc_url_invalid"
  | "rpc_unavailable"
  | "probe_timeout"
  | "wrong_network"
  | "contract_unavailable"
  | "contract_not_deployed"
  | "bill_unavailable"
  | "bill_invalid";

export type TapTabReadinessChecks = Readonly<{
  configuration: CheckState;
  rpc: CheckState;
  network: CheckState;
  contract: CheckState;
  bill: CheckState;
}>;

export type TapTabReadinessResult =
  | Readonly<{
      status: "ready";
      checks: TapTabReadinessChecks;
      network: Readonly<{
        chainId: typeof MONAD_TESTNET_CHAIN_ID;
        blockNumber: string;
      }>;
    }>
  | Readonly<{
      status: "not_ready";
      reason: TapTabReadinessReason;
      checks: TapTabReadinessChecks;
      network?: Readonly<{
        chainId: number;
        blockNumber: string;
      }>;
    }>;

type ReadinessOptions = Readonly<{
  env: TapTabReadinessEnvironment;
  createProbe: TapTabReadinessProbeFactory;
  timeoutMs?: number;
}>;

class ReadinessTimeoutError extends Error {
  constructor() {
    super("The readiness probe exceeded its time budget.");
    this.name = "ReadinessTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new ReadinessTimeoutError()),
      timeoutMs,
    );

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function skippedAfterConfiguration(configuration: CheckState): TapTabReadinessChecks {
  return {
    configuration,
    rpc: "skipped",
    network: "skipped",
    contract: "skipped",
    bill: "skipped",
  };
}

function resolveRpcUrl(value: string | undefined) {
  const candidate = value?.trim() || DEFAULT_MONAD_TESTNET_RPC_URL;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExpectedBill(value: unknown, billId: bigint) {
  if (!isRecord(value)) return false;

  const creator = value.creator;
  const payee = value.payee;
  const createdAt = value.createdAt;
  const deadline = value.deadline;
  const subtotal = value.subtotal;

  return (
    value.id === billId &&
    typeof creator === "string" &&
    isAddress(creator) &&
    creator.toLowerCase() !== zeroAddress &&
    typeof payee === "string" &&
    isAddress(payee) &&
    payee.toLowerCase() !== zeroAddress &&
    typeof createdAt === "bigint" &&
    typeof deadline === "bigint" &&
    deadline > createdAt &&
    typeof subtotal === "bigint" &&
    subtotal > 0n
  );
}

function timeoutReason(error: unknown, fallback: TapTabReadinessReason) {
  return error instanceof ReadinessTimeoutError ? "probe_timeout" : fallback;
}

const FALLBACK_ELIGIBLE_REASONS = new Set<TapTabReadinessReason>([
  "rpc_unavailable",
  "probe_timeout",
  "wrong_network",
  "contract_unavailable",
  "bill_unavailable",
]);

async function checkRpcReadiness({
  deployment,
  rpcUrl,
  createProbe,
  budget,
}: Readonly<{
  deployment: TapTabDeployment;
  rpcUrl: string;
  createProbe: TapTabReadinessProbeFactory;
  budget: number;
}>): Promise<TapTabReadinessResult> {
  const startedAt = Date.now();
  const remainingBudget = () => Math.max(1, budget - (Date.now() - startedAt));

  let probe: TapTabReadinessProbe;
  try {
    probe = createProbe(rpcUrl);
  } catch {
    return {
      status: "not_ready",
      reason: "rpc_unavailable",
      checks: {
        configuration: "pass",
        rpc: "fail",
        network: "skipped",
        contract: "skipped",
        bill: "skipped",
      },
    };
  }

  let chainId: number;
  let blockNumber: bigint;
  try {
    [chainId, blockNumber] = await withTimeout(
      Promise.all([probe.getChainId(), probe.getBlockNumber()]),
      remainingBudget(),
    );
  } catch (error) {
    return {
      status: "not_ready",
      reason: timeoutReason(error, "rpc_unavailable"),
      checks: {
        configuration: "pass",
        rpc: "fail",
        network: "skipped",
        contract: "skipped",
        bill: "skipped",
      },
    };
  }

  const network = { chainId, blockNumber: blockNumber.toString() };
  if (chainId !== MONAD_TESTNET_CHAIN_ID) {
    return {
      status: "not_ready",
      reason: "wrong_network",
      checks: {
        configuration: "pass",
        rpc: "pass",
        network: "fail",
        contract: "skipped",
        bill: "skipped",
      },
      network,
    };
  }

  let bytecode: Hex | undefined;
  try {
    bytecode = await withTimeout(
      probe.getBytecode(deployment.address),
      remainingBudget(),
    );
  } catch (error) {
    return {
      status: "not_ready",
      reason: timeoutReason(error, "contract_unavailable"),
      checks: {
        configuration: "pass",
        rpc: "pass",
        network: "pass",
        contract: "fail",
        bill: "skipped",
      },
      network,
    };
  }

  if (!bytecode || bytecode === "0x") {
    return {
      status: "not_ready",
      reason: "contract_not_deployed",
      checks: {
        configuration: "pass",
        rpc: "pass",
        network: "pass",
        contract: "fail",
        bill: "skipped",
      },
      network,
    };
  }

  let bill: unknown;
  try {
    bill = await withTimeout(
      probe.getBill(deployment.address, deployment.billId),
      remainingBudget(),
    );
  } catch (error) {
    return {
      status: "not_ready",
      reason: timeoutReason(error, "bill_unavailable"),
      checks: {
        configuration: "pass",
        rpc: "pass",
        network: "pass",
        contract: "pass",
        bill: "fail",
      },
      network,
    };
  }

  if (!isExpectedBill(bill, deployment.billId)) {
    return {
      status: "not_ready",
      reason: "bill_invalid",
      checks: {
        configuration: "pass",
        rpc: "pass",
        network: "pass",
        contract: "pass",
        bill: "fail",
      },
      network,
    };
  }

  return {
    status: "ready",
    checks: {
      configuration: "pass",
      rpc: "pass",
      network: "pass",
      contract: "pass",
      bill: "pass",
    },
    network: {
      chainId: MONAD_TESTNET_CHAIN_ID,
      blockNumber: blockNumber.toString(),
    },
  };
}

export async function checkTapTabReadiness({
  env,
  createProbe,
  timeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
}: ReadinessOptions): Promise<TapTabReadinessResult> {
  const deployment = resolveTapTabDeployment(env);
  if (deployment.status === "unconfigured") {
    return {
      status: "not_ready",
      reason: "configuration_missing",
      checks: skippedAfterConfiguration("fail"),
    };
  }
  if (deployment.status === "invalid") {
    return {
      status: "not_ready",
      reason: "configuration_invalid",
      checks: skippedAfterConfiguration("fail"),
    };
  }

  const primaryRpcUrl = resolveRpcUrl(env.MONAD_TESTNET_RPC_URL);
  const rawFallbackRpcUrl = env.MONAD_TESTNET_FALLBACK_RPC_URL?.trim();
  const fallbackRpcUrl = rawFallbackRpcUrl
    ? resolveRpcUrl(rawFallbackRpcUrl)
    : undefined;
  if (!primaryRpcUrl || (rawFallbackRpcUrl && !fallbackRpcUrl)) {
    return {
      status: "not_ready",
      reason: "rpc_url_invalid",
      checks: {
        configuration: "pass",
        rpc: "fail",
        network: "skipped",
        contract: "skipped",
        bill: "skipped",
      },
    };
  }

  const budget = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(timeoutMs, DEFAULT_READINESS_TIMEOUT_MS))
    : DEFAULT_READINESS_TIMEOUT_MS;
  const distinctFallbackRpcUrl =
    fallbackRpcUrl && fallbackRpcUrl !== primaryRpcUrl
      ? fallbackRpcUrl
      : undefined;
  const startedAt = Date.now();
  const primaryBudget = distinctFallbackRpcUrl
    ? Math.max(1, Math.floor(budget / 2))
    : budget;
  const primaryResult = await checkRpcReadiness({
    deployment,
    rpcUrl: primaryRpcUrl,
    createProbe,
    budget: primaryBudget,
  });
  if (
    primaryResult.status === "ready" ||
    !distinctFallbackRpcUrl ||
    !FALLBACK_ELIGIBLE_REASONS.has(primaryResult.reason)
  ) {
    return primaryResult;
  }

  const remainingBudget = Math.max(1, budget - (Date.now() - startedAt));
  return checkRpcReadiness({
    deployment,
    rpcUrl: distinctFallbackRpcUrl,
    createProbe,
    budget: remainingBudget,
  });
}

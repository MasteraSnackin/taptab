import { createPublicClient, http } from "viem";
import { TAPTAB_MONAD_TESTNET, tapTabAbi } from "../../../taptab-chain.ts";
import {
  checkTapTabReadiness,
  DEFAULT_READINESS_TIMEOUT_MS,
  type TapTabReadinessEnvironment,
  type TapTabReadinessProbeFactory,
} from "../../../../lib/server/taptab-readiness.ts";

type ReadinessResponseOptions = Readonly<{
  env?: TapTabReadinessEnvironment;
  createProbe?: TapTabReadinessProbeFactory;
  now?: () => number;
  requestId?: string;
  timeoutMs?: number;
}>;

function createViemReadinessProbe(rpcUrl: string) {
  const client = createPublicClient({
    chain: TAPTAB_MONAD_TESTNET,
    transport: http(rpcUrl, {
      retryCount: 0,
      timeout: DEFAULT_READINESS_TIMEOUT_MS - 500,
    }),
  });

  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
    getBytecode: (address: `0x${string}`) => client.getBytecode({ address }),
    getBill: (address: `0x${string}`, billId: bigint) =>
      client.readContract({
        address,
        abi: tapTabAbi,
        functionName: "getBill",
        args: [billId],
      }),
  };
}

export async function createReadinessResponse({
  env = {
    NEXT_PUBLIC_TAPTAB_ADDRESS: process.env.NEXT_PUBLIC_TAPTAB_ADDRESS,
    NEXT_PUBLIC_TAPTAB_BILL_ID: process.env.NEXT_PUBLIC_TAPTAB_BILL_ID,
    MONAD_TESTNET_RPC_URL: process.env.MONAD_TESTNET_RPC_URL,
    MONAD_TESTNET_FALLBACK_RPC_URL: process.env.MONAD_TESTNET_FALLBACK_RPC_URL,
  },
  createProbe = createViemReadinessProbe,
  now = Date.now,
  requestId = crypto.randomUUID(),
  timeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
}: ReadinessResponseOptions = {}) {
  const startedAt = now();
  const result = await checkTapTabReadiness({ env, createProbe, timeoutMs });
  const checkedAtMs = now();
  const status = result.status === "ready" ? 200 : 503;

  return Response.json(
    {
      ...result,
      service: "taptab",
      checkedAt: new Date(checkedAtMs).toISOString(),
      durationMs: Math.max(0, checkedAtMs - startedAt),
      requestId,
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
        "x-taptab-readiness": result.status,
        ...(status === 503 ? { "retry-after": "10" } : {}),
      },
    },
  );
}

export function GET() {
  return createReadinessResponse();
}

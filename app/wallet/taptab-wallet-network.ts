import type { EIP1193Provider } from "viem";
import { TAPTAB_MONAD_TESTNET } from "../taptab-chain.ts";

export const TAPTAB_MONAD_TESTNET_FAUCET_URL = "https://faucet.monad.xyz/";
export const TAPTAB_MONAD_TESTNET_CHAIN_HEX =
  `0x${TAPTAB_MONAD_TESTNET.id.toString(16)}` as const;

function providerErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>).code;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
}

export function parseEip155ChainId(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    return undefined;
  }
  try {
    const parsed = BigInt(value);
    return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : undefined;
  } catch {
    return undefined;
  }
}

export async function readTapTabWalletChainId(
  provider: EIP1193Provider,
): Promise<number> {
  const chainId = parseEip155ChainId(
    await provider.request({ method: "eth_chainId" }),
  );
  if (chainId === undefined) {
    throw new Error("The wallet returned an invalid network identifier.");
  }
  return chainId;
}

/**
 * Requests an explicit EIP-3326 switch, adding Monad Testnet only when the
 * wallet reports that it is unknown. Call this only in direct response to a
 * user action, then still verify again immediately before any write.
 */
export async function switchTapTabWalletToMonadTestnet(
  provider: EIP1193Provider,
): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: TAPTAB_MONAD_TESTNET_CHAIN_HEX }],
    });
  } catch (error) {
    if (providerErrorCode(error) !== 4_902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: TAPTAB_MONAD_TESTNET_CHAIN_HEX,
          chainName: TAPTAB_MONAD_TESTNET.name,
          nativeCurrency: TAPTAB_MONAD_TESTNET.nativeCurrency,
          rpcUrls: [...TAPTAB_MONAD_TESTNET.rpcUrls.default.http],
          blockExplorerUrls: [TAPTAB_MONAD_TESTNET.blockExplorers.default.url],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: TAPTAB_MONAD_TESTNET_CHAIN_HEX }],
    });
  }

  if ((await readTapTabWalletChainId(provider)) !== TAPTAB_MONAD_TESTNET.id) {
    throw new Error("The wallet did not switch to Monad Testnet. Nothing was submitted.");
  }
}

export function describeTapTabNetworkSwitchError(error: unknown): string {
  if (providerErrorCode(error) === 4_001) {
    return "The Monad Testnet switch was declined. Nothing was submitted.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The wallet could not switch to Monad Testnet. Nothing was submitted.";
}

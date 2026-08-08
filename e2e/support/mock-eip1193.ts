import type { Page } from "@playwright/test";

export const MOCK_WALLET_NAME = "TapTab Test Wallet";
export const MOCK_WALLET_ACCOUNT =
  "0x1091A22b34e0E6BFb93C31913B926335EFB078D3";
export const SECOND_MOCK_WALLET_ACCOUNT =
  "0x2222222222222222222222222222222222222222";
export const MONAD_TESTNET_CHAIN_HEX = "0x279f";

type MockWalletOptions = Readonly<{
  account?: string;
  accounts?: readonly string[];
  chainId?: string;
  rejectMethods?: Readonly<Record<string, Readonly<{ code: number; message: string }>>>;
}>;

type MockWalletSnapshot = Readonly<{
  accounts: readonly string[];
  chainId: string;
  eip6963Announcements: number;
  eip6963Requests: number;
  requests: readonly Readonly<{ method: string; params?: unknown }>[];
}>;

export async function installMockEip1193Provider(
  page: Page,
  options: MockWalletOptions = {},
) {
  await page.addInitScript(
    ({ account, accounts, chainId, rejectMethods, walletName }) => {
      type Listener = (...args: unknown[]) => void;
      const listeners = new Map<string, Set<Listener>>();
      const requestedAccount =
        account ?? "0x1091A22b34e0E6BFb93C31913B926335EFB078D3";
      const state = {
        accounts: [...(accounts ?? [])],
        chainId: chainId ?? "0x1",
        eip6963Announcements: 0,
        eip6963Requests: 0,
        requests: [] as Array<{ method: string; params?: unknown }>,
        rejectMethods: { ...(rejectMethods ?? {}) },
      };

      const emit = (event: string, ...args: unknown[]) => {
        for (const listener of listeners.get(event) ?? []) listener(...args);
      };
      const provider = {
        isTapTabMock: true,
        async request({ method, params }: { method: string; params?: unknown }) {
          state.requests.push({ method, ...(params === undefined ? {} : { params }) });
          const rejection = state.rejectMethods[method];
          if (rejection) {
            throw Object.assign(new Error(rejection.message), { code: rejection.code });
          }

          switch (method) {
            case "eth_accounts":
              return [...state.accounts];
            case "eth_requestAccounts":
              state.accounts = [requestedAccount];
              queueMicrotask(() => emit("accountsChanged", [...state.accounts]));
              return [...state.accounts];
            case "eth_chainId":
              return state.chainId;
            case "net_version":
              return BigInt(state.chainId).toString(10);
            case "wallet_switchEthereumChain": {
              const requestedChain = (params as Array<{ chainId?: unknown }> | undefined)?.[0]
                ?.chainId;
              if (typeof requestedChain === "string") {
                state.chainId = requestedChain;
                queueMicrotask(() => emit("chainChanged", requestedChain));
              }
              return null;
            }
            case "wallet_addEthereumChain":
            case "wallet_revokePermissions":
              return null;
            case "wallet_getPermissions":
              return [];
            case "wallet_requestPermissions":
              return [{ parentCapability: "eth_accounts" }];
            case "wallet_getCapabilities":
              return {};
            case "eth_getBalance":
              return "0xde0b6b3a7640000";
            case "eth_blockNumber":
              return "0x1";
            case "web3_clientVersion":
              return "TapTabMockWallet/1.0";
            case "eth_sendTransaction":
            case "personal_sign":
            case "eth_sign":
            case "eth_signTypedData":
            case "eth_signTypedData_v4":
              throw Object.assign(new Error("Test wallet blocks signing and writes."), {
                code: 4_001,
              });
            default:
              return null;
          }
        },
        on(event: string, listener: Listener) {
          const eventListeners = listeners.get(event) ?? new Set<Listener>();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
          return provider;
        },
        removeListener(event: string, listener: Listener) {
          listeners.get(event)?.delete(listener);
          return provider;
        },
      };

      const controller = {
        provider,
        snapshot: () => ({
          accounts: [...state.accounts],
          chainId: state.chainId,
          eip6963Announcements: state.eip6963Announcements,
          eip6963Requests: state.eip6963Requests,
          requests: state.requests.map((request) => ({ ...request })),
        }),
        clearRequests: () => {
          state.requests.length = 0;
        },
        setRejectMethod: (
          method: string,
          rejection?: { code: number; message: string },
        ) => {
          if (rejection) state.rejectMethods[method] = rejection;
          else delete state.rejectMethods[method];
        },
        setAccounts: (nextAccounts: string[]) => {
          state.accounts = [...nextAccounts];
          emit("accountsChanged", [...state.accounts]);
        },
        setChainId: (nextChainId: string) => {
          state.chainId = nextChainId;
          emit("chainChanged", nextChainId);
        },
        disconnect: () => {
          state.accounts = [];
          emit("accountsChanged", []);
          emit("disconnect", { code: 4_900, message: "Test wallet disconnected." });
        },
      };

      Object.defineProperty(window, "ethereum", {
        configurable: true,
        value: provider,
      });
      Object.defineProperty(window, "__taptabMockWallet", {
        configurable: true,
        value: controller,
      });

      const detail = {
        info: {
          uuid: "350670db-19fa-4704-a166-e52e178b59d2",
          name: walletName,
          icon:
            "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAzMiAzMic+PHJlY3Qgd2lkdGg9JzMyJyBoZWlnaHQ9JzMyJyByeD0nOCcgZmlsbD0nIzVmNGNmNicvPjxwYXRoIGQ9J005IDloMTR2NGgtNXYxMGgtNFYxM0g5eicgZmlsbD0nd2hpdGUnLz48L3N2Zz4=",
          rdns: "dev.taptab.test-wallet",
        },
        provider,
      };
      const announce = () => {
        state.eip6963Announcements += 1;
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail }),
        );
      };
      window.addEventListener("eip6963:requestProvider", () => {
        state.eip6963Requests += 1;
        announce();
      });
      queueMicrotask(announce);
    },
    {
      account: options.account ?? MOCK_WALLET_ACCOUNT,
      accounts: options.accounts ?? [],
      chainId: options.chainId ?? "0x1",
      rejectMethods: options.rejectMethods ?? {},
      walletName: MOCK_WALLET_NAME,
    },
  );
}

export async function getMockWalletSnapshot(page: Page): Promise<MockWalletSnapshot> {
  return page.evaluate(() => {
    const controller = (
      window as typeof window & {
        __taptabMockWallet: { snapshot(): MockWalletSnapshot };
      }
    ).__taptabMockWallet;
    return controller.snapshot();
  });
}

export async function setMockWalletAccounts(page: Page, accounts: readonly string[]) {
  await page.evaluate((nextAccounts) => {
    const controller = (
      window as typeof window & {
        __taptabMockWallet: { setAccounts(value: string[]): void };
      }
    ).__taptabMockWallet;
    controller.setAccounts(nextAccounts);
  }, [...accounts]);
}

export async function setMockWalletChainId(page: Page, chainId: string) {
  await page.evaluate((nextChainId) => {
    const controller = (
      window as typeof window & {
        __taptabMockWallet: { setChainId(value: string): void };
      }
    ).__taptabMockWallet;
    controller.setChainId(nextChainId);
  }, chainId);
}

export async function disconnectMockWallet(page: Page) {
  await page.evaluate(() => {
    const controller = (
      window as typeof window & {
        __taptabMockWallet: { disconnect(): void };
      }
    ).__taptabMockWallet;
    controller.disconnect();
  });
}

"use client";

import { monadTestnet } from "@reown/appkit/networks";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAddress, isAddress, type Address, type EIP1193Provider } from "viem";
import {
  TAPTAB_APPKIT_FEATURES,
  TAPTAB_SOCIAL_PROVIDERS,
  getTapTabWalletMetadata,
  getTapTabWalletOnboarding,
  tapTabWalletSetup,
  unavailableWalletOnboarding,
  type TapTabWalletOnboarding,
} from "./taptab-wallet-config";

export type TapTabWalletStatus =
  | "unconfigured"
  | "invalid"
  | "initializing"
  | "ready"
  | "connecting"
  | "connected"
  | "error";

export type TapTabWallet = {
  enabled: boolean;
  ready: boolean;
  status: TapTabWalletStatus;
  setupMessage?: string;
  onboarding: TapTabWalletOnboarding;
  account?: Address;
  provider?: EIP1193Provider;
  open(): void;
  openWallets(): void;
  refreshConnection(): void;
  retryInitialisation(): void;
  disconnect(): Promise<void>;
  isConnecting: boolean;
};

const disabledWallet: TapTabWallet = {
  enabled: false,
  ready: false,
  status:
    tapTabWalletSetup.status === "invalid" ? "invalid" : "unconfigured",
  setupMessage:
    tapTabWalletSetup.status === "configured" ? undefined : tapTabWalletSetup.reason,
  onboarding: unavailableWalletOnboarding,
  open() {},
  openWallets() {},
  refreshConnection() {},
  retryInitialisation() {},
  async disconnect() {},
  isConnecting: false,
};

const TapTabWalletContext = createContext<TapTabWallet>(disabledWallet);

export const isTapTabWalletEnabled = tapTabWalletSetup.status === "configured";

const networks = [monadTestnet] as [typeof monadTestnet];

type WalletAccountState = {
  address?: string;
  isConnected?: boolean;
  status?: "connecting" | "reconnecting" | "connected" | "disconnected";
};

function isEip1193Provider(value: unknown): value is EIP1193Provider {
  return (
    typeof value === "object" &&
    value !== null &&
    "request" in value &&
    typeof value.request === "function" &&
    "on" in value &&
    typeof value.on === "function" &&
    "removeListener" in value &&
    typeof value.removeListener === "function"
  );
}

export function TapTabWalletProvider({ children }: { children: ReactNode }) {
  const appKitRef = useRef<import("@reown/appkit").AppKit | undefined>(
    undefined,
  );
  const syncConnectionRef = useRef<() => void>(() => {});
  const [enabled, setEnabled] = useState(isTapTabWalletEnabled);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<TapTabWalletStatus>(
    isTapTabWalletEnabled
      ? "initializing"
      : tapTabWalletSetup.status === "invalid"
        ? "invalid"
        : "unconfigured",
  );
  const [setupMessage, setSetupMessage] = useState<string | undefined>(
    tapTabWalletSetup.status === "configured" ? undefined : tapTabWalletSetup.reason,
  );
  const [onboarding, setOnboarding] = useState<TapTabWalletOnboarding>(() =>
    getTapTabWalletOnboarding(isTapTabWalletEnabled),
  );
  const [account, setAccount] = useState<Address>();
  const [provider, setProvider] = useState<EIP1193Provider>();
  const [isConnecting, setIsConnecting] = useState(isTapTabWalletEnabled);
  const [initialisationAttempt, setInitialisationAttempt] = useState(0);

  useEffect(() => {
    if (tapTabWalletSetup.status !== "configured") return;
    const { projectId, siteOrigin } = tapTabWalletSetup;

    let active = true;
    const unsubscribers: Array<() => void> = [];

    void Promise.all([
      import("@reown/appkit"),
      import("@reown/appkit-adapter-ethers"),
    ])
      .then(([{ createAppKit }, { EthersAdapter }]) => {
        if (!active) return;

        const appKit = createAppKit({
          adapters: [new EthersAdapter()],
          networks,
          defaultNetwork: monadTestnet,
          projectId,
          metadata: getTapTabWalletMetadata(siteOrigin),
          defaultAccountTypes: { eip155: "eoa" },
          features: {
            ...TAPTAB_APPKIT_FEATURES,
            socials: [...TAPTAB_SOCIAL_PROVIDERS],
          },
          enableAuthLogger: false,
          enableMobileFullScreen: true,
        });

        appKitRef.current = appKit;
        setReady(true);
        setStatus("ready");
        setIsConnecting(false);

        const syncConnection = (
          state: WalletAccountState | undefined = appKit.getAccount("eip155"),
        ) => {
          const nextAccount =
            state?.isConnected && state.address && isAddress(state.address)
              ? getAddress(state.address)
              : undefined;
          const providerValue = appKit.getProvider<unknown>("eip155");
          const nextProvider = isEip1193Provider(providerValue)
            ? providerValue
            : undefined;

          setAccount(nextAccount);
          setProvider(nextProvider);
          const connecting =
            state?.status === "connecting" ||
            state?.status === "reconnecting" ||
            Boolean(nextAccount) !== Boolean(nextProvider);
          setIsConnecting(connecting);
          setStatus(
            nextAccount && nextProvider
              ? "connected"
              : connecting
                ? "connecting"
                : "ready",
          );
        };
        syncConnectionRef.current = () => syncConnection();

        unsubscribers.push(
          appKit.subscribeAccount((state) => syncConnection(state), "eip155"),
          appKit.subscribeProviders(() => syncConnection()),
          appKit.subscribeRemoteFeatures((features) => {
            if (!active || !features) return;
            setOnboarding(
              getTapTabWalletOnboarding(true, {
                email: features.email,
                socials: features.socials,
              }),
            );
          }),
        );

        syncConnection();
      })
      .catch(() => {
        if (!active) return;

        appKitRef.current = undefined;
        setEnabled(true);
        setReady(false);
        setStatus("error");
        setSetupMessage(
          "Wallet sign-in could not initialise. Check the Reown project and allowed HTTPS origin.",
        );
        setOnboarding(unavailableWalletOnboarding);
        setAccount(undefined);
        setProvider(undefined);
        setIsConnecting(false);
      });

    return () => {
      active = false;
      appKitRef.current = undefined;
      syncConnectionRef.current = () => {};
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [initialisationAttempt]);

  const refreshConnection = useCallback(() => {
    syncConnectionRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshConnection();
    };
    window.addEventListener("focus", refreshConnection);
    window.addEventListener("pageshow", refreshConnection);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshConnection);
      window.removeEventListener("pageshow", refreshConnection);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled, refreshConnection]);

  const retryInitialisation = useCallback(() => {
    if (tapTabWalletSetup.status !== "configured") return;
    appKitRef.current = undefined;
    setEnabled(true);
    setReady(false);
    setStatus("initializing");
    setSetupMessage(undefined);
    setOnboarding(getTapTabWalletOnboarding(true));
    setAccount(undefined);
    setProvider(undefined);
    setIsConnecting(true);
    setInitialisationAttempt((current) => current + 1);
  }, []);

  const openView = useCallback((view: "Connect" | "AllWallets") => {
    const appKit = appKitRef.current;
    if (!appKit) return;

    setSetupMessage(undefined);
    setIsConnecting(true);
    setStatus("connecting");
    void appKit
      .open({ view })
      .then(
        () => {
          setIsConnecting(false);
          setStatus((current) => (current === "connected" ? current : "ready"));
        },
        () => {
          setIsConnecting(false);
          setStatus("error");
          setSetupMessage("Wallet sign-in could not open. Please try again.");
        },
      );
  }, []);

  const open = useCallback(() => openView("Connect"), [openView]);
  const openWallets = useCallback(() => openView("AllWallets"), [openView]);

  const disconnect = useCallback(async () => {
    const appKit = appKitRef.current;
    if (!appKit) return;

    setSetupMessage(undefined);
    try {
      await appKit.disconnect("eip155");
      setAccount(undefined);
      setProvider(undefined);
      setIsConnecting(false);
      setStatus("ready");
    } catch {
      setIsConnecting(false);
      setStatus("error");
      setSetupMessage(
        "The wallet could not disconnect. TapTab has kept the current connection; try again from the wallet if needed.",
      );
    }
  }, []);

  const wallet = useMemo<TapTabWallet>(
    () => ({
      enabled,
      ready,
      status,
      setupMessage,
      onboarding,
      account,
      provider,
      open,
      openWallets,
      refreshConnection,
      retryInitialisation,
      disconnect,
      isConnecting,
    }),
    [
      account,
      disconnect,
      enabled,
      isConnecting,
      onboarding,
      open,
      openWallets,
      provider,
      ready,
      refreshConnection,
      retryInitialisation,
      setupMessage,
      status,
    ],
  );

  return (
    <TapTabWalletContext.Provider value={wallet}>
      {children}
    </TapTabWalletContext.Provider>
  );
}

export function useTapTabWallet() {
  return useContext(TapTabWalletContext);
}

// Compatibility aliases for the archived CrowdCart application. New TapTab code
// must use the TapTab-named exports above.
export type CrowdCartWalletStatus = TapTabWalletStatus;
export type CrowdCartWallet = TapTabWallet;
export const isCrowdCartWalletEnabled = isTapTabWalletEnabled;
export const CrowdCartWalletProvider = TapTabWalletProvider;
export const useCrowdCartWallet = useTapTabWallet;

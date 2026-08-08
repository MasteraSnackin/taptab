"use client";

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

type DeferredInstallPrompt = Event & {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
};

export type TapTabInstallStatus =
  | "checking"
  | "unavailable"
  | "available"
  | "prompting"
  | "accepted"
  | "dismissed"
  | "installed"
  | "failed";

export type TapTabInstallResult =
  | "accepted"
  | "dismissed"
  | "unavailable"
  | "failed";

export type TapTabServiceWorkerStatus =
  | "checking"
  | "inactive"
  | "unsupported"
  | "registering"
  | "registered"
  | "ready"
  | "failed";

export type TapTabShareAvailability =
  | "checking"
  | "native"
  | "clipboard"
  | "unavailable";

export type TapTabShareStatus =
  | "idle"
  | "sharing"
  | "shared"
  | "copied"
  | "cancelled"
  | "unavailable"
  | "failed";

export type TapTabShareResult =
  | "shared"
  | "copied"
  | "cancelled"
  | "unavailable"
  | "failed";

export type TapTabShareData = {
  title?: string;
  text?: string;
  url?: string;
};

export type TapTabPwaCapabilities = {
  installStatus: TapTabInstallStatus;
  canPromptInstall: boolean;
  installationObserved: boolean;
  displayMode: "browser" | "standalone";
  installError: string | null;
  requestInstall(): Promise<TapTabInstallResult>;
  serviceWorkerStatus: TapTabServiceWorkerStatus;
  shareAvailability: TapTabShareAvailability;
  shareStatus: TapTabShareStatus;
  shareError: string | null;
  share(data: TapTabShareData): Promise<TapTabShareResult>;
};

const TapTabPwaContext = createContext<TapTabPwaCapabilities | null>(null);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function shareText({ title, text, url }: TapTabShareData) {
  return [title, text, url].filter((part): part is string => Boolean(part?.trim())).join("\n\n");
}

function legacyCopy(text: string) {
  if (!document.body || typeof document.execCommand !== "function") return false;

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  document.body.append(field);
  field.select();

  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
  }
}

async function copyShareText(text: string) {
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // A denied async clipboard permission can still leave the user-gesture
      // based legacy copy path available.
    }
  }

  return legacyCopy(text);
}

function supportsClipboardFallback() {
  return Boolean(
    navigator.clipboard?.writeText ||
      (document.body && typeof document.execCommand === "function"),
  );
}

export function TapTabPwaBridge({ children }: { children: ReactNode }) {
  const deferredInstallRef = useRef<DeferredInstallPrompt | null>(null);
  const installationObservedRef = useRef(false);
  const [installStatus, setInstallStatus] = useState<TapTabInstallStatus>("unavailable");
  const [installationObserved, setInstallationObserved] = useState(false);
  const [displayMode, setDisplayMode] = useState<"browser" | "standalone">("browser");
  const [installError, setInstallError] = useState<string | null>(null);
  const [serviceWorkerStatus, setServiceWorkerStatus] =
    useState<TapTabServiceWorkerStatus>("checking");
  const [shareAvailability, setShareAvailability] =
    useState<TapTabShareAvailability>("checking");
  const [shareStatus, setShareStatus] = useState<TapTabShareStatus>("idle");
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const updateDisplayMode = () => {
      const iosStandalone = Boolean(
        (navigator as Navigator & { standalone?: boolean }).standalone,
      );
      setDisplayMode(standaloneQuery.matches || iosStandalone ? "standalone" : "browser");
    };
    const onBeforeInstallPrompt = (rawEvent: Event) => {
      const event = rawEvent as DeferredInstallPrompt;
      event.preventDefault();
      deferredInstallRef.current = event;
      setInstallError(null);
      if (!installationObservedRef.current) setInstallStatus("available");
    };
    const onAppInstalled = () => {
      installationObservedRef.current = true;
      deferredInstallRef.current = null;
      setInstallationObserved(true);
      setInstallError(null);
      setInstallStatus("installed");
    };

    const capabilityTimer = window.setTimeout(() => {
      if (!active) return;
      updateDisplayMode();
      setShareAvailability(
        typeof navigator.share === "function"
          ? "native"
          : supportsClipboardFallback()
            ? "clipboard"
            : "unavailable",
      );
    }, 0);

    standaloneQuery.addEventListener?.("change", updateDisplayMode);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      active = false;
      window.clearTimeout(capabilityTimer);
      standaloneQuery.removeEventListener?.("change", updateDisplayMode);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      deferredInstallRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const registrationTimer = window.setTimeout(() => {
      if (!active) return;

      if (process.env.NODE_ENV !== "production" || !window.isSecureContext) {
        setServiceWorkerStatus("inactive");
        return;
      }

      if (!("serviceWorker" in navigator)) {
        setServiceWorkerStatus("unsupported");
        return;
      }

      setServiceWorkerStatus("registering");
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          if (!active) return;
          setServiceWorkerStatus(registration.active ? "ready" : "registered");

          void navigator.serviceWorker.ready.then(() => {
            if (active) setServiceWorkerStatus("ready");
          });
        })
        .catch(() => {
          if (active) setServiceWorkerStatus("failed");
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(registrationTimer);
    };
  }, []);

  const requestInstall = useCallback(async (): Promise<TapTabInstallResult> => {
    const installPrompt = deferredInstallRef.current;
    if (!installPrompt) {
      setInstallStatus(installationObservedRef.current ? "installed" : "unavailable");
      return "unavailable";
    }

    setInstallError(null);
    setInstallStatus("prompting");
    deferredInstallRef.current = null;

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;

      if (!installationObservedRef.current) setInstallStatus(choice.outcome);
      return choice.outcome;
    } catch (error) {
      setInstallError(errorMessage(error, "The browser could not open the install prompt."));
      if (!installationObservedRef.current) setInstallStatus("failed");
      return "failed";
    }
  }, []);

  const share = useCallback(async (data: TapTabShareData): Promise<TapTabShareResult> => {
    const textToCopy = shareText(data);
    let nativeShareError: unknown;
    setShareError(null);
    setShareStatus("sharing");

    if (typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        setShareStatus("shared");
        return "shared";
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setShareStatus("cancelled");
          return "cancelled";
        }
        nativeShareError = error;
      }
    }

    try {
      if (await copyShareText(textToCopy)) {
        setShareStatus("copied");
        return "copied";
      }

      const message = nativeShareError
        ? "The browser share failed and the link could not be copied. Copy it from the address bar instead."
        : "This browser cannot share or copy the bill link. Copy it from the address bar instead.";
      setShareError(message);
      setShareStatus(nativeShareError ? "failed" : "unavailable");
      return nativeShareError ? "failed" : "unavailable";
    } catch (error) {
      setShareError(errorMessage(error, "The bill link could not be shared or copied."));
      setShareStatus("failed");
      return "failed";
    }
  }, []);

  const value = useMemo<TapTabPwaCapabilities>(
    () => ({
      installStatus,
      canPromptInstall: installStatus === "available",
      installationObserved,
      displayMode,
      installError,
      requestInstall,
      serviceWorkerStatus,
      shareAvailability,
      shareStatus,
      shareError,
      share,
    }),
    [
      displayMode,
      installError,
      installStatus,
      installationObserved,
      requestInstall,
      serviceWorkerStatus,
      share,
      shareAvailability,
      shareError,
      shareStatus,
    ],
  );

  return <TapTabPwaContext.Provider value={value}>{children}</TapTabPwaContext.Provider>;
}

export function useTapTabPwa() {
  const context = useContext(TapTabPwaContext);
  if (!context) throw new Error("useTapTabPwa must be used inside TapTabPwaBridge.");
  return context;
}

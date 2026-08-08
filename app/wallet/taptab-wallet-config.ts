export const TAPTAB_SOCIAL_PROVIDERS = ["google", "apple", "github"] as const;

export const TAPTAB_APPKIT_FEATURES = {
  analytics: false,
  email: true,
  emailShowWallets: true,
  socials: TAPTAB_SOCIAL_PROVIDERS,
  allWallets: true,
  collapseWallets: true,
  history: false,
  onramp: false,
  swaps: false,
  receive: false,
  send: false,
  pay: false,
  smartSessions: false,
  reownAuthentication: false,
} as const;

export type TapTabSocialProvider = (typeof TAPTAB_SOCIAL_PROVIDERS)[number];

export type TapTabWalletOnboarding = Readonly<{
  primaryLabel:
    | "Continue with email or wallet"
    | "Continue with social login or wallet"
    | "Continue with wallet"
    | "Wallet sign-in unavailable";
  email: boolean;
  socials: readonly TapTabSocialProvider[];
  wallets: boolean;
}>;

export type TapTabWalletSetup =
  | Readonly<{
      status: "configured";
      projectId: string;
      siteOrigin: string;
    }>
  | Readonly<{
      status: "unconfigured" | "invalid";
      reason: string;
    }>;

export type TapTabWalletPublicEnv = Readonly<{
  NEXT_PUBLIC_REOWN_PROJECT_ID?: string;
  NEXT_PUBLIC_SITE_URL?: string;
}>;

export type TapTabRemoteAuthFeatures = Readonly<{
  email?: boolean;
  socials?: readonly string[] | false;
}>;

export const unavailableWalletOnboarding: TapTabWalletOnboarding = {
  primaryLabel: "Wallet sign-in unavailable",
  email: false,
  socials: [],
  wallets: false,
};

function getHttpsOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * Wallet sign-in stays fail-closed: a public Reown project ID and the exact
 * public HTTPS origin must both be available before AppKit is initialised.
 */
export function resolveTapTabWalletSetup(env: TapTabWalletPublicEnv): TapTabWalletSetup {
  const projectId = env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() ?? "";
  const rawSiteUrl = env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";

  if (!projectId && !rawSiteUrl) {
    return {
      status: "unconfigured",
      reason: "NEXT_PUBLIC_REOWN_PROJECT_ID and NEXT_PUBLIC_SITE_URL are not set.",
    };
  }
  if (!projectId) {
    return {
      status: "unconfigured",
      reason: "NEXT_PUBLIC_REOWN_PROJECT_ID is not set.",
    };
  }
  if (!rawSiteUrl) {
    return {
      status: "unconfigured",
      reason: "NEXT_PUBLIC_SITE_URL is not set.",
    };
  }

  const siteOrigin = getHttpsOrigin(rawSiteUrl);
  if (!siteOrigin) {
    return {
      status: "invalid",
      reason: "NEXT_PUBLIC_SITE_URL must be a valid public HTTPS URL without credentials.",
    };
  }

  return { status: "configured", projectId, siteOrigin };
}

export function getTapTabWalletOnboarding(
  enabled: boolean,
  remote?: TapTabRemoteAuthFeatures,
): TapTabWalletOnboarding {
  if (!enabled) return unavailableWalletOnboarding;

  const email = remote?.email !== false;
  const remoteSocials = remote?.socials;
  const socials =
    remoteSocials === false
      ? []
      : remoteSocials
        ? TAPTAB_SOCIAL_PROVIDERS.filter((provider) => remoteSocials.includes(provider))
        : [...TAPTAB_SOCIAL_PROVIDERS];

  return {
    primaryLabel: email
      ? "Continue with email or wallet"
      : socials.length
        ? "Continue with social login or wallet"
        : "Continue with wallet",
    email,
    socials,
    wallets: true,
  };
}

export function getTapTabWalletMetadata(siteOrigin: string) {
  return {
    name: "TapTab",
    description: "Claim, fund and settle shared bills together on Monad",
    url: siteOrigin,
    icons: [`${siteOrigin}/favicon.svg`],
  };
}

export const tapTabWalletSetup = resolveTapTabWalletSetup({
  NEXT_PUBLIC_REOWN_PROJECT_ID: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});

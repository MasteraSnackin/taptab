import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TAPTAB_APPKIT_FEATURES,
  TAPTAB_SOCIAL_PROVIDERS,
  getTapTabWalletMetadata,
  getTapTabWalletOnboarding,
  resolveTapTabWalletSetup,
  unavailableWalletOnboarding,
} from "../app/wallet/taptab-wallet-config.ts";

const PROJECT_ID = "public-reown-project-id";
const SITE_URL = "https://taptab.example";

test("keeps wallet onboarding fail-closed until both public values are valid", () => {
  assert.deepEqual(resolveTapTabWalletSetup({}), {
    status: "unconfigured",
    reason: "NEXT_PUBLIC_REOWN_PROJECT_ID and NEXT_PUBLIC_SITE_URL are not set.",
  });
  assert.equal(
    resolveTapTabWalletSetup({ NEXT_PUBLIC_REOWN_PROJECT_ID: PROJECT_ID }).status,
    "unconfigured",
  );
  assert.equal(
    resolveTapTabWalletSetup({ NEXT_PUBLIC_SITE_URL: SITE_URL }).status,
    "unconfigured",
  );

  for (const siteUrl of [
    "http://taptab.example",
    "https://user:secret@taptab.example",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(
      resolveTapTabWalletSetup({
        NEXT_PUBLIC_REOWN_PROJECT_ID: PROJECT_ID,
        NEXT_PUBLIC_SITE_URL: siteUrl,
      }).status,
      "invalid",
      siteUrl,
    );
  }
});

test("normalises a configured HTTPS site to its exact public origin", () => {
  assert.deepEqual(
    resolveTapTabWalletSetup({
      NEXT_PUBLIC_REOWN_PROJECT_ID: ` ${PROJECT_ID} `,
      NEXT_PUBLIC_SITE_URL: " https://taptab.example/table/7?source=qr ",
    }),
    {
      status: "configured",
      projectId: PROJECT_ID,
      siteOrigin: SITE_URL,
    },
  );
});

test("enables only the requested guest login methods alongside normal wallets", () => {
  assert.deepEqual(TAPTAB_SOCIAL_PROVIDERS, ["google", "apple", "github"]);
  assert.equal(TAPTAB_APPKIT_FEATURES.email, true);
  assert.deepEqual(TAPTAB_APPKIT_FEATURES.socials, ["google", "apple", "github"]);
  assert.equal(TAPTAB_APPKIT_FEATURES.emailShowWallets, true);
  assert.equal(TAPTAB_APPKIT_FEATURES.allWallets, true);
  assert.equal(TAPTAB_APPKIT_FEATURES.collapseWallets, true);

  for (const disabledFeature of [
    "analytics",
    "history",
    "onramp",
    "swaps",
    "receive",
    "send",
    "pay",
    "smartSessions",
    "reownAuthentication",
  ]) {
    assert.equal(TAPTAB_APPKIT_FEATURES[disabledFeature], false, disabledFeature);
  }
  assert.equal("sponsoredTransactions" in TAPTAB_APPKIT_FEATURES, false);
  assert.equal("passkeys" in TAPTAB_APPKIT_FEATURES, false);
});

test("exposes an honest primary action as remote project capabilities resolve", () => {
  assert.deepEqual(getTapTabWalletOnboarding(true), {
    primaryLabel: "Continue with email or wallet",
    email: true,
    socials: ["google", "apple", "github"],
    wallets: true,
  });
  assert.deepEqual(
    getTapTabWalletOnboarding(true, {
      email: false,
      socials: ["github", "facebook"],
    }),
    {
      primaryLabel: "Continue with social login or wallet",
      email: false,
      socials: ["github"],
      wallets: true,
    },
  );
  assert.deepEqual(
    getTapTabWalletOnboarding(true, { email: false, socials: false }),
    {
      primaryLabel: "Continue with wallet",
      email: false,
      socials: [],
      wallets: true,
    },
  );
  assert.deepEqual(getTapTabWalletOnboarding(false), unavailableWalletOnboarding);
});

test("uses TapTab-only public metadata without user identity fields", () => {
  const metadata = getTapTabWalletMetadata(SITE_URL);
  assert.deepEqual(metadata, {
    name: "TapTab",
    description: "Claim, fund and settle shared bills together on Monad",
    url: SITE_URL,
    icons: [`${SITE_URL}/favicon.svg`],
  });
  assert.equal("email" in metadata, false);
  assert.equal("account" in metadata, false);
});

test("provider wires combined onboarding, normal-wallet fallback and remote capability updates", async () => {
  const source = await readFile(
    new URL("../app/wallet/CrowdCartWalletProvider.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /features:\s*\{/);
  assert.match(source, /TAPTAB_APPKIT_FEATURES/);
  assert.match(source, /socials:\s*\[\.\.\.TAPTAB_SOCIAL_PROVIDERS\]/);
  assert.match(source, /enableAuthLogger:\s*false/);
  assert.match(source, /defaultAccountTypes:\s*\{\s*eip155:\s*"eoa"\s*\}/);
  assert.match(source, /import\("@reown\/appkit"\)/);
  assert.doesNotMatch(source, /@reown\/appkit\/core/);
  assert.match(source, /import\("@reown\/appkit-adapter-ethers"\)/);
  assert.match(source, /adapters:\s*\[new EthersAdapter\(\)\]/);
  assert.match(source, /subscribeRemoteFeatures/);
  assert.match(source, /openView\("Connect"\)/);
  assert.match(source, /openView\("AllWallets"\)/);
  assert.match(source, /refreshConnection\(\): void/);
  assert.match(source, /Boolean\(nextAccount\) !== Boolean\(nextProvider\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(source, /retryInitialisation\(\): void/);
  assert.match(source, /setInitialisationAttempt\(\(current\) => current \+ 1\)/);
  assert.match(source, /await appKit\.disconnect\("eip155"\);[\s\S]*catch \{/);
  assert.match(source, /The wallet could not disconnect/);
});

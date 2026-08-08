import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("keeps submitted-but-unverified transactions locked until reconciliation", async () => {
  const [createBill, livePanel] = await Promise.all([
    read("../app/TapTabCreateBillPanel.tsx"),
    read("../app/TapTabLivePanel.tsx"),
  ]);

  for (const integration of [
    'visibleSubmissionState === "unverified"',
    "setPendingCreation(pending)",
    "Check status again",
    "submissionLockRef.current",
    "pending.prepared",
    "MonadVision shows failed · reset",
  ]) {
    assert.ok(createBill.includes(integration), `missing create recovery: ${integration}`);
  }
  assert.match(createBill, /receiptResult\.status !== "success"[\s\S]*setSubmissionState\("reverted"\)/);
  assert.match(createBill, /activeIntentRef\.current/);
  assert.match(createBill, /current\.provider !== provider/);

  for (const integration of [
    '| "unverified"',
    'update({ status: "unverified"',
    'transaction.status === "unverified"',
    "recheckTransaction(transaction)",
    "transactionInFlight.current",
    "currentWallet.provider !== provider",
  ]) {
    assert.ok(livePanel.includes(integration), `missing live recovery: ${integration}`);
  }
  assert.match(
    livePanel,
    /transaction\.status === "pending" \|\|\s+transaction\.status === "unverified"/,
  );
});

test("bounds live receipt checks and safely resumes exact-scope pending transactions", async () => {
  const livePanel = await read("../app/TapTabLivePanel.tsx");

  assert.match(livePanel, /const TRANSACTION_RECEIPT_TIMEOUT_MS = 45_000/);
  assert.equal(
    livePanel.match(/timeout: TRANSACTION_RECEIPT_TIMEOUT_MS/g)?.length,
    2,
  );
  assert.equal(livePanel.match(/checkReplacement: true/g)?.length, 2);
  assert.equal(livePanel.match(/onReplaced\(replacement\)/g)?.length, 2);
  assert.match(livePanel, /replacementReason === "cancelled"/);
  assert.match(livePanel, /replacementReason === "replaced"/);
  assert.match(livePanel, /The wallet repriced this transaction/);
  assert.match(livePanel, /It may have been dropped or replaced/);
  assert.match(livePanel, /PENDING_TAPTAB_TRANSACTION_STORAGE_KEY/);
  assert.match(livePanel, /pendingTapTabTransactionsForScope/);
  assert.match(livePanel, /Restored after refresh\. TapTab will recheck it once/);
  assert.match(livePanel, /automaticallyResumedTransactions/);
  assert.match(livePanel, /chainId: TAPTAB_MONAD_TESTNET\.id/);
  assert.match(livePanel, /account: getAddress\(wallet\.account\)/);
});

test("surfaces event-watch diagnostics while retaining snapshot polling", async () => {
  const livePanel = await read("../app/TapTabLivePanel.tsx");

  assert.match(livePanel, /onError\(error\) \{/);
  assert.match(livePanel, /createClientIssueId\("event-watch"\)/);
  assert.match(livePanel, /errorName: safeErrorName\(error\)/);
  assert.match(livePanel, /Instant activity alerts are temporarily delayed/);
  assert.match(livePanel, /Snapshot polling continues every four seconds/);
  assert.match(livePanel, /Diagnostic reference: \{visibleEventWatchIssue\.id\}/);
  assert.doesNotMatch(livePanel, /onError\(\) \{\s*\/\/ The 4s snapshot poll/);
});

test("bounds retriable reads and degrades external data without hiding onchain state", async () => {
  const [app, livePanel, chain] = await Promise.all([
    read("../app/TapTabApp.tsx"),
    read("../app/TapTabLivePanel.tsx"),
    read("../app/taptab-chain.ts"),
  ]);

  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /controller\?\.abort\(\)/);
  assert.match(app, /Math\.min\(120_000, 30_000 \* 2 \*\*/);
  assert.match(app, /Math\.random\(\) \* 5_000/);
  assert.match(app, /cachedAge <= TAPTAB_PRICE_MAX_AGE_SECONDS/);
  assert.match(app, /setPriceState\("stale"\)/);
  assert.match(app, /setPrice\(undefined\);[\s\S]{0,80}setPriceState\("unavailable"\)/);

  assert.match(chain, /function createTapTabHttpTransport\(rpcUrl\?: string\)/);
  assert.match(chain, /transport: readTransport/);
  assert.match(chain, /TAPTAB_PUBLIC_RPC_TIMEOUT_MS = 10_000/);
  assert.match(chain, /TAPTAB_PUBLIC_RPC_RETRY_COUNT = 2/);
  assert.match(chain, /rank: false/);

  assert.match(livePanel, /credentials: "omit"/);
  assert.match(livePanel, /referrerPolicy: "no-referrer"/);
  assert.match(livePanel, /response\.body\.getReader\(\)/);
  assert.match(livePanel, /byteLength > MAX_METADATA_BYTES/);
  assert.match(livePanel, /setMetadataReadState\("error"\)/);
  assert.match(livePanel, /setMetadataReadState\(value \? "ready" : "invalid"\)/);
  assert.match(livePanel, /Retry receipt metadata/);
  assert.match(livePanel, /eventRetryAfterAt\.current = Date\.now\(\) \+ 15_000/);
  assert.match(livePanel, /The bill is current; its activity feed is delayed/);
});

test("surfaces wallet, install, sharing and copy failures with recovery actions", async () => {
  const [provider, livePanel, pwa, app] = await Promise.all([
    read("../app/wallet/CrowdCartWalletProvider.tsx"),
    read("../app/TapTabLivePanel.tsx"),
    read("../app/TapTabPwaBridge.tsx"),
    read("../app/TapTabApp.tsx"),
  ]);

  assert.match(provider, /retryInitialisation\(\): void/);
  assert.match(provider, /setInitialisationAttempt\(\(current\) => current \+ 1\)/);
  assert.match(provider, /await appKit\.disconnect\("eip155"\);[\s\S]*catch \{/);
  assert.match(provider, /The wallet could not disconnect/);
  assert.match(livePanel, /<span>\{wallet\.setupMessage\}<\/span>/);
  assert.match(livePanel, /onClick=\{wallet\.retryInitialisation\}/);
  assert.match(livePanel, /<strong>Copy failed\.<\/strong>/);

  assert.match(pwa, /setShareError\(message\)/);
  assert.match(pwa, /Copy it from the address bar instead/);
  assert.match(app, /installError \? \(/);
  assert.match(app, /serviceWorkerStatus === "failed"/);
  assert.match(app, /shareError \|\| copyError/);
  assert.match(
    app,
    /className="share-recovery" role=\{shareError \|\| copyError \? "alert" : "status"\}/,
  );
  assert.match(app, /className="field-error workspace-action-error"/);
});

test("keeps a selectable value visible after a live clipboard denial", async () => {
  const livePanel = await read("../app/TapTabLivePanel.tsx");

  assert.match(livePanel, /setCopyRecoveryValue\(value\)/);
  assert.match(livePanel, /readOnly/);
  assert.match(livePanel, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(livePanel, /Select the complete value below and copy it manually/);
});

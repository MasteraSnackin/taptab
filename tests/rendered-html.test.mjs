import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the TapTab product experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TapTab — Nobody fronts the bill<\/title>/i);
  assert.match(html, /Nobody fronts/i);
  assert.match(html, /the bill\./i);
  assert.match(html, /Lina Stores/);
  assert.match(
    html,
    /Photograph the receipt, claim what you had/i,
  );
  assert.match(html, /Receipt studio/i);
  assert.match(html, /Organiser &amp; demo controls/i);
  assert.match(html, /Transfer a departing diner/i);
  assert.match(html, /Assign another diner/i);
  assert.match(html, /Choose your tip/i);
  assert.match(html, /Volunteer for unclaimed extras/i);
  assert.match(html, /Your final check/i);
  assert.match(html, /Sponsor someone/);
  assert.match(html, /Protected payment/);
  assert.match(html, /Safe ending rehearsal/);
  assert.match(html, /Open Stage mode/);
  assert.match(html, /Sample preview/);
  assert.match(html, /Local judge rehearsal/);
  assert.match(html, /Local judge evidence/);
  assert.match(html, /Download local evidence/);
  assert.match(html, /GBP-first by design/);
  assert.match(html, /mainnet spot price/i);
  assert.match(html, /Testnet MON is not cash/i);
  assert.match(html, /Settle or refund/i);
  assert.match(html, /Try sample bill/i);
  assert.match(html, /without connecting a wallet/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the finished site free of starter metadata and dependencies", async () => {
  const [page, layout, packageJson, css, tapTabApp] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /TapTabApp/);
  assert.match(page, /TapTab — Nobody fronts the bill/);
  assert.match(layout, /TapTab — Nobody fronts the bill/);
  assert.match(layout, /\/og\.png/);
  assert.match(layout, /TapTabWalletProvider/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(tapTabApp, /Sponsor someone/);
  assert.match(tapTabApp, /Simulate expiry/);
  assert.match(tapTabApp, /Open Stage mode/);
  assert.match(tapTabApp, /TapTab Local Demo/);
  assert.match(tapTabApp, /Simulated table activity/);
  assert.match(tapTabApp, /no Monad receipt is claimed/);
  assert.match(tapTabApp, /Solidity parity is covered by the local contract rehearsal/);
  assert.match(tapTabApp, /workspaceMode === "live" \? liveUpdate\.shareUrl : ""/);
  assert.match(tapTabApp, /hidden=\{workspaceMode !== "preview"\}/);
  assert.match(tapTabApp, /url\.hash = "current-action"/);
  assert.match(tapTabApp, /url\.search = ""/);
});

test("keeps the default preview journey diner-first and the demo controls separate", async () => {
  const tapTabApp = await readFile(
    new URL("../app/TapTabApp.tsx", import.meta.url),
    "utf8",
  );

  for (const journeyCopy of [
    "Claim yours",
    "Tip & extras",
    "Review",
    "Pay",
    "Receipt",
    "Try sample bill",
    "Assign another diner",
    "Organiser &amp; demo controls",
    "TapTabSettlementReceipt",
  ]) {
    assert.ok(tapTabApp.includes(journeyCopy), `missing diner journey copy: ${journeyCopy}`);
  }

  assert.match(tapTabApp, /aria-label=\{`\$\{youClaimed \? "Release" : "Claim"\} \$\{item\.name\} for yourself`\}/);
  assert.match(tapTabApp, /className="other-diners-disclosure"/);
  assert.match(tapTabApp, /role="status"\s+aria-live="polite"/);
  assert.match(
    tapTabApp,
    /\(workspaceMode === "live" \? liveReceiptSummaryRef : receiptSummaryRef\)\.current\?\.focus\(\)/,
  );
  assert.match(tapTabApp, /className="tap-mobile-nav"/);
  assert.match(tapTabApp, /className="bill-grid" hidden=\{phase !== "claiming"\}/);
});

test("keeps the sponsor control aligned with the next unpaid participant", async () => {
  const tapTabApp = await readFile(
    new URL("../app/TapTabApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(tapTabApp, /const activeSponsorId = sponsorableParticipants\.some/);
  assert.match(tapTabApp, /value=\{activeSponsorId \?\? ""\}/);
  assert.match(tapTabApp, /payRemaining\(activeSponsorId, "you"\)/);
  assert.doesNotMatch(tapTabApp, /value=\{sponsorId\}/);
});

test("keeps workspace navigation, stage mode and sharing in one explicit mode", async () => {
  const tapTabApp = await readFile(
    new URL("../app/TapTabApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    tapTabApp,
    /workspaceMode === "live" && liveConfigured && liveSnapshot !== null/,
  );
  assert.match(
    tapTabApp,
    /if \(workspaceMode === "live" && !liveShareUrl\) return/,
  );
  assert.match(tapTabApp, /url\.searchParams\.delete\("pay"\)/);
  assert.match(
    tapTabApp,
    /const openWorkspace = \([\s\S]*?nextMode: WorkspaceMode,[\s\S]*?preserveTrustedContext = false,[\s\S]*?\) =>/,
  );
  assert.match(tapTabApp, /event\.preventDefault\(\);\s+openWorkspace\("live"\)/);
  assert.match(tapTabApp, /window\.history\.replaceState\(\{\}, "", url\)/);
  assert.doesNotMatch(
    tapTabApp,
    /window\.addEventListener\("hashchange", syncWorkspaceFromLocation\)/,
  );
});

test("rejects receipt shares that would crash the penny split preview", async () => {
  const receiptPanel = await readFile(
    new URL("../app/ReceiptImportPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(receiptPanel, /if \(item\.shareSlots > pricePence\)/);
  assert.match(
    receiptPanel,
    /cannot have more equal shares than pennies in its price/,
  );
});

test("keeps custom tips valid and stage mode inside compact viewports", async () => {
  const [tapTabApp, css] = await Promise.all([
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(tapTabApp, /step="0\.01"/);
  assert.doesNotMatch(tapTabApp, /step="0\.25"/);
  assert.match(css, /\.stage-overlay \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.stage-overlay > \*,\s*\.stage-header-status \{\s*min-width: 0/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("links the host through the eight-step live Testnet journey in order", async () => {
  const [appSource, journeySource, panelSource] = await Promise.all([
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TapTabHostJourney.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TapTabLivePanel.tsx", import.meta.url), "utf8"),
  ]);

  const steps = [
    ["wallet", "Sign in and switch network"],
    ["receipt", "Fill bill details"],
    ["quote", "Review locked quote"],
    ["create", "Create Testnet bill"],
    ["invite", "Fill participant wallets"],
    ["participation", "Join, claim and approve"],
    ["payment", "Pay and settle"],
    ["proof", "Show Testnet proof"],
  ];
  let previousIndex = -1;
  for (const [id, label] of steps) {
    const index = journeySource.indexOf(`id: "${id}"`);
    assert.ok(index > previousIndex, `missing or out-of-order host step: ${label}`);
    assert.ok(
      journeySource.indexOf(`label: "${label}"`, index) > index,
      `missing label for host step: ${label}`,
    );
    previousIndex = index;
  }

  assert.equal(journeySource.match(/\n\s+label: "/g)?.length, 8);
  assert.match(journeySource, /data-testid="testnet-demo-guide"/);
  assert.match(journeySource, /<ol aria-label="Eight-step live Testnet checklist">/);
  assert.match(journeySource, /data-testid=\{`testnet-demo-step-\$\{step\.id\}`\}/);
  assert.match(journeySource, /href=\{step\.href\}/);
  assert.match(journeySource, /aria-disabled=\{step\.disabled \|\| undefined\}/);

  const journeyStart = appSource.indexOf("<TapTabHostJourney");
  const journeyEnd = appSource.indexOf("/>", journeyStart);
  assert.notEqual(journeyStart, -1);
  assert.notEqual(journeyEnd, -1);
  const journeyProps = appSource.slice(journeyStart, journeyEnd);
  for (const target of [
    'href: "#live-wallet-title"',
    'href: "#host-live-receipt-fields"',
    'href: "#host-create-testnet-bill"',
    'href: "#live-host-title"',
    'href: "#live-items-title"',
    'href: liveSnapshot?.phase === "settled" ? "#live-settlement-proof" : "#pay"',
    'href: hostProofUrl || "#live-technical-details"',
  ]) {
    assert.ok(journeyProps.includes(target), `missing host journey target: ${target}`);
  }

  const renderedTargets = `${appSource}\n${panelSource}`;
  for (const targetId of [
    "live-wallet-title",
    "host-live-receipt-fields",
    "host-create-testnet-bill",
    "live-host-title",
    "live-items-title",
    "pay",
    "live-settlement-proof",
    "live-technical-details",
  ]) {
    assert.ok(
      renderedTargets.includes(`id="${targetId}"`),
      `missing rendered host journey target: ${targetId}`,
    );
  }

  assert.match(appSource, /lastCreatedBillMatchesLiveContext &&[\s\S]*?lastCreatedBill &&/);
  assert.match(appSource, /const hostProofUrl = explorerEventIsNewer/);
  assert.match(appSource, /TAPTAB_MONAD_TESTNET\.blockExplorers\.default\.url/);
  assert.match(appSource, /event\.eventName === "BillSettled" && event\.explorerUrl/);
  assert.match(appSource, /liveUpdate\.events\.find\(\(event\) => event\.explorerUrl\)/);
  assert.match(appSource, /hostBillMatchesReceipt && hostProofUrl/);
  assert.match(journeyProps, /external: Boolean\(hostProofUrl\)/);
  assert.match(journeySource, /target: "_blank", rel: "noreferrer"/);
  assert.doesNotMatch(journeySource, /Five-step host checklist|Open trusted audience view/);
});

test("keeps editable receipt fields inside the live journey", async () => {
  const [appSource, receiptSource] = await Promise.all([
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ReceiptImportPanel.tsx", import.meta.url), "utf8"),
  ]);

  const liveWorkspaceStart = appSource.indexOf('{workspaceMode === "live" ? (');
  const liveWorkspaceEnd = appSource.indexOf(
    '<details className="tool-disclosure presenter-tools organiser-area">',
    liveWorkspaceStart,
  );
  assert.notEqual(liveWorkspaceStart, -1);
  assert.notEqual(liveWorkspaceEnd, -1);
  const liveWorkspace = appSource.slice(liveWorkspaceStart, liveWorkspaceEnd);

  const guideIndex = liveWorkspace.indexOf("<TapTabHostJourney");
  const fieldsIndex = liveWorkspace.indexOf('id="host-live-receipt-fields"');
  const createIndex = liveWorkspace.indexOf('id="host-create-testnet-bill"');
  const panelIndex = liveWorkspace.indexOf("<TapTabLivePanel active");
  for (const [name, index] of [
    ["host journey", guideIndex],
    ["live receipt fields", fieldsIndex],
    ["live bill creation", createIndex],
    ["live bill panel", panelIndex],
  ]) {
    assert.notEqual(index, -1, `missing ${name} from the live workspace`);
  }
  assert.ok(guideIndex < fieldsIndex, "the guide must lead to the live receipt fields");
  assert.ok(fieldsIndex < createIndex, "bill details must be editable before bill creation");
  assert.ok(createIndex < panelIndex, "bill creation must precede the loaded live bill panel");

  assert.match(liveWorkspace, /data-testid="live-bill-fields"/);
  assert.match(liveWorkspace, /open=\{receiptStudioOpen\}/);
  assert.match(liveWorkspace, /<ReceiptImportPanel[\s\S]*?currentMerchant=\{merchant\}[\s\S]*?currentItems=\{receiptItems\}[\s\S]*?onApply=\{applyImportedReceipt\}/);
  assert.doesNotMatch(liveWorkspace, /id="host-live-receipt-fields"[^>]*hidden/);
  assert.match(
    appSource,
    /target instanceof HTMLDetailsElement[\s\S]*?disclosure\.open = true/,
    "following the receipt step must reveal its details panel",
  );

  for (const field of [
    "value={merchant}",
    "value={item.name}",
    "value={item.priceText}",
    "value={item.shareSlots}",
  ]) {
    assert.ok(receiptSource.includes(field), `missing editable live receipt field: ${field}`);
  }
});

test("mounts live-chain work only in the durable live workspace", async () => {
  const appSource = await readFile(
    new URL("../app/TapTabApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    appSource,
    /\{workspaceMode === "live" \? \([\s\S]*?<TapTabHostJourney[\s\S]*?<TapTabLivePanel active onLiveUpdate=\{handleLiveUpdate\} \/>/,
  );
  assert.doesNotMatch(appSource, /hidden=\{workspaceMode !== "live"\}/);
  assert.doesNotMatch(appSource, /active=\{workspaceMode === "live"\}/);
  assert.match(
    appSource,
    /const openWorkspace = \([\s\S]*?nextMode: WorkspaceMode,[\s\S]*?preserveTrustedContext = false,[\s\S]*?\) =>/,
  );
  assert.match(
    appSource,
    /openWorkspace\("live", "host-live-receipt-fields"\)/,
  );
  assert.match(appSource, /if \(!preserveTrustedContext\) \{[\s\S]*?delete\("contract"\)/);
  assert.match(appSource, /url\.hash = targetId/);
  assert.match(appSource, /taptabWorkspace: nextMode/);
  assert.match(appSource, /target instanceof HTMLDetailsElement/);
  assert.match(appSource, /\(\) => openWorkspace\("live", "live"\)/);
  assert.match(appSource, /window\.addEventListener\("popstate", syncWorkspaceFromLocation\)/);
});

test("keeps operational TapTab text at an explicit desktop legibility floor", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /TapTab operational copy remains legible/);
  assert.match(css, /@media \(min-width: 681px\)/);
  assert.match(
    css,
    /:is\(\.taptab-shell, \.payment-route-live\) \.bill-section button,[\s\S]*?font-size: 12px/,
  );
  assert.match(css, /\.live-read-error strong,[\s\S]*?\.field-error[\s\S]*?font-size: 12px/);
  assert.match(css, /\.live-action-list > button :is\(strong, small\)[\s\S]*?font-size: 11px/);
  assert.match(css, /\.live-share-slots > button :is\(span, small\)/);
  assert.match(css, /\.avatar-stack > span,[\s\S]*?font-size: 10px/);
});

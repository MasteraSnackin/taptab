import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("links the host through the five trusted bill checks in order", async () => {
  const [appSource, journeySource] = await Promise.all([
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TapTabHostJourney.tsx", import.meta.url), "utf8"),
  ]);

  const labels = [
    "Verify receipt",
    "Review locked quote",
    "Create Testnet bill",
    "Invite wallets",
    "Open trusted audience view",
  ];
  let previousIndex = -1;
  for (const label of labels) {
    const index = journeySource.indexOf(`label: "${label}"`);
    assert.ok(index > previousIndex, `missing or out-of-order host step: ${label}`);
    previousIndex = index;
  }

  assert.match(journeySource, /<ol aria-label="Five-step host checklist">/);
  assert.match(journeySource, /href=\{step\.href\}/);
  assert.match(journeySource, /aria-disabled=\{step\.disabled \|\| undefined\}/);

  for (const target of [
    'id="host-verify-receipt"',
    'id="host-create-testnet-bill"',
    'href: "#live-host-title"',
  ]) {
    assert.ok(appSource.includes(target), `missing host journey target: ${target}`);
  }
  assert.match(appSource, /href: liveUpdate\.shareUrl \|\| "#live"/);
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
    /openWorkspace\("preview", "host-verify-receipt", true\)/,
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

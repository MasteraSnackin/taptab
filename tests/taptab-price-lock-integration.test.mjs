import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("opens preview funding only after snapshotting complete conversion evidence", async () => {
  const source = await readFile(
    new URL("../app/TapTabApp.tsx", import.meta.url),
    "utf8",
  );

  for (const integration of [
    "lockTapTabPriceReference({",
    "setLockedPriceReference(nextLockedPriceReference)",
    "No live or explicitly confirmed manual MON/GBP quote was available.",
    "Protected quote fixed for payments",
    "It cannot change the protected payment totals.",
    "Testnet MON is not cash and cannot be redeemed",
  ]) {
    assert.ok(source.includes(integration), `missing price-lock integration: ${integration}`);
  }

  assert.doesNotMatch(source, /lockedGbpPerMon|lockedQuoteTimestamp/);
  assert.match(
    source,
    /setLockedPriceReference\(nextLockedPriceReference\);[\s\S]{0,120}setPhase\("funding"\)/,
  );
});

test("keeps the Stage Mode no-cash warning beside every verified GBP quote", async () => {
  const source = await readFile(
    new URL("../app/TapTabApp.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /liveUpdate\.quote && liveUpdate\.metadata\?\.quote/);
  assert.match(source, /GBP quote fixed for this bill/);
  assert.match(source, /Testnet MON has no cash value/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function judgeGuideSource() {
  return readFile(new URL("../app/TapTabJudgeGuide.tsx", import.meta.url), "utf8");
}

test("keeps the judge rehearsal timed and explicitly local-only", async () => {
  const source = await judgeGuideSource();

  assert.match(source, /const REHEARSAL_SECONDS = 3 \* 60/);
  assert.match(source, /> Start\s*</);
  assert.match(source, /> Pause\s*</);
  assert.match(source, /> Reset\s*</);
  assert.match(source, /className\?: string/);
  assert.match(source, /Local preview only/);
  assert.match(source, /No wallet or public network required/);
  assert.match(source, /deterministic sample behaviour/);
  assert.match(source, /does not\s+establish a deployed contract or public transaction/);

  assert.doesNotMatch(
    source,
    /liveTestnetAvailable|confirmationMs|formatMeasuredConfirmation|Monad|Testnet|explorer|live bill/i,
  );
});

test("covers the five local proof points in pitch order", async () => {
  const source = await judgeGuideSource();
  const orderedProofs = [
    "Name the everyday problem",
    "Show the local receipt journey",
    "Reach group agreement",
    "Demonstrate protected funding",
    "Close with local evidence",
  ];

  let previousIndex = -1;
  for (const proof of orderedProofs) {
    const index = source.indexOf(proof);
    assert.ok(index > previousIndex, `missing or out-of-order proof: ${proof}`);
    previousIndex = index;
  }

  assert.match(source, /human-verified rows and exact shared-item slots/);
  assert.match(source, /Organiser & demo controls/);
  assert.match(source, /approvals clear/);
  assert.match(source, /median tip and opt-in fair remainder/);
  assert.match(source, /Manage diner approvals/);
  assert.match(source, /Pay one share, sponsor another/);
  assert.match(source, /settlement stays unavailable until the exact total is funded/);
  assert.match(source, /confirm settlement/);
  assert.match(source, /separate ephemeral Hardhat rehearsal/);
});

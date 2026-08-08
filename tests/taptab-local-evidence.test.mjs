import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createTapTabLocalJudgeEvidence,
  serialiseTapTabLocalJudgeEvidence,
  tapTabLocalJudgeEvidenceFileName,
} from "../app/taptab-local-evidence.ts";

const INPUT = {
  merchant: "Local Table",
  items: [{ id: "shared", name: "Shared dish", pricePence: 100, shareSlots: 2 }],
  participants: [
    { id: "a", name: "A", remainderOptIn: false, tipVoteBps: 0 },
    { id: "b", name: "B", remainderOptIn: false, tipVoteBps: 0 },
  ],
  claims: [
    { participantId: "a", itemId: "shared", shareIndexes: [0] },
    { participantId: "b", itemId: "shared", shareIndexes: [1] },
  ],
  payments: [
    { payerId: "a", beneficiaryId: "a", amountPence: 50 },
    { payerId: "a", beneficiaryId: "b", amountPence: 50 },
  ],
  approvedParticipantIds: ["a", "b"],
  refundedPayerIds: [],
  splitRevision: 3,
  phase: "settled",
};

test("exports a self-checking local snapshot without chain evidence claims", () => {
  const evidence = createTapTabLocalJudgeEvidence(INPUT, 1_800_000_000);

  assert.equal(evidence.schema, "taptab-local-judge-evidence");
  assert.equal(evidence.scope, "local-preview");
  assert.equal(evidence.derived.subtotalPence, 100);
  assert.equal(evidence.derived.totalDuePence, 100);
  assert.equal(evidence.derived.fundedPence, 100);
  assert.equal(evidence.derived.canSettle, true);
  assert.equal(evidence.allInvariantsPass, true);
  assert.ok(evidence.invariants.every(({ pass }) => pass));
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.derived.participantAllocations));

  const json = serialiseTapTabLocalJudgeEvidence(evidence);
  for (const forbidden of [
    "chainId",
    "contractAddress",
    "transactionHash",
    "explorerUrl",
    "gbpPerMon",
  ]) {
    assert.equal(json.includes(forbidden), false, forbidden);
  }
});

test("records bounded local refunds and rejects impossible evidence identifiers", () => {
  const partialInput = {
    ...INPUT,
    payments: [{ payerId: "a", beneficiaryId: "b", amountPence: 20 }],
    refundedPayerIds: ["a"],
    phase: "cancelled",
  };
  const evidence = createTapTabLocalJudgeEvidence(partialInput, 1_800_000_001);
  assert.equal(evidence.derived.fundedPence, 20);
  assert.equal(evidence.derived.refundedPence, 20);
  assert.equal(evidence.allInvariantsPass, true);

  assert.throws(
    () =>
      createTapTabLocalJudgeEvidence(
        { ...partialInput, refundedPayerIds: ["unknown"] },
        1_800_000_001,
      ),
    /unknown identifier/,
  );
  assert.throws(
    () =>
      createTapTabLocalJudgeEvidence(
        { ...partialInput, approvedParticipantIds: ["a", "a"] },
        1_800_000_001,
      ),
    /duplicate participant/,
  );
});

test("uses a timestamped local-only filename and separates live recovery tools", async () => {
  assert.equal(
    tapTabLocalJudgeEvidenceFileName(new Date("2026-08-08T09:00:00.000Z")),
    "taptab-local-judge-evidence-2026-08-08T09-00-00-000Z.json",
  );

  const app = await readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8");
  assert.match(app, /workspaceMode === "preview" \? \(/);
  assert.match(app, /<TapTabLocalEvidencePanel/);
  assert.match(app, /\) : \(\s*<TapTabDemoResiliencePanel/);
});

test("pins the contract rehearsal to ephemeral Hardhat and labels its report", async () => {
  const [packageText, script] = await Promise.all([
    readFile(new URL("../contracts/package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../contracts/scripts/rehearse-taptab-local.cjs", import.meta.url),
      "utf8",
    ),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(
    packageJson.scripts["rehearse:local"],
    "hardhat run scripts/rehearse-taptab-local.cjs --network hardhat",
  );
  assert.match(script, /LOCAL_CHAIN_ID = 31_337n/);
  assert.match(script, /hre\.network\.name !== "hardhat"/);
  assert.match(script, /not Monad Testnet proof/);
  assert.match(script, /finalState: "Settled"/);
  assert.match(script, /finalState: "Cancelled"/);
  assert.match(script, /finalState: "Expired"/);
});

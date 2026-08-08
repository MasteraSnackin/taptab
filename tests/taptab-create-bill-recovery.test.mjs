import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TAPTAB_MONAD_TESTNET } from "../app/taptab-chain.ts";
import {
  PENDING_TAPTAB_CREATION_MAX_AGE_MS,
  parsePendingTapTabCreations,
  pendingTapTabCreationForScope,
  removePendingTapTabCreation,
  replacePendingTapTabCreationHash,
  serialisePendingTapTabCreations,
  upsertPendingTapTabCreation,
} from "../app/taptab-pending-creations.ts";

const NOW = 1_800_000_000_000;
const CONTRACT = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const OTHER_ACCOUNT = "0x3333333333333333333333333333333333333333";
const PAYEE = "0x4444444444444444444444444444444444444444";
const HASH = `0x${"a".repeat(64)}`;
const REPLACEMENT_HASH = `0x${"b".repeat(64)}`;

function creation(overrides = {}) {
  const subtotalPence = overrides.subtotalPence ?? 3_001;
  const subtotalWei = overrides.subtotalWei ?? "1200400000000000000000";
  const quote = overrides.quote ?? {
    gbpPerMon: "0.025",
    source: "CoinGecko",
    basis: "mainnet MON reference",
    observedAtUnixSeconds: 1_800_000_000,
  };
  const metadataURI = `data:application/json,${encodeURIComponent(JSON.stringify({
    schema: "taptab-gbp-receipt",
    version: 1,
    currency: "GBP",
    merchant: "The Green Room",
    subtotalPence,
    items: [{ name: "Dinner", amountPence: subtotalPence }],
    quote: {
      ...quote,
      lockedAtUnixSeconds: 1_800_000_000,
      allocation: "largest-remainder-half-up",
      subtotalWei,
    },
  }))}`;
  return {
    chainId: TAPTAB_MONAD_TESTNET.id,
    contract: CONTRACT,
    account: ACCOUNT,
    hash: HASH,
    submittedAt: NOW - 1_000,
    payee: PAYEE,
    deadline: "1800007200",
    subtotalPence,
    subtotalWei,
    metadataURI,
    quote,
    ...overrides,
  };
}

const scope = {
  chainId: TAPTAB_MONAD_TESTNET.id,
  contract: CONTRACT,
  account: ACCOUNT,
};

test("round-trips pending creations and selects the latest for an exact scope", () => {
  const older = creation({ hash: REPLACEMENT_HASH, submittedAt: NOW - 2_000 });
  const raw = serialisePendingTapTabCreations([older, creation()], NOW);
  const parsed = parsePendingTapTabCreations(raw, NOW);

  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map(({ hash }) => hash), [HASH, REPLACEMENT_HASH]);
  assert.equal(pendingTapTabCreationForScope(parsed, scope)?.hash, HASH);
  assert.equal(
    pendingTapTabCreationForScope(parsed, { ...scope, account: OTHER_ACCOUNT }),
    undefined,
  );
});

test("rejects stale, foreign-chain and malformed persisted creation evidence", () => {
  const candidates = [
    creation({ chainId: 1 }),
    creation({ submittedAt: NOW - PENDING_TAPTAB_CREATION_MAX_AGE_MS - 1 }),
    creation({ hash: "0x1234" }),
    creation({ contract: "not-an-address" }),
    creation({ metadataURI: "https://example.test/receipt.json" }),
    creation({ subtotalWei: "-1" }),
    creation({ quote: { ...creation().quote, gbpPerMon: "1e-3" } }),
    {
      ...creation(),
      quote: { ...creation().quote, source: "Tampered source" },
    },
  ];

  for (const candidate of candidates) {
    const raw = JSON.stringify({ version: 1, creations: [candidate] });
    assert.deepEqual(parsePendingTapTabCreations(raw, NOW), []);
  }
  assert.deepEqual(parsePendingTapTabCreations("not-json", NOW), []);
});

test("updates only a repriced hash and removes only the matching scoped creation", () => {
  const initial = upsertPendingTapTabCreation([], creation(), NOW);
  const repriced = replacePendingTapTabCreationHash(
    initial,
    scope,
    HASH,
    REPLACEMENT_HASH,
    NOW,
  );
  assert.equal(repriced[0].hash, REPLACEMENT_HASH);
  assert.deepEqual(
    removePendingTapTabCreation(repriced, scope, REPLACEMENT_HASH),
    [],
  );

  const untouched = removePendingTapTabCreation(repriced, {
    ...scope,
    account: OTHER_ACCOUNT,
  });
  assert.equal(untouched[0].hash, REPLACEMENT_HASH);
});

test("bounds create-bill confirmation and restores without automatically resubmitting", async () => {
  const source = await readFile(
    new URL("../app/TapTabCreateBillPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const CREATION_RECEIPT_TIMEOUT_MS = 45_000/);
  assert.match(source, /timeout: CREATION_RECEIPT_TIMEOUT_MS/);
  assert.match(source, /checkReplacement: true/);
  assert.match(source, /onReplaced\(replacement\)/);
  assert.match(source, /replacementReason === "cancelled"/);
  assert.match(source, /replacementReason === "replaced"/);
  assert.match(source, /The wallet repriced this transaction/);
  assert.match(source, /PENDING_TAPTAB_CREATION_STORAGE_KEY/);
  assert.match(source, /pendingTapTabCreationForScope/);
  assert.match(source, /automaticallyResumedCreations/);
  assert.match(source, /will not submit it again/);
  assert.match(source, /findConfirmedTapTabBillCreated\(receiptResult\.logs/);

  const recoveryStart = source.indexOf("useEffect(() => {", source.indexOf("confirmCreation"));
  const submissionStart = source.indexOf("const submit = async", recoveryStart);
  assert.ok(recoveryStart >= 0 && submissionStart > recoveryStart);
  assert.doesNotMatch(
    source.slice(recoveryStart, submissionStart),
    /writeContract|walletClient/,
  );
  const submittedHashIndex = source.indexOf("const hash = await walletClient.writeContract");
  assert.ok(
    submittedHashIndex >= 0 &&
      submittedHashIndex < source.indexOf("upsertPendingTapTabCreation", submittedHashIndex),
    "pending creation must only be stored after the wallet returns a submitted hash",
  );
});

test("does not apply an old creation result after the wallet or trusted contract changes", async () => {
  const source = await readFile(
    new URL("../app/TapTabCreateBillPanel.tsx", import.meta.url),
    "utf8",
  );
  const confirmationStart = source.indexOf("const confirmCreation = useCallback");
  const recoveryStart = source.indexOf("useEffect(() => {", confirmationStart);
  const confirmation = source.slice(confirmationStart, recoveryStart);

  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{\s*activeCreationScopeKeyRef\.current = creationScopeKey/,
  );
  assert.match(
    confirmation,
    /const isCurrentCreationScope = \(\) =>[\s\S]*activeCreationScopeKeyRef\.current === pendingScopeKey/,
  );
  assert.ok(
    (confirmation.match(/!isCurrentCreationScope\(\)/g)?.length ?? 0) >= 6,
    "every receipt outcome must be guarded against a changed creation scope",
  );
  assert.match(
    confirmation,
    /onReplaced\(replacement\)[\s\S]*if \(isCurrentCreationScope\(\)\) \{[\s\S]*setTransactionHash/,
  );
  assert.match(
    confirmation,
    /receiptResult\.status !== "success"[\s\S]*removePendingTapTabCreation\(current, persistedScope, trackedHash\)[\s\S]*if \(!isCurrentCreationScope\(\)\)[\s\S]*return "superseded"/,
  );
  assert.match(
    confirmation,
    /findConfirmedTapTabBillCreated\(receiptResult\.logs[\s\S]*removePendingTapTabCreation\(current, persistedScope, trackedHash\)[\s\S]*if \(!isCurrentCreationScope\(\)\)[\s\S]*return "superseded"[\s\S]*onCreated\(\{/,
  );
  assert.match(
    confirmation,
    /const message = await describeCreationReceiptError[\s\S]*if \(!isCurrentCreationScope\(\)\)[\s\S]*setPendingCreation\(trackedPending\)/,
  );
  assert.match(source, /const pendingCreationBelongsToCurrentScope =/);
  assert.match(
    source,
    /const visibleTransactionHash = pendingCreationBelongsToCurrentScope/,
  );
});

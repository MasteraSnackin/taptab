import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createManualTapTabQuote,
  createTapTabDemoRecoveryPack,
  parseTapTabDemoRecoveryPack,
  serialiseTapTabDemoRecoveryPack,
  tapTabRecoveryFileName,
} from "../app/taptab-demo-resilience.ts";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const OTHER_CONTRACT = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"A".repeat(64)}`;
const NOW = 1_800_000_000;

const SOURCE = {
  merchant: "The Green Room",
  items: [
    { id: "starter-private-id", name: "Shared starter", pricePence: 1_001, shareSlots: 3 },
    { id: "main-private-id", name: "Main", pricePence: 2_000, shareSlots: 1 },
  ],
  audienceUrl: "https://taptab.example/table?private_token=do-not-copy#stage",
  context: { address: CONTRACT, billId: 7n },
  quote: {
    mode: "live",
    gbpPerMon: "0.025000",
    source: "CoinGecko",
    basis: "mainnet MON spot reference",
    observedAtUnixSeconds: NOW - 30,
  },
  evidence: [
    {
      action: "Create live bill",
      transactionHash: HASH,
      blockNumber: 123n,
      confirmedAtUnixSeconds: NOW - 20,
      confirmationMs: 812,
    },
  ],
  privateNames: ["This field must be ignored"],
  deployerPrivateKey: "This field must also be ignored",
};

test("manual fallback requires an exact acknowledged decimal when live pricing is not current", () => {
  assert.deepEqual(
    createManualTapTabQuote({
      gbpPerMon: "0.025000",
      sourceLabel: "CoinGecko screen checked by host",
      acknowledged: true,
      liveStatus: "unavailable",
      nowUnixSeconds: NOW,
    }),
    {
      gbpPerMon: "0.025",
      source: "Manual fallback: CoinGecko screen checked by host",
      basis: "Host-entered GBP-per-MON fallback; not an oracle",
      observedAtUnixSeconds: NOW,
    },
  );

  for (const gbpPerMon of ["0", " 0.025", "£0.025", ".025", "2.5e-2"]) {
    assert.throws(
      () =>
        createManualTapTabQuote({
          gbpPerMon,
          sourceLabel: "Host check",
          acknowledged: true,
          liveStatus: "stale",
          nowUnixSeconds: NOW,
        }),
      /positive|plain|exact decimal/,
      gbpPerMon,
    );
  }
  assert.throws(
    () =>
      createManualTapTabQuote({
        gbpPerMon: "0.025",
        sourceLabel: "Host check",
        acknowledged: false,
        liveStatus: "stale",
        nowUnixSeconds: NOW,
      }),
    /Acknowledge/,
  );
  assert.throws(
    () =>
      createManualTapTabQuote({
        gbpPerMon: "0.025",
        sourceLabel: "Host check",
        acknowledged: true,
        liveStatus: "live",
        nowUnixSeconds: NOW,
      }),
    /only when the live quote is stale or unavailable/,
  );
});

test("exports only bounded public demo state and canonical explorer evidence", () => {
  const pack = createTapTabDemoRecoveryPack(SOURCE, NOW);
  assert.deepEqual(pack, {
    schema: "taptab-demo-recovery",
    version: 1,
    notice: "Recovery pack only — not chain proof.",
    chain: { name: "Monad Testnet", chainId: 10_143 },
    exportedAtUnixSeconds: NOW,
    audienceUrl: `https://taptab.example/table?contract=${CONTRACT}&bill=7#live`,
    receipt: {
      verification: "host-verified",
      merchant: "The Green Room",
      items: [
        { name: "Shared starter", pricePence: 1_001, shareCount: 3 },
        { name: "Main", pricePence: 2_000, shareCount: 1 },
      ],
    },
    context: { contractAddress: CONTRACT, billId: "7" },
    quote: {
      mode: "live",
      gbpPerMon: "0.025",
      source: "CoinGecko",
      basis: "mainnet MON spot reference",
      observedAtUnixSeconds: NOW - 30,
    },
    evidence: [
      {
        action: "Create live bill",
        transactionHash: HASH.toLowerCase(),
        blockNumber: "123",
        explorerUrl: `https://testnet.monadvision.com/tx/${HASH.toLowerCase()}`,
        confirmedAtUnixSeconds: NOW - 20,
        confirmationMs: 812,
      },
    ],
  });

  const json = serialiseTapTabDemoRecoveryPack(pack);
  assert.equal(json.includes("starter-private-id"), false);
  assert.equal(json.includes("private_token"), false);
  assert.equal(json.includes("privateNames"), false);
  assert.equal(json.includes("deployerPrivateKey"), false);
  assert.match(tapTabRecoveryFileName(new Date("2026-08-08T09:00:00.000Z")), /^taptab-demo-recovery-2026-08-08T09-00-00-000Z\.json$/);
});

test("round-trips receipt rows and opens only a bill on the build-trusted contract", () => {
  const json = serialiseTapTabDemoRecoveryPack(
    createTapTabDemoRecoveryPack(SOURCE, NOW),
  );
  const recovered = parseTapTabDemoRecoveryPack(json, CONTRACT);
  assert.deepEqual(recovered.receipt, {
    merchant: "The Green Room",
    items: [
      { id: "recovery-row-1", name: "Shared starter", pricePence: 1_001, shareSlots: 3 },
      { id: "recovery-row-2", name: "Main", pricePence: 2_000, shareSlots: 1 },
    ],
  });
  assert.deepEqual(recovered.context, { address: CONTRACT, billId: 7n });
  assert.equal(recovered.pack.quote.mode, "live");

  assert.throws(
    () => parseTapTabDemoRecoveryPack(json),
    /no trusted TapTab contract/,
  );
  assert.throws(
    () => parseTapTabDemoRecoveryPack(json, OTHER_CONTRACT),
    /does not use the TapTab contract trusted by this build/,
  );
});

test("rejects unsupported, oversized or out-of-bounds recovery data", () => {
  const pack = createTapTabDemoRecoveryPack(SOURCE, NOW);
  assert.throws(
    () => parseTapTabDemoRecoveryPack(JSON.stringify({ ...pack, version: 2 }), CONTRACT),
    /schema or version/,
  );
  assert.throws(
    () =>
      parseTapTabDemoRecoveryPack(
        JSON.stringify({ ...pack, chain: { name: "Monad Mainnet", chainId: 143 } }),
        CONTRACT,
      ),
    /not for Monad Testnet/,
  );
  assert.throws(
    () =>
      parseTapTabDemoRecoveryPack(
        JSON.stringify({
          ...pack,
          receipt: { ...pack.receipt, verification: undefined },
        }),
        CONTRACT,
      ),
    /not labelled as host-verified/,
  );
  assert.throws(
    () =>
      parseTapTabDemoRecoveryPack(
        JSON.stringify({
          ...pack,
          receipt: {
            ...pack.receipt,
            items: Array.from({ length: 5 }, (_, index) => ({
              name: `Shared row ${index + 1}`,
              pricePence: 100,
              shareCount: 32,
            })),
          },
        }),
        CONTRACT,
      ),
    /128-share contract limit/,
  );
  assert.throws(
    () => parseTapTabDemoRecoveryPack("x".repeat(256 * 1024 + 1), CONTRACT),
    /256 KB safety limit/,
  );
});

test("the application always prefers a recovered live quote over a manual fallback", async () => {
  const source = await readFile(
    new URL("../app/TapTabApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const createBillQuote = liveCreateBillQuote \?\? activeManualCreateBillQuote/,
  );
  assert.match(
    source,
    /if \(nextPrice\.state === "live"\) setManualCreateBillQuote\(undefined\)/,
  );
  assert.match(
    source,
    /manualQuote=\{activeManualCreateBillQuote\}/,
  );
});

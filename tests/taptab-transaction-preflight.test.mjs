import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateTapTabPreflightCosts,
  describeTapTabPreflightError,
  describeTapTabSubmittedError,
  describeTapTabWalletError,
} from "../app/taptab-transaction-preflight.ts";

test("calculates native-MON fee and required-balance ranges with bigint arithmetic", () => {
  assert.deepEqual(
    calculateTapTabPreflightCosts({
      estimatedGas: 21_001n,
      feePerGasWei: 2_000_000_003n,
      transactionValueWei: 3_000_000_000_000_000_000n,
      walletBalanceWei: 3_000_060_000_000_000_000n,
    }),
    {
      estimatedGas: 21_001n,
      bufferedGasLimit: 26_252n,
      feePerGasWei: 2_000_000_003n,
      transactionValueWei: 3_000_000_000_000_000_000n,
      estimatedNetworkFeeWei: 42_002_000_063_003n,
      bufferedNetworkFeeWei: 52_504_000_078_756n,
      estimatedRequiredBalanceWei: 3_000_042_002_000_063_003n,
      bufferedRequiredBalanceWei: 3_000_052_504_000_078_756n,
      walletBalanceWei: 3_000_060_000_000_000_000n,
      coversEstimatedCost: true,
      coversBufferedCost: true,
    },
  );
});

test("distinguishes the current estimate from the 25% fee buffer", () => {
  const costs = calculateTapTabPreflightCosts({
    estimatedGas: 100n,
    feePerGasWei: 2n,
    transactionValueWei: 1_000n,
    walletBalanceWei: 1_225n,
  });
  assert.equal(costs.estimatedRequiredBalanceWei, 1_200n);
  assert.equal(costs.bufferedRequiredBalanceWei, 1_250n);
  assert.equal(costs.coversEstimatedCost, true);
  assert.equal(costs.coversBufferedCost, false);

  assert.throws(
    () => calculateTapTabPreflightCosts({ estimatedGas: -1n, feePerGasWei: 1n }),
    /cannot be negative/,
  );
});

test("decodes known TapTab custom-error selectors and fails closed for unknown errors", () => {
  assert.equal(
    describeTapTabPreflightError({ cause: { data: "0x93687c0b" } }),
    "Only the bill creator can do this. Nothing was submitted.",
  );
  assert.equal(
    describeTapTabPreflightError({ errorName: "PaymentExceedsRemaining" }),
    "The payment exceeds the participant’s remaining amount. Nothing was submitted.",
  );
  assert.equal(
    describeTapTabPreflightError(null),
    "The Monad Testnet simulation was rejected. Nothing was submitted.",
  );
});

test("distinguishes wallet rejection from uncertain post-submission status", () => {
  assert.equal(
    describeTapTabWalletError({ cause: { code: 4_001 } }),
    "You rejected the wallet request. Nothing was submitted.",
  );
  assert.equal(
    describeTapTabWalletError({ code: 4_901 }),
    "The wallet is not connected to Monad Testnet. Switch network and try again. Nothing was submitted.",
  );
  assert.equal(
    describeTapTabSubmittedError(new Error("receipt polling timed out")),
    "The transaction was submitted, but TapTab could not verify its final status. Check MonadVision before trying again.",
  );
  assert.equal(
    describeTapTabSubmittedError(new Error("Monad reported a reverted transaction")),
    "Monad confirmed that the transaction reverted. No TapTab state changed.",
  );
});

test("wires double simulation, fee disclosure and bill-scoped live event watching", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );

  for (const integration of [
    "await publicClient.simulateContract(simulationInput as never)",
    "await simulateExactAction()",
    "publicClient.estimateContractGas(simulationInput as never)",
    "publicClient.estimateFeesPerGas()",
    "publicClient.getBalance({ address: account })",
    "switchTapTabWalletToMonadTestnet(provider)",
    "...(costs ? { gas: costs.bufferedGasLimit } : {})",
    "describeTapTabPreflightError(error)",
    "The wallet did not switch to Monad Testnet",
    "publicClient.watchContractEvent({",
    "address: context.address",
    "if (decoded.args.billId !== context.billId) continue",
    "pollingInterval: EVENT_WATCH_INTERVAL_MS",
    "if (sawNewBillEvent) void refresh(true)",
    "unwatch()",
    "watchedEventIds.current.has(eventId)",
  ]) {
    assert.ok(source.includes(integration), `missing live safety wiring: ${integration}`);
  }

  assert.equal(
    source.match(/await simulateExactAction\(\)/g)?.length,
    2,
    "the action must be simulated once before network interaction and again before writeContract",
  );
  assert.match(source, /status: "blocked",\s+message,\s+preflight: \{ status: "blocked", message \}/);
  assert.match(source, /estimated fee .*25% gas buffer/);
  assert.match(source, /costs\?\.coversBufferedCost === false/);
  assert.match(source, /hasPendingTransaction \? PENDING_POLL_INTERVAL_MS : POLL_INTERVAL_MS/);
});

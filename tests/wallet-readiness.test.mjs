import assert from "node:assert/strict";
import test from "node:test";

import {
  GAS_RESERVE_BUFFER_PERCENT,
  MONAD_TESTNET_CHAIN_ID,
  calculateBufferedGasLimit,
  calculateBufferedGasReserve,
  calculateRequiredWalletBalance,
  getWalletReadiness,
} from "../app/wallet-readiness.ts";

function connected(overrides = {}) {
  return {
    connected: true,
    chainId: MONAD_TESTNET_CHAIN_ID,
    balanceWei: 2_000n,
    maxDepositWei: 1_000n,
    gasUnits: 100n,
    feePerGasWei: 4n,
    ...overrides,
  };
}

test("exports the Monad Testnet target and 25% reserve policy", () => {
  assert.equal(MONAD_TESTNET_CHAIN_ID, 10_143);
  assert.equal(GAS_RESERVE_BUFFER_PERCENT, 25n);
});

test("adds a 25% buffer to gas units with an exact ceiling", () => {
  assert.equal(calculateBufferedGasLimit(0n), 0n);
  assert.equal(calculateBufferedGasLimit(1n), 2n);
  assert.equal(calculateBufferedGasLimit(3n), 4n);
  assert.equal(calculateBufferedGasLimit(21_000n), 26_250n);

  assert.equal(calculateBufferedGasReserve(0n, 99n), 0n);
  assert.equal(calculateBufferedGasReserve(1n, 1n), 2n);
  assert.equal(calculateBufferedGasReserve(3n, 1n), 4n);
  assert.equal(calculateBufferedGasReserve(1n, 4n), 8n);
  assert.equal(calculateBufferedGasReserve(21_000n, 100n), 2_625_000n);
});

test("keeps gas and required-balance arithmetic exact above Number's range", () => {
  const gasUnits = (1n << 200n) + 1n;
  const feePerGasWei = 3n;
  const bufferedGasUnits = gasUnits + (gasUnits + 3n) / 4n;
  const reserveWei = bufferedGasUnits * feePerGasWei;
  const maxDepositWei = (1n << 240n) + 9n;

  assert.equal(
    calculateBufferedGasReserve(gasUnits, feePerGasWei),
    reserveWei,
  );
  assert.equal(
    calculateRequiredWalletBalance(maxDepositWei, gasUnits, feePerGasWei),
    maxDepositWei + reserveWei,
  );
});

test("rejects negative or non-bigint monetary inputs", () => {
  assert.throws(
    () => calculateBufferedGasReserve(-1n, 1n),
    /gasUnits must not be negative/,
  );
  assert.throws(
    () => calculateBufferedGasReserve(1n, -1n),
    /feePerGasWei must not be negative/,
  );
  assert.throws(
    () => calculateRequiredWalletBalance(-1n, 1n, 1n),
    /maxDepositWei must not be negative/,
  );
  assert.throws(
    () => calculateBufferedGasReserve(21_000, 1n),
    /gasUnits must be a bigint/,
  );
});

test("reports disconnected and in-progress connections without doing fee maths", () => {
  assert.deepEqual(
    getWalletReadiness({ connected: false, maxDepositWei: 1_000n }),
    {
      status: "disconnected",
      canJoin: false,
      targetChainId: MONAD_TESTNET_CHAIN_ID,
      chainId: null,
      balanceWei: null,
      maxDepositWei: 1_000n,
      gasReserveWei: null,
      requiredBalanceWei: null,
      shortfallWei: null,
    },
  );

  assert.equal(
    getWalletReadiness({
      connected: false,
      checking: true,
      maxDepositWei: 1_000n,
    }).status,
    "checking",
  );
});

test("known wrong network takes precedence over balance, loading and availability", () => {
  const result = getWalletReadiness(
    connected({
      chainId: 1,
      balanceWei: -1n,
      gasUnits: -1n,
      checking: true,
      unavailable: true,
    }),
  );

  assert.equal(result.status, "wrong_network");
  assert.equal(result.canJoin, false);
  assert.equal(result.requiredBalanceWei, null);
  assert.equal(result.shortfallWei, null);
});

test("reports unavailable only after confirming the correct network", () => {
  const result = getWalletReadiness(
    connected({ unavailable: true, balanceWei: null }),
  );

  assert.equal(result.status, "unavailable");
  assert.equal(result.balanceWei, null);
  assert.equal(result.requiredBalanceWei, null);
});

test("reports checking while any required connected-wallet value is pending", () => {
  for (const overrides of [
    { chainId: null },
    { balanceWei: null },
    { gasUnits: null },
    { feePerGasWei: null },
    { checking: true },
  ]) {
    const result = getWalletReadiness(connected(overrides));
    assert.equal(result.status, "checking");
    assert.equal(result.canJoin, false);
    assert.equal(result.requiredBalanceWei, null);
  }
});

test("reports the exact shortfall below the required balance", () => {
  const result = getWalletReadiness(connected({ balanceWei: 1_499n }));

  assert.deepEqual(result, {
    status: "insufficient",
    canJoin: false,
    targetChainId: MONAD_TESTNET_CHAIN_ID,
    chainId: MONAD_TESTNET_CHAIN_ID,
    balanceWei: 1_499n,
    maxDepositWei: 1_000n,
    gasReserveWei: 500n,
    requiredBalanceWei: 1_500n,
    shortfallWei: 1n,
  });
});

test("the exact required-balance boundary is ready", () => {
  const result = getWalletReadiness(connected({ balanceWei: 1_500n }));

  assert.equal(result.status, "ready");
  assert.equal(result.canJoin, true);
  assert.equal(result.requiredBalanceWei, 1_500n);
  assert.equal(result.shortfallWei, 0n);
});

test("balances above the boundary remain ready with zero shortfall", () => {
  const result = getWalletReadiness(connected({ balanceWei: 9_999n }));

  assert.equal(result.status, "ready");
  assert.equal(result.canJoin, true);
  assert.equal(result.shortfallWei, 0n);
});

test("validates balance and fee inputs once the wallet can be classified", () => {
  assert.throws(
    () => getWalletReadiness(connected({ balanceWei: -1n })),
    /balanceWei must not be negative/,
  );
  assert.throws(
    () => getWalletReadiness(connected({ gasUnits: -1n })),
    /gasUnits must not be negative/,
  );
  assert.throws(
    () => getWalletReadiness(connected({ feePerGasWei: -1n })),
    /feePerGasWei must not be negative/,
  );
});

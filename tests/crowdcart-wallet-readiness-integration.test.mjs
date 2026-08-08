import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CrowdCart exposes a fail-closed wallet readiness flow", async () => {
  const source = await readFile(
    new URL("../app/CrowdCartApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Wallet readiness/);
  assert.match(source, /faucet\.monad\.xyz/);
  assert.match(source, /wallet_switchEthereumChain/);
  assert.match(source, /getChainId\(\)/);
  assert.match(source, /stateOverride/);
  assert.match(source, /estimateFeesPerGas/);
  assert.match(source, /freshReadiness\.canJoin/);
  assert.match(source, /visibilitychange/);
});

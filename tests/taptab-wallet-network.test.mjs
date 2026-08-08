import assert from "node:assert/strict";
import test from "node:test";

import {
  TAPTAB_MONAD_TESTNET_CHAIN_HEX,
  TAPTAB_MONAD_TESTNET_FAUCET_URL,
  describeTapTabNetworkSwitchError,
  parseEip155ChainId,
  readTapTabWalletChainId,
  switchTapTabWalletToMonadTestnet,
} from "../app/wallet/taptab-wallet-network.ts";

function provider(handler) {
  return { request: handler };
}

test("parses strict EIP-155 hexadecimal chain identifiers", () => {
  assert.equal(TAPTAB_MONAD_TESTNET_CHAIN_HEX, "0x279f");
  assert.equal(parseEip155ChainId("0x279f"), 10_143);
  assert.equal(parseEip155ChainId("0X279F"), undefined);
  assert.equal(parseEip155ChainId("10143"), undefined);
  assert.equal(parseEip155ChainId("0x"), undefined);
  assert.equal(parseEip155ChainId(-1), undefined);
});

test("switches and verifies Monad Testnet without submitting a transaction", async () => {
  const calls = [];
  await switchTapTabWalletToMonadTestnet(
    provider(async (request) => {
      calls.push(request);
      if (request.method === "eth_chainId") return "0x279f";
      return null;
    }),
  );

  assert.deepEqual(calls.map(({ method }) => method), [
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
  assert.equal(calls.some(({ method }) => method === "eth_sendTransaction"), false);
});

test("adds an unknown chain, switches again and verifies the result", async () => {
  const calls = [];
  let firstSwitch = true;
  await switchTapTabWalletToMonadTestnet(
    provider(async (request) => {
      calls.push(request);
      if (request.method === "wallet_switchEthereumChain" && firstSwitch) {
        firstSwitch = false;
        throw Object.assign(new Error("unknown chain"), { code: 4_902 });
      }
      if (request.method === "eth_chainId") return "0x279f";
      return null;
    }),
  );

  assert.deepEqual(calls.map(({ method }) => method), [
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
  assert.equal(calls[1].params[0].chainId, "0x279f");
});

test("preserves rejection and fails closed when post-switch verification is wrong", async () => {
  const rejection = Object.assign(new Error("user rejected"), { code: 4_001 });
  await assert.rejects(
    switchTapTabWalletToMonadTestnet(provider(async () => { throw rejection; })),
    (error) => error === rejection,
  );
  assert.match(describeTapTabNetworkSwitchError(rejection), /declined/);

  await assert.rejects(
    switchTapTabWalletToMonadTestnet(
      provider(async ({ method }) => (method === "eth_chainId" ? "0x1" : null)),
    ),
    /did not switch/,
  );
  await assert.rejects(
    readTapTabWalletChainId(provider(async () => "not-a-chain")),
    /invalid network identifier/,
  );
});

test("keeps the faucet guidance on the official Monad host", () => {
  const url = new URL(TAPTAB_MONAD_TESTNET_FAUCET_URL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "faucet.monad.xyz");
});

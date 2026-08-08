import assert from "node:assert/strict";
import test from "node:test";

import { createLivenessResponse } from "../app/api/health/live/route.ts";
import { createReadinessResponse } from "../app/api/health/ready/route.ts";
import {
  checkTapTabReadiness,
  DEFAULT_MONAD_TESTNET_RPC_URL,
  MONAD_TESTNET_CHAIN_ID,
} from "../lib/server/taptab-readiness.ts";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const PAYEE = "0x3333333333333333333333333333333333333333";

const configuredEnv = {
  NEXT_PUBLIC_TAPTAB_ADDRESS: CONTRACT,
  NEXT_PUBLIC_TAPTAB_BILL_ID: "1",
};

function validBill(overrides = {}) {
  return {
    id: 1n,
    creator: CREATOR,
    payee: PAYEE,
    createdAt: 100n,
    deadline: 200n,
    subtotal: 1n,
    ...overrides,
  };
}

function readyProbe(overrides = {}) {
  return {
    getChainId: async () => MONAD_TESTNET_CHAIN_ID,
    getBlockNumber: async () => 123n,
    getBytecode: async () => "0x6000",
    getBill: async () => validBill(),
    ...overrides,
  };
}

test("liveness is dependency-free, correlated and never cached", async () => {
  const response = createLivenessResponse({
    now: () => Date.UTC(2026, 7, 6, 9, 0, 0),
    requestId: "live-request",
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-request-id"), "live-request");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "taptab",
    checkedAt: "2026-08-06T09:00:00.000Z",
    requestId: "live-request",
  });
});

test("readiness fails closed before RPC when deployment config is absent or invalid", async () => {
  let factoryCalls = 0;
  const createProbe = () => {
    factoryCalls += 1;
    return readyProbe();
  };

  const missing = await checkTapTabReadiness({ env: {}, createProbe });
  const invalid = await checkTapTabReadiness({
    env: {
      NEXT_PUBLIC_TAPTAB_ADDRESS: "0x1234",
      NEXT_PUBLIC_TAPTAB_BILL_ID: "1",
    },
    createProbe,
  });

  assert.equal(missing.status, "not_ready");
  assert.equal(missing.reason, "configuration_missing");
  assert.equal(invalid.status, "not_ready");
  assert.equal(invalid.reason, "configuration_invalid");
  assert.equal(factoryCalls, 0);
});

test("readiness accepts only a credential-free HTTPS RPC URL", async () => {
  let factoryCalls = 0;
  const result = await checkTapTabReadiness({
    env: {
      ...configuredEnv,
      MONAD_TESTNET_RPC_URL: "http://rpc.example.test/#secret",
    },
    createProbe: () => {
      factoryCalls += 1;
      return readyProbe();
    },
  });

  assert.equal(result.status, "not_ready");
  assert.equal(result.reason, "rpc_url_invalid");
  assert.equal(result.checks.rpc, "fail");
  assert.equal(factoryCalls, 0);
});

test("readiness rejects an invalid configured fallback before probing either RPC", async () => {
  let factoryCalls = 0;
  const result = await checkTapTabReadiness({
    env: {
      ...configuredEnv,
      MONAD_TESTNET_FALLBACK_RPC_URL: "http://fallback-rpc.example.test",
    },
    createProbe: () => {
      factoryCalls += 1;
      return readyProbe();
    },
  });

  assert.equal(result.status, "not_ready");
  assert.equal(result.reason, "rpc_url_invalid");
  assert.equal(result.checks.rpc, "fail");
  assert.equal(factoryCalls, 0);
});

test("readiness defaults to the canonical Monad Testnet RPC without exposing it", async () => {
  let selectedRpcUrl;
  const result = await checkTapTabReadiness({
    env: configuredEnv,
    createProbe: (rpcUrl) => {
      selectedRpcUrl = rpcUrl;
      return readyProbe();
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(selectedRpcUrl, `${DEFAULT_MONAD_TESTNET_RPC_URL}/`);
  assert.equal(JSON.stringify(result).includes(DEFAULT_MONAD_TESTNET_RPC_URL), false);
});

test("readiness distinguishes RPC failure, timeout and the wrong network", async () => {
  const unavailable = await checkTapTabReadiness({
    env: configuredEnv,
    createProbe: () =>
      readyProbe({
        getChainId: async () => {
          throw new Error("provider unavailable");
        },
      }),
  });
  const timeout = await checkTapTabReadiness({
    env: configuredEnv,
    createProbe: () =>
      readyProbe({
        getChainId: () => new Promise(() => {}),
      }),
    timeoutMs: 5,
  });
  const wrongNetwork = await checkTapTabReadiness({
    env: configuredEnv,
    createProbe: () => readyProbe({ getChainId: async () => 143 }),
  });

  assert.equal(unavailable.status, "not_ready");
  assert.equal(unavailable.reason, "rpc_unavailable");
  assert.equal(timeout.status, "not_ready");
  assert.equal(timeout.reason, "probe_timeout");
  assert.equal(wrongNetwork.status, "not_ready");
  assert.equal(wrongNetwork.reason, "wrong_network");
  assert.deepEqual(wrongNetwork.network, { chainId: 143, blockNumber: "123" });
});

test("readiness tries the primary first and fails over after an RPC outage", async () => {
  const primaryRpcUrl = "https://primary-rpc.example.test/";
  const fallbackRpcUrl = "https://fallback-rpc.example.test/";
  const selectedRpcUrls = [];
  const result = await checkTapTabReadiness({
    env: {
      ...configuredEnv,
      MONAD_TESTNET_RPC_URL: primaryRpcUrl,
      MONAD_TESTNET_FALLBACK_RPC_URL: fallbackRpcUrl,
    },
    createProbe: (rpcUrl) => {
      selectedRpcUrls.push(rpcUrl);
      return rpcUrl === primaryRpcUrl
        ? readyProbe({
            getChainId: async () => {
              throw new Error("primary unavailable");
            },
          })
        : readyProbe();
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(selectedRpcUrls, [primaryRpcUrl, fallbackRpcUrl]);
});

test("readiness neither preflights nor contacts the fallback while the primary is healthy", async () => {
  const primaryRpcUrl = "https://primary-rpc.example.test/";
  const fallbackRpcUrl = "https://fallback-rpc.example.test/";
  const selectedRpcUrls = [];
  const result = await checkTapTabReadiness({
    env: {
      ...configuredEnv,
      MONAD_TESTNET_RPC_URL: primaryRpcUrl,
      MONAD_TESTNET_FALLBACK_RPC_URL: fallbackRpcUrl,
    },
    createProbe: (rpcUrl) => {
      selectedRpcUrls.push(rpcUrl);
      return readyProbe();
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(selectedRpcUrls, [primaryRpcUrl]);
});

test("readiness does not mask authoritative missing-contract state with the fallback", async () => {
  const primaryRpcUrl = "https://primary-rpc.example.test/";
  const selectedRpcUrls = [];
  const result = await checkTapTabReadiness({
    env: {
      ...configuredEnv,
      MONAD_TESTNET_RPC_URL: primaryRpcUrl,
      MONAD_TESTNET_FALLBACK_RPC_URL: "https://fallback-rpc.example.test/",
    },
    createProbe: (rpcUrl) => {
      selectedRpcUrls.push(rpcUrl);
      return readyProbe({ getBytecode: async () => "0x" });
    },
  });

  assert.equal(result.status, "not_ready");
  assert.equal(result.reason, "contract_not_deployed");
  assert.deepEqual(selectedRpcUrls, [primaryRpcUrl]);
});

test("readiness requires deployed bytecode before calling the configured bill", async () => {
  let billCalls = 0;
  const result = await checkTapTabReadiness({
    env: configuredEnv,
    createProbe: () =>
      readyProbe({
        getBytecode: async () => "0x",
        getBill: async () => {
          billCalls += 1;
          return validBill();
        },
      }),
  });

  assert.equal(result.status, "not_ready");
  assert.equal(result.reason, "contract_not_deployed");
  assert.equal(result.checks.contract, "fail");
  assert.equal(result.checks.bill, "skipped");
  assert.equal(billCalls, 0);
});

test("readiness rejects an unavailable or inconsistent configured bill", async () => {
  const unavailable = await checkTapTabReadiness({
    env: configuredEnv,
    createProbe: () =>
      readyProbe({
        getBill: async () => {
          throw new Error("execution reverted");
        },
      }),
  });
  const invalid = await checkTapTabReadiness({
    env: configuredEnv,
    createProbe: () => readyProbe({ getBill: async () => validBill({ id: 2n }) }),
  });

  assert.equal(unavailable.status, "not_ready");
  assert.equal(unavailable.reason, "bill_unavailable");
  assert.equal(invalid.status, "not_ready");
  assert.equal(invalid.reason, "bill_invalid");
});

test("readiness passes only after configuration, RPC, network, contract and bill checks", async () => {
  const result = await checkTapTabReadiness({
    env: configuredEnv,
    createProbe: () => readyProbe(),
  });

  assert.deepEqual(result, {
    status: "ready",
    checks: {
      configuration: "pass",
      rpc: "pass",
      network: "pass",
      contract: "pass",
      bill: "pass",
    },
    network: { chainId: MONAD_TESTNET_CHAIN_ID, blockNumber: "123" },
  });
});

test("the readiness route returns a no-store 200 with correlation metadata", async () => {
  const readyAt = Date.UTC(2026, 7, 6, 0, 0, 0);
  const times = [readyAt, readyAt + 12];
  const response = await createReadinessResponse({
    env: configuredEnv,
    createProbe: () => readyProbe(),
    now: () => times.shift(),
    requestId: "ready-request",
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), "ready-request");
  assert.equal(response.headers.get("x-taptab-readiness"), "ready");
  assert.equal(response.headers.get("retry-after"), null);

  const body = await response.json();
  assert.equal(body.status, "ready");
  assert.equal(body.service, "taptab");
  assert.equal(body.durationMs, 12);
  assert.equal(body.requestId, "ready-request");
  assert.equal(body.checkedAt, "2026-08-06T00:00:00.012Z");
  assert.equal("rpcUrl" in body, false);
});

test("the readiness route returns a retryable no-store 503 without diagnostics leakage", async () => {
  const response = await createReadinessResponse({
    env: {},
    createProbe: () => {
      throw new Error("must not run");
    },
    now: () => Date.UTC(2026, 7, 6, 0, 0, 0),
    requestId: "not-ready-request",
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "10");
  assert.equal(response.headers.get("x-taptab-readiness"), "not_ready");

  const body = await response.json();
  assert.equal(body.reason, "configuration_missing");
  assert.equal(JSON.stringify(body).includes("NEXT_PUBLIC"), false);
  assert.equal(JSON.stringify(body).includes("must not run"), false);
});

test("the production Worker serves the liveness endpoint", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("health-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/api/health/live"),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).status, "ok");
});

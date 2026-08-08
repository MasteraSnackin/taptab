import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function builtWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("pwa-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

async function serviceWorkerRuntime({ cacheStorage = {}, fetchImpl = fetch, clients } = {}) {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  const context = {
    URL,
    Request,
    Response,
    fetch: fetchImpl,
    caches: cacheStorage,
    self: {
      location: { origin: "https://taptab.example" },
      clients: clients ?? { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
    },
  };
  vm.runInNewContext(source, context);
  return { context, listeners, source };
}

function dispatchStaticAssetFetch(listeners) {
  const lifetimePromises = [];
  let responsePromise;
  listeners.get("fetch")({
    request: new Request("https://taptab.example/assets/app-AbC123xy.js"),
    respondWith(value) {
      responsePromise = Promise.resolve(value);
    },
    waitUntil(value) {
      lifetimePromises.push(Promise.resolve(value));
    },
  });
  assert.ok(responsePromise, "the static asset request must be handled");
  return { lifetimePromises, responsePromise };
}

test("serves a standalone GBP-first TapTab manifest with a safe scope", async () => {
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request("http://localhost/manifest.webmanifest"),
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
  const manifest = await response.json();
  assert.equal(manifest.name, "TapTab — shared bills without the awkwardness");
  assert.equal(manifest.short_name, "TapTab");
  assert.match(manifest.description, /shared bills in pounds/i);
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#5f4cf6");
  assert.equal(manifest.background_color, "#fffdf9");
  assert.ok(
    manifest.icons.some(
      (icon) =>
        icon.src === "/favicon.svg" &&
        icon.sizes === "any" &&
        icon.type === "image/svg+xml" &&
        icon.purpose === "any",
    ),
  );
});

test("the service worker admits only credential-free immutable static assets", async () => {
  const { context, listeners, source } = await serviceWorkerRuntime();

  const isCacheable = context.isCacheableStaticRequest;
  assert.equal(typeof isCacheable, "function");
  assert.equal(
    isCacheable(new Request("https://taptab.example/assets/app-AbC123xy.js")),
    true,
  );
  assert.equal(
    isCacheable(new Request("https://taptab.example/_next/static/chunks/app-123.js")),
    true,
  );

  for (const url of [
    "https://taptab.example/",
    "https://taptab.example/api/mon-price",
    "https://taptab.example/auth/session",
    "https://taptab.example/wallet/connect",
    "https://taptab.example/rpc/10143",
    "https://taptab.example/contracts/0x123",
    "https://taptab.example/transactions/0xabc",
    "https://testnet-rpc.monad.xyz/assets/app-AbC123xy.js",
  ]) {
    assert.equal(isCacheable(new Request(url)), false, `must not cache ${url}`);
  }

  assert.equal(
    isCacheable(
      new Request("https://taptab.example/assets/app-AbC123xy.js", {
        headers: { authorization: "Bearer private" },
      }),
    ),
    false,
  );
  assert.equal(
    isCacheable(
      new Request("https://taptab.example/assets/app-AbC123xy.js", {
        method: "POST",
      }),
    ),
    false,
  );

  assert.deepEqual([...listeners.keys()].sort(), ["activate", "fetch", "install"]);
  assert.ok(source.includes('const CACHE_NAME = `${CACHE_PREFIX}v2`;'));
  assert.match(source, /credentials:\s*"omit"/);
  assert.doesNotMatch(source, /cache\.addAll|caches\.match\(event\.request/);
});

test("cache failures fall back to a successful static network response", async () => {
  const scenarios = [
    {
      name: "cache open",
      cacheStorage: {
        async open() {
          throw new Error("cache storage unavailable");
        },
      },
    },
    {
      name: "cache read",
      cacheStorage: {
        async open() {
          return {
            async match() {
              throw new Error("cache read failed");
            },
            async put() {},
          };
        },
      },
    },
    {
      name: "cache write",
      cacheStorage: {
        async open() {
          return {
            async match() {
              return undefined;
            },
            async put() {
              throw new Error("cache write failed");
            },
          };
        },
      },
    },
  ];

  for (const scenario of scenarios) {
    let networkCalls = 0;
    const { listeners } = await serviceWorkerRuntime({
      cacheStorage: scenario.cacheStorage,
      fetchImpl: async () => {
        networkCalls += 1;
        return new Response(`network after ${scenario.name}`, {
          headers: { "cache-control": "public, max-age=31536000" },
        });
      },
    });
    const { lifetimePromises, responsePromise } = dispatchStaticAssetFetch(listeners);

    const response = await responsePromise;
    assert.equal(response.status, 200, scenario.name);
    assert.equal(await response.text(), `network after ${scenario.name}`, scenario.name);
    assert.equal(networkCalls, 1, scenario.name);
    await Promise.all(lifetimePromises);
  }
});

test("activation deletes obsolete TapTab cache generations only", async () => {
  const deleted = [];
  let claims = 0;
  const { listeners } = await serviceWorkerRuntime({
    cacheStorage: {
      async keys() {
        return ["taptab-static-v0", "taptab-static-v1", "taptab-static-v2", "other-app-v1"];
      },
      async delete(cacheName) {
        deleted.push(cacheName);
        return true;
      },
    },
    clients: {
      async claim() {
        claims += 1;
      },
    },
  });
  let activationPromise;
  listeners.get("activate")({
    waitUntil(value) {
      activationPromise = Promise.resolve(value);
    },
  });

  await activationPromise;
  assert.deepEqual(deleted, ["taptab-static-v0", "taptab-static-v1"]);
  assert.equal(claims, 1);
});

test("the bridge reports browser events honestly and keeps share fallback reusable", async () => {
  const [bridge, layout, app] = await Promise.all([
    readFile(new URL("../app/TapTabPwaBridge.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(bridge, /process\.env\.NODE_ENV !== "production" \|\| !window\.isSecureContext/);
  assert.match(bridge, /register\("\/sw\.js", \{ scope: "\/", updateViaCache: "none" \}\)/);
  assert.match(bridge, /beforeinstallprompt/);
  assert.match(bridge, /event\.preventDefault\(\)/);
  assert.match(bridge, /appinstalled/);
  assert.match(bridge, /setInstallStatus\("installed"\)/);
  assert.match(bridge, /await navigator\.share\(data\)/);
  assert.match(bridge, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(bridge, /error\.name === "AbortError"/);
  assert.match(bridge, /export function useTapTabPwa\(\)/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /<html lang="en-GB">/);
  assert.match(layout, /<TapTabPwaBridge>\{children\}<\/TapTabPwaBridge>/);
  assert.match(app, /useTapTabPwa\(\)/);
  assert.match(
    app,
    /const liveShareUrl = workspaceMode === "live" \? liveUpdate\.shareUrl : ""/,
  );
  assert.match(
    app,
    /const url = liveShareUrl \|\| buildCanonicalPreviewUrl\(window\.location\.origin\)/,
  );
  assert.match(app, /setCopyRecoveryUrl\(url\)/);
  assert.match(app, /Share the current non-personalised bill link/);
  assert.match(app, /canPromptInstall \? \(/);
  assert.match(app, /Install TapTab/);
});

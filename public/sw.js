/* global self, caches */

const CACHE_PREFIX = "taptab-static-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const IMMUTABLE_ASSET_PATTERNS = [
  /^\/assets\/.+-[A-Za-z0-9_-]{6,}\.(?:css|js|mjs|woff2?|png|jpg|jpeg|webp|avif)$/,
  /^\/_next\/static\//,
];
const NEVER_CACHE_PATH_PREFIXES = [
  "/api/",
  "/auth/",
  "/wallet/",
  "/rpc/",
  "/contracts/",
  "/transactions/",
];

function isCacheableStaticRequest(request) {
  if (request.method !== "GET" || request.cache === "no-store") return false;
  if (request.headers.has("authorization")) return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (NEVER_CACHE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return false;
  }

  return IMMUTABLE_ASSET_PATTERNS.some((pattern) => pattern.test(url.pathname));
}

function isCacheableStaticResponse(response) {
  if (!response.ok || response.type === "opaque") return false;
  if (response.headers.has("set-cookie")) return false;

  const cacheControl = response.headers.get("cache-control") ?? "";
  return !/(?:^|,)\s*(?:private|no-store|no-cache)(?:\s|,|=|$)/i.test(cacheControl);
}

function publicAssetRequest(request) {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-cache",
    redirect: "follow",
    mode: "same-origin",
  });
}

async function readCachedResponse(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

async function cacheResponseBestEffort(request, response) {
  try {
    const responseForCache = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, responseForCache);
  } catch {
    // A usable network response must not depend on cache availability.
  }
}

async function deleteCacheBestEffort(cacheName) {
  try {
    await caches.delete(cacheName);
  } catch {
    // A failed deletion can be retried on the next activation.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      let keys = [];
      try {
        keys = await caches.keys();
      } catch {
        // Cache cleanup is best-effort and must not prevent activation.
      }

      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => deleteCacheBestEffort(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isCacheableStaticRequest(event.request)) return;

  event.respondWith(
    (async () => {
      const safeRequest = publicAssetRequest(event.request);
      const cached = await readCachedResponse(safeRequest);
      if (cached) return cached;

      const response = await fetch(safeRequest);
      if (isCacheableStaticResponse(response)) {
        event.waitUntil(cacheResponseBestEffort(safeRequest, response));
      }
      return response;
    })(),
  );
});

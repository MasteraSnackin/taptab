import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TAPTAB_LOCAL_SITE_ORIGIN,
  resolveTapTabMetadataOrigin,
} from "../app/taptab-site-origin.ts";

test("uses only an explicitly configured public HTTPS origin for metadata", () => {
  assert.equal(
    resolveTapTabMetadataOrigin(" https://taptab.example/table?source=demo "),
    "https://taptab.example",
  );
  assert.equal(resolveTapTabMetadataOrigin(undefined), TAPTAB_LOCAL_SITE_ORIGIN);

  for (const value of [
    "http://taptab.example",
    "https://user:secret@taptab.example",
    "javascript:alert(1)",
    "not a URL",
  ]) {
    assert.equal(resolveTapTabMetadataOrigin(value), TAPTAB_LOCAL_SITE_ORIGIN, value);
  }
});

test("does not derive public metadata from untrusted request headers", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /resolveTapTabMetadataOrigin\(process\.env\.NEXT_PUBLIC_SITE_URL\)/);
  assert.doesNotMatch(layout, /x-forwarded-host|x-forwarded-proto|headers\(\)/);
});

test("ships unconfigured address and bill pairs in both environment templates", async () => {
  const [applicationTemplate, contractTemplate] = await Promise.all([
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../contracts/.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(
    applicationTemplate,
    /^NEXT_PUBLIC_TAPTAB_ADDRESS=\nNEXT_PUBLIC_TAPTAB_BILL_ID=$/m,
  );
  assert.match(
    contractTemplate,
    /^TAPTAB_CONTRACT_ADDRESS=\nTAPTAB_BILL_ID=$/m,
  );
});

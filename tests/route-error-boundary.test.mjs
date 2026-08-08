import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const errorBoundaryUrl = new URL("../app/error.tsx", import.meta.url);
const globalStylesUrl = new URL("../app/globals.css", import.meta.url);

test("offers an accessible route-level recovery path", async () => {
  const source = await readFile(errorBoundaryUrl, "utf8");

  assert.match(source, /^"use client";/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-labelledby="route-error-title"/);
  assert.match(source, /onClick=\{reset\}/);
  assert.match(source, />\s*Retry\s*</);
  assert.match(source, /href="\/#bill"/);
  assert.match(source, /Open sample mode/);
  assert.match(source, /submitted transaction/i);
  assert.match(source, /MonadVision/);
  assert.match(source, /your wallet/i);
});

test("keeps diagnostics concise and error details out of the page", async () => {
  const source = await readFile(errorBoundaryUrl, "utf8");

  assert.match(source, /console\.error\("\[TapTab\] Route error", \{/);
  assert.match(source, /message: error\.message/);
  assert.match(source, /digest: error\.digest/);
  assert.doesNotMatch(source, /error\.stack|console\.error\([^\n]*,\s*error\s*\)/);
  assert.doesNotMatch(source, /\{error\.message\}|dangerouslySetInnerHTML/);
});

test("styles the recovery card for visible focus and compact screens", async () => {
  const styles = await readFile(globalStylesUrl, "utf8");

  assert.match(styles, /\.route-error-shell\s*\{/);
  assert.match(styles, /\.route-error-card\s*\{/);
  assert.match(styles, /\.route-error-card :is\(a, button\):focus-visible/);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*\.route-error-actions/);
});

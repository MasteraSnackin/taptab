import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_RECEIPT_IMAGE_BYTES,
  inspectReceiptImage,
  inspectReceiptImageBytes,
} from "../app/receipt-image-safety.ts";

function png(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(width, height) {
  const bytes = new Uint8Array(15);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  bytes.set([0x01, 0x01, 0x11, 0x00], 11);
  return bytes;
}

function webpExtended(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([..."RIFF"].map((character) => character.charCodeAt(0)), 0);
  new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set([..."WEBPVP8X"].map((character) => character.charCodeAt(0)), 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes.set(
    [
      widthMinusOne & 0xff,
      (widthMinusOne >> 8) & 0xff,
      (widthMinusOne >> 16) & 0xff,
    ],
    24,
  );
  bytes.set(
    [
      heightMinusOne & 0xff,
      (heightMinusOne >> 8) & 0xff,
      (heightMinusOne >> 16) & 0xff,
    ],
    27,
  );
  return bytes;
}

function webpLossless(width, height) {
  const bytes = new Uint8Array(26);
  bytes.set([..."RIFF"].map((character) => character.charCodeAt(0)), 0);
  new DataView(bytes.buffer).setUint32(4, 18, true);
  bytes.set([..."WEBPVP8L"].map((character) => character.charCodeAt(0)), 8);
  new DataView(bytes.buffer).setUint32(16, 5, true);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes[20] = 0x2f;
  bytes[21] = widthMinusOne & 0xff;
  bytes[22] = ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6);
  bytes[23] = (heightMinusOne >> 2) & 0xff;
  bytes[24] = (heightMinusOne >> 10) & 0x0f;
  return bytes;
}

test("reads bounded dimensions from PNG and JPEG headers", () => {
  assert.deepEqual(inspectReceiptImageBytes(png(1_200, 2_400), "image/png"), {
    mediaType: "image/png",
    width: 1_200,
    height: 2_400,
    pixels: 2_880_000,
  });
  assert.deepEqual(inspectReceiptImageBytes(jpeg(1_080, 1_920), "image/jpeg"), {
    mediaType: "image/jpeg",
    width: 1_080,
    height: 1_920,
    pixels: 2_073_600,
  });
});

test("reads extended and lossless WebP dimensions", () => {
  assert.deepEqual(inspectReceiptImageBytes(webpExtended(900, 1_600), "image/webp"), {
    mediaType: "image/webp",
    width: 900,
    height: 1_600,
    pixels: 1_440_000,
  });
  assert.deepEqual(inspectReceiptImageBytes(webpLossless(640, 1_280), "image/webp"), {
    mediaType: "image/webp",
    width: 640,
    height: 1_280,
    pixels: 819_200,
  });
});

test("rejects MIME spoofing, malformed headers and decompression-sized images", () => {
  assert.throws(
    () => inspectReceiptImageBytes(png(100, 100), "image/jpeg"),
    /do not match its advertised image type/,
  );
  assert.throws(
    () => inspectReceiptImageBytes(new Uint8Array([0xff, 0xd8]), "image/jpeg"),
    /header could not be read safely/,
  );
  assert.throws(
    () => inspectReceiptImageBytes(png(8_193, 1), "image/png"),
    /too large to scan safely/,
  );
  assert.throws(
    () => inspectReceiptImageBytes(png(6_000, 5_000), "image/png"),
    /too large to scan safely/,
  );
});

test("checks Blob media type and byte size before reading its header", async () => {
  const valid = new Blob([png(320, 640)], { type: "image/png" });
  assert.equal((await inspectReceiptImage(valid)).pixels, 204_800);

  await assert.rejects(
    inspectReceiptImage(new Blob([png(1, 1)], { type: "text/plain" })),
    /Use a JPEG, PNG or WebP/,
  );
  const oversized = {
    type: "image/png",
    size: MAX_RECEIPT_IMAGE_BYTES + 1,
    arrayBuffer() {
      throw new Error("must not read an oversized file");
    },
  };
  await assert.rejects(inspectReceiptImage(oversized), /smaller than 8 MB/);
});

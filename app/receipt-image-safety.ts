export const MAX_RECEIPT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_RECEIPT_IMAGE_DIMENSION = 8_192;
export const MAX_RECEIPT_IMAGE_PIXELS = 24_000_000;

export const ACCEPTED_RECEIPT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type ReceiptImageInspection = Readonly<{
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  pixels: number;
}>;

const HEADER_ERROR =
  "The receipt image header could not be read safely. Export it as a fresh JPEG, PNG or WebP.";

function bytesEqual(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1_00_00_00 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x1_00_00 +
    bytes[offset + 3] * 0x1_00_00_00
  );
}

function inspectPng(bytes: Uint8Array): Readonly<{ width: number; height: number }> {
  if (
    bytes.length < 33 ||
    !bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    readUint32BigEndian(bytes, 8) !== 13 ||
    ascii(bytes, 12, 4) !== "IHDR"
  ) {
    throw new Error(HEADER_ERROR);
  }
  return {
    width: readUint32BigEndian(bytes, 16),
    height: readUint32BigEndian(bytes, 20),
  };
}

const JPEG_DIMENSION_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

function inspectJpeg(bytes: Uint8Array): Readonly<{ width: number; height: number }> {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(HEADER_ERROR);
  }

  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue;
    }
    if (offset + 2 > bytes.length) break;

    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (JPEG_DIMENSION_MARKERS.has(marker)) {
      if (segmentLength < 11) break;
      const componentCount = bytes[offset + 7];
      if (componentCount <= 0 || segmentLength !== 8 + 3 * componentCount) break;
      return {
        height: readUint16BigEndian(bytes, offset + 3),
        width: readUint16BigEndian(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }

  throw new Error(HEADER_ERROR);
}

function inspectWebp(bytes: Uint8Array): Readonly<{ width: number; height: number }> {
  if (
    bytes.length < 20 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) {
    throw new Error(HEADER_ERROR);
  }

  const declaredSize = readUint32LittleEndian(bytes, 4) + 8;
  if (declaredSize < 20 || declaredSize !== bytes.length) {
    throw new Error(HEADER_ERROR);
  }

  let offset = 12;
  while (offset + 8 <= declaredSize) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = readUint32LittleEndian(bytes, offset + 4);
    const payloadOffset = offset + 8;
    const payloadEnd = payloadOffset + chunkSize;
    if (payloadEnd > declaredSize || payloadEnd < payloadOffset) break;

    if (chunkType === "VP8X" && chunkSize >= 10) {
      return {
        width: readUint24LittleEndian(bytes, payloadOffset + 4) + 1,
        height: readUint24LittleEndian(bytes, payloadOffset + 7) + 1,
      };
    }
    if (
      chunkType === "VP8L" &&
      chunkSize >= 5 &&
      bytes[payloadOffset] === 0x2f
    ) {
      const byte1 = bytes[payloadOffset + 1];
      const byte2 = bytes[payloadOffset + 2];
      const byte3 = bytes[payloadOffset + 3];
      const byte4 = bytes[payloadOffset + 4];
      if ((byte4 & 0xe0) !== 0) throw new Error(HEADER_ERROR);
      return {
        width: 1 + (byte1 | ((byte2 & 0x3f) << 8)),
        height: 1 + ((byte2 >> 6) | (byte3 << 2) | ((byte4 & 0x0f) << 10)),
      };
    }
    if (
      chunkType === "VP8 " &&
      chunkSize >= 10 &&
      bytesEqual(bytes, payloadOffset + 3, [0x9d, 0x01, 0x2a])
    ) {
      return {
        width: readUint16LittleEndian(bytes, payloadOffset + 6) & 0x3fff,
        height: readUint16LittleEndian(bytes, payloadOffset + 8) & 0x3fff,
      };
    }

    offset = payloadEnd + (chunkSize % 2);
  }

  throw new Error(HEADER_ERROR);
}

function detectedMediaType(
  bytes: Uint8Array,
): ReceiptImageInspection["mediaType"] | undefined {
  if (bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

export function inspectReceiptImageBytes(
  bytes: Uint8Array,
  declaredMediaType: string,
): ReceiptImageInspection {
  const mediaType = detectedMediaType(bytes);
  if (!mediaType) throw new Error(HEADER_ERROR);
  if (mediaType !== declaredMediaType) {
    throw new Error(
      "The file contents do not match its advertised image type. Export it as a fresh JPEG, PNG or WebP.",
    );
  }

  const dimensions =
    mediaType === "image/png"
      ? inspectPng(bytes)
      : mediaType === "image/jpeg"
        ? inspectJpeg(bytes)
        : inspectWebp(bytes);
  const { width, height } = dimensions;
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(HEADER_ERROR);
  }
  if (
    width > MAX_RECEIPT_IMAGE_DIMENSION ||
    height > MAX_RECEIPT_IMAGE_DIMENSION ||
    !Number.isSafeInteger(pixels) ||
    pixels > MAX_RECEIPT_IMAGE_PIXELS
  ) {
    throw new Error(
      `The receipt image is too large to scan safely. Use an image no wider or taller than ${MAX_RECEIPT_IMAGE_DIMENSION.toLocaleString("en-GB")} pixels and below ${MAX_RECEIPT_IMAGE_PIXELS.toLocaleString("en-GB")} total pixels.`,
    );
  }

  return { mediaType, width, height, pixels };
}

export async function inspectReceiptImage(
  file: Blob & Readonly<{ type: string; size: number }>,
): Promise<ReceiptImageInspection> {
  if (!ACCEPTED_RECEIPT_IMAGE_TYPES.has(file.type)) {
    throw new Error("Use a JPEG, PNG or WebP receipt image.");
  }
  if (file.size <= 0 || file.size > MAX_RECEIPT_IMAGE_BYTES) {
    throw new Error("The receipt image must be smaller than 8 MB.");
  }
  return inspectReceiptImageBytes(new Uint8Array(await file.arrayBuffer()), file.type);
}

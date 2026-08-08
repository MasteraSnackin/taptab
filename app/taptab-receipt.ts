/** Pure helpers for turning untrusted UK receipt OCR into an editable draft. */

export const MAX_RECEIPT_OCR_CHARACTERS = 50_000;
export const MAX_RECEIPT_OCR_LINES = 500;
export const MAX_RECEIPT_PENCE = 1_000_000_000;

export type ReceiptWarningCode =
  | "unsafe_characters_removed"
  | "line_too_long"
  | "duplicate_line"
  | "amount_unreadable"
  | "service_amount_missing"
  | "service_rate_unreadable"
  | "conflicting_subtotal"
  | "conflicting_total"
  | "conflicting_service"
  | "merchant_missing"
  | "items_missing"
  | "subtotal_missing"
  | "total_missing"
  | "discount_exceeds_items"
  | "subtotal_mismatch"
  | "total_mismatch";

export type ReceiptWarning = Readonly<{
  code: ReceiptWarningCode;
  message: string;
  lineNumber?: number;
  rawLine?: string;
}>;

export type ParsedReceiptItem = Readonly<{
  id: string;
  name: string;
  pricePence: number;
  sourceLine: number;
}>;

export type ParsedReceiptDiscount = Readonly<{
  id: string;
  label: string;
  amountPence: number;
  sourceLine: number;
}>;

export type ParsedUkReceipt = Readonly<{
  currency: "GBP";
  merchant?: string;
  merchantSourceLine?: number;
  items: readonly ParsedReceiptItem[];
  discounts: readonly ParsedReceiptDiscount[];
  serviceChargePence?: number;
  serviceRateBps?: number;
  subtotalPence?: number;
  totalPence?: number;
  itemTotalPence: number;
  discountTotalPence: number;
  calculatedTotalPence?: number;
  warnings: readonly ReceiptWarning[];
}>;

type CapturedAmount = {
  value?: number;
  conflicted: boolean;
};

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const TRAILING_AMOUNT =
  /(?<![\d,.])(\(?\s*(?:[-+−]\s*)?(?:(?:£|GBP)\s*)?(?:[-+−]\s*)?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*-?\s*\)?)\s*$/i;
const SUBTOTAL_LINE = /^sub[\s-]*total\b/i;
const SERVICE_LINE = /^(?:(?:discretionary|optional)\s+)?service(?:\s+charge)?\b|^svc\b/i;
const DISCOUNT_LINE = /\b(?:discount|voucher|promo(?:tion)?|saving|offer)\b/i;
const TOTAL_LINE = /^(?:(?:grand|amount)\s+)?total(?:\s+(?:to\s+pay|due))?\b|^(?:amount|balance)\s+due\b/i;

function frozenWarning(
  code: ReceiptWarningCode,
  message: string,
  lineNumber?: number,
  rawLine?: string,
): ReceiptWarning {
  return Object.freeze({
    code,
    message,
    ...(lineNumber === undefined ? {} : { lineNumber }),
    ...(rawLine === undefined ? {} : { rawLine }),
  });
}

/**
 * Parses a complete GBP decimal token without floating point arithmetic.
 * Parentheses, a leading/trailing minus and £/GBP markers are supported.
 */
export function parseGbpAmountToPence(value: string): number | undefined {
  if (typeof value !== "string") return undefined;
  let text = value
    .normalize("NFKC")
    .replaceAll("−", "-")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!text || text.length > 40) return undefined;

  let negative = false;
  const hasOpeningParenthesis = text.startsWith("(");
  const hasClosingParenthesis = text.endsWith(")");
  if (hasOpeningParenthesis !== hasClosingParenthesis) return undefined;
  if (hasOpeningParenthesis) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text.replace(/\s+/g, "");
  if (text.endsWith("-")) {
    if (negative) return undefined;
    negative = true;
    text = text.slice(0, -1);
  }

  const match = /^([+-])?(?:(?:£|GBP)([+-])?)?([^.]*)?(?:\.(\d+))?$/i.exec(text);
  if (!match) return undefined;
  const signs = [match[1], match[2]].filter(Boolean);
  if (signs.length > 1 || (negative && signs.length > 0)) return undefined;
  if (signs[0] === "-") negative = true;

  const poundsText = match[3] ?? "";
  const fraction = match[4];
  if (!poundsText || (fraction !== undefined && !/^\d{1,2}$/.test(fraction))) {
    return undefined;
  }
  if (poundsText.includes(",")) {
    if (!/^\d{1,3}(?:,\d{3})+$/.test(poundsText)) return undefined;
  } else if (!/^\d+$/.test(poundsText)) {
    return undefined;
  }

  const pounds = BigInt(poundsText.replaceAll(",", ""));
  const pennies = BigInt((fraction ?? "").padEnd(2, "0") || "0");
  const absolute = pounds * BigInt(100) + pennies;
  if (absolute > BigInt(MAX_RECEIPT_PENCE)) return undefined;
  const amount = Number(absolute);
  return negative && amount !== 0 ? -amount : amount;
}

function trailingAmount(line: string):
  | Readonly<{ label: string; token: string; amountPence?: number }>
  | undefined {
  const match = TRAILING_AMOUNT.exec(line);
  if (!match || match.index === undefined) return undefined;
  const token = match[1].trim();
  return {
    label: line.slice(0, match.index).trim(),
    token,
    amountPence: parseGbpAmountToPence(token),
  };
}

function cleanLabel(value: string): string {
  return value
    .replace(/[.·•]{2,}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

function parsePercentToBps(line: string): number | undefined {
  const match = /\b(\d{1,3})(?:\.(\d{1,2}))?\s*%/.exec(line);
  if (!match) return undefined;
  const basisPoints =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return basisPoints <= 10_000 ? basisPoints : undefined;
}

function looksLikeMerchant(line: string): boolean {
  if (line.length > 100 || !/[\p{L}]/u.test(line)) return false;
  if (
    /^(?:welcome|thank\s+you|receipt|tax\s+invoice|order|table|server|date|time|tel|phone|vat|www\.|https?:)/i.test(
      line,
    )
  ) {
    return false;
  }
  if (/^\d+\s/.test(line)) return false;
  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(line)) return false;
  if (/\b\d{1,2}[/:.-]\d{1,2}(?:[/:.-]\d{2,4})?\b/.test(line)) return false;
  return trailingAmount(line) === undefined;
}

function hasAmountLikeSuffix(line: string): boolean {
  return /(?:£|GBP|\d[.,]\d{2,})\s*[-)]?\s*$/i.test(line);
}

function captureAmount(
  state: CapturedAmount,
  value: number,
  warningCode: Extract<
    ReceiptWarningCode,
    "conflicting_subtotal" | "conflicting_total" | "conflicting_service"
  >,
  label: string,
  lineNumber: number,
  rawLine: string,
  warnings: ReceiptWarning[],
): void {
  if (state.conflicted) return;
  if (state.value === undefined) {
    state.value = value;
    return;
  }
  if (state.value !== value) {
    state.value = undefined;
    state.conflicted = true;
    warnings.push(
      frozenWarning(
        warningCode,
        `Conflicting ${label} values were found; no ${label} was selected.`,
        lineNumber,
        rawLine,
      ),
    );
  }
}

export function parseUkReceiptOcr(ocrText: string): ParsedUkReceipt {
  if (typeof ocrText !== "string") throw new TypeError("Receipt OCR text must be a string.");
  if (ocrText.length > MAX_RECEIPT_OCR_CHARACTERS) {
    throw new RangeError(
      `Receipt OCR text exceeds ${MAX_RECEIPT_OCR_CHARACTERS} characters.`,
    );
  }

  const rawLines = ocrText.replace(/\r\n?/g, "\n").split("\n");
  if (rawLines.length > MAX_RECEIPT_OCR_LINES) {
    throw new RangeError(`Receipt OCR text exceeds ${MAX_RECEIPT_OCR_LINES} lines.`);
  }

  const warnings: ReceiptWarning[] = [];
  const items: ParsedReceiptItem[] = [];
  const discounts: ParsedReceiptDiscount[] = [];
  const seenLines = new Map<string, number>();
  const subtotal: CapturedAmount = { conflicted: false };
  const total: CapturedAmount = { conflicted: false };
  const service: CapturedAmount = { conflicted: false };
  let merchant: string | undefined;
  let merchantSourceLine: number | undefined;
  let serviceRateBps: number | undefined;
  let serviceRateConflicted = false;
  let sawServiceLine = false;

  for (const [index, originalLine] of rawLines.entries()) {
    const lineNumber = index + 1;
    if (!originalLine.trim()) continue;
    if (originalLine.length > 300) {
      warnings.push(
        frozenWarning(
          "line_too_long",
          "An unusually long OCR line was ignored.",
          lineNumber,
        ),
      );
      continue;
    }

    const hadControls = CONTROL_CHARACTERS.test(originalLine);
    CONTROL_CHARACTERS.lastIndex = 0;
    const line = originalLine
      .replace(CONTROL_CHARACTERS, " ")
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFC");
    if (!line) continue;
    if (hadControls) {
      warnings.push(
        frozenWarning(
          "unsafe_characters_removed",
          "Control characters were removed from this OCR line.",
          lineNumber,
          line,
        ),
      );
    }

    const duplicateKey = line.toLocaleLowerCase("en-GB");
    const firstSeen = seenLines.get(duplicateKey);
    if (firstSeen !== undefined) {
      warnings.push(
        frozenWarning(
          "duplicate_line",
          `This line duplicates line ${firstSeen}; it was retained for review.`,
          lineNumber,
          line,
        ),
      );
    } else {
      seenLines.set(duplicateKey, lineNumber);
    }

    const extracted = trailingAmount(line);
    const summaryAmount = extracted?.amountPence;

    if (SUBTOTAL_LINE.test(line)) {
      if (summaryAmount === undefined || summaryAmount < 0) {
        warnings.push(
          frozenWarning(
            "amount_unreadable",
            "The subtotal amount could not be read safely.",
            lineNumber,
            line,
          ),
        );
      } else {
        captureAmount(
          subtotal,
          summaryAmount,
          "conflicting_subtotal",
          "subtotal",
          lineNumber,
          line,
          warnings,
        );
      }
      continue;
    }

    if (SERVICE_LINE.test(line)) {
      sawServiceLine = true;
      const rate = parsePercentToBps(line);
      if (line.includes("%") && rate === undefined) {
        warnings.push(
          frozenWarning(
            "service_rate_unreadable",
            "The service percentage could not be read safely.",
            lineNumber,
            line,
          ),
        );
      } else if (rate !== undefined && !serviceRateConflicted) {
        if (serviceRateBps !== undefined && serviceRateBps !== rate) {
          warnings.push(
            frozenWarning(
              "conflicting_service",
              "Conflicting service percentages were found.",
              lineNumber,
              line,
            ),
          );
          serviceRateBps = undefined;
          serviceRateConflicted = true;
        } else {
          serviceRateBps = rate;
        }
      }

      if (summaryAmount === undefined || summaryAmount < 0) {
        warnings.push(
          frozenWarning(
            "service_amount_missing",
            "A service line was found without a safe amount; no service amount was calculated.",
            lineNumber,
            line,
          ),
        );
      } else {
        captureAmount(
          service,
          summaryAmount,
          "conflicting_service",
          "service charge",
          lineNumber,
          line,
          warnings,
        );
      }
      continue;
    }

    if (DISCOUNT_LINE.test(line)) {
      if (summaryAmount === undefined || summaryAmount === 0) {
        warnings.push(
          frozenWarning(
            "amount_unreadable",
            "The discount amount could not be read safely.",
            lineNumber,
            line,
          ),
        );
      } else {
        const label = cleanLabel(extracted?.label ?? line);
        discounts.push(
          Object.freeze({
            id: `discount-${lineNumber}`,
            label,
            amountPence: Math.abs(summaryAmount),
            sourceLine: lineNumber,
          }),
        );
      }
      continue;
    }

    if (TOTAL_LINE.test(line)) {
      if (summaryAmount === undefined || summaryAmount < 0) {
        warnings.push(
          frozenWarning(
            "amount_unreadable",
            "The total amount could not be read safely.",
            lineNumber,
            line,
          ),
        );
      } else {
        captureAmount(
          total,
          summaryAmount,
          "conflicting_total",
          "total",
          lineNumber,
          line,
          warnings,
        );
      }
      continue;
    }

    if (extracted && /(?:£|GBP|\.\d+)/i.test(extracted.token)) {
      const name = cleanLabel(extracted.label);
      if (
        extracted.amountPence !== undefined &&
        extracted.amountPence > 0 &&
        name &&
        name.length <= 120 &&
        /[\p{L}]/u.test(name) &&
        !/^(?:cash|card|visa|mastercard|amex|change|balance|vat)\b/i.test(name)
      ) {
        items.push(
          Object.freeze({
            id: `item-${lineNumber}`,
            name,
            pricePence: extracted.amountPence,
            sourceLine: lineNumber,
          }),
        );
      } else {
        warnings.push(
          frozenWarning(
            "amount_unreadable",
            "A price-like line was not safe enough to add as an item.",
            lineNumber,
            line,
          ),
        );
      }
      continue;
    }

    if (hasAmountLikeSuffix(line)) {
      warnings.push(
        frozenWarning(
          "amount_unreadable",
          "A possible amount could not be parsed as pounds and pence.",
          lineNumber,
          line,
        ),
      );
    } else if (!merchant && looksLikeMerchant(line)) {
      merchant = line;
      merchantSourceLine = lineNumber;
    }
  }

  const itemTotalPence = items.reduce((sum, item) => sum + item.pricePence, 0);
  const discountTotalPence = discounts.reduce(
    (sum, discount) => sum + discount.amountPence,
    0,
  );
  const discountedItemsPence = itemTotalPence - discountTotalPence;
  let calculatedTotalPence: number | undefined;
  if (discountedItemsPence < 0) {
    warnings.push(
      frozenWarning(
        "discount_exceeds_items",
        "Captured discounts exceed captured item prices; no calculated total was produced.",
      ),
    );
  } else if (!sawServiceLine || service.value !== undefined) {
    calculatedTotalPence = discountedItemsPence + (service.value ?? 0);
  }

  if (!merchant) {
    warnings.push(
      frozenWarning("merchant_missing", "No merchant name was selected from the OCR text."),
    );
  }
  if (items.length === 0) {
    warnings.push(
      frozenWarning("items_missing", "No safe receipt items were found."),
    );
  }
  if (subtotal.value === undefined) {
    warnings.push(
      frozenWarning("subtotal_missing", "No unambiguous printed subtotal was found."),
    );
  } else if (
    items.length > 0 &&
    subtotal.value !== itemTotalPence &&
    subtotal.value !== discountedItemsPence
  ) {
    warnings.push(
      frozenWarning(
        "subtotal_mismatch",
        "The printed subtotal does not match the captured item lines or discounted item lines.",
      ),
    );
  }
  if (total.value === undefined) {
    warnings.push(
      frozenWarning("total_missing", "No unambiguous printed total was found."),
    );
  } else if (
    calculatedTotalPence !== undefined &&
    items.length > 0 &&
    total.value !== calculatedTotalPence
  ) {
    warnings.push(
      frozenWarning(
        "total_mismatch",
        "The printed total does not match the safely captured items, discounts and service.",
      ),
    );
  }

  return Object.freeze({
    currency: "GBP",
    ...(merchant === undefined ? {} : { merchant }),
    ...(merchantSourceLine === undefined ? {} : { merchantSourceLine }),
    items: Object.freeze(items),
    discounts: Object.freeze(discounts),
    ...(service.value === undefined ? {} : { serviceChargePence: service.value }),
    ...(serviceRateBps === undefined ? {} : { serviceRateBps }),
    ...(subtotal.value === undefined ? {} : { subtotalPence: subtotal.value }),
    ...(total.value === undefined ? {} : { totalPence: total.value }),
    itemTotalPence,
    discountTotalPence,
    ...(calculatedTotalPence === undefined ? {} : { calculatedTotalPence }),
    warnings: Object.freeze(warnings),
  });
}

export type VersionedReceiptItem = Readonly<{
  id: string;
  name: string;
  pricePence: number;
  shareSlots: number;
}>;

export type VersionedReceiptDiscount = Readonly<{
  id: string;
  label: string;
  amountPence: number;
}>;

export type ReceiptSplitVersionInput = Readonly<{
  receipt: Readonly<{
    currency: "GBP";
    merchant?: string;
    items: readonly VersionedReceiptItem[];
    discounts?: readonly VersionedReceiptDiscount[];
    serviceChargePence?: number;
    subtotalPence?: number;
    totalPence?: number;
  }>;
  split: Readonly<{
    participants: readonly Readonly<{
      id: string;
      remainderOptIn: boolean;
      tipVoteBps: number;
    }>[];
    claims: readonly Readonly<{
      participantId: string;
      itemId: string;
      shareIndexes: readonly number[];
    }>[];
  }>;
}>;

function checkedText(value: string, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > maximum ||
    CONTROL_CHARACTERS.test(value)
  ) {
    CONTROL_CHARACTERS.lastIndex = 0;
    throw new TypeError(`${label} is invalid.`);
  }
  CONTROL_CHARACTERS.lastIndex = 0;
  return value.normalize("NFC");
}

function checkedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum = MAX_RECEIPT_PENCE,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is outside its allowed integer range.`);
  }
  return value;
}

/** Canonical JSON for semantic receipt/split change detection. */
export function serialiseReceiptSplitVersion(input: ReceiptSplitVersionInput): string {
  if (!input || typeof input !== "object") {
    throw new TypeError("Receipt/split version input is required.");
  }
  if (input.receipt.currency !== "GBP") {
    throw new TypeError("Receipt/split versions must use GBP.");
  }
  if (!Array.isArray(input.receipt.items) || input.receipt.items.length === 0) {
    throw new RangeError("A versioned receipt needs at least one item.");
  }
  if (
    !Array.isArray(input.split.participants) ||
    input.split.participants.length === 0
  ) {
    throw new RangeError("A versioned split needs at least one participant.");
  }
  if (!Array.isArray(input.split.claims)) {
    throw new TypeError("Versioned claims must be an array.");
  }

  const itemOrder = new Map<string, number>();
  const items = input.receipt.items.map((item, index) => {
    const id = checkedText(item.id, `item ${index} id`, 100);
    if (itemOrder.has(id)) throw new RangeError(`Duplicate item id ${id}.`);
    itemOrder.set(id, index);
    const pricePence = checkedInteger(item.pricePence, `item ${id} price`, 1);
    const shareSlots = checkedInteger(item.shareSlots, `item ${id} shares`, 1, 32);
    if (shareSlots > pricePence) {
      throw new RangeError(`Item ${id} has more shares than pence.`);
    }
    return {
      id,
      name: checkedText(item.name, `item ${id} name`, 120),
      pricePence,
      shareSlots,
    };
  });

  const discountIds = new Set<string>();
  const discounts = (input.receipt.discounts ?? []).map((discount, index) => {
    const id = checkedText(discount.id, `discount ${index} id`, 100);
    if (discountIds.has(id)) throw new RangeError(`Duplicate discount id ${id}.`);
    discountIds.add(id);
    return {
      id,
      label: checkedText(discount.label, `discount ${index} label`, 120),
      amountPence: checkedInteger(
        discount.amountPence,
        `discount ${index} amount`,
        1,
      ),
    };
  });

  const participantOrder = new Map<string, number>();
  const participants = input.split.participants.map((participant, index) => {
    const id = checkedText(participant.id, `participant ${index} id`, 100);
    if (participantOrder.has(id)) {
      throw new RangeError(`Duplicate participant id ${id}.`);
    }
    participantOrder.set(id, index);
    if (typeof participant.remainderOptIn !== "boolean") {
      throw new TypeError(`Participant ${id} remainderOptIn must be boolean.`);
    }
    return {
      id,
      remainderOptIn: participant.remainderOptIn,
      tipVoteBps: checkedInteger(
        participant.tipVoteBps,
        `participant ${id} tip vote`,
        0,
        3_000,
      ),
    };
  });

  const indexesByItem = new Map<string, Set<number>>();
  const claimsByPair = new Map<
    string,
    { participantId: string; itemId: string; shareIndexes: number[] }
  >();
  for (const claim of input.split.claims) {
    const participantId = checkedText(claim.participantId, "claim participant", 100);
    const itemId = checkedText(claim.itemId, "claim item", 100);
    const participantIndex = participantOrder.get(participantId);
    const itemIndex = itemOrder.get(itemId);
    if (participantIndex === undefined) {
      throw new RangeError(`Claim references unknown participant ${participantId}.`);
    }
    if (itemIndex === undefined) {
      throw new RangeError(`Claim references unknown item ${itemId}.`);
    }
    if (!Array.isArray(claim.shareIndexes) || claim.shareIndexes.length === 0) {
      throw new RangeError("Claim shareIndexes must be a non-empty array.");
    }

    let usedIndexes = indexesByItem.get(itemId);
    if (!usedIndexes) {
      usedIndexes = new Set<number>();
      indexesByItem.set(itemId, usedIndexes);
    }
    const pairKey = `${itemId}\u0000${participantId}`;
    let canonicalClaim = claimsByPair.get(pairKey);
    if (!canonicalClaim) {
      canonicalClaim = { participantId, itemId, shareIndexes: [] };
      claimsByPair.set(pairKey, canonicalClaim);
    }

    for (const shareIndex of claim.shareIndexes) {
      checkedInteger(
        shareIndex,
        `share index for ${participantId}/${itemId}`,
        0,
        items[itemIndex].shareSlots - 1,
      );
      if (usedIndexes.has(shareIndex)) {
        throw new RangeError(`Item ${itemId} share ${shareIndex} is claimed twice.`);
      }
      usedIndexes.add(shareIndex);
      canonicalClaim.shareIndexes.push(shareIndex);
    }
  }

  const claims = [...claimsByPair.values()]
    .map((claim) => ({
      participantId: claim.participantId,
      itemId: claim.itemId,
      shareIndexes: [...claim.shareIndexes].sort((left, right) => left - right),
    }))
    .sort((left, right) => {
      const itemDifference =
        (itemOrder.get(left.itemId) ?? 0) - (itemOrder.get(right.itemId) ?? 0);
      if (itemDifference !== 0) return itemDifference;
      return (
        (participantOrder.get(left.participantId) ?? 0) -
        (participantOrder.get(right.participantId) ?? 0)
      );
    });

  const optionalPence = (value: number | undefined, label: string) => {
    return value === undefined ? null : checkedInteger(value, label, 0);
  };
  const merchant =
    input.receipt.merchant === undefined
      ? null
      : checkedText(input.receipt.merchant, "merchant", 100);

  return JSON.stringify({
    schema: "taptab-receipt-split",
    version: 1,
    receipt: {
      currency: "GBP",
      merchant,
      items,
      discounts,
      serviceChargePence: optionalPence(
        input.receipt.serviceChargePence,
        "service charge",
      ),
      subtotalPence: optionalPence(input.receipt.subtotalPence, "subtotal"),
      totalPence: optionalPence(input.receipt.totalPence, "total"),
    },
    split: { participants, claims },
  });
}

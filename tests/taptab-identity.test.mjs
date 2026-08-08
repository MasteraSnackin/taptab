import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_NAME_STORAGE_KEY,
  buildParticipantPaymentUrl,
  buildWhatsAppPaymentShareUrl,
  createPrivateNameMapping,
  createVenueSettlementDownload,
  findPrivateDisplayName,
  parsePrivateNameMappings,
  privateNameMappingKey,
  resolveParticipantPaymentUrl,
  serialisePrivateNameMappings,
  serialiseVenueSettlementRecord,
  upsertPrivateNameMapping,
  validatePrivateDisplayName,
} from "../app/taptab-identity.ts";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const ALICE = "0x2222222222222222222222222222222222222222";
const BOB = "0x3333333333333333333333333333333333333333";
const EVE = "0x4444444444444444444444444444444444444444";
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const HASH_C = `0x${"c".repeat(64)}`;

function nameContext(overrides = {}) {
  return {
    contractAddress: CONTRACT,
    billId: 7n,
    walletAddress: ALICE,
    ...overrides,
  };
}

function linkContext(overrides = {}) {
  return {
    origin: "https://taptab.example",
    pathname: "/settle",
    contractAddress: CONTRACT,
    billId: 7n,
    participantAddresses: [ALICE, BOB],
    ...overrides,
  };
}

function settlementInput(overrides = {}) {
  return {
    chainId: 10_143,
    contractAddress: CONTRACT,
    billId: 7n,
    currency: "GBP",
    merchant: "Cafe Seven",
    subtotalPence: 1_000,
    tipPence: 125,
    totalDuePence: 1_125,
    fundedPence: 1_125,
    allocations: [
      {
        walletAddress: BOB,
        privateName: "Bob",
        baseDuePence: 400,
        tipPence: 50,
        totalDuePence: 450,
        fundedPence: 450,
        transactionHashes: [HASH_B],
      },
      {
        walletAddress: ALICE,
        privateName: "Alice",
        baseDuePence: 600,
        tipPence: 75,
        totalDuePence: 675,
        fundedPence: 675,
        transactionHashes: [HASH_A],
      },
    ],
    transactionHashes: [HASH_C, HASH_A, HASH_B],
    ...overrides,
  };
}

test("private display names accept human names but reject markup and controls", () => {
  assert.equal(validatePrivateDisplayName("Élodie O’Connor"), "Élodie O’Connor");
  assert.equal(validatePrivateDisplayName("Jean-Luc 2"), "Jean-Luc 2");

  for (const unsafe of [
    " Alice",
    "Alice ",
    "Alice  Bob",
    "<script>",
    "Alice/Bob",
    "Alice\nBob",
    "Alice😀",
    "A".repeat(41),
  ]) {
    assert.throws(() => validatePrivateDisplayName(unsafe), TypeError, unsafe);
  }
});

test("device-local names are keyed by contract, bill and wallet", () => {
  assert.equal(PRIVATE_NAME_STORAGE_KEY, "taptab.private-names.v1");
  const alice = createPrivateNameMapping(nameContext(), "Alice");
  const anotherBill = createPrivateNameMapping(
    nameContext({ billId: 8n }),
    "Alice at lunch",
  );
  const bob = createPrivateNameMapping(
    nameContext({ walletAddress: BOB }),
    "Bob",
  );

  assert.notEqual(alice.key, anotherBill.key);
  assert.notEqual(alice.key, bob.key);
  assert.equal(alice.key, privateNameMappingKey(nameContext()));

  const serialised = serialisePrivateNameMappings([bob, anotherBill, alice]);
  const parsed = parsePrivateNameMappings(serialised);
  assert.deepEqual(parsed.map((entry) => entry.key), [...parsed.map((entry) => entry.key)].sort());
  assert.equal(findPrivateDisplayName(parsed, nameContext()), "Alice");
  assert.equal(
    findPrivateDisplayName(parsed, nameContext({ billId: 99n })),
    undefined,
  );

  const updated = upsertPrivateNameMapping(parsed, nameContext(), "Alicia");
  assert.equal(findPrivateDisplayName(updated, nameContext()), "Alicia");
  assert.equal(updated.length, 3);
});

test("malformed private-name storage fails closed", () => {
  assert.deepEqual(parsePrivateNameMappings(null), []);
  assert.deepEqual(parsePrivateNameMappings("not json"), []);
  assert.deepEqual(parsePrivateNameMappings('{"version":2,"entries":[]}'), []);
  assert.deepEqual(
    parsePrivateNameMappings(
      JSON.stringify({
        version: 1,
        entries: [{ key: privateNameMappingKey(nameContext()), name: "<img>" }],
      }),
    ),
    [],
  );
});

test("participant payment links are personalised, same-origin and name-free", () => {
  const url = buildParticipantPaymentUrl(linkContext(), ALICE.toUpperCase().replace("0X", "0x"));
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://taptab.example");
  assert.equal(parsed.pathname, "/settle");
  assert.equal(parsed.searchParams.get("contract"), CONTRACT);
  assert.equal(parsed.searchParams.get("bill"), "7");
  assert.equal(parsed.searchParams.get("pay"), ALICE);
  assert.equal(parsed.hash, "#pay");
  assert.equal(url.includes("Alice"), false);
  assert.deepEqual(resolveParticipantPaymentUrl(url, linkContext()), {
    status: "trusted",
    participantAddress: ALICE,
    url,
  });
});

test("payment links reject arbitrary origins, contracts, participants and parameters", () => {
  const valid = buildParticipantPaymentUrl(linkContext(), ALICE);
  const mutations = [
    valid.replace("https://taptab.example", "https://evil.example"),
    valid.replace(CONTRACT, EVE),
    valid.replace(ALICE, EVE),
    valid.replace("#pay", "&name=Alice#pay"),
    valid.replace(`contract=${CONTRACT}`, `contract=${CONTRACT}&contract=${CONTRACT}`),
  ];
  for (const unsafe of mutations) {
    assert.equal(resolveParticipantPaymentUrl(unsafe, linkContext()).status, "rejected");
  }

  assert.throws(() => buildParticipantPaymentUrl(linkContext(), EVE), /not in the trusted/);
  assert.throws(
    () => buildParticipantPaymentUrl(linkContext({ origin: "https://example.com/path" }), ALICE),
    /scheme and authority/,
  );
  assert.throws(
    () => buildParticipantPaymentUrl(linkContext({ pathname: "//evil.example" }), ALICE),
    /local absolute path/,
  );
  assert.throws(
    () => buildParticipantPaymentUrl(linkContext({ pathname: "/settle/../admin" }), ALICE),
    /already be canonical/,
  );
});

test("WhatsApp shares wrap only the validated payment URL and contain no private name", () => {
  const share = new URL(buildWhatsAppPaymentShareUrl(linkContext(), BOB));
  assert.equal(share.origin, "https://wa.me");
  const text = share.searchParams.get("text");
  assert.ok(text);
  assert.match(text, /Open your TapTab payment link:/);
  assert.match(text, new RegExp(BOB, "i"));
  assert.equal(text.includes("Bob"), false);

  const embeddedUrl = text.slice(text.indexOf("https://"));
  assert.equal(resolveParticipantPaymentUrl(embeddedUrl, linkContext()).status, "trusted");
});

test("venue settlement JSON is deterministic and private-name-free by default", () => {
  const input = settlementInput();
  const first = serialiseVenueSettlementRecord(input);
  const reordered = settlementInput({
    allocations: [...input.allocations].reverse(),
    transactionHashes: [...input.transactionHashes].reverse(),
  });
  assert.equal(serialiseVenueSettlementRecord(reordered), first);
  assert.equal(first.includes("Alice"), false);
  assert.equal(first.includes("Bob"), false);
  assert.equal(first.includes("privateName"), false);

  const record = JSON.parse(first);
  assert.equal(record.schema, "taptab-venue-settlement");
  assert.deepEqual(record.totals, {
    subtotalPence: 1_000,
    tipPence: 125,
    totalDuePence: 1_125,
    fundedPence: 1_125,
  });
  assert.deepEqual(
    record.allocations.map((allocation) => allocation.walletAddress),
    [ALICE, BOB],
  );
  assert.deepEqual(record.transactionHashes, [HASH_A, HASH_B, HASH_C]);

  const download = createVenueSettlementDownload(input);
  assert.equal(download.fileName, "taptab-bill-7-settlement.json");
  assert.equal(download.mimeType, "application/json;charset=utf-8");
  assert.equal(download.text, first);

  const explicitEmptyAllocationHashes = settlementInput({
    allocations: input.allocations.map((allocation) => ({
      ...allocation,
      transactionHashes: [],
    })),
  });
  assert.doesNotThrow(() =>
    serialiseVenueSettlementRecord(explicitEmptyAllocationHashes),
  );
});

test("venue exports include validated private names only after explicit opt-in", () => {
  const privateRecord = serialiseVenueSettlementRecord(settlementInput(), {
    includePrivateNames: true,
  });
  assert.match(privateRecord, /"privateName": "Alice"/);
  assert.match(privateRecord, /"privateName": "Bob"/);

  const unsafeName = settlementInput({
    allocations: settlementInput().allocations.map((allocation, index) =>
      index === 0 ? { ...allocation, privateName: "<script>" } : allocation,
    ),
  });
  assert.doesNotThrow(() => serialiseVenueSettlementRecord(unsafeName));
  assert.throws(
    () =>
      serialiseVenueSettlementRecord(unsafeName, {
        includePrivateNames: true,
      }),
    /Private name/,
  );
});

test("venue settlement allocations can share transaction evidence", () => {
  const input = settlementInput();
  const record = JSON.parse(
    serialiseVenueSettlementRecord({
      ...input,
      allocations: input.allocations.map((allocation) => ({
        ...allocation,
        transactionHashes: [HASH_A],
      })),
      transactionHashes: [HASH_C, HASH_A],
    }),
  );

  assert.deepEqual(
    record.allocations.map((allocation) => allocation.transactionHashes),
    [[HASH_A], [HASH_A]],
  );
  assert.deepEqual(record.transactionHashes, [HASH_A, HASH_C]);
});

test("venue settlement allocations reject evidence absent from the top-level record", () => {
  assert.throws(
    () =>
      serialiseVenueSettlementRecord(
        settlementInput({ transactionHashes: [HASH_A, HASH_C] }),
      ),
    /Allocation transaction hashes must be included in settlement transactions/,
  );
});

test("venue settlement records reject unsafe hashes and inconsistent totals", () => {
  assert.throws(
    () => serialiseVenueSettlementRecord(settlementInput({ transactionHashes: ["0xdead"] })),
    /32-byte hexadecimal/,
  );
  assert.throws(
    () => serialiseVenueSettlementRecord(settlementInput({ fundedPence: 1_124 })),
    /fully funded/,
  );
  assert.throws(
    () =>
      serialiseVenueSettlementRecord(
        settlementInput({
          allocations: [
            {
              ...settlementInput().allocations[0],
              baseDuePence: 401,
            },
            settlementInput().allocations[1],
          ],
        }),
      ),
    /base and tip/,
  );
});

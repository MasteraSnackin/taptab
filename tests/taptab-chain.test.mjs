import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

import {
  TAPTAB_MONAD_TESTNET,
  TAPTAB_HTTP_BATCH_MAX_REQUESTS,
  TAPTAB_HTTP_BATCH_WAIT_MS,
  TAPTAB_MULTICALL_BATCH_SIZE_BYTES,
  MAX_TAPTAB_ITEMS,
  MAX_TAPTAB_PARTICIPANTS,
  MAX_TAPTAB_SHARES_PER_ITEM,
  MAX_TAPTAB_TOTAL_SHARES,
  assertTipVoteBps,
  buildAccountReads,
  buildBillRead,
  buildCurrentBlockTimestampRead,
  buildCancelWrite,
  buildClaimManyWrite,
  buildClaimWrite,
  buildCreateBillWrite,
  buildExpireWrite,
  buildFundWrite,
  buildInvitationRead,
  buildInviteManyWrite,
  buildInviteWrite,
  buildItemsRead,
  buildJoinWrite,
  buildOpenFundingWrite,
  buildParticipantRead,
  buildParticipantsRead,
  buildPreferencesWrite,
  buildProceedsRead,
  buildRefundWrite,
  buildSettleWrite,
  buildShareOwnersRead,
  buildShareValueRead,
  buildUnclaimWrite,
  buildWithdrawWrite,
  createTapTabPublicClient,
  deriveTapTabPhase,
  requireTapTabContext,
  resolveTapTabPublicFallbackRpcUrl,
  resolveTapTabDeployment,
  tapTabAbi,
} from "../app/taptab-chain.ts";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const PARTICIPANT = "0x3333333333333333333333333333333333333333";
const SECOND_PARTICIPANT = "0x4444444444444444444444444444444444444444";
const CONTEXT = { address: CONTRACT, billId: 7n };

test("exports Monad Testnet and the complete compact TapTab interface", () => {
  assert.equal(TAPTAB_MONAD_TESTNET.id, 10_143);
  assert.equal(TAPTAB_MONAD_TESTNET.nativeCurrency.symbol, "MON");
  assert.deepEqual(TAPTAB_MONAD_TESTNET.contracts?.multicall3, {
    address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    blockCreated: 251_449,
  });

  const functions = new Set(
    tapTabAbi.filter((entry) => entry.type === "function").map((entry) => entry.name),
  );
  const events = new Set(
    tapTabAbi.filter((entry) => entry.type === "event").map((entry) => entry.name),
  );

  for (const name of [
    "createBill",
    "inviteParticipant",
    "inviteMany",
    "joinBill",
    "updatePreferences",
    "claimItemShare",
    "claimMany",
    "unclaimItemShare",
    "openFunding",
    "fundParticipant",
    "settleBill",
    "cancelBill",
    "expireBill",
    "claimRefund",
    "withdrawProceeds",
    "getBill",
    "getItems",
    "getParticipants",
    "getParticipant",
    "isInvited",
    "getItemShareOwners",
    "itemShareValue",
    "remainingDue",
    "contributionOf",
    "claimableRefund",
    "proceedsAvailable",
  ]) {
    assert.equal(functions.has(name), true, `missing function ${name}`);
  }

  for (const name of [
    "BillCreated",
    "ParticipantJoined",
    "ParticipantInvited",
    "PreferencesUpdated",
    "ItemShareClaimed",
    "ItemShareUnclaimed",
    "ParticipantDueLocked",
    "FundingOpened",
    "ContributionReceived",
    "BillSettled",
    "BillCancelled",
    "BillExpired",
    "RefundClaimed",
    "ProceedsWithdrawn",
  ]) {
    assert.equal(events.has(name), true, `missing event ${name}`);
  }
});

test("bounds and retries public Monad RPC reads without retrying wallet writes", async () => {
  const source = await readFile(new URL("../app/taptab-chain.ts", import.meta.url), "utf8");

  assert.equal(TAPTAB_HTTP_BATCH_MAX_REQUESTS, 64);
  assert.equal(TAPTAB_HTTP_BATCH_WAIT_MS, 10);
  assert.equal(TAPTAB_MULTICALL_BATCH_SIZE_BYTES, 65_536);
  assert.match(source, /function createTapTabHttpTransport\(rpcUrl\?: string\)/);
  assert.match(source, /transport: readTransport/);
  assert.match(source, /fallback\(/);
  assert.match(source, /rank: false/);
  assert.match(source, /batchSize: TAPTAB_HTTP_BATCH_MAX_REQUESTS/);
  assert.match(source, /wait: TAPTAB_HTTP_BATCH_WAIT_MS/);
  assert.match(source, /TAPTAB_PUBLIC_RPC_TIMEOUT_MS = 10_000/);
  assert.match(source, /TAPTAB_PUBLIC_RPC_RETRY_COUNT = 2/);
  assert.match(source, /Wallet writes use[\s\S]*a separate EIP-1193 transport/);
});

test("admits only an optional HTTPS browser-read fallback", () => {
  assert.equal(resolveTapTabPublicFallbackRpcUrl(undefined), undefined);
  assert.equal(resolveTapTabPublicFallbackRpcUrl("  "), undefined);
  assert.equal(
    resolveTapTabPublicFallbackRpcUrl(" https://rpc-backup.example.test/path "),
    "https://rpc-backup.example.test/path",
  );
  for (const candidate of [
    "http://rpc-backup.example.test",
    "https://user:secret@rpc-backup.example.test",
    "https://rpc-backup.example.test/#fragment",
    "not a URL",
  ]) {
    assert.equal(resolveTapTabPublicFallbackRpcUrl(candidate), undefined);
  }
});

test("tries the primary browser-read RPC before its validated fallback", async (t) => {
  const primaryRpcUrl = "https://primary-rpc.example.test/";
  const fallbackRpcUrl = "https://fallback-rpc.example.test/";
  const calls = [];

  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    if (url === primaryRpcUrl) {
      return Response.json(
        { error: { code: -32_000, message: "primary unavailable" } },
        { status: 503 },
      );
    }

    const payload = JSON.parse(String(init?.body));
    const requests = Array.isArray(payload) ? payload : [payload];
    const replies = requests.map((request) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: "0x279f",
    }));
    return Response.json(Array.isArray(payload) ? replies : replies[0]);
  });

  const client = createTapTabPublicClient(primaryRpcUrl, fallbackRpcUrl);
  assert.equal(await client.getChainId(), TAPTAB_MONAD_TESTNET.id);
  assert.deepEqual(calls, [
    primaryRpcUrl,
    primaryRpcUrl,
    primaryRpcUrl,
    fallbackRpcUrl,
  ]);
});

test("coalesces concurrent public reads into one bounded HTTP JSON-RPC batch", async (t) => {
  const requestBodies = [];
  const server = createServer(async (request, response) => {
    let rawBody = "";
    for await (const chunk of request) rawBody += chunk;
    const body = JSON.parse(rawBody);
    requestBodies.push(body);
    const calls = Array.isArray(body) ? body : [body];
    const replies = calls.map((call) => ({
      jsonrpc: "2.0",
      id: call.id,
      result: call.method === "eth_chainId" ? "0x279f" : "0x10",
    }));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = createTapTabPublicClient(`http://127.0.0.1:${address.port}`);
  const [chainId, blockNumber] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
  ]);

  assert.equal(chainId, 10_143);
  assert.equal(blockNumber, 16n);
  assert.equal(requestBodies.length, 1);
  assert.ok(Array.isArray(requestBodies[0]));
  assert.equal(requestBodies[0].length, 2);
});

test("reports absent, partial, malformed and configured public deployment values honestly", () => {
  assert.equal(resolveTapTabDeployment({}).status, "unconfigured");
  assert.deepEqual(
    resolveTapTabDeployment({ NEXT_PUBLIC_TAPTAB_ADDRESS: CONTRACT }),
    {
      status: "invalid",
      reason: "TapTab address and bill ID must be configured together.",
    },
  );
  assert.equal(
    resolveTapTabDeployment({
      NEXT_PUBLIC_TAPTAB_ADDRESS: "0x1234",
      NEXT_PUBLIC_TAPTAB_BILL_ID: "1",
    }).status,
    "invalid",
  );
  assert.equal(
    resolveTapTabDeployment({
      NEXT_PUBLIC_TAPTAB_ADDRESS: "0x0000000000000000000000000000000000000000",
      NEXT_PUBLIC_TAPTAB_BILL_ID: "1",
    }).status,
    "invalid",
  );
  for (const billId of ["0", "-1", "1.5", "0x2", " 0 "]) {
    assert.equal(
      resolveTapTabDeployment({
        NEXT_PUBLIC_TAPTAB_ADDRESS: CONTRACT,
        NEXT_PUBLIC_TAPTAB_BILL_ID: billId,
      }).status,
      "invalid",
    );
  }
  assert.equal(
    resolveTapTabDeployment({
      NEXT_PUBLIC_TAPTAB_ADDRESS: CONTRACT,
      NEXT_PUBLIC_TAPTAB_BILL_ID: (1n << 256n).toString(),
    }).status,
    "invalid",
  );

  const configured = resolveTapTabDeployment({
    NEXT_PUBLIC_TAPTAB_ADDRESS: ` ${CONTRACT} `,
    NEXT_PUBLIC_TAPTAB_BILL_ID: " 7 ",
  });
  assert.deepEqual(configured, { status: "configured", address: CONTRACT, billId: 7n });
  assert.deepEqual(requireTapTabContext(configured), CONTEXT);
  assert.throws(
    () => requireTapTabContext(resolveTapTabDeployment({})),
    /deployment is unconfigured/,
  );
});

test("derives all TapTab lifecycle phases without treating None as Draft", () => {
  assert.equal(deriveTapTabPhase(null), "unavailable");
  assert.equal(deriveTapTabPhase(undefined), "unavailable");
  assert.equal(deriveTapTabPhase(0), "unavailable");
  assert.equal(deriveTapTabPhase(1), "draft");
  assert.equal(deriveTapTabPhase(2n), "funding");
  assert.equal(deriveTapTabPhase(3), "settled");
  assert.equal(deriveTapTabPhase(4), "cancelled");
  assert.equal(deriveTapTabPhase(5), "expired");
  assert.equal(deriveTapTabPhase(99), "unavailable");
});

test("builds all bill and participant reads with exact bigint arguments", () => {
  assert.equal(buildBillRead(CONTEXT).functionName, "getBill");
  assert.equal(buildItemsRead(CONTEXT).functionName, "getItems");
  assert.equal(buildParticipantsRead(CONTEXT).functionName, "getParticipants");
  assert.equal(buildProceedsRead(CONTEXT).functionName, "proceedsAvailable");
  assert.deepEqual(buildCurrentBlockTimestampRead(), {
    address: TAPTAB_MONAD_TESTNET.contracts.multicall3.address,
    abi: [
      {
        type: "function",
        name: "getCurrentBlockTimestamp",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "timestamp", type: "uint256" }],
      },
    ],
    functionName: "getCurrentBlockTimestamp",
    args: [],
  });
  assert.deepEqual(buildParticipantRead(CONTEXT, PARTICIPANT).args, [7n, PARTICIPANT]);
  assert.deepEqual(buildInvitationRead(CONTEXT, PARTICIPANT).args, [7n, PARTICIPANT]);
  assert.deepEqual(buildShareOwnersRead(CONTEXT, 2n).args, [7n, 2n]);
  assert.deepEqual(buildShareValueRead(CONTEXT, 2n, 3n).args, [7n, 2n, 3n]);

  const accountReads = buildAccountReads(CONTEXT, PARTICIPANT);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(accountReads).map(([name, request]) => [name, request.functionName]),
    ),
    {
      participant: "getParticipant",
      remainingDue: "remainingDue",
      contribution: "contributionOf",
      claimableRefund: "claimableRefund",
    },
  );
  for (const request of Object.values(accountReads)) {
    assert.deepEqual(request.args, [7n, PARTICIPANT]);
  }
});

test("builds creation, joining, preferences and share writes without monetary conversion", () => {
  const create = buildCreateBillWrite(CONTRACT, {
    payee: PAYEE,
    metadataURI: "ipfs://receipt",
    deadline: 1_800_000_000n,
    itemAmounts: [10_000_000_000_000_001n, 5n],
    shareCounts: [3, 1],
    currentTimestamp: 1_700_000_000n,
  });
  assert.equal(create.functionName, "createBill");
  assert.deepEqual(create.args, [
    PAYEE,
    "ipfs://receipt",
    1_800_000_000n,
    [10_000_000_000_000_001n, 5n],
    [3, 1],
  ]);

  assert.deepEqual(buildJoinWrite(CONTEXT, true, 1250).args, [7n, true, 1250]);
  assert.deepEqual(buildInviteWrite(CONTEXT, PARTICIPANT).args, [7n, PARTICIPANT]);
  assert.deepEqual(buildInviteManyWrite(CONTEXT, [PARTICIPANT, SECOND_PARTICIPANT]).args, [
    7n,
    [PARTICIPANT, SECOND_PARTICIPANT],
  ]);
  assert.deepEqual(buildPreferencesWrite(CONTEXT, false, 1777).args, [
    7n,
    false,
    1777,
  ]);
  assert.deepEqual(buildClaimWrite(CONTEXT, 1n, 2n).args, [7n, 1n, 2n]);
  assert.deepEqual(buildClaimManyWrite(CONTEXT, [0n, 1n], [2n, 3n]).args, [
    7n,
    [0n, 1n],
    [2n, 3n],
  ]);
  assert.deepEqual(buildUnclaimWrite(CONTEXT, 1n, 2n).args, [7n, 1n, 2n]);

  assert.throws(
    () =>
      buildCreateBillWrite(CONTRACT, {
        payee: PAYEE,
        metadataURI: "",
        deadline: 1n,
        itemAmounts: [1n],
        shareCounts: [],
      }),
    RangeError,
  );
  assert.throws(() => buildClaimWrite(CONTEXT, -1n, 0n), RangeError);
});

test("rejects the TapTab contract as its own payee before wallet submission", () => {
  assert.throws(
    () =>
      buildCreateBillWrite(CONTRACT, {
        payee: CONTRACT,
        metadataURI: "ipfs://receipt",
        deadline: 2000n,
        currentTimestamp: 1000n,
        itemAmounts: [100n],
        shareCounts: [1],
      }),
    /payee cannot be the TapTab contract itself/,
  );
});

test("mirrors every bounded createBill contract invariant before wallet submission", () => {
  const create = (overrides = {}) =>
    buildCreateBillWrite(CONTRACT, {
      payee: PAYEE,
      metadataURI: "ipfs://receipt",
      deadline: 2000n,
      currentTimestamp: 1000n,
      itemAmounts: [100n],
      shareCounts: [1],
      ...overrides,
    });

  assert.equal(MAX_TAPTAB_ITEMS, 32);
  assert.equal(MAX_TAPTAB_PARTICIPANTS, 32);
  assert.equal(MAX_TAPTAB_SHARES_PER_ITEM, 32);
  assert.equal(MAX_TAPTAB_TOTAL_SHARES, 128);
  assert.doesNotThrow(() => create());
  assert.throws(
    () => create({ payee: "0x0000000000000000000000000000000000000000" }),
    TypeError,
  );
  assert.throws(() => create({ deadline: 1000n }), /later than currentTimestamp/);
  assert.throws(() => create({ deadline: 999n }), /later than currentTimestamp/);
  assert.throws(
    () =>
      buildCreateBillWrite(CONTRACT, {
        payee: PAYEE,
        metadataURI: "",
        deadline: 0n,
        itemAmounts: [1n],
        shareCounts: [1],
      }),
    /non-zero uint64/,
  );
  assert.throws(
    () =>
      create({
        itemAmounts: Array(MAX_TAPTAB_ITEMS + 1).fill(1n),
        shareCounts: Array(MAX_TAPTAB_ITEMS + 1).fill(1),
      }),
    /at most 32 items/,
  );
  assert.throws(() => create({ itemAmounts: [0n] }), /non-zero/);
  assert.throws(() => create({ shareCounts: [0] }), /from 1 to 32/);
  assert.throws(() => create({ itemAmounts: [100n], shareCounts: [33] }), /from 1 to 32/);
  assert.throws(
    () => create({ itemAmounts: [2n], shareCounts: [3] }),
    /cannot exceed the item's exact amount/,
  );
  assert.throws(
    () => create({ itemAmounts: Array(5).fill(32n), shareCounts: Array(5).fill(32) }),
    /at most 128 share slots/,
  );
  assert.throws(
    () => create({ itemAmounts: [(1n << 256n) - 1n, 1n], shareCounts: [1, 1] }),
    /subtotal exceeds uint256/,
  );
  assert.throws(
    () => buildInviteWrite(CONTEXT, "0x0000000000000000000000000000000000000000"),
    TypeError,
  );
});

test("rejects malformed or unbounded invitation and claim batches before wallet submission", () => {
  assert.throws(() => buildInviteManyWrite(CONTEXT, []), /from 1 to 32/);
  assert.throws(
    () => buildInviteManyWrite(CONTEXT, Array(MAX_TAPTAB_PARTICIPANTS + 1).fill(PARTICIPANT)),
    /from 1 to 32/,
  );
  assert.throws(
    () =>
      buildInviteManyWrite(CONTEXT, [
        PARTICIPANT,
        PARTICIPANT.toUpperCase().replace("0X", "0x"),
      ]),
    /duplicate participants/,
  );
  assert.throws(
    () =>
      buildInviteManyWrite(CONTEXT, [
        PARTICIPANT,
        "0x0000000000000000000000000000000000000000",
      ]),
    /cannot be zero/,
  );

  assert.throws(() => buildClaimManyWrite(CONTEXT, [], []), /from 1 to 128/);
  assert.throws(() => buildClaimManyWrite(CONTEXT, [0n], []), /matching item and share/);
  assert.throws(
    () =>
      buildClaimManyWrite(
        CONTEXT,
        Array(MAX_TAPTAB_TOTAL_SHARES + 1).fill(0n),
        Array(MAX_TAPTAB_TOTAL_SHARES + 1).fill(0n),
      ),
    /from 1 to 128/,
  );
  assert.throws(() => buildClaimManyWrite(CONTEXT, [-1n], [0n]), /itemIndex/);
  assert.throws(() => buildClaimManyWrite(CONTEXT, [0n], [-1n]), /shareIndex/);
  assert.throws(
    () => buildClaimManyWrite(CONTEXT, [0n, 0n], [1n, 1n]),
    /same share slot/,
  );
});

test("builds lifecycle writes and payable sponsorship explicitly", () => {
  const builders = [
    [buildOpenFundingWrite, "openFunding"],
    [buildSettleWrite, "settleBill"],
    [buildCancelWrite, "cancelBill"],
    [buildExpireWrite, "expireBill"],
    [buildRefundWrite, "claimRefund"],
    [buildWithdrawWrite, "withdrawProceeds"],
  ];
  for (const [builder, functionName] of builders) {
    const request = builder(CONTEXT);
    assert.equal(request.functionName, functionName);
    assert.deepEqual(request.args, [7n]);
    assert.equal("value" in request, false);
  }

  const funding = buildFundWrite(CONTEXT, PARTICIPANT, 123_456_789n);
  assert.equal(funding.functionName, "fundParticipant");
  assert.deepEqual(funding.args, [7n, PARTICIPANT]);
  assert.equal(funding.value, 123_456_789n);
  assert.throws(() => buildFundWrite(CONTEXT, PARTICIPANT, 0n), RangeError);
});

test("validates the full contract tip-vote range", () => {
  for (const value of [0, 1000, 1250, 1777, 3000]) {
    assert.equal(assertTipVoteBps(value), value);
  }
  for (const value of [-1, 3001, 12.5, Number.NaN]) {
    assert.throws(() => assertTipVoteBps(value), RangeError);
  }
});

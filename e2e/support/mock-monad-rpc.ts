import type { Page } from "@playwright/test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  multicall3Abi,
  type Address,
  type Hex,
} from "viem";
import {
  TAPTAB_MONAD_TESTNET,
  multicall3TimestampAbi,
  tapTabAbi,
} from "../../app/taptab-chain";
import { MOCK_WALLET_ACCOUNT } from "./mock-eip1193";

export const MOCK_TAPTAB_CONTRACT =
  "0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198" as Address;

const MOCK_CREATOR = "0x3333333333333333333333333333333333333333" as Address;
const MOCK_PAYEE = "0x4444444444444444444444444444444444444444" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const RECEIPT_DIGEST = `0x${"11".repeat(32)}` as Hex;
const SPLIT_DIGEST = `0x${"22".repeat(32)}` as Hex;
const ONE_MON = 1_000_000_000_000_000_000n;
const MOCK_BLOCK_NUMBER = 51_800_000n;
const MOCK_CHAIN_TIMESTAMP = 1_786_147_200n;

type MockParticipant = Readonly<{
  address: Address;
  joined: boolean;
  fairRemainder: boolean;
  tipVoteBps: number;
  baseDue: bigint;
  tipDue: bigint;
  amountDue: bigint;
  amountFunded: bigint;
  approved: boolean;
  invited: boolean;
  contribution: bigint;
  claimableRefund: bigint;
}>;

type MockItem = Readonly<{
  name: string;
  amount: bigint;
  amountPence: number;
  shareCount: number;
  owners: readonly Address[];
}>;

type MockBill = Readonly<{
  id: bigint;
  merchant: string;
  state: number;
  lockedTipBps: number;
  subtotal: bigint;
  totalDue: bigint;
  totalFunded: bigint;
  items: readonly MockItem[];
  participants: readonly MockParticipant[];
}>;

type RpcRequest = Readonly<{
  id: number | string | null;
  jsonrpc: "2.0";
  method: string;
  params?: readonly unknown[];
}>;

type RpcObservation = Readonly<{
  method: string;
  billIds: readonly string[];
}>;

type RpcGate = Readonly<{
  matches(requests: readonly RpcRequest[]): boolean;
  started(): void;
  wait: Promise<void>;
}>;

function metadataUri(bill: MockBill) {
  const value = {
    currency: "GBP",
    merchant: bill.merchant,
    subtotalPence: bill.items.reduce((total, item) => total + item.amountPence, 0),
    items: bill.items.map((item) => ({
      name: item.name,
      amountPence: item.amountPence,
    })),
    quote: {
      gbpPerMon: "1",
      source: "TapTab deterministic browser fixture",
      basis: "mainnet MON test reference",
      observedAtUnixSeconds: 1_786_140_000,
      lockedAtUnixSeconds: 1_786_140_100,
      allocation: "per-row-half-up",
      subtotalWei: bill.subtotal.toString(),
    },
  };
  return `data:application/json,${encodeURIComponent(JSON.stringify(value))}`;
}

function joinedParticipant(
  address: Address,
  values: Partial<Omit<MockParticipant, "address">> = {},
): MockParticipant {
  return {
    address: getAddress(address),
    joined: true,
    fairRemainder: true,
    tipVoteBps: 1_000,
    baseDue: ONE_MON,
    tipDue: ONE_MON / 10n,
    amountDue: (ONE_MON * 11n) / 10n,
    amountFunded: 0n,
    approved: true,
    invited: true,
    contribution: 0n,
    claimableRefund: 0n,
    ...values,
  };
}

const MOCK_BILLS: ReadonlyMap<bigint, MockBill> = new Map([
  [
    2n,
    {
      id: 2n,
      merchant: "Table 2 mock",
      state: 1,
      lockedTipBps: 0,
      subtotal: ONE_MON,
      totalDue: 0n,
      totalFunded: 0n,
      items: [
        {
          name: "Bill two item",
          amount: ONE_MON,
          amountPence: 100,
          shareCount: 1,
          owners: [MOCK_WALLET_ACCOUNT],
        },
      ],
      participants: [
        joinedParticipant(MOCK_WALLET_ACCOUNT, {
          tipVoteBps: 0,
          baseDue: 0n,
          tipDue: 0n,
          amountDue: 0n,
          approved: false,
        }),
      ],
    },
  ],
  [
    3n,
    {
      id: 3n,
      merchant: "Table 3 mock",
      state: 2,
      lockedTipBps: 1_000,
      subtotal: ONE_MON,
      totalDue: (ONE_MON * 11n) / 10n,
      totalFunded: 0n,
      items: [
        {
          name: "Bill three item",
          amount: ONE_MON,
          amountPence: 100,
          shareCount: 1,
          owners: [MOCK_WALLET_ACCOUNT],
        },
      ],
      participants: [joinedParticipant(MOCK_WALLET_ACCOUNT)],
    },
  ],
]);

function participantFor(bill: MockBill, address: Address): MockParticipant {
  return (
    bill.participants.find(
      (participant) => participant.address.toLowerCase() === address.toLowerCase(),
    ) ?? {
      address,
      joined: false,
      fairRemainder: false,
      tipVoteBps: 0,
      baseDue: 0n,
      tipDue: 0n,
      amountDue: 0n,
      amountFunded: 0n,
      approved: false,
      invited: false,
      contribution: 0n,
      claimableRefund: 0n,
    }
  );
}

function encodeTapTabCall(callData: Hex): Readonly<{ billId?: bigint; result: Hex }> {
  const decoded = decodeFunctionData({ abi: tapTabAbi, data: callData });
  const args = decoded.args as readonly unknown[];
  const billId = typeof args?.[0] === "bigint" ? args[0] : undefined;
  const bill = billId === undefined ? undefined : MOCK_BILLS.get(billId);
  if (!bill) throw new Error(`No deterministic TapTab fixture exists for bill ${billId}.`);

  const encode = (result: unknown) =>
    encodeFunctionResult({
      abi: tapTabAbi,
      functionName: decoded.functionName,
      result: result as never,
    });

  switch (decoded.functionName) {
    case "getBill":
      return {
        billId,
        result: encode({
          id: bill.id,
          creator: MOCK_CREATOR,
          payee: MOCK_PAYEE,
          metadataURI: metadataUri(bill),
          createdAt: MOCK_CHAIN_TIMESTAMP - 3_600n,
          deadline: MOCK_CHAIN_TIMESTAMP + 86_400n,
          participantCount: bill.participants.length,
          lockedTipBps: bill.lockedTipBps,
          state: bill.state,
          proceedsWithdrawn: false,
          subtotal: bill.subtotal,
          totalDue: bill.totalDue,
          totalFunded: bill.totalFunded,
          remainingToFund: bill.totalDue - bill.totalFunded,
        }),
      };
    case "getItems":
      return {
        billId,
        result: encode(
          bill.items.map((item) => ({
            amount: item.amount,
            shareCount: item.shareCount,
            claimedShareCount: item.owners.filter(
              (owner) => owner.toLowerCase() !== ZERO_ADDRESS,
            ).length,
          })),
        ),
      };
    case "getParticipants":
      return { billId, result: encode(bill.participants.map(({ address }) => address)) };
    case "getParticipant": {
      const participant = participantFor(bill, getAddress(args[1] as Address));
      return {
        billId,
        result: encode({
          joined: participant.joined,
          fairRemainder: participant.fairRemainder,
          tipVoteBps: participant.tipVoteBps,
          baseDue: participant.baseDue,
          tipDue: participant.tipDue,
          amountDue: participant.amountDue,
          amountFunded: participant.amountFunded,
        }),
      };
    }
    case "isInvited":
      return {
        billId,
        result: encode(participantFor(bill, getAddress(args[1] as Address)).invited),
      };
    case "currentSplitDigest":
      return { billId, result: encode(SPLIT_DIGEST) };
    case "getSplitStatus":
      return {
        billId,
        result: encode({
          receiptDigest: RECEIPT_DIGEST,
          currentDigest: SPLIT_DIGEST,
          splitVersion: 1n,
          approvalCount: bill.participants.filter(({ approved }) => approved).length,
          requiredApprovals: bill.participants.length,
        }),
      };
    case "hasApprovedCurrentSplit":
      return {
        billId,
        result: encode(participantFor(bill, getAddress(args[1] as Address)).approved),
      };
    case "getItemShareOwners": {
      const itemIndex = Number(args[1]);
      return { billId, result: encode(bill.items[itemIndex]?.owners ?? []) };
    }
    case "remainingDue": {
      const participant = participantFor(bill, getAddress(args[1] as Address));
      return { billId, result: encode(participant.amountDue - participant.amountFunded) };
    }
    case "contributionOf":
      return {
        billId,
        result: encode(participantFor(bill, getAddress(args[1] as Address)).contribution),
      };
    case "claimableRefund":
      return {
        billId,
        result: encode(participantFor(bill, getAddress(args[1] as Address)).claimableRefund),
      };
    case "proceedsAvailable":
      return { billId, result: encode(0n) };
    case "unclaimItemShare":
      return { billId, result: encode(undefined) };
    default:
      throw new Error(`Unhandled TapTab fixture call ${decoded.functionName}.`);
  }
}

function isDirectTapTabCall(request: RpcRequest, functionName: string): boolean {
  if (request.method !== "eth_call") return false;
  const transaction = request.params?.[0] as
    | Readonly<{ data?: Hex; to?: Address }>
    | undefined;
  if (
    !transaction?.data ||
    !transaction.to ||
    transaction.to.toLowerCase() !== MOCK_TAPTAB_CONTRACT.toLowerCase()
  ) {
    return false;
  }
  try {
    return decodeFunctionData({ abi: tapTabAbi, data: transaction.data }).functionName === functionName;
  } catch {
    return false;
  }
}

function isBillSnapshotRequest(request: RpcRequest, billId: bigint): boolean {
  if (request.method !== "eth_call") return false;
  const transaction = request.params?.[0] as
    | Readonly<{ data?: Hex; to?: Address }>
    | undefined;
  if (
    !transaction?.data ||
    !transaction.to ||
    transaction.to.toLowerCase() !==
      TAPTAB_MONAD_TESTNET.contracts.multicall3.address.toLowerCase()
  ) {
    return false;
  }
  try {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: transaction.data });
    if (decoded.functionName !== "aggregate3") return false;
    return decoded.args[0].some((call) => {
      if (call.target.toLowerCase() !== MOCK_TAPTAB_CONTRACT.toLowerCase()) return false;
      try {
        const tapTabCall = decodeFunctionData({ abi: tapTabAbi, data: call.callData });
        return tapTabCall.args?.[0] === billId;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function encodeMulticall(callData: Hex) {
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: callData });
  if (decoded.functionName !== "aggregate3") {
    throw new Error(`Unhandled Multicall3 fixture call ${decoded.functionName}.`);
  }
  const calls = decoded.args[0];
  const billIds = new Set<string>();
  const result = calls.map((call) => {
    try {
      if (
        call.target.toLowerCase() ===
        TAPTAB_MONAD_TESTNET.contracts.multicall3.address.toLowerCase()
      ) {
        const timestampCall = decodeFunctionData({
          abi: multicall3TimestampAbi,
          data: call.callData,
        });
        if (timestampCall.functionName === "getCurrentBlockTimestamp") {
          return {
            success: true,
            returnData: encodeFunctionResult({
              abi: multicall3TimestampAbi,
              functionName: "getCurrentBlockTimestamp",
              result: MOCK_CHAIN_TIMESTAMP,
            }),
          };
        }
      }
    } catch {
      // It is a TapTab call rather than the timestamp helper.
    }

    const encoded = encodeTapTabCall(call.callData);
    if (encoded.billId !== undefined) billIds.add(encoded.billId.toString());
    return { success: true, returnData: encoded.result };
  });
  return {
    billIds: [...billIds],
    result: encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result,
    }),
  };
}

export async function installMockMonadRpc(page: Page) {
  const observations: RpcObservation[] = [];
  const unknownMethods: string[] = [];
  let nextGate: RpcGate | undefined;

  await page.route("https://testnet-rpc.monad.xyz/**", async (route) => {
    const raw = route.request().postData();
    const payload = JSON.parse(raw ?? "null") as RpcRequest | readonly RpcRequest[];
    const requests = Array.isArray(payload) ? payload : [payload];
    const gate = nextGate;
    if (gate?.matches(requests)) {
      nextGate = undefined;
      gate.started();
      await gate.wait;
    }
    const responses = requests.map((request) => {
      try {
        let result: unknown;
        let billIds: readonly string[] = [];
        switch (request.method) {
          case "eth_blockNumber":
            result = `0x${MOCK_BLOCK_NUMBER.toString(16)}`;
            break;
          case "eth_chainId":
            result = "0x279f";
            break;
          case "net_version":
            result = "10143";
            break;
          case "eth_getBalance":
            result = `0x${ONE_MON.toString(16)}`;
            break;
          case "eth_call": {
            const transaction = request.params?.[0] as
              | Readonly<{ data?: Hex; to?: Address }>
              | undefined;
            if (!transaction?.data || !transaction.to) {
              throw new Error("The fixture eth_call has no target or data.");
            }
            if (transaction.to.toLowerCase() === MOCK_TAPTAB_CONTRACT.toLowerCase()) {
              const encoded = encodeTapTabCall(transaction.data);
              billIds = encoded.billId === undefined ? [] : [encoded.billId.toString()];
              result = encoded.result;
            } else {
              const encoded = encodeMulticall(transaction.data);
              billIds = encoded.billIds;
              result = encoded.result;
            }
            break;
          }
          case "eth_getLogs":
          case "eth_getFilterChanges":
          case "eth_getFilterLogs":
            result = [];
            break;
          case "eth_newFilter":
            result = "0x1";
            break;
          case "eth_uninstallFilter":
            result = true;
            break;
          default:
            unknownMethods.push(request.method);
            throw new Error(`Unhandled deterministic RPC method ${request.method}.`);
        }
        observations.push({ method: request.method, billIds });
        return { jsonrpc: "2.0", id: request.id, result };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32_001,
            message: error instanceof Error ? error.message : "Deterministic RPC failure.",
          },
        };
      }
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0]),
    });
  });

  return {
    holdNextRequest() {
      let release = () => {};
      let markStarted = () => {};
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      nextGate = { matches: () => true, started: markStarted, wait };
      return { started, release };
    },
    holdNextDirectTapTabCall(functionName: string) {
      let release = () => {};
      let markStarted = () => {};
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      nextGate = {
        matches: (requests) =>
          requests.some((request) => isDirectTapTabCall(request, functionName)),
        started: markStarted,
        wait,
      };
      return { started, release };
    },
    holdNextBillSnapshot(billId: bigint) {
      let release = () => {};
      let markStarted = () => {};
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      nextGate = {
        matches: (requests) =>
          requests.some((request) => isBillSnapshotRequest(request, billId)),
        started: markStarted,
        wait,
      };
      return { started, release };
    },
    snapshot() {
      return {
        observations: observations.map((entry) => ({ ...entry })),
        unknownMethods: [...unknownMethods],
      };
    },
  };
}

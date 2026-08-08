"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  TransactionNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  createWalletClient,
  custom,
  formatEther,
  getAddress,
  type Address,
  type EIP1193Provider,
  type Hash,
  type PublicClient,
} from "viem";
import {
  TAPTAB_MONAD_TESTNET,
  createTapTabPublicClient,
  type TapTabContext,
} from "./taptab-chain";
import {
  allocateReceiptPenceToWei,
  findConfirmedTapTabBillCreated,
  prepareTapTabBill,
  type PreparedTapTabBill,
  type TapTabCreateBillQuote,
  type TapTabTrustedContract,
  type TapTabVerifiedReceipt,
} from "./taptab-create-bill";
import {
  PENDING_TAPTAB_CREATION_STORAGE_KEY,
  parsePendingTapTabCreations,
  pendingTapTabCreationForScope,
  pendingTapTabCreationScopeKey,
  removePendingTapTabCreation,
  replacePendingTapTabCreationHash,
  serialisePendingTapTabCreations,
  upsertPendingTapTabCreation,
  type PendingTapTabCreation,
  type PendingTapTabCreationScope,
} from "./taptab-pending-creations";
import {
  calculateBufferedGasLimit,
  calculateBufferedGasReserve,
} from "./wallet-readiness";
import {
  describeTapTabPreflightError,
  describeTapTabSubmittedError,
  describeTapTabWalletError,
} from "./taptab-transaction-preflight";
import { switchTapTabWalletToMonadTestnet } from "./wallet/taptab-wallet-network";

const EXPLORER_URL = TAPTAB_MONAD_TESTNET.blockExplorers.default.url;
const CREATION_RECEIPT_TIMEOUT_MS = 45_000;

export type TapTabCreateBillWallet = Readonly<{
  account?: Address;
  provider?: EIP1193Provider;
  isConnecting?: boolean;
  open?(): void;
}>;

export type TapTabCreatedBill = Readonly<{
  context: TapTabContext;
  transactionHash: Hash;
  blockNumber: bigint;
  payee: Address;
  deadline: bigint;
  subtotalPence: number;
  subtotalWei: bigint;
  metadataURI: string;
  quote: TapTabCreateBillQuote;
  submittedAt: number;
  confirmedAt: number;
  confirmationMs: number;
}>;

export type TapTabCreateBillPanelProps = Readonly<{
  receipt: TapTabVerifiedReceipt;
  trustedContract: TapTabTrustedContract;
  wallet: TapTabCreateBillWallet;
  quote?: TapTabCreateBillQuote;
  initialPayee?: string;
  onCreated(bill: TapTabCreatedBill): void;
}>;

type SubmissionState =
  | "idle"
  | "checking"
  | "awaiting-wallet"
  | "confirming"
  | "unverified"
  | "reverted"
  | "replaced"
  | "confirmed";

type PreparedCreationEvidence = Pick<
  PreparedTapTabBill,
  | "contractAddress"
  | "payee"
  | "deadline"
  | "subtotalPence"
  | "subtotalWei"
  | "metadataURI"
>;

type PendingCreation = Readonly<{
  hash: Hash;
  submittedAt: number;
  creator: Address;
  prepared: PreparedCreationEvidence;
  quote: TapTabCreateBillQuote;
  restored?: boolean;
}>;

type CreateBillPreflight =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "checking"; scope: string }>
  | Readonly<{
      status: "ready";
      scope: string;
      estimatedGas?: bigint;
      bufferedGasLimit?: bigint;
      feeReserveWei?: bigint;
    }>
  | Readonly<{ status: "blocked"; scope: string; message: string }>;

function pounds(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function confirmationDuration(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds} ms`
    : `${(milliseconds / 1_000).toFixed(2)} s`;
}

function parseLocalDeadline(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) return undefined;
  const seconds = Math.floor(milliseconds / 1_000);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function mutateStoredPendingCreations(
  mutate: (
    current: readonly PendingTapTabCreation[],
  ) => readonly PendingTapTabCreation[],
): void {
  if (typeof window === "undefined") return;
  try {
    const current = parsePendingTapTabCreations(
      window.localStorage.getItem(PENDING_TAPTAB_CREATION_STORAGE_KEY),
    );
    const next = [...mutate(current)];
    if (next.length === 0) {
      window.localStorage.removeItem(PENDING_TAPTAB_CREATION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      PENDING_TAPTAB_CREATION_STORAGE_KEY,
      serialisePendingTapTabCreations(next),
    );
  } catch {
    // Persistence is best-effort. The submitted hash remains visible in memory.
  }
}

function pendingCreationFromStorage(
  stored: PendingTapTabCreation,
): PendingCreation {
  return {
    hash: stored.hash,
    submittedAt: stored.submittedAt,
    creator: stored.account,
    prepared: {
      contractAddress: stored.contract,
      payee: stored.payee,
      deadline: BigInt(stored.deadline),
      subtotalPence: stored.subtotalPence,
      subtotalWei: BigInt(stored.subtotalWei),
      metadataURI: stored.metadataURI,
    },
    quote: stored.quote,
    restored: true,
  };
}

function pendingCreationForStorage(
  pending: PendingCreation,
): PendingTapTabCreation {
  return {
    chainId: TAPTAB_MONAD_TESTNET.id,
    contract: pending.prepared.contractAddress,
    account: pending.creator,
    hash: pending.hash,
    submittedAt: pending.submittedAt,
    payee: pending.prepared.payee,
    deadline: pending.prepared.deadline.toString(),
    subtotalPence: pending.prepared.subtotalPence,
    subtotalWei: pending.prepared.subtotalWei.toString(),
    metadataURI: pending.prepared.metadataURI,
    quote: pending.quote,
  };
}

async function describeCreationReceiptError(
  client: PublicClient,
  error: unknown,
  hash: Hash,
): Promise<string> {
  const timedOut =
    error instanceof WaitForTransactionReceiptTimeoutError ||
    (error instanceof Error && error.name === "WaitForTransactionReceiptTimeoutError");
  if (!timedOut) {
    return `${describeTapTabSubmittedError(error)} Check MonadVision before creating another bill.`;
  }

  try {
    await client.getTransaction({ hash });
    return "The 45-second confirmation check ended while this transaction was still visible. It may still confirm. Check MonadVision or use ‘Check status again’ before creating another bill.";
  } catch (lookupError) {
    if (
      lookupError instanceof TransactionNotFoundError ||
      (lookupError instanceof Error && lookupError.name === "TransactionNotFoundError")
    ) {
      return "The transaction is not currently visible after the 45-second confirmation check. It may have been dropped or replaced. Check MonadVision or use ‘Check status again’ before creating another bill.";
    }
    return "The 45-second confirmation check ended and the RPC could not recheck this transaction. Check MonadVision or use ‘Check status again’ before creating another bill.";
  }
}

export function TapTabCreateBillPanel({
  receipt,
  trustedContract,
  wallet,
  quote,
  initialPayee = "",
  onCreated,
}: TapTabCreateBillPanelProps) {
  const publicClient = useMemo(() => createTapTabPublicClient(), []);
  const [payee, setPayee] = useState(initialPayee);
  const [deadline, setDeadline] = useState("");
  const [payeeConfirmed, setPayeeConfirmed] = useState(false);
  const [deadlineConfirmed, setDeadlineConfirmed] = useState(false);
  const [confirmedQuoteKey, setConfirmedQuoteKey] = useState<string>();
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [transactionHash, setTransactionHash] = useState<Hash>();
  const [pendingCreation, setPendingCreation] = useState<PendingCreation>();
  const [confirmationMs, setConfirmationMs] = useState<number>();
  const [preflight, setPreflight] = useState<CreateBillPreflight>({ status: "idle" });
  const [error, setError] = useState<string>();

  const subtotalPence = useMemo(
    () => receipt.items.reduce((total, item) => total + item.pricePence, 0),
    [receipt.items],
  );
  const conversion = useMemo(() => {
    if (!quote) return undefined;
    try {
      return allocateReceiptPenceToWei(
        receipt.items.map((item) => item.pricePence),
        quote.gbpPerMon,
      );
    } catch {
      return undefined;
    }
  }, [quote, receipt.items]);
  const deadlineUnixSeconds = parseLocalDeadline(deadline);
  const quoteKey = quote
    ? `${quote.gbpPerMon}\u0000${quote.source}\u0000${quote.basis}\u0000${quote.observedAtUnixSeconds}`
    : undefined;
  const preflightScope = `${quoteKey ?? "no-quote"}\u0000${receipt.merchant}\u0000${receipt.items
    .map((item) => `${item.id}:${item.name}:${item.pricePence}:${item.shareSlots}`)
    .join("|")}\u0000${payee}\u0000${deadline}`;
  const pendingCreationScope = useMemo<PendingTapTabCreationScope | undefined>(
    () =>
      wallet.account
        ? {
            chainId: TAPTAB_MONAD_TESTNET.id,
            contract: getAddress(trustedContract.address),
            account: getAddress(wallet.account),
          }
        : undefined,
    [trustedContract.address, wallet.account],
  );
  const creationScopeKey = pendingCreationScope
    ? pendingTapTabCreationScopeKey(pendingCreationScope)
    : "";
  const mountedRef = useRef(true);
  const submissionLockRef = useRef<string | undefined>(undefined);
  const automaticallyResumedCreations = useRef(new Set<string>());
  const activeCreationScopeKeyRef = useRef(creationScopeKey);
  useLayoutEffect(() => {
    activeCreationScopeKeyRef.current = creationScopeKey;
  }, [creationScopeKey]);
  const activeIntentRef = useRef({
    scope: preflightScope,
    account: wallet.account,
    provider: wallet.provider,
  });
  useEffect(() => {
    activeIntentRef.current = {
      scope: preflightScope,
      account: wallet.account,
      provider: wallet.provider,
    };
  }, [preflightScope, wallet.account, wallet.provider]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submissionLockRef.current = undefined;
    };
  }, []);
  const visiblePreflight =
    preflight.status !== "idle" && preflight.scope !== preflightScope
      ? ({ status: "idle" } as const)
      : preflight;
  const quoteConfirmed = quoteKey !== undefined && confirmedQuoteKey === quoteKey;
  const visiblePendingCreationScopeKey = pendingCreation
    ? pendingTapTabCreationScopeKey({
        chainId: TAPTAB_MONAD_TESTNET.id,
        contract: pendingCreation.prepared.contractAddress,
        account: pendingCreation.creator,
      })
    : creationScopeKey;
  const pendingCreationBelongsToCurrentScope =
    visiblePendingCreationScopeKey === creationScopeKey;
  const visibleSubmissionState = pendingCreationBelongsToCurrentScope
    ? submissionState
    : "idle";
  const visiblePendingCreation = pendingCreationBelongsToCurrentScope
    ? pendingCreation
    : undefined;
  const visibleTransactionHash = pendingCreationBelongsToCurrentScope
    ? transactionHash
    : undefined;
  const visibleConfirmationMs = pendingCreationBelongsToCurrentScope
    ? confirmationMs
    : undefined;
  const visibleError = pendingCreationBelongsToCurrentScope ? error : undefined;
  const busy =
    visibleSubmissionState === "checking" ||
    visibleSubmissionState === "awaiting-wallet" ||
    visibleSubmissionState === "confirming" ||
    visibleSubmissionState === "unverified";
  const readyToCreate =
    Boolean(wallet.account && wallet.provider && quote && conversion && deadlineUnixSeconds) &&
    payeeConfirmed &&
    deadlineConfirmed &&
    quoteConfirmed &&
    !busy;

  const confirmCreation = useCallback(
    async (pending: PendingCreation) => {
      const persistedScope: PendingTapTabCreationScope = {
        chainId: TAPTAB_MONAD_TESTNET.id,
        contract: pending.prepared.contractAddress,
        account: pending.creator,
      };
      const pendingScopeKey = pendingTapTabCreationScopeKey(persistedScope);
      const resumeKey = `${pendingScopeKey}:${pending.hash.toLowerCase()}`;
      const isCurrentCreationScope = () =>
        mountedRef.current &&
        Boolean(pendingScopeKey) &&
        activeCreationScopeKeyRef.current === pendingScopeKey;
      if (!isCurrentCreationScope()) return "superseded" as const;
      let trackedHash = pending.hash;
      let trackedPending = pending;
      let replacementReason: "cancelled" | "replaced" | "repriced" | undefined;
      setSubmissionState("confirming");
      setError(
        pending.restored
          ? "Restored after refresh. TapTab is running one bounded status recheck and will not resubmit the bill."
          : undefined,
      );
      try {
        const receiptResult = await publicClient.waitForTransactionReceipt({
          hash: pending.hash,
          timeout: CREATION_RECEIPT_TIMEOUT_MS,
          checkReplacement: true,
          onReplaced(replacement) {
            const previousHash = trackedHash;
            trackedHash = replacement.transaction.hash;
            replacementReason = replacement.reason;
            trackedPending = { ...trackedPending, hash: trackedHash };
            if (isCurrentCreationScope()) {
              setTransactionHash(trackedHash);
              setPendingCreation(
                replacement.reason === "repriced" ? trackedPending : undefined,
              );
              setError(
                replacement.reason === "repriced"
                  ? "The wallet repriced this transaction. TapTab is checking the replacement receipt."
                  : replacement.reason === "cancelled"
                    ? "The wallet cancelled this bill creation with a replacement transaction."
                    : "The wallet replaced this bill creation with a different transaction.",
              );
            }
            mutateStoredPendingCreations((current) =>
              replacement.reason === "repriced"
                ? replacePendingTapTabCreationHash(
                    current,
                    persistedScope,
                    previousHash,
                    trackedHash,
                  )
                : removePendingTapTabCreation(current, persistedScope, previousHash),
            );
          },
        });
        if (replacementReason === "cancelled" || replacementReason === "replaced") {
          if (!isCurrentCreationScope()) {
            automaticallyResumedCreations.current.delete(resumeKey);
            return "superseded" as const;
          }
          setPendingCreation(undefined);
          setSubmissionState("replaced");
          setError(
            replacementReason === "cancelled"
              ? "The wallet cancelled this bill creation. No TapTab bill confirmation was accepted."
              : "The wallet replaced this bill creation with a different action. No TapTab bill confirmation was accepted; review the replacement in MonadVision.",
          );
          return "replaced" as const;
        }
        if (receiptResult.status !== "success") {
          mutateStoredPendingCreations((current) =>
            removePendingTapTabCreation(current, persistedScope, trackedHash),
          );
          if (!isCurrentCreationScope()) {
            automaticallyResumedCreations.current.delete(resumeKey);
            return "superseded" as const;
          }
          setPendingCreation(undefined);
          setSubmissionState("reverted");
          setError(
            "Monad confirmed that the bill-creation transaction reverted. No bill was created, so it is safe to try again.",
          );
          return "reverted" as const;
        }
        const confirmed = findConfirmedTapTabBillCreated(receiptResult.logs, {
          contractAddress: pending.prepared.contractAddress,
          creator: pending.creator,
          payee: pending.prepared.payee,
          deadline: pending.prepared.deadline,
          subtotalWei: pending.prepared.subtotalWei,
          metadataURI: pending.prepared.metadataURI,
        });
        const confirmedAt = Date.now();
        const measuredConfirmationMs = Math.max(0, confirmedAt - pending.submittedAt);
        mutateStoredPendingCreations((current) =>
          removePendingTapTabCreation(current, persistedScope, trackedHash),
        );
        if (!isCurrentCreationScope()) {
          automaticallyResumedCreations.current.delete(resumeKey);
          return "superseded" as const;
        }
        setPendingCreation(undefined);
        setTransactionHash(trackedHash);
        setConfirmationMs(measuredConfirmationMs);
        setSubmissionState("confirmed");
        onCreated({
          context: confirmed.context,
          transactionHash: trackedHash,
          blockNumber: receiptResult.blockNumber,
          payee: confirmed.payee,
          deadline: confirmed.deadline,
          subtotalPence: pending.prepared.subtotalPence,
          subtotalWei: confirmed.subtotalWei,
          metadataURI: confirmed.metadataURI,
          quote: pending.quote,
          submittedAt: pending.submittedAt,
          confirmedAt,
          confirmationMs: measuredConfirmationMs,
        });
        return "confirmed" as const;
      } catch (confirmationError) {
        if (replacementReason === "cancelled" || replacementReason === "replaced") {
          if (!isCurrentCreationScope()) {
            automaticallyResumedCreations.current.delete(resumeKey);
            return "superseded" as const;
          }
          setPendingCreation(undefined);
          setSubmissionState("replaced");
          setError(
            replacementReason === "cancelled"
              ? "The wallet cancelled this bill creation. No TapTab bill confirmation was accepted."
              : "The wallet replaced this bill creation with a different action. No TapTab bill confirmation was accepted; review the replacement in MonadVision.",
          );
          return "replaced" as const;
        }
        const message = await describeCreationReceiptError(
          publicClient as PublicClient,
          confirmationError,
          trackedHash,
        );
        if (!isCurrentCreationScope()) {
          automaticallyResumedCreations.current.delete(resumeKey);
          return "superseded" as const;
        }
        setPendingCreation(trackedPending);
        setTransactionHash(trackedHash);
        setSubmissionState("unverified");
        setError(message);
        return "unverified" as const;
      }
    },
    [onCreated, publicClient],
  );

  useEffect(() => {
    if (!pendingCreationScope || !creationScopeKey || typeof window === "undefined") {
      return;
    }
    let restored: PendingTapTabCreation | undefined;
    try {
      restored = pendingTapTabCreationForScope(
        parsePendingTapTabCreations(
          window.localStorage.getItem(PENDING_TAPTAB_CREATION_STORAGE_KEY),
        ),
        pendingCreationScope,
      );
    } catch {
      return;
    }
    if (!restored) {
      if (!pendingCreation || submissionLockRef.current === creationScopeKey) return;
      const staleScopeKey = pendingTapTabCreationScopeKey({
        chainId: TAPTAB_MONAD_TESTNET.id,
        contract: pendingCreation.prepared.contractAddress,
        account: pendingCreation.creator,
      });
      if (staleScopeKey !== creationScopeKey) return;
      const staleHash = pendingCreation.hash;
      const clearStale = window.setTimeout(() => {
        if (
          activeCreationScopeKeyRef.current !== creationScopeKey ||
          submissionLockRef.current === creationScopeKey
        ) {
          return;
        }
        setPendingCreation((current) => {
          if (!current || current.hash.toLowerCase() !== staleHash.toLowerCase()) {
            return current;
          }
          return undefined;
        });
        setTransactionHash(undefined);
        setConfirmationMs(undefined);
        setSubmissionState("idle");
        setError(undefined);
        setPreflight({ status: "idle" });
      }, 0);
      return () => window.clearTimeout(clearStale);
    }

    const resumeKey = `${creationScopeKey}:${restored.hash.toLowerCase()}`;
    if (automaticallyResumedCreations.current.has(resumeKey)) return;
    const restoredPending = pendingCreationFromStorage(restored);
    submissionLockRef.current = creationScopeKey;
    setConfirmationMs(undefined);
    setTransactionHash(restored.hash);
    setPendingCreation(restoredPending);
    setSubmissionState("unverified");
    setError(
      "Restored after refresh. TapTab will recheck this transaction once and will not submit it again.",
    );

    const resume = window.setTimeout(() => {
      if (automaticallyResumedCreations.current.has(resumeKey)) return;
      automaticallyResumedCreations.current.add(resumeKey);
      void confirmCreation(restoredPending).then((outcome) => {
        if (
          outcome !== "unverified" &&
          submissionLockRef.current === creationScopeKey
        ) {
          submissionLockRef.current = undefined;
        }
      });
    }, 0);
    return () => window.clearTimeout(resume);
  }, [confirmCreation, creationScopeKey, pendingCreation, pendingCreationScope]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submissionScopeKey = creationScopeKey;
    if (submissionLockRef.current === submissionScopeKey) return;
    submissionLockRef.current = submissionScopeKey;
    setError(undefined);
    setTransactionHash(undefined);
    setPendingCreation(undefined);
    setConfirmationMs(undefined);
    setPreflight({ status: "checking", scope: preflightScope });
    if (!wallet.account || !wallet.provider) {
      if (submissionLockRef.current === submissionScopeKey) {
        submissionLockRef.current = undefined;
      }
      setPreflight({ status: "idle" });
      wallet.open?.();
      return;
    }
    if (!quote || deadlineUnixSeconds === undefined) {
      const message = "A current quote and valid future deadline are required.";
      setPreflight({ status: "blocked", scope: preflightScope, message });
      setError(message);
      if (submissionLockRef.current === submissionScopeKey) {
        submissionLockRef.current = undefined;
      }
      return;
    }

    const account = wallet.account;
    const provider = wallet.provider;
    const submittedIntentScope = preflightScope;
    const assertCurrentIntent = () => {
      const current = activeIntentRef.current;
      if (
        !mountedRef.current ||
        current.scope !== submittedIntentScope ||
        current.account?.toLowerCase() !== account.toLowerCase() ||
        current.provider !== provider
      ) {
        throw new Error(
          "The bill details or connected wallet changed before submission. Nothing was submitted.",
        );
      }
    };
    let stage: "preflight" | "network" | "wallet" | "submitted" = "preflight";
    try {
      assertCurrentIntent();
      const nowUnixSeconds = Math.floor(Date.now() / 1_000);
      const prepared = prepareTapTabBill({
        trustedContract,
        receipt,
        quote,
        payee,
        deadlineUnixSeconds,
        nowUnixSeconds,
        confirmations: {
          payee: payeeConfirmed,
          deadline: deadlineConfirmed,
          quote: quoteConfirmed,
        },
      });

      setSubmissionState("checking");
      const simulationInput = {
        ...prepared.write,
        account,
      } as const;
      const simulateExactCreation = async () => {
        const rpcChainId = await publicClient.getChainId();
        if (rpcChainId !== TAPTAB_MONAD_TESTNET.id) {
          throw new Error(
            `The public RPC returned chain ${rpcChainId}, not Monad Testnet ${TAPTAB_MONAD_TESTNET.id}. Nothing was submitted.`,
          );
        }
        return publicClient.simulateContract(simulationInput as never);
      };
      await simulateExactCreation();
      const [gasResult, feesResult, balanceResult] = await Promise.allSettled([
        publicClient.estimateContractGas(simulationInput as never),
        publicClient.estimateFeesPerGas(),
        publicClient.getBalance({ address: account }),
      ]);
      assertCurrentIntent();
      const estimatedGas = gasResult.status === "fulfilled" ? gasResult.value : undefined;
      const bufferedGasLimit =
        estimatedGas === undefined ? undefined : calculateBufferedGasLimit(estimatedGas);
      const feeQuote =
        feesResult.status === "fulfilled"
          ? (feesResult.value as Readonly<{
              maxFeePerGas?: bigint;
              gasPrice?: bigint;
            }>)
          : undefined;
      const feePerGasWei = feeQuote?.maxFeePerGas ?? feeQuote?.gasPrice;
      const feeReserveWei =
        estimatedGas !== undefined && feePerGasWei !== undefined
          ? calculateBufferedGasReserve(estimatedGas, feePerGasWei)
          : undefined;
      if (
        balanceResult.status === "fulfilled" &&
        feeReserveWei !== undefined &&
        balanceResult.value < feeReserveWei
      ) {
        throw new Error(
          `This wallet needs up to ${formatEther(feeReserveWei)} MON for the estimated bill-creation fee. Nothing was submitted.`,
        );
      }
      setPreflight({
        status: "ready",
        scope: preflightScope,
        ...(estimatedGas === undefined ? {} : { estimatedGas }),
        ...(bufferedGasLimit === undefined ? {} : { bufferedGasLimit }),
        ...(feeReserveWei === undefined ? {} : { feeReserveWei }),
      });

      stage = "network";
      await switchTapTabWalletToMonadTestnet(provider);
      assertCurrentIntent();

      stage = "preflight";
      setPreflight({ status: "checking", scope: preflightScope });
      const simulation = await simulateExactCreation();
      assertCurrentIntent();
      setPreflight({
        status: "ready",
        scope: preflightScope,
        ...(estimatedGas === undefined ? {} : { estimatedGas }),
        ...(bufferedGasLimit === undefined ? {} : { bufferedGasLimit }),
        ...(feeReserveWei === undefined ? {} : { feeReserveWei }),
      });

      stage = "wallet";
      setSubmissionState("awaiting-wallet");

      const walletClient = createWalletClient({
        account,
        chain: TAPTAB_MONAD_TESTNET,
        transport: custom(provider),
      });
      assertCurrentIntent();
      const hash = await walletClient.writeContract({
        ...(simulation.request as Readonly<Record<string, unknown>>),
        account,
        ...(bufferedGasLimit === undefined ? {} : { gas: bufferedGasLimit }),
      } as never);
      stage = "submitted";
      const submittedAt = Date.now();
      const pending = { hash, submittedAt, creator: account, prepared, quote };
      const submittedScopeKey = pendingTapTabCreationScopeKey({
        chainId: TAPTAB_MONAD_TESTNET.id,
        contract: prepared.contractAddress,
        account,
      });
      automaticallyResumedCreations.current.add(
        `${submittedScopeKey}:${hash.toLowerCase()}`,
      );
      mutateStoredPendingCreations((current) =>
        upsertPendingTapTabCreation(current, pendingCreationForStorage(pending)),
      );
      if (activeCreationScopeKeyRef.current !== submittedScopeKey) {
        if (submissionLockRef.current === submissionScopeKey) {
          submissionLockRef.current = undefined;
        }
        return;
      }
      setTransactionHash(hash);
      setPendingCreation(pending);
      const outcome = await confirmCreation(pending);
      if (
        outcome !== "unverified" &&
        submissionLockRef.current === submissionScopeKey
      ) {
        submissionLockRef.current = undefined;
      }
    } catch (submissionError) {
      if (activeCreationScopeKeyRef.current !== submissionScopeKey) {
        if (submissionLockRef.current === submissionScopeKey) {
          submissionLockRef.current = undefined;
        }
        return;
      }
      const message =
        stage === "preflight"
          ? describeTapTabPreflightError(submissionError)
          : stage === "submitted"
            ? describeTapTabSubmittedError(submissionError)
            : describeTapTabWalletError(submissionError);
      setSubmissionState(stage === "submitted" ? "unverified" : "idle");
      setPreflight((current) =>
        stage !== "preflight" && current.status === "ready"
          ? current
          : { status: "blocked", scope: preflightScope, message },
      );
      setError(message);
      if (
        stage !== "submitted" &&
        submissionLockRef.current === submissionScopeKey
      ) {
        submissionLockRef.current = undefined;
      }
    }
  };

  return (
    <section className="live-control-card create-bill-card" aria-labelledby="create-bill-title">
      <div className="live-card-heading">
        <div>
          <span className="section-kicker">Receipt to Monad Testnet</span>
          <h3 id="create-bill-title">Create the live bill</h3>
        </div>
        <span>{receipt.items.length} verified rows</span>
      </div>

      <p className="live-action-hint">
        The pound receipt is converted once at the confirmed reference rate. Its source and
        timestamp are stored with the bill, while settlement uses native Testnet MON.
      </p>

      <dl className="create-bill-summary">
        <div>
          <dt>Merchant</dt>
          <dd>{receipt.merchant}</dd>
        </div>
        <div>
          <dt>Receipt subtotal</dt>
          <dd>{Number.isSafeInteger(subtotalPence) ? pounds(subtotalPence) : "Invalid receipt"}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>Monad Testnet · {TAPTAB_MONAD_TESTNET.id}</dd>
        </div>
        <div>
          <dt>Trusted contract</dt>
          <dd>{shortAddress(trustedContract.address)}</dd>
        </div>
      </dl>

      <form className="create-bill-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Venue payee wallet</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={payee}
            onChange={(event) => {
              setPayee(event.target.value);
              setPayeeConfirmed(false);
              setPreflight({ status: "idle" });
            }}
            placeholder="0x…"
            disabled={busy}
            aria-describedby="create-payee-help"
          />
          <small id="create-payee-help">Funds can only be withdrawn by this address after settlement.</small>
        </label>

        <label>
          <span>Refund deadline</span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(event) => {
              setDeadline(event.target.value);
              setDeadlineConfirmed(false);
              setPreflight({ status: "idle" });
            }}
            disabled={busy}
          />
          <small>After this time, an incomplete bill can expire and contributions become refundable.</small>
        </label>

        <div className="create-bill-quote" aria-live="polite">
          <span>Locked MON reference</span>
          {quote && conversion ? (
            <>
              <strong>£{quote.gbpPerMon} per MON</strong>
              <small>
                {quote.source} · {quote.basis} · {new Date(quote.observedAtUnixSeconds * 1_000).toLocaleString("en-GB")}
              </small>
              <small>{formatEther(conversion.subtotalWei)} Testnet MON for this receipt</small>
            </>
          ) : (
            <strong>No valid quote available</strong>
          )}
        </div>

        <div className={`create-bill-preflight is-${visiblePreflight.status}`} aria-live="polite">
          <span>Transaction safety check</span>
          {visiblePreflight.status === "idle" ? (
            <strong>Runs immediately before the wallet request</strong>
          ) : visiblePreflight.status === "checking" ? (
            <strong>Simulating this exact bill on Monad Testnet…</strong>
          ) : visiblePreflight.status === "blocked" ? (
            <>
              <strong>Submission blocked</strong>
              <small>{visiblePreflight.message}</small>
            </>
          ) : (
            <>
              <strong>Simulation passed</strong>
              <small>
                {visiblePreflight.estimatedGas !== undefined &&
                visiblePreflight.bufferedGasLimit !== undefined &&
                visiblePreflight.feeReserveWei !== undefined
                  ? `Estimated ${visiblePreflight.estimatedGas.toString()} gas units · buffered limit ${visiblePreflight.bufferedGasLimit.toString()} · fee reserve up to ${formatEther(visiblePreflight.feeReserveWei)} MON.`
                  : "Gas or balance estimates were unavailable; the exact simulation passed and the wallet will quote the network fee."}
              </small>
            </>
          )}
        </div>

        <fieldset className="create-bill-confirmations" disabled={busy}>
          <legend>Confirm before the wallet opens</legend>
          <label>
            <input
              type="checkbox"
              checked={payeeConfirmed}
              onChange={(event) => setPayeeConfirmed(event.target.checked)}
            />
            <span>I checked the venue payee wallet.</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={deadlineConfirmed}
              onChange={(event) => setDeadlineConfirmed(event.target.checked)}
            />
            <span>I checked the deadline and refund path.</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={quoteConfirmed}
              onChange={(event) =>
                setConfirmedQuoteKey(event.target.checked ? quoteKey : undefined)
              }
              disabled={!quote || !conversion}
            />
            <span>I accept this GBP-per-MON reference for the Testnet demo.</span>
          </label>
        </fieldset>

        {visibleError ? <p className="field-error" role="alert">{visibleError}</p> : null}

        {!wallet.account || !wallet.provider ? (
          <button
            type="button"
            className="lock-button"
            onClick={wallet.open}
            disabled={wallet.isConnecting}
          >
            {wallet.isConnecting ? "Opening sign-in…" : "Connect to create the bill"}
          </button>
        ) : (
          <button type="submit" className="lock-button" disabled={!readyToCreate}>
            {visibleSubmissionState === "checking"
              ? "Checking on Monad…"
              : visibleSubmissionState === "awaiting-wallet"
              ? "Confirm in wallet…"
              : visibleSubmissionState === "confirming"
                ? "Confirming on Monad…"
                : visibleSubmissionState === "unverified"
                  ? "Check transaction before retrying"
                : visibleSubmissionState === "reverted"
                  ? "Try bill creation again"
                  : visibleSubmissionState === "replaced"
                    ? "Create a new bill"
                : visibleSubmissionState === "confirmed"
                  ? "Live bill created"
                  : "Create live bill"}
          </button>
        )}
      </form>

      {visibleTransactionHash ? (
        <div className="create-bill-confirmed" role="status">
          {visibleConfirmationMs !== undefined ? (
            <strong>Confirmed on Monad in {confirmationDuration(visibleConfirmationMs)}</strong>
          ) : visibleSubmissionState === "unverified" ? (
            <strong>Final status needs review</strong>
          ) : visibleSubmissionState === "reverted" ? (
            <strong>Transaction reverted · no bill was created</strong>
          ) : visibleSubmissionState === "replaced" ? (
            <strong>Transaction replaced · no TapTab bill confirmation accepted</strong>
          ) : (
            <span>Waiting for Monad confirmation</span>
          )}
          <a
            className="live-explorer-link"
            href={`${EXPLORER_URL}/tx/${visibleTransactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View the bill-creation transaction
          </a>
          {visibleSubmissionState === "unverified" ? (
            <div className="create-bill-recovery-actions">
              <button
                type="button"
                className="quiet-button"
                disabled={!visiblePendingCreation}
                onClick={() => {
                  if (!visiblePendingCreation) return;
                  const manualScopeKey = pendingTapTabCreationScopeKey({
                    chainId: TAPTAB_MONAD_TESTNET.id,
                    contract: visiblePendingCreation.prepared.contractAddress,
                    account: visiblePendingCreation.creator,
                  });
                  submissionLockRef.current = manualScopeKey;
                  void confirmCreation({ ...visiblePendingCreation, restored: false }).then((outcome) => {
                    if (
                      outcome !== "unverified" &&
                      submissionLockRef.current === manualScopeKey
                    ) {
                      submissionLockRef.current = undefined;
                    }
                  });
                }}
              >
                Check status again
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  if (visiblePendingCreation) {
                    const persistedScope: PendingTapTabCreationScope = {
                      chainId: TAPTAB_MONAD_TESTNET.id,
                      contract: visiblePendingCreation.prepared.contractAddress,
                      account: visiblePendingCreation.creator,
                    };
                    mutateStoredPendingCreations((current) =>
                      removePendingTapTabCreation(
                        current,
                        persistedScope,
                        visiblePendingCreation.hash,
                      ),
                    );
                    const resetScopeKey = pendingTapTabCreationScopeKey(persistedScope);
                    if (submissionLockRef.current === resetScopeKey) {
                      submissionLockRef.current = undefined;
                    }
                  }
                  setPendingCreation(undefined);
                  setSubmissionState("idle");
                  setTransactionHash(undefined);
                  setError(undefined);
                  setPreflight({ status: "idle" });
                }}
              >
                MonadVision shows failed · reset
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

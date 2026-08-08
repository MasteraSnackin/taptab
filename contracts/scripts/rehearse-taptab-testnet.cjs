const assert = require("node:assert/strict");
const { mkdir, readFile, writeFile, chmod } = require("node:fs/promises");
const path = require("node:path");

const hre = require("hardhat");

const CHAIN_ID = 10_143n;
const ACTOR_FUNDING = hre.ethers.parseEther("0.35");
const MIN_CREATOR_BALANCE = hre.ethers.parseEther("1.2");
const EXPLORER = "https://testnet.monadvision.com";
const State = Object.freeze({ Funding: 2n, Settled: 3n, Cancelled: 4n });
const outputDirectory = path.resolve(__dirname, "../../outputs");
const walletPath = path.join(outputDirectory, "taptab-testnet-rehearsal-wallets.json");
const evidencePath = path.join(outputDirectory, "taptab-testnet-rehearsal.json");
const publicEvidencePath = path.resolve(
  __dirname,
  "../../docs/submission/monad-testnet-multiwallet-evidence.json",
);
const priorFundingAttempts = Object.freeze([
  Object.freeze({
    label: "Fund Alice rehearsal wallet",
    hash: "0x6f075b9910a031209aa65ddbe2b5ebdf9b98ea45521fd0a59cf3b6411ac95ebb",
    explorerUrl: `${EXPLORER}/tx/0x6f075b9910a031209aa65ddbe2b5ebdf9b98ea45521fd0a59cf3b6411ac95ebb`,
    status: "confirmed",
    valueWei: ACTOR_FUNDING.toString(),
  }),
  Object.freeze({
    label: "Initial Bob funding attempt",
    hash: "0x384df466938bcacfb837113eb3dac7f55423f53047c1d2324d7181f64ce4a0e8",
    explorerUrl: `${EXPLORER}/tx/0x384df466938bcacfb837113eb3dac7f55423f53047c1d2324d7181f64ce4a0e8`,
    status: "reverted",
    gasUsed: "21000",
    note: "The RPC estimated a 21,000-gas new-account transfer which reverted. The retry uses an explicit 50,000-gas ceiling.",
  }),
  Object.freeze({
    label: "Fund Bob rehearsal wallet with explicit gas ceiling",
    hash: "0xbde920741b57fc4c85508c4dd71fd214f5d0315eac034a7db897ccc907a5f9bc",
    explorerUrl: `${EXPLORER}/tx/0xbde920741b57fc4c85508c4dd71fd214f5d0315eac034a7db897ccc907a5f9bc`,
    status: "confirmed",
    valueWei: ACTOR_FUNDING.toString(),
    gasUsed: "50000",
  }),
]);

function contractAddress() {
  const value = (process.env.TAPTAB_CONTRACT_ADDRESS || "").trim();
  if (!hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
    throw new Error("TAPTAB_CONTRACT_ADDRESS must identify the deployed TapTab contract.");
  }
  return hre.ethers.getAddress(value);
}

function serialisedError(error) {
  return {
    name: error?.revert?.name || error?.errorName || error?.name || "Error",
    message: error?.shortMessage || error?.message || "Unknown contract refusal",
  };
}

function publicActor(label, wallet) {
  return { label, address: wallet.address };
}

async function loadOrCreateParticipantWallets(provider) {
  await mkdir(outputDirectory, { recursive: true });
  let stored;
  try {
    stored = JSON.parse(await readFile(walletPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const wallets = ["Alice", "Bob"].map((label) => {
      const wallet = hre.ethers.Wallet.createRandom();
      return { label, address: wallet.address, privateKey: wallet.privateKey };
    });
    stored = { schema: "taptab-private-testnet-wallets", version: 1, chainId: CHAIN_ID.toString(), wallets };
    await writeFile(walletPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(walletPath, 0o600);
  }

  if (
    stored?.schema !== "taptab-private-testnet-wallets" ||
    stored?.chainId !== CHAIN_ID.toString() ||
    !Array.isArray(stored.wallets) ||
    stored.wallets.length !== 2
  ) {
    throw new Error("The private rehearsal-wallet file is malformed or belongs to another chain.");
  }

  return stored.wallets.map(({ label, address, privateKey }) => {
    const wallet = new hre.ethers.Wallet(privateKey, provider);
    if (wallet.address !== hre.ethers.getAddress(address)) {
      throw new Error(`Stored ${label} wallet does not match its recorded address.`);
    }
    return Object.assign(wallet, { rehearsalLabel: label });
  });
}

async function recordTransaction(records, label, transactionPromise, billId) {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait();
  assert.ok(receipt && receipt.status === 1, `${label} did not confirm successfully.`);
  records.push({
    label,
    ...(billId === undefined ? {} : { billId: billId.toString() }),
    hash: receipt.hash,
    explorerUrl: `${EXPLORER}/tx/${receipt.hash}`,
    blockNumber: receipt.blockNumber.toString(),
    from: transaction.from,
    to: transaction.to,
    nonce: transaction.nonce,
    gasUsed: receipt.gasUsed.toString(),
    gasPriceWei: (receipt.gasPrice || 0n).toString(),
    valueWei: transaction.value.toString(),
  });
  return receipt;
}

function createdBillId(contract, receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "BillCreated") return parsed.args.billId;
    } catch {
      // Other contracts may emit logs in the same receipt.
    }
  }
  throw new Error("The confirmed creation transaction did not emit BillCreated.");
}

async function createBill(contract, creator, records, label, amount, shareCount) {
  const latest = await hre.ethers.provider.getBlock("latest");
  assert.ok(latest, "Monad Testnet did not return its latest block.");
  const metadata = {
    schema: "taptab-testnet-rehearsal",
    version: 1,
    label,
    currency: "TESTNET_MON",
    notice: "Technical rehearsal only. Testnet MON has no cash value.",
  };
  const receipt = await recordTransaction(
    records,
    `Create ${label}`,
    contract.connect(creator).createBill(
      creator.address,
      `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`,
      latest.timestamp + 21_600,
      [amount],
      [shareCount],
    ),
  );
  return createdBillId(contract, receipt);
}

async function inviteJoinClaimApprove({ contract, creator, participants, billId, records }) {
  await recordTransaction(
    records,
    "Invite rehearsal participants",
    contract.connect(creator).inviteMany(billId, participants.map((wallet) => wallet.address)),
    billId,
  );
  for (const [index, wallet] of participants.entries()) {
    await recordTransaction(
      records,
      `${wallet.rehearsalLabel} joins`,
      contract.connect(wallet).joinBill(billId, index !== 1, index === 0 ? 1_000 : index === 1 ? 1_250 : 1_500),
      billId,
    );
    await recordTransaction(
      records,
      `${wallet.rehearsalLabel} claims share ${index + 1}`,
      contract.connect(wallet).claimItemShare(billId, 0, index),
      billId,
    );
  }
  const digest = await contract.currentSplitDigest(billId);
  for (const wallet of participants) {
    await recordTransaction(
      records,
      `${wallet.rehearsalLabel} approves exact split`,
      contract.connect(wallet).approveSplit(billId, digest),
      billId,
    );
  }
  await recordTransaction(records, "Open protected funding", contract.connect(creator).openFunding(billId), billId);
  assert.equal((await contract.getBill(billId)).state, State.Funding);
}

async function fundActorIfNeeded(creator, actor, records) {
  if (actor.address === creator.address) return;
  const balance = await hre.ethers.provider.getBalance(actor.address);
  if (balance >= ACTOR_FUNDING) return;
  await recordTransaction(
    records,
    `Fund ${actor.rehearsalLabel} rehearsal wallet`,
    creator.sendTransaction({
      to: actor.address,
      value: ACTOR_FUNDING - balance,
      gasLimit: 50_000n,
    }),
  );
}

async function existingSuccessBill(contract, creator, participants) {
  const latestId = await contract.billCount();
  const minimumId = latestId > 12n ? latestId - 12n : 1n;
  for (let billId = latestId; billId >= minimumId; billId -= 1n) {
    const bill = await contract.getBill(billId);
    if (
      bill.creator !== creator.address ||
      (bill.state !== State.Funding && bill.state !== State.Settled) ||
      bill.subtotal !== hre.ethers.parseEther("0.003") ||
      !bill.metadataURI.includes("Three-wallet%20settlement%20rehearsal")
    ) {
      continue;
    }
    const joined = await contract.getParticipants(billId);
    if (
      joined.length === participants.length &&
      joined.every((address, index) => address === participants[index].address)
    ) {
      return billId;
    }
  }
  return null;
}

async function existingRefundBill(contract, creator, participants) {
  const latestId = await contract.billCount();
  const minimumId = latestId > 12n ? latestId - 12n : 1n;
  for (let billId = latestId; billId >= minimumId; billId -= 1n) {
    const bill = await contract.getBill(billId);
    if (
      bill.creator !== creator.address ||
      bill.state !== State.Cancelled ||
      bill.subtotal !== hre.ethers.parseEther("0.0012") ||
      !bill.metadataURI.includes("Two-wallet%20cancellation%20and%20refund%20rehearsal")
    ) {
      continue;
    }
    const joined = await contract.getParticipants(billId);
    if (
      joined.length === participants.length &&
      joined.every((address, index) => address === participants[index].address)
    ) {
      return billId;
    }
  }
  return null;
}

async function contractTransactionEvidence(contract, billIds) {
  const billIdSet = new Set(billIds.map((billId) => billId.toString()));
  const latestBlock = await hre.ethers.provider.getBlockNumber();
  let logs = [];
  let recoveredCreationIds = new Set();
  for (let window = 2_000; window <= 32_000; window *= 2) {
    const fromBlock = Math.max(0, latestBlock - window);
    logs = [];
    recoveredCreationIds = new Set();
    for (let start = fromBlock; start <= latestBlock; start += 100) {
      logs.push(
        ...(await hre.ethers.provider.getLogs({
          address: await contract.getAddress(),
          fromBlock: start,
          toBlock: Math.min(start + 99, latestBlock),
        })),
      );
    }
    for (const log of logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === "BillCreated" && billIdSet.has(parsed.args.billId.toString())) {
          recoveredCreationIds.add(parsed.args.billId.toString());
        }
      } catch {
        // Ignore logs that do not belong to the current ABI.
      }
    }
    if (recoveredCreationIds.size === billIds.length) break;
  }
  if (recoveredCreationIds.size !== billIds.length) {
    throw new Error("Could not recover one confirmed BillCreated event per rehearsal bill within 32,000 blocks.");
  }
  const grouped = new Map();
  for (const log of logs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    const billId = parsed?.args?.billId;
    if (billId === undefined || !billIdSet.has(billId.toString())) continue;
    const entry = grouped.get(log.transactionHash) || {
      hash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      billId: billId.toString(),
      events: [],
    };
    entry.events.push(parsed.name);
    entry.logIndex = Math.min(entry.logIndex, log.index);
    grouped.set(log.transactionHash, entry);
  }

  const transactions = [];
  for (const entry of grouped.values()) {
    const [transaction, receipt] = await Promise.all([
      hre.ethers.provider.getTransaction(entry.hash),
      hre.ethers.provider.getTransactionReceipt(entry.hash),
    ]);
    if (!transaction || !receipt || receipt.status !== 1) {
      throw new Error(`Contract evidence transaction ${entry.hash} is missing or unsuccessful.`);
    }
    transactions.push({
      ...entry,
      explorerUrl: `${EXPLORER}/tx/${entry.hash}`,
      transactionIndex: receipt.index,
      from: transaction.from,
      to: transaction.to,
      nonce: transaction.nonce,
      gasUsed: receipt.gasUsed.toString(),
      gasPriceWei: (receipt.gasPrice || 0n).toString(),
      valueWei: transaction.value.toString(),
    });
  }
  return transactions.sort(
    (left, right) => left.blockNumber - right.blockNumber || left.transactionIndex - right.transactionIndex,
  );
}

async function historicalIncompleteSettlementEvidence(contract, billId, creator, transactions) {
  const contributions = transactions.filter(
    (transaction) =>
      transaction.billId === billId.toString() && transaction.events.includes("ContributionReceived"),
  );
  if (contributions.length !== 3) {
    throw new Error("Expected exactly three confirmed contributions in the settlement journey.");
  }
  const blockTag = contributions[0].blockNumber;
  const call = {
    from: creator.address,
    to: await contract.getAddress(),
    data: contract.interface.encodeFunctionData("settleBill", [billId]),
  };
  let refusal;
  try {
    await hre.ethers.provider.send("eth_call", [call, hre.ethers.toQuantity(blockTag)]);
  } catch (error) {
    let parsed;
    try {
      parsed = contract.interface.parseError(error?.data);
    } catch {
      // The assertion below will fail closed when the RPC omits decodable data.
    }
    if (parsed?.name === "BillNotFullyFunded") {
      refusal = {
        method: "historical eth_call",
        blockTag,
        name: parsed.name,
        selector: parsed.selector,
        fundedWei: parsed.args[0].toString(),
        totalDueWei: parsed.args[1].toString(),
        revertData: error.data,
      };
    }
  }
  assert.ok(refusal, "Historical incomplete-settlement call did not return BillNotFullyFunded.");
  return refusal;
}

async function main() {
  const provider = hre.ethers.provider;
  const network = await provider.getNetwork();
  if (hre.network.name !== "monadTestnet" || network.chainId !== CHAIN_ID) {
    throw new Error(`Refusing to write outside Monad Testnet chain ${CHAIN_ID}.`);
  }

  const [creator] = await hre.ethers.getSigners();
  if (!creator) throw new Error("DEPLOYER_PRIVATE_KEY is not configured.");
  const creatorBalance = await provider.getBalance(creator.address);

  const participantWallets = await loadOrCreateParticipantWallets(provider);
  const alice = Object.assign(participantWallets[0], { rehearsalLabel: "Alice" });
  const bob = Object.assign(participantWallets[1], { rehearsalLabel: "Bob" });
  const creatorActor = Object.assign(creator, { rehearsalLabel: "Creator" });
  const records = [];

  const contract = await hre.ethers.getContractAt("TapTab", contractAddress());
  const deployedCode = await provider.getCode(await contract.getAddress());
  if (deployedCode === "0x") throw new Error("No contract bytecode exists at TAPTAB_CONTRACT_ADDRESS.");

  const successParticipants = [creatorActor, alice, bob];
  const refundParticipants = [alice, bob];
  let successBillId = await existingSuccessBill(contract, creator, successParticipants);
  let refundBillId = await existingRefundBill(contract, creator, refundParticipants);
  const completedJourneyFound =
    successBillId !== null &&
    refundBillId !== null &&
    (await contract.getBill(successBillId)).state === State.Settled;
  if (!completedJourneyFound) {
    if (creatorBalance < MIN_CREATOR_BALANCE) {
      throw new Error(
        `Preflight refused: creator balance ${hre.ethers.formatEther(creatorBalance)} MON is below 1.2 MON.`,
      );
    }
    await fundActorIfNeeded(creator, alice, records);
    await fundActorIfNeeded(creator, bob, records);
  }

  if (successBillId === null) {
    successBillId = await createBill(
      contract,
      creator,
      records,
      "Three-wallet settlement rehearsal",
      hre.ethers.parseEther("0.003"),
      3,
    );
    await inviteJoinClaimApprove({
      contract,
      creator,
      participants: successParticipants,
      billId: successBillId,
      records,
    });
  } else {
    console.log(`Using confirmed settlement journey bill ${successBillId}.`);
  }

  const successDues = [];
  for (const wallet of successParticipants) {
    const participant = await contract.getParticipant(successBillId, wallet.address);
    successDues.push({ label: wallet.rehearsalLabel, address: wallet.address, amountDueWei: participant.amountDue.toString() });
  }

  let incompleteSettlementRefusal;
  const successStateBeforeContinuation = (await contract.getBill(successBillId)).state;
  if (successStateBeforeContinuation === State.Funding) {
    const creatorLedger = await contract.getParticipant(successBillId, creator.address);
    if (creatorLedger.amountFunded < creatorLedger.amountDue) {
      await recordTransaction(
        records,
        "Creator funds own share",
        contract.connect(creator).fundParticipant(successBillId, creator.address, {
          value: creatorLedger.amountDue - creatorLedger.amountFunded,
        }),
        successBillId,
      );
    }
    try {
      await contract.connect(creator).settleBill.staticCall(successBillId);
    } catch (error) {
      incompleteSettlementRefusal = serialisedError(error);
    }
    assert.ok(incompleteSettlementRefusal, "Incomplete settlement unexpectedly succeeded.");
    for (const [wallet] of [
      [alice, successDues[1]],
      [bob, successDues[2]],
    ]) {
      const ledger = await contract.getParticipant(successBillId, wallet.address);
      if (ledger.amountFunded >= ledger.amountDue) continue;
      await recordTransaction(
        records,
        `${wallet.rehearsalLabel} funds exact share`,
        contract.connect(wallet).fundParticipant(successBillId, wallet.address, {
          value: ledger.amountDue - ledger.amountFunded,
        }),
        successBillId,
      );
    }
    const fullyFunded = await contract.getBill(successBillId);
    assert.equal(fullyFunded.totalFunded, fullyFunded.totalDue);
    await recordTransaction(records, "Settle fully funded bill", contract.connect(creator).settleBill(successBillId), successBillId);
    await recordTransaction(records, "Payee withdraws settled proceeds", contract.connect(creator).withdrawProceeds(successBillId), successBillId);
  } else {
    assert.equal(successStateBeforeContinuation, State.Settled);
    incompleteSettlementRefusal = {
      name: "ObservedIncompleteSettlementRefusal",
      message: "Observed before final funding. Monad RPC returned a revert without custom-error data; no transaction was broadcast.",
    };
  }
  assert.equal((await contract.getBill(successBillId)).state, State.Settled);
  assert.equal(await contract.proceedsAvailable(successBillId), 0n);

  let aliceContribution;
  let bobContribution;
  if (refundBillId === null) {
    refundBillId = await createBill(
      contract,
      creator,
      records,
      "Two-wallet cancellation and refund rehearsal",
      hre.ethers.parseEther("0.0012"),
      2,
    );
    await inviteJoinClaimApprove({
      contract,
      creator,
      participants: refundParticipants,
      billId: refundBillId,
      records,
    });
    const aliceRefundDue = (await contract.getParticipant(refundBillId, alice.address)).amountDue;
    const bobRefundDue = (await contract.getParticipant(refundBillId, bob.address)).amountDue;
    aliceContribution = aliceRefundDue / 2n;
    bobContribution = bobRefundDue / 2n;
    await recordTransaction(
      records,
      "Alice partly funds before cancellation",
      contract.connect(alice).fundParticipant(refundBillId, alice.address, { value: aliceContribution }),
      refundBillId,
    );
    await recordTransaction(
      records,
      "Bob partly funds before cancellation",
      contract.connect(bob).fundParticipant(refundBillId, bob.address, { value: bobContribution }),
      refundBillId,
    );
    await recordTransaction(records, "Creator cancels incomplete bill", contract.connect(creator).cancelBill(refundBillId), refundBillId);
    assert.equal(await contract.claimableRefund(refundBillId, alice.address), aliceContribution);
    assert.equal(await contract.claimableRefund(refundBillId, bob.address), bobContribution);
    await recordTransaction(records, "Alice claims original contribution", contract.connect(alice).claimRefund(refundBillId), refundBillId);
    await recordTransaction(records, "Bob claims original contribution", contract.connect(bob).claimRefund(refundBillId), refundBillId);
  } else {
    console.log(`Using confirmed cancellation/refund journey bill ${refundBillId}.`);
    aliceContribution = (await contract.getParticipant(refundBillId, alice.address)).amountFunded;
    bobContribution = (await contract.getParticipant(refundBillId, bob.address)).amountFunded;
  }
  assert.equal((await contract.getBill(refundBillId)).state, State.Cancelled);
  assert.equal(await contract.claimableRefund(refundBillId, alice.address), 0n);
  assert.equal(await contract.claimableRefund(refundBillId, bob.address), 0n);

  const finalBlock = await provider.getBlockNumber();
  const finalCreatorBalance = await provider.getBalance(creator.address);
  const transactions = await contractTransactionEvidence(contract, [successBillId, refundBillId]);
  incompleteSettlementRefusal = await historicalIncompleteSettlementEvidence(
    contract,
    successBillId,
    creator,
    transactions,
  );
  const report = {
    schema: "taptab-monad-testnet-multiwallet-rehearsal",
    version: 1,
    generatedAt: new Date().toISOString(),
    boundary: "Public Monad Testnet evidence. Testnet MON has no cash value. Private keys are excluded.",
    chain: { name: "Monad Testnet", chainId: CHAIN_ID.toString(), finalBlock },
    contract: {
      address: await contract.getAddress(),
      explorerUrl: `${EXPLORER}/address/${await contract.getAddress()}`,
    },
    actors: {
      creator: publicActor("Creator", creator),
      alice: publicActor("Alice", alice),
      bob: publicActor("Bob", bob),
    },
    preflight: {
      creatorBalanceBeforeWei: creatorBalance.toString(),
      minimumRequiredWei: MIN_CREATOR_BALANCE.toString(),
      participantFundingTargetWei: ACTOR_FUNDING.toString(),
      priorFundingAttempts,
    },
    journeys: {
      settlement: {
        billId: successBillId.toString(),
        canonicalUrl: `${EXPLORER}/address/${await contract.getAddress()}?tab=Contract`,
        participants: successDues,
        incompleteSettlementRefusal,
        finalState: "Settled",
        exactFundingConfirmed: true,
        proceedsWithdrawn: true,
      },
      cancellationRefund: {
        billId: refundBillId.toString(),
        finalState: "Cancelled",
        contributionsWei: { alice: aliceContribution.toString(), bob: bobContribution.toString() },
        refundsClaimedByOriginalContributors: true,
      },
    },
    checks: [
      "three distinct wallets signed the successful journey",
      "three deterministic item-share claims",
      "unanimous approval of one split digest",
      "incomplete settlement refused",
      "exact participant funding",
      "successful settlement and payee withdrawal",
      "incomplete-bill cancellation",
      "refunds returned to both original contributors",
    ],
    transactions,
    finalCreatorBalanceWei: finalCreatorBalance.toString(),
    privateWalletFile: "outputs/taptab-testnet-rehearsal-wallets.json (git-ignored, mode 0600)",
  };
  const serialisedReport = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    writeFile(evidencePath, serialisedReport, "utf8"),
    writeFile(publicEvidencePath, serialisedReport, "utf8"),
  ]);

  console.log("Monad Testnet multi-wallet rehearsal passed.");
  console.log(`Settlement bill: ${successBillId}`);
  console.log(`Cancellation/refund bill: ${refundBillId}`);
  console.log(`Contract transactions: ${transactions.length}`);
  console.log(`Evidence: ${evidencePath}`);
  console.log(`Public evidence: ${publicEvidencePath}`);
}

main().catch((error) => {
  console.error(`Monad Testnet rehearsal failed: ${error instanceof Error ? error.message : "unknown failure"}`);
  process.exitCode = 1;
});

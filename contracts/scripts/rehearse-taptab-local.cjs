const assert = require("node:assert/strict");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

const hre = require("hardhat");

const LOCAL_CHAIN_ID = 31_337n;
const State = Object.freeze({
  Draft: 1n,
  Funding: 2n,
  Settled: 3n,
  Cancelled: 4n,
  Expired: 5n,
});

async function latestTimestamp() {
  const block = await hre.ethers.provider.getBlock("latest");
  assert.ok(block, "The local chain did not return its latest block.");
  return block.timestamp;
}

async function recordTransaction(records, label, transactionPromise, billId) {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait();
  assert.ok(receipt && receipt.status === 1, `${label} did not confirm successfully.`);
  records.push({
    label,
    ...(billId === undefined ? {} : { billId: billId.toString() }),
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber.toString(),
  });
  return receipt;
}

async function expectCustomError(action, errorName) {
  await assert.rejects(
    async () => {
      const transaction = await action();
      await transaction.wait();
    },
    (error) =>
      error instanceof Error &&
      (error.message.includes(errorName) || error.shortMessage?.includes(errorName)),
    `Expected ${errorName}.`,
  );
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== LOCAL_CHAIN_ID || hre.network.name !== "hardhat") {
    throw new Error(
      `Refusing to rehearse outside the ephemeral Hardhat network (received ${hre.network.name}, chain ${network.chainId}).`,
    );
  }

  const [creator, payee, alice, bob, carol, sponsor, outsider] =
    await hre.ethers.getSigners();
  const records = [];
  const TapTab = await hre.ethers.getContractFactory("TapTab");
  const tapTab = await TapTab.deploy();
  await tapTab.waitForDeployment();
  const deploymentTransaction = tapTab.deploymentTransaction();
  assert.ok(deploymentTransaction, "The local deployment transaction is unavailable.");
  await recordTransaction(records, "Deploy TapTab locally", deploymentTransaction);
  const contractAddress = await tapTab.getAddress();

  async function createBill(label, itemAmounts, shareCounts, duration = 7_200) {
    const deadline = (await latestTimestamp()) + duration;
    const metadata = {
      schema: "taptab-local-rehearsal",
      version: 1,
      label,
      unit: "abstract-local-unit",
      notice: "Not GBP, MON or Monad Testnet evidence.",
    };
    await recordTransaction(
      records,
      `Create ${label}`,
      tapTab
        .connect(creator)
        .createBill(
          payee.address,
          `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`,
          deadline,
          itemAmounts,
          shareCounts,
        ),
    );
    return { billId: await tapTab.billCount(), deadline };
  }

  async function inviteAndJoin(billId, participants) {
    await recordTransaction(
      records,
      "Invite rehearsal diners",
      tapTab
        .connect(creator)
        .inviteMany(billId, participants.map(({ signer }) => signer.address)),
      billId,
    );
    for (const participant of participants) {
      await recordTransaction(
        records,
        `Join as ${participant.label}`,
        tapTab
          .connect(participant.signer)
          .joinBill(billId, participant.fairRemainder, participant.tipVoteBps),
        billId,
      );
    }
  }

  async function approveAndOpen(billId, participants) {
    const digest = await tapTab.currentSplitDigest(billId);
    for (const participant of participants) {
      await recordTransaction(
        records,
        `Approve split as ${participant.label}`,
        tapTab.connect(participant.signer).approveSplit(billId, digest),
        billId,
      );
    }
    await recordTransaction(
      records,
      "Open funding",
      tapTab.connect(creator).openFunding(billId),
      billId,
    );
    assert.equal((await tapTab.getBill(billId)).state, State.Funding);
  }

  const diners = [
    { label: "Alice", signer: alice, fairRemainder: true, tipVoteBps: 1_000 },
    { label: "Bob", signer: bob, fairRemainder: false, tipVoteBps: 1_250 },
    { label: "Carol", signer: carol, fairRemainder: true, tipVoteBps: 1_500 },
  ];

  const successful = await createBill(
    "Table 7 success rehearsal",
    [1_200n, 750n, 900n, 1_400n, 600n],
    [1, 2, 2, 4, 2],
  );
  await inviteAndJoin(successful.billId, diners);
  await recordTransaction(
    records,
    "Alice claims item shares",
    tapTab.connect(alice).claimMany(successful.billId, [0, 1, 3], [0, 0, 0]),
    successful.billId,
  );
  await recordTransaction(
    records,
    "Bob claims item shares",
    tapTab.connect(bob).claimMany(successful.billId, [1, 2, 3], [1, 0, 1]),
    successful.billId,
  );
  await recordTransaction(
    records,
    "Carol claims item shares",
    tapTab.connect(carol).claimMany(successful.billId, [2, 3, 4], [1, 2, 0]),
    successful.billId,
  );
  await approveAndOpen(successful.billId, diners);

  const successBill = await tapTab.getBill(successful.billId);
  assert.equal(successBill.subtotal, 4_850n);
  assert.equal(successBill.lockedTipBps, 1_250n);
  assert.equal(successBill.totalDue, 5_456n);
  const successLedgers = await Promise.all(
    diners.map(({ signer }) => tapTab.getParticipant(successful.billId, signer.address)),
  );
  assert.deepEqual(
    successLedgers.map(({ baseDue, tipDue, amountDue }) => [baseDue, tipDue, amountDue]),
    [
      [2_250n, 282n, 2_532n],
      [1_175n, 146n, 1_321n],
      [1_425n, 178n, 1_603n],
    ],
  );

  await recordTransaction(
    records,
    "Alice funds her allocation",
    tapTab
      .connect(alice)
      .fundParticipant(successful.billId, alice.address, { value: 2_532n }),
    successful.billId,
  );
  await expectCustomError(
    () => tapTab.connect(creator).settleBill(successful.billId),
    "BillNotFullyFunded",
  );
  await recordTransaction(
    records,
    "Sponsor funds Bob",
    tapTab
      .connect(sponsor)
      .fundParticipant(successful.billId, bob.address, { value: 1_321n }),
    successful.billId,
  );
  await recordTransaction(
    records,
    "Carol funds her allocation",
    tapTab
      .connect(carol)
      .fundParticipant(successful.billId, carol.address, { value: 1_603n }),
    successful.billId,
  );
  assert.equal(await tapTab.contributionOf(successful.billId, sponsor.address), 1_321n);
  assert.equal((await tapTab.getBill(successful.billId)).totalFunded, 5_456n);
  await recordTransaction(
    records,
    "Settle fully funded bill",
    tapTab.connect(creator).settleBill(successful.billId),
    successful.billId,
  );
  assert.equal((await tapTab.getBill(successful.billId)).state, State.Settled);
  assert.equal(await tapTab.proceedsAvailable(successful.billId), 5_456n);
  await recordTransaction(
    records,
    "Payee withdraws proceeds",
    tapTab.connect(payee).withdrawProceeds(successful.billId),
    successful.billId,
  );
  assert.equal(await tapTab.proceedsAvailable(successful.billId), 0n);

  const refundDiners = [
    { label: "Alice", signer: alice, fairRemainder: false, tipVoteBps: 0 },
    { label: "Bob", signer: bob, fairRemainder: false, tipVoteBps: 0 },
  ];

  async function openTwoDinerBill(label, duration = 7_200) {
    const created = await createBill(label, [101n], [2], duration);
    await inviteAndJoin(created.billId, refundDiners);
    await recordTransaction(
      records,
      "Alice claims first half",
      tapTab.connect(alice).claimItemShare(created.billId, 0, 0),
      created.billId,
    );
    await recordTransaction(
      records,
      "Bob claims second half",
      tapTab.connect(bob).claimItemShare(created.billId, 0, 1),
      created.billId,
    );
    await approveAndOpen(created.billId, refundDiners);
    return created;
  }

  const cancelled = await openTwoDinerBill("Cancellation refund rehearsal");
  await recordTransaction(
    records,
    "Sponsor partly funds Alice",
    tapTab.connect(sponsor).fundParticipant(cancelled.billId, alice.address, { value: 20n }),
    cancelled.billId,
  );
  await recordTransaction(
    records,
    "Bob partly funds his allocation",
    tapTab.connect(bob).fundParticipant(cancelled.billId, bob.address, { value: 10n }),
    cancelled.billId,
  );
  await recordTransaction(
    records,
    "Creator cancels incomplete bill",
    tapTab.connect(creator).cancelBill(cancelled.billId),
    cancelled.billId,
  );
  assert.equal((await tapTab.getBill(cancelled.billId)).state, State.Cancelled);
  assert.equal(await tapTab.claimableRefund(cancelled.billId, sponsor.address), 20n);
  assert.equal(await tapTab.claimableRefund(cancelled.billId, bob.address), 10n);
  await recordTransaction(
    records,
    "Sponsor claims cancellation refund",
    tapTab.connect(sponsor).claimRefund(cancelled.billId),
    cancelled.billId,
  );
  assert.equal(await tapTab.claimableRefund(cancelled.billId, sponsor.address), 0n);
  await recordTransaction(
    records,
    "Bob claims cancellation refund",
    tapTab.connect(bob).claimRefund(cancelled.billId),
    cancelled.billId,
  );
  assert.equal(await tapTab.claimableRefund(cancelled.billId, bob.address), 0n);

  const expired = await openTwoDinerBill("Expiry refund rehearsal", 120);
  await recordTransaction(
    records,
    "Sponsor funds Bob before expiry",
    tapTab.connect(sponsor).fundParticipant(expired.billId, bob.address, { value: 25n }),
    expired.billId,
  );
  await recordTransaction(
    records,
    "Alice partly funds before expiry",
    tapTab.connect(alice).fundParticipant(expired.billId, alice.address, { value: 30n }),
    expired.billId,
  );
  await hre.ethers.provider.send("evm_setNextBlockTimestamp", [expired.deadline]);
  await hre.ethers.provider.send("evm_mine", []);
  await recordTransaction(
    records,
    "Record incomplete bill expiry",
    tapTab.connect(outsider).expireBill(expired.billId),
    expired.billId,
  );
  assert.equal((await tapTab.getBill(expired.billId)).state, State.Expired);
  assert.equal(await tapTab.claimableRefund(expired.billId, sponsor.address), 25n);
  assert.equal(await tapTab.claimableRefund(expired.billId, alice.address), 30n);
  await recordTransaction(
    records,
    "Sponsor claims expiry refund",
    tapTab.connect(sponsor).claimRefund(expired.billId),
    expired.billId,
  );
  assert.equal(await tapTab.claimableRefund(expired.billId, sponsor.address), 0n);
  await recordTransaction(
    records,
    "Alice claims expiry refund",
    tapTab.connect(alice).claimRefund(expired.billId),
    expired.billId,
  );
  assert.equal(await tapTab.claimableRefund(expired.billId, alice.address), 0n);
  assert.equal(await hre.ethers.provider.getBalance(contractAddress), 0n);

  const report = {
    schema: "taptab-local-rehearsal",
    version: 1,
    notice: "Ephemeral Hardhat evidence only — not Monad Testnet proof.",
    chain: { name: "Hardhat local", chainId: network.chainId.toString() },
    contractAddress,
    actors: {
      creator: creator.address,
      payee: payee.address,
      alice: alice.address,
      bob: bob.address,
      carol: carol.address,
      sponsor: sponsor.address,
      outsider: outsider.address,
    },
    journeys: {
      success: {
        billId: successful.billId.toString(),
        finalState: "Settled",
        subtotalUnits: "4850",
        tipBasisPoints: "1250",
        totalDueUnits: "5456",
        sponsorContributionUnits: "1321",
        proceedsWithdrawn: true,
      },
      cancellation: {
        billId: cancelled.billId.toString(),
        finalState: "Cancelled",
        contributorRefundUnits: { sponsor: "20", bob: "10" },
      },
      expiry: {
        billId: expired.billId.toString(),
        finalState: "Expired",
        contributorRefundUnits: { sponsor: "25", alice: "30" },
      },
    },
    checks: [
      "exact share and fair-remainder allocation",
      "median custom tip and deterministic dust",
      "unanimous split approval",
      "sponsorship ledger",
      "incomplete-settlement rejection",
      "full settlement and payee withdrawal",
      "cancellation refund",
      "expiry refund",
      "zero residual contract balance",
    ],
    transactions: records,
  };

  const outputPath = path.resolve(
    __dirname,
    "../../outputs/taptab-local-rehearsal.json",
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("TapTab local rehearsal passed.");
  console.log("Successful bill: settled and proceeds withdrawn.");
  console.log("Cancelled bill: contributor refund claimed.");
  console.log("Expired bill: contributor refund claimed.");
  console.log("Evidence:", outputPath);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown local rehearsal failure.";
  console.error(`TapTab local rehearsal failed: ${message}`);
  process.exitCode = 1;
});

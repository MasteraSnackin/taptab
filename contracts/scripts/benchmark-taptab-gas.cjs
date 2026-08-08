const assert = require("node:assert/strict");
const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const hre = require("hardhat");

const LOCAL_CHAIN_ID = 31_337n;
const PARTICIPANT_COUNT = 32;
const ITEM_COUNT = 32;
const SHARES_PER_ITEM = 4;
const TOTAL_SHARES = ITEM_COUNT * SHARES_PER_ITEM;
const MAX_METADATA_URI_BYTES = 64_000;
const BOUNDARY_TRANSACTION_GAS_LIMIT = 55_000_000n;

// These are deliberately generous regression tripwires, not fee forecasts.
// Tightening them requires a reviewed benchmark update with an explanation.
const GAS_CEILINGS = Object.freeze({
  createBillMaximumShape: 5_000_000n,
  createBillMaximumShapeAtMetadataLimit: 50_000_000n,
  currentSplitDigestEstimate: 3_000_000n,
  approveSplitFirstForVersion: 3_500_000n,
  approveSplitCachedForVersion: 300_000n,
  openFundingMaximumShape: 6_000_000n,
  leaveWithAll128Shares: 5_000_000n,
  fundParticipant: 300_000n,
});

function deterministicWallet(index) {
  const privateKey = hre.ethers.keccak256(
    hre.ethers.toUtf8Bytes(`taptab-local-gas-participant-${index}`),
  );
  return new hre.ethers.Wallet(privateKey, hre.ethers.provider);
}

async function mined(transactionPromise) {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait();
  assert(receipt, "A local benchmark transaction did not return a receipt.");
  return receipt;
}

function max(values) {
  return values.reduce((greatest, value) => (value > greatest ? value : greatest), 0n);
}

function metric(gasUsed, ceiling, kind = "receipt") {
  return {
    kind,
    gasUsed: gasUsed.toString(),
    ceiling: ceiling.toString(),
    headroom: (ceiling - gasUsed).toString(),
    pass: gasUsed <= ceiling,
  };
}

function metadataAtExactByteLimit() {
  const prefix = "data:application/octet-stream,";
  const prefixBytes = hre.ethers.toUtf8Bytes(prefix).length;
  assert(prefixBytes < MAX_METADATA_URI_BYTES, "Metadata prefix exceeds its byte limit.");
  const metadataURI = `${prefix}${"x".repeat(MAX_METADATA_URI_BYTES - prefixBytes)}`;
  assert.equal(
    hre.ethers.toUtf8Bytes(metadataURI).length,
    MAX_METADATA_URI_BYTES,
    "Boundary metadata is not exactly 64,000 UTF-8 bytes.",
  );
  return metadataURI;
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (hre.network.name !== "hardhat" || network.chainId !== LOCAL_CHAIN_ID) {
    throw new Error(
      `Refusing to benchmark outside ephemeral Hardhat chain 31337 (received ${hre.network.name}, chain ${network.chainId}).`,
    );
  }
  assert.equal(
    hre.network.config.hardfork,
    "cancun",
    "The exact metadata-boundary benchmark requires the documented local Cancun profile.",
  );
  const initialBlock = await hre.ethers.provider.getBlock("latest");
  assert(initialBlock, "Hardhat did not return its initial block.");

  const [creator, payee, sponsor] = await hre.ethers.getSigners();
  assert(
    creator && payee && sponsor,
    "The Hardhat benchmark needs creator, payee and sponsor accounts.",
  );
  const participants = Array.from({ length: PARTICIPANT_COUNT }, (_, index) =>
    deterministicWallet(index),
  );
  for (const participant of participants) {
    await hre.ethers.provider.send("hardhat_setBalance", [
      participant.address,
      hre.ethers.toQuantity(hre.ethers.parseEther("10")),
    ]);
  }

  const TapTab = await hre.ethers.getContractFactory("TapTab");
  const tapTab = await TapTab.deploy();
  await tapTab.waitForDeployment();
  assert.equal(
    await tapTab.MAX_METADATA_URI_BYTES(),
    BigInt(MAX_METADATA_URI_BYTES),
    "Benchmark metadata bytes diverged from the contract limit.",
  );
  const contractAddress = await tapTab.getAddress();
  const itemAmounts = Array.from(
    { length: ITEM_COUNT },
    (_, itemIndex) => 4_000n + BigInt(itemIndex),
  );
  const shareCounts = Array(ITEM_COUNT).fill(SHARES_PER_ITEM);
  const participantAddresses = participants.map(({ address }) => address);

  async function createMaximumShapeBill(label, metadataOverride) {
    const latest = await hre.ethers.provider.getBlock("latest");
    assert(latest, "Hardhat did not return a latest block.");
    const metadataURI =
      metadataOverride ??
      `data:application/json,${encodeURIComponent(
        JSON.stringify({ schema: "taptab-local-gas-benchmark", label }),
      )}`;
    const overrides =
      hre.ethers.toUtf8Bytes(metadataURI).length === MAX_METADATA_URI_BYTES
        ? { gasLimit: BOUNDARY_TRANSACTION_GAS_LIMIT }
        : {};
    const receipt = await mined(
      tapTab
        .connect(creator)
        .createBill(
          payee.address,
          metadataURI,
          latest.timestamp + 86_400,
          itemAmounts,
          shareCounts,
          overrides,
        ),
    );
    return {
      billId: await tapTab.billCount(),
      creationGas: receipt.gasUsed,
      metadataBytes: hre.ethers.toUtf8Bytes(metadataURI).length,
    };
  }

  async function inviteAndJoinMaximumParticipants(billId) {
    const inviteReceipt = await mined(
      tapTab.connect(creator).inviteMany(billId, participantAddresses),
    );
    const joinGas = [];
    for (const [participantIndex, participant] of participants.entries()) {
      // Descending votes make the insertion-sort median path maximally unfavourable.
      const vote = 3_000 - participantIndex * 90;
      const receipt = await mined(
        tapTab.connect(participant).joinBill(billId, true, vote),
      );
      joinGas.push(receipt.gasUsed);
    }
    return { inviteMany: inviteReceipt.gasUsed, joinBillMaximum: max(joinGas) };
  }

  const primary = await createMaximumShapeBill("maximum funding shape");
  // This intentionally combines every accepted createBill dimension: the exact
  // metadata byte boundary, all 32 items and all 128 share slots. The local
  // Hardhat network pins a pre-EIP-7825 hardfork solely so this regression
  // transaction can be mined; it is not evidence that a public network will
  // accept the shape.
  const metadataBoundary = await createMaximumShapeBill(
    "exact metadata boundary",
    metadataAtExactByteLimit(),
  );
  assert.equal(
    metadataBoundary.metadataBytes,
    MAX_METADATA_URI_BYTES,
    "Maximum-shape boundary bill did not use the exact metadata limit.",
  );
  const primarySetup = await inviteAndJoinMaximumParticipants(primary.billId);
  const distributedClaims = participants.map(() => ({ itemIndexes: [], shareIndexes: [] }));
  for (let itemIndex = 0; itemIndex < ITEM_COUNT; itemIndex += 1) {
    for (let shareIndex = 0; shareIndex < SHARES_PER_ITEM; shareIndex += 1) {
      const ownerIndex = (itemIndex * SHARES_PER_ITEM + shareIndex) % PARTICIPANT_COUNT;
      distributedClaims[ownerIndex].itemIndexes.push(itemIndex);
      distributedClaims[ownerIndex].shareIndexes.push(shareIndex);
    }
  }
  const distributedClaimGas = [];
  for (const [participantIndex, claim] of distributedClaims.entries()) {
    const receipt = await mined(
      tapTab
        .connect(participants[participantIndex])
        .claimMany(primary.billId, claim.itemIndexes, claim.shareIndexes),
    );
    distributedClaimGas.push(receipt.gasUsed);
  }

  const digestEstimate = await tapTab.currentSplitDigest.estimateGas(primary.billId);
  const digest = await tapTab.currentSplitDigest(primary.billId);
  const firstApproval = await mined(
    tapTab.connect(participants[0]).approveSplit(primary.billId, digest),
  );
  const cachedApproval = await mined(
    tapTab.connect(participants[1]).approveSplit(primary.billId, digest),
  );
  const remainingApprovalGas = [cachedApproval.gasUsed];
  for (const participant of participants.slice(2)) {
    const receipt = await mined(
      tapTab.connect(participant).approveSplit(primary.billId, digest),
    );
    remainingApprovalGas.push(receipt.gasUsed);
  }
  const openFunding = await mined(tapTab.connect(creator).openFunding(primary.billId));
  const beneficiary = await tapTab.getParticipant(primary.billId, participants[0].address);
  assert(beneficiary.amountDue > 0n, "Maximum-shape beneficiary unexpectedly has no amount due.");
  const funding = await mined(
    tapTab
      .connect(sponsor)
      .fundParticipant(primary.billId, participants[0].address, { value: beneficiary.amountDue }),
  );

  const leaveBill = await createMaximumShapeBill("maximum leave shape");
  const leaveSetup = await inviteAndJoinMaximumParticipants(leaveBill.billId);
  const everyItemIndex = [];
  const everyShareIndex = [];
  for (let itemIndex = 0; itemIndex < ITEM_COUNT; itemIndex += 1) {
    for (let shareIndex = 0; shareIndex < SHARES_PER_ITEM; shareIndex += 1) {
      everyItemIndex.push(itemIndex);
      everyShareIndex.push(shareIndex);
    }
  }
  const claimAll = await mined(
    tapTab
      .connect(participants[0])
      .claimMany(leaveBill.billId, everyItemIndex, everyShareIndex),
  );
  const leave = await mined(
    tapTab.connect(participants[0]).leaveBill(leaveBill.billId, participants[1].address),
  );
  const transferredOwners = await Promise.all(
    Array.from({ length: ITEM_COUNT }, (_, itemIndex) =>
      tapTab.getItemShareOwners(leaveBill.billId, itemIndex),
    ),
  );
  assert(
    transferredOwners.flat().every((owner) => owner === participants[1].address),
    "Maximum-shape leave did not atomically transfer every share.",
  );

  const measured = {
    createBillMaximumShape: metric(
      primary.creationGas,
      GAS_CEILINGS.createBillMaximumShape,
    ),
    createBillMaximumShapeAtMetadataLimit: metric(
      metadataBoundary.creationGas,
      GAS_CEILINGS.createBillMaximumShapeAtMetadataLimit,
    ),
    currentSplitDigestEstimate: metric(
      digestEstimate,
      GAS_CEILINGS.currentSplitDigestEstimate,
      "estimate",
    ),
    approveSplitFirstForVersion: metric(
      firstApproval.gasUsed,
      GAS_CEILINGS.approveSplitFirstForVersion,
    ),
    approveSplitCachedForVersion: metric(
      max(remainingApprovalGas),
      GAS_CEILINGS.approveSplitCachedForVersion,
    ),
    openFundingMaximumShape: metric(
      openFunding.gasUsed,
      GAS_CEILINGS.openFundingMaximumShape,
    ),
    leaveWithAll128Shares: metric(leave.gasUsed, GAS_CEILINGS.leaveWithAll128Shares),
    fundParticipant: metric(funding.gasUsed, GAS_CEILINGS.fundParticipant),
  };
  const allCeilingsPass = Object.values(measured).every(({ pass }) => pass);
  const report = {
    schema: "taptab-local-gas-benchmark",
    version: 2,
    notice:
      "Ephemeral Cancun-profile Hardhat chain-31337 regression evidence only; this does not establish public-network acceptance and the figures are not Monad fee or performance claims.",
    chain: {
      name: hre.network.name,
      chainId: network.chainId.toString(),
      hardfork: hre.network.config.hardfork,
      blockGasLimit: initialBlock.gasLimit.toString(),
    },
    contractAddress,
    shape: {
      participants: PARTICIPANT_COUNT,
      items: ITEM_COUNT,
      sharesPerItem: SHARES_PER_ITEM,
      totalShares: TOTAL_SHARES,
      creationMetadataBytes: primary.metadataBytes,
      metadataBoundaryBytes: metadataBoundary.metadataBytes,
      metadataBoundaryTransactionGasLimit: BOUNDARY_TRANSACTION_GAS_LIMIT.toString(),
    },
    measured,
    setupGas: {
      inviteManyMaximum: primarySetup.inviteMany.toString(),
      joinBillMaximum: primarySetup.joinBillMaximum.toString(),
      distributedClaimManyMaximum: max(distributedClaimGas).toString(),
      leaveBillInviteManyMaximum: leaveSetup.inviteMany.toString(),
      leaveBillJoinMaximum: leaveSetup.joinBillMaximum.toString(),
      claimAll128Shares: claimAll.gasUsed.toString(),
    },
    allCeilingsPass,
  };

  const outputPath = path.resolve(__dirname, "../../outputs/taptab-gas-benchmark.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("TapTab maximum-shape gas benchmark (Hardhat chain 31337)");
  for (const [name, result] of Object.entries(measured)) {
    console.log(
      `${name}: ${result.gasUsed} gas (${result.kind}; ceiling ${result.ceiling}; ${
        result.pass ? "PASS" : "FAIL"
      })`,
    );
  }
  console.log("Evidence:", outputPath);
  assert(allCeilingsPass, "One or more maximum-shape gas regression ceilings were exceeded.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`TapTab local gas benchmark failed: ${message}`);
  process.exitCode = 1;
});

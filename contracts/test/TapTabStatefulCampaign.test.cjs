const { expect } = require("chai");
const { ethers } = require("hardhat");

const State = Object.freeze({
  Draft: 1n,
  Funding: 2n,
  Settled: 3n,
  Cancelled: 4n,
  Expired: 5n,
});

const DEFAULT_SEEDS = Object.freeze([
  0x1020_3040,
  0x5eed_c0de,
  0x7f4a_7c15,
  0x2468_ace0,
  0xf00d_baad,
  0x2718_2818,
  0xf00d_baae,
  0x2718_2819,
  0x9e37_79b9,
  0xc001_d00d,
]);
const RANDOM_DRAFT_STEPS = 8;
const OUTCOMES = Object.freeze([
  "settled",
  "cancelled-funding",
  "expired-funding",
  "cancelled-draft",
  "expired-draft",
]);

function parseReplaySeed(value) {
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/iu.test(value)) {
    throw new Error(
      "TAPTAB_STATEFUL_SEED must be a non-zero 32-bit integer, for example 0x10203040.",
    );
  }
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffff_ffff) {
    throw new Error(
      "TAPTAB_STATEFUL_SEED must be a non-zero 32-bit integer, for example 0x10203040.",
    );
  }
  return seed >>> 0;
}

function selectedSeeds() {
  const replaySeed = process.env.TAPTAB_STATEFUL_SEED?.trim();
  return replaySeed ? [parseReplaySeed(replaySeed)] : DEFAULT_SEEDS;
}

function deterministicRandom(seed) {
  let state = seed >>> 0;
  return (upperExclusive) => {
    if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0) {
      throw new Error(`Invalid deterministic random bound: ${upperExclusive}`);
    }
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) % upperExclusive;
  };
}

function seedLabel(seed) {
  return `0x${seed.toString(16).padStart(8, "0")}`;
}

function accountKey(account) {
  return (typeof account === "string" ? account : account.address).toLowerCase();
}

function choose(random, values) {
  if (values.length === 0) throw new Error("Cannot choose from an empty collection.");
  return values[random(values.length)];
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0n);
}

function activeParticipants(model) {
  return model.participants.filter(({ joined }) => joined);
}

function uniqueSigners(signers) {
  return [...new Map(signers.map((signer) => [accountKey(signer), signer])).values()];
}

function itemShareValue(item, shareIndex) {
  const shares = BigInt(item.shareCount);
  return item.amount / shares + (BigInt(shareIndex) < item.amount % shares ? 1n : 0n);
}

function ownedSlots(model) {
  return model.owners.flatMap((owners, itemIndex) =>
    owners.flatMap((owner, shareIndex) =>
      owner === ethers.ZeroAddress ? [] : [{ itemIndex, shareIndex, owner }],
    ),
  );
}

function unownedSlots(model) {
  return model.owners.flatMap((owners, itemIndex) =>
    owners.flatMap((owner, shareIndex) =>
      owner === ethers.ZeroAddress ? [{ itemIndex, shareIndex }] : [],
    ),
  );
}

function expectedLockedAllocation(model) {
  const active = activeParticipants(model);
  const baseDue = new Map(active.map((participant) => [accountKey(participant.signer), 0n]));
  let unclaimedValue = 0n;

  for (const [itemIndex, item] of model.items.entries()) {
    for (let shareIndex = 0; shareIndex < item.shareCount; shareIndex += 1) {
      const value = itemShareValue(item, shareIndex);
      const owner = model.owners[itemIndex][shareIndex];
      if (owner === ethers.ZeroAddress) {
        unclaimedValue += value;
      } else {
        const ownerKey = accountKey(owner);
        if (!baseDue.has(ownerKey)) {
          throw new Error(`${model.context}: an inactive participant still owns a share`);
        }
        baseDue.set(ownerKey, baseDue.get(ownerKey) + value);
      }
    }
  }

  const fairParticipants = active.filter(({ fairRemainder }) => fairRemainder);
  if (unclaimedValue !== 0n && fairParticipants.length === 0) {
    throw new Error(`${model.context}: unclaimed value has no fair-remainder participant`);
  }
  if (fairParticipants.length !== 0) {
    const equalRemainder = unclaimedValue / BigInt(fairParticipants.length);
    let dust = unclaimedValue % BigInt(fairParticipants.length);
    for (const participant of fairParticipants) {
      const key = accountKey(participant.signer);
      baseDue.set(key, baseDue.get(key) + equalRemainder + (dust === 0n ? 0n : 1n));
      if (dust !== 0n) dust -= 1n;
    }
  }

  const votes = active.map(({ tipVoteBps }) => tipVoteBps).sort((left, right) => left - right);
  const middle = Math.floor(votes.length / 2);
  const lockedTipBps = votes.length % 2 === 1
    ? votes[middle]
    : Math.floor((votes[middle - 1] + votes[middle]) / 2);
  const totalTip = (model.subtotal * BigInt(lockedTipBps)) / 10_000n;
  const ledgers = new Map();
  let allocatedTip = 0n;

  for (const participant of active) {
    const key = accountKey(participant.signer);
    const base = baseDue.get(key);
    const tip = (base * BigInt(lockedTipBps)) / 10_000n;
    allocatedTip += tip;
    ledgers.set(key, { baseDue: base, tipDue: tip, amountDue: base + tip });
  }

  let tipDust = totalTip - allocatedTip;
  for (const participant of active) {
    if (tipDust === 0n) break;
    const key = accountKey(participant.signer);
    const ledger = ledgers.get(key);
    if (ledger.amountDue === 0n) continue;
    ledger.tipDue += 1n;
    ledger.amountDue += 1n;
    tipDust -= 1n;
  }
  expect(tipDust, `${model.context}: independent tip dust allocation`).to.equal(0n);

  return {
    ledgers,
    lockedTipBps: BigInt(lockedTipBps),
    totalDue: model.subtotal + totalTip,
  };
}

async function assertDraftInvariants(tapTab, billId, model, label) {
  const context = `${model.context}: ${label}`;
  const active = activeParticipants(model);
  const [bill, items, participantAddresses, split, contractBalance] = await Promise.all([
    tapTab.getBill(billId),
    tapTab.getItems(billId),
    tapTab.getParticipants(billId),
    tapTab.getSplitStatus(billId),
    ethers.provider.getBalance(await tapTab.getAddress()),
  ]);

  expect(bill.state, `${context}: phase`).to.equal(State.Draft);
  expect(bill.creator, `${context}: creator`).to.equal(model.creator.address);
  expect(bill.payee, `${context}: payee`).to.equal(model.payee.address);
  expect(bill.participantCount, `${context}: participant count`).to.equal(BigInt(active.length));
  expect(bill.subtotal, `${context}: subtotal`).to.equal(model.subtotal);
  expect(bill.totalDue, `${context}: draft due`).to.equal(0n);
  expect(bill.totalFunded, `${context}: draft funding`).to.equal(0n);
  expect(bill.remainingToFund, `${context}: draft remaining`).to.equal(0n);
  expect(contractBalance, `${context}: draft contract balance`).to.equal(0n);
  expect(sum(items.map(({ amount }) => amount)), `${context}: item conservation`).to.equal(
    model.subtotal,
  );
  expect(participantAddresses, `${context}: active join order`).to.deep.equal(
    active.map(({ signer }) => signer.address),
  );
  expect(split.receiptDigest, `${context}: immutable receipt digest`).to.equal(model.receiptDigest);
  expect(split.splitVersion, `${context}: split version`).to.equal(model.splitVersion);
  expect(split.approvalCount, `${context}: approval count`).to.equal(
    BigInt(model.approvals.size),
  );
  expect(split.requiredApprovals, `${context}: required approvals`).to.equal(
    BigInt(active.length),
  );
  expect(split.currentDigest, `${context}: canonical digest`).to.equal(
    await tapTab.currentSplitDigest(billId),
  );

  const participantLedgers = await Promise.all(
    model.participants.map(({ signer }) => tapTab.getParticipant(billId, signer.address)),
  );
  for (const [index, participant] of model.participants.entries()) {
    const ledger = participantLedgers[index];
    expect(ledger.joined, `${context}: ${participant.signer.address} joined`).to.equal(
      participant.joined,
    );
    expect(ledger.fairRemainder, `${context}: fair-remainder preference`).to.equal(
      participant.joined ? participant.fairRemainder : false,
    );
    expect(ledger.tipVoteBps, `${context}: tip preference`).to.equal(
      participant.joined ? BigInt(participant.tipVoteBps) : 0n,
    );
    expect(ledger.baseDue, `${context}: unlocked base due`).to.equal(0n);
    expect(ledger.tipDue, `${context}: unlocked tip due`).to.equal(0n);
    expect(ledger.amountDue, `${context}: unlocked total due`).to.equal(0n);
    expect(ledger.amountFunded, `${context}: draft participant funding`).to.equal(0n);
    expect(
      await tapTab.hasApprovedCurrentSplit(billId, participant.signer.address),
      `${context}: approval version for ${participant.signer.address}`,
    ).to.equal(participant.joined && model.approvals.has(accountKey(participant.signer)));
  }

  for (const signer of model.waiting) {
    expect(
      await tapTab.isInvited(billId, signer.address),
      `${context}: pending invitation for ${signer.address}`,
    ).to.equal(true);
  }

  for (const [itemIndex, item] of model.items.entries()) {
    const owners = await tapTab.getItemShareOwners(billId, itemIndex);
    expect(owners, `${context}: item ${itemIndex} owners`).to.deep.equal(model.owners[itemIndex]);
    expect(items[itemIndex].amount, `${context}: item ${itemIndex} amount`).to.equal(item.amount);
    expect(items[itemIndex].shareCount, `${context}: item ${itemIndex} shares`).to.equal(
      BigInt(item.shareCount),
    );
    expect(
      items[itemIndex].claimedShareCount,
      `${context}: item ${itemIndex} claimed shares`,
    ).to.equal(BigInt(owners.filter((owner) => owner !== ethers.ZeroAddress).length));
    const values = await Promise.all(
      owners.map((_, shareIndex) => tapTab.itemShareValue(billId, itemIndex, shareIndex)),
    );
    expect(sum(values), `${context}: item ${itemIndex} share conservation`).to.equal(item.amount);
    expect(values, `${context}: item ${itemIndex} deterministic share values`).to.deep.equal(
      owners.map((_, shareIndex) => itemShareValue(item, shareIndex)),
    );
  }
}

async function approveCurrent(tapTab, billId, model, signer, label) {
  const key = accountKey(signer);
  if (model.approvals.has(key)) return;
  const before = await tapTab.getSplitStatus(billId);
  await tapTab.connect(signer).approveSplit(billId, before.currentDigest);
  model.approvals.add(key);
  const after = await tapTab.getSplitStatus(billId);
  expect(after.splitVersion, `${model.context}: ${label}: approval version`).to.equal(
    before.splitVersion,
  );
  expect(after.currentDigest, `${model.context}: ${label}: approval digest`).to.equal(
    before.currentDigest,
  );
  expect(after.approvalCount, `${model.context}: ${label}: approval increment`).to.equal(
    before.approvalCount + 1n,
  );
  expect(await tapTab.hasApprovedCurrentSplit(billId, signer.address)).to.equal(true);
}

async function mutateSplit(tapTab, billId, model, random, label, transaction, updateModel, options = {}) {
  const activeBefore = activeParticipants(model);
  const staleApprover = options.staleApprover
    ?? activeBefore.find(({ signer }) => model.approvals.has(accountKey(signer)))?.signer
    ?? choose(random, activeBefore).signer;
  await approveCurrent(tapTab, billId, model, staleApprover, `${label}: pre-mutation`);

  const before = await tapTab.getSplitStatus(billId);
  const staleDigest = before.currentDigest;
  await transaction();
  updateModel();
  model.splitVersion += 1n;
  model.approvals.clear();

  const after = await tapTab.getSplitStatus(billId);
  expect(after.splitVersion, `${model.context}: ${label}: version advances once`).to.equal(
    before.splitVersion + 1n,
  );
  expect(after.approvalCount, `${model.context}: ${label}: approvals reset`).to.equal(0n);
  expect(after.currentDigest, `${model.context}: ${label}: digest changes`).not.to.equal(
    staleDigest,
  );

  const activeAfter = activeParticipants(model);
  const staleAttempt = choose(random, activeAfter).signer;
  await expect(tapTab.connect(staleAttempt).approveSplit(billId, staleDigest))
    .to.be.revertedWithCustomError(tapTab, "SplitDigestMismatch");
  await assertDraftInvariants(tapTab, billId, model, label);
}

async function performPreferenceMutation(tapTab, billId, model, random, label) {
  const participant = choose(random, activeParticipants(model));
  let fairRemainder = participant.fairRemainder;
  let tipVoteBps = participant.tipVoteBps;
  if (random(2) === 0) {
    fairRemainder = !fairRemainder;
  } else {
    tipVoteBps = (tipVoteBps + 1 + random(3_000)) % 3_001;
  }
  await mutateSplit(
    tapTab,
    billId,
    model,
    random,
    label,
    () => tapTab
      .connect(participant.signer)
      .updatePreferences(billId, fairRemainder, tipVoteBps),
    () => {
      participant.fairRemainder = fairRemainder;
      participant.tipVoteBps = tipVoteBps;
    },
  );
}

async function performClaim(tapTab, billId, model, random, label) {
  const available = unownedSlots(model);
  if (available.length === 0) {
    await performPreferenceMutation(tapTab, billId, model, random, `${label}: fallback preference`);
    return;
  }
  const participant = choose(random, activeParticipants(model));
  const selected = [];
  const selectionPool = [...available];
  const claimCount = 1 + random(Math.min(3, selectionPool.length));
  for (let index = 0; index < claimCount; index += 1) {
    selected.push(selectionPool.splice(random(selectionPool.length), 1)[0]);
  }
  const transaction = selected.length === 1 && random(2) === 0
    ? () => tapTab
      .connect(participant.signer)
      .claimItemShare(billId, selected[0].itemIndex, selected[0].shareIndex)
    : () => tapTab
      .connect(participant.signer)
      .claimMany(
        billId,
        selected.map(({ itemIndex }) => itemIndex),
        selected.map(({ shareIndex }) => shareIndex),
      );
  await mutateSplit(
    tapTab,
    billId,
    model,
    random,
    label,
    transaction,
    () => {
      for (const { itemIndex, shareIndex } of selected) {
        model.owners[itemIndex][shareIndex] = participant.signer.address;
      }
    },
  );
}

async function performUnclaim(tapTab, billId, model, random, label) {
  const claimed = ownedSlots(model);
  if (claimed.length === 0) {
    await performClaim(tapTab, billId, model, random, `${label}: fallback claim`);
    return;
  }
  const slot = choose(random, claimed);
  const owner = model.participantsByAddress.get(accountKey(slot.owner));
  await mutateSplit(
    tapTab,
    billId,
    model,
    random,
    label,
    () => tapTab
      .connect(owner.signer)
      .unclaimItemShare(billId, slot.itemIndex, slot.shareIndex),
    () => {
      model.owners[slot.itemIndex][slot.shareIndex] = ethers.ZeroAddress;
    },
  );
}

async function performLateJoin(tapTab, billId, model, random, label) {
  if (model.waiting.length === 0) {
    await performApprovalAction(tapTab, billId, model, random, `${label}: fallback approval`);
    return;
  }
  const waitingIndex = random(model.waiting.length);
  const signer = model.waiting[waitingIndex];
  const participant = {
    signer,
    joined: true,
    fairRemainder: random(2) === 1,
    tipVoteBps: random(3_001),
    amountFunded: 0n,
  };
  await mutateSplit(
    tapTab,
    billId,
    model,
    random,
    label,
    () => tapTab
      .connect(signer)
      .joinBill(billId, participant.fairRemainder, participant.tipVoteBps),
    () => {
      model.waiting.splice(waitingIndex, 1);
      model.participants.push(participant);
      model.participantsByAddress.set(accountKey(signer), participant);
    },
  );
  expect(await tapTab.isInvited(billId, signer.address), `${model.context}: invitation consumed`)
    .to.equal(false);
}

async function performLeave(tapTab, billId, model, random, label, preferShareOwner = false) {
  const active = activeParticipants(model);
  if (active.length <= 2) {
    await performPreferenceMutation(tapTab, billId, model, random, `${label}: fallback preference`);
    return;
  }

  const activeKeys = new Set(active.map(({ signer }) => accountKey(signer)));
  const shareOwners = uniqueSigners(
    ownedSlots(model)
      .filter(({ owner }) => activeKeys.has(accountKey(owner)))
      .map(({ owner }) => model.participantsByAddress.get(accountKey(owner)).signer),
  );
  const departing = preferShareOwner && shareOwners.length !== 0
    ? choose(random, shareOwners)
    : choose(random, active.map(({ signer }) => signer));
  const remaining = active.filter(({ signer }) => accountKey(signer) !== accountKey(departing));
  const departingOwnsShares = ownedSlots(model).some(
    ({ owner }) => accountKey(owner) === accountKey(departing),
  );
  const recipient = departingOwnsShares || random(2) === 1
    ? choose(random, remaining).signer
    : null;
  const staleApprover = choose(random, remaining).signer;
  const departingParticipant = model.participantsByAddress.get(accountKey(departing));

  await mutateSplit(
    tapTab,
    billId,
    model,
    random,
    label,
    () => tapTab
      .connect(departing)
      .leaveBill(billId, recipient?.address ?? ethers.ZeroAddress),
    () => {
      if (recipient) {
        for (const owners of model.owners) {
          for (let shareIndex = 0; shareIndex < owners.length; shareIndex += 1) {
            if (accountKey(owners[shareIndex]) === accountKey(departing)) {
              owners[shareIndex] = recipient.address;
            }
          }
        }
      }
      departingParticipant.joined = false;
      departingParticipant.fairRemainder = false;
      departingParticipant.tipVoteBps = 0;
    },
    { staleApprover },
  );

  await expect(tapTab.connect(model.creator).inviteParticipant(billId, departing.address))
    .to.be.revertedWithCustomError(tapTab, "AlreadyParticipated");
}

async function performApprovalAction(tapTab, billId, model, random, label) {
  const available = activeParticipants(model).filter(
    ({ signer }) => !model.approvals.has(accountKey(signer)),
  );
  if (available.length === 0) {
    await performRevokeAction(tapTab, billId, model, random, `${label}: fallback revoke`);
    return;
  }
  await approveCurrent(tapTab, billId, model, choose(random, available).signer, label);
  await assertDraftInvariants(tapTab, billId, model, label);
}

async function performRevokeAction(tapTab, billId, model, random, label) {
  let approved = activeParticipants(model).filter(({ signer }) =>
    model.approvals.has(accountKey(signer)),
  );
  if (approved.length === 0) {
    const signer = choose(random, activeParticipants(model)).signer;
    await approveCurrent(tapTab, billId, model, signer, `${label}: setup approval`);
    approved = [model.participantsByAddress.get(accountKey(signer))];
  }
  const participant = choose(random, approved);
  const before = await tapTab.getSplitStatus(billId);
  await tapTab.connect(participant.signer).revokeSplitApproval(billId);
  model.approvals.delete(accountKey(participant.signer));
  const after = await tapTab.getSplitStatus(billId);
  expect(after.splitVersion, `${model.context}: ${label}: revocation version`).to.equal(
    before.splitVersion,
  );
  expect(after.currentDigest, `${model.context}: ${label}: revocation digest`).to.equal(
    before.currentDigest,
  );
  expect(after.approvalCount, `${model.context}: ${label}: revocation decrement`).to.equal(
    before.approvalCount - 1n,
  );
  expect(await tapTab.hasApprovedCurrentSplit(billId, participant.signer.address)).to.equal(false);
  await assertDraftInvariants(tapTab, billId, model, label);
}

async function performRandomDraftAction(tapTab, billId, model, random, step) {
  const label = `random draft step ${step}`;
  switch (random(8)) {
    case 0:
      await performPreferenceMutation(tapTab, billId, model, random, label);
      break;
    case 1:
    case 2:
      await performClaim(tapTab, billId, model, random, label);
      break;
    case 3:
      await performUnclaim(tapTab, billId, model, random, label);
      break;
    case 4:
      await performLateJoin(tapTab, billId, model, random, label);
      break;
    case 5:
      await performLeave(tapTab, billId, model, random, label);
      break;
    case 6:
      await performApprovalAction(tapTab, billId, model, random, label);
      break;
    default:
      await performRevokeAction(tapTab, billId, model, random, label);
  }
}

async function ensureFairRemainderCoverage(tapTab, billId, model, random) {
  const hasUnclaimedValue = unownedSlots(model).length !== 0;
  const hasFairParticipant = activeParticipants(model).some(({ fairRemainder }) => fairRemainder);
  if (!hasUnclaimedValue || hasFairParticipant) return;
  const participant = choose(random, activeParticipants(model));
  await mutateSplit(
    tapTab,
    billId,
    model,
    random,
    "enable fair remainder before funding",
    () => tapTab
      .connect(participant.signer)
      .updatePreferences(billId, true, participant.tipVoteBps),
    () => {
      participant.fairRemainder = true;
    },
  );
}

async function approveAll(tapTab, billId, model) {
  const digest = await tapTab.currentSplitDigest(billId);
  for (const participant of activeParticipants(model)) {
    const key = accountKey(participant.signer);
    if (model.approvals.has(key)) continue;
    const before = await tapTab.getSplitStatus(billId);
    await tapTab.connect(participant.signer).approveSplit(billId, digest);
    model.approvals.add(key);
    const after = await tapTab.getSplitStatus(billId);
    expect(after.splitVersion, `${model.context}: unanimous approval version`).to.equal(
      model.splitVersion,
    );
    expect(after.currentDigest, `${model.context}: unanimous approval digest`).to.equal(digest);
    expect(after.approvalCount, `${model.context}: unanimous approval count`).to.equal(
      before.approvalCount + 1n,
    );
  }
  const finalStatus = await tapTab.getSplitStatus(billId);
  expect(finalStatus.approvalCount, `${model.context}: unanimous approval`).to.equal(
    finalStatus.requiredApprovals,
  );
}

async function assertFundingInvariants(tapTab, billId, model, expectedState, label) {
  const context = `${model.context}: ${label}`;
  const active = activeParticipants(model);
  const [bill, items, participantAddresses, split, contractBalance] = await Promise.all([
    tapTab.getBill(billId),
    tapTab.getItems(billId),
    tapTab.getParticipants(billId),
    tapTab.getSplitStatus(billId),
    ethers.provider.getBalance(await tapTab.getAddress()),
  ]);
  const actualLedgers = await Promise.all(
    active.map(({ signer }) => tapTab.getParticipant(billId, signer.address)),
  );
  const currentContributions = await Promise.all(
    model.allPayers.map((signer) => tapTab.contributionOf(billId, signer.address)),
  );
  const claimableRefunds = await Promise.all(
    model.allPayers.map((signer) => tapTab.claimableRefund(billId, signer.address)),
  );
  const proceeds = await tapTab.proceedsAvailable(billId);
  const totalFunded = sum(active.map(({ amountFunded }) => amountFunded));
  const outstandingContributions = sum(
    [...model.contributions.values()],
  );

  expect(bill.state, `${context}: phase`).to.equal(expectedState);
  expect(bill.subtotal, `${context}: subtotal`).to.equal(model.subtotal);
  expect(sum(items.map(({ amount }) => amount)), `${context}: item conservation`).to.equal(
    model.subtotal,
  );
  expect(bill.lockedTipBps, `${context}: independently computed median tip`).to.equal(
    model.allocation.lockedTipBps,
  );
  expect(bill.totalDue, `${context}: independently computed total due`).to.equal(
    model.allocation.totalDue,
  );
  expect(bill.totalDue >= bill.subtotal, `${context}: total due lower bound`).to.equal(true);
  expect(
    bill.totalDue <= bill.subtotal + (bill.subtotal * 3_000n) / 10_000n,
    `${context}: total due upper bound`,
  ).to.equal(true);
  expect(bill.totalFunded, `${context}: beneficiary funding conservation`).to.equal(totalFunded);
  expect(bill.totalFunded <= bill.totalDue, `${context}: total funding bound`).to.equal(true);
  expect(bill.remainingToFund, `${context}: remaining funding`).to.equal(
    bill.totalDue - bill.totalFunded,
  );
  expect(participantAddresses, `${context}: locked participant order`).to.deep.equal(
    active.map(({ signer }) => signer.address),
  );
  expect(split.splitVersion, `${context}: locked split version`).to.equal(model.splitVersion);
  expect(split.approvalCount, `${context}: locked approvals`).to.equal(BigInt(active.length));
  expect(split.requiredApprovals, `${context}: locked approval requirement`).to.equal(
    BigInt(active.length),
  );

  expect(
    sum(actualLedgers.map(({ baseDue }) => baseDue)),
    `${context}: base-due conservation`,
  ).to.equal(model.subtotal);
  expect(
    sum(actualLedgers.map(({ tipDue }) => tipDue)),
    `${context}: tip-due conservation`,
  ).to.equal(bill.totalDue - bill.subtotal);
  expect(
    sum(actualLedgers.map(({ amountDue }) => amountDue)),
    `${context}: total-due conservation`,
  ).to.equal(bill.totalDue);

  for (const [index, participant] of active.entries()) {
    const actual = actualLedgers[index];
    const expected = model.allocation.ledgers.get(accountKey(participant.signer));
    expect(actual.baseDue, `${context}: participant ${index} base due`).to.equal(expected.baseDue);
    expect(actual.tipDue, `${context}: participant ${index} tip due`).to.equal(expected.tipDue);
    expect(actual.amountDue, `${context}: participant ${index} amount due`).to.equal(
      expected.amountDue,
    );
    expect(actual.baseDue + actual.tipDue, `${context}: participant ${index} due components`)
      .to.equal(actual.amountDue);
    expect(actual.amountFunded, `${context}: participant ${index} funded`).to.equal(
      participant.amountFunded,
    );
    expect(
      actual.amountFunded <= actual.amountDue,
      `${context}: participant ${index} funding bound`,
    ).to.equal(true);
    expect(
      await tapTab.remainingDue(billId, participant.signer.address),
      `${context}: participant ${index} remaining due`,
    ).to.equal(actual.amountDue - actual.amountFunded);
    expect(await tapTab.hasApprovedCurrentSplit(billId, participant.signer.address)).to.equal(true);
  }

  for (const [index, signer] of model.allPayers.entries()) {
    const expectedContribution = model.contributions.get(accountKey(signer)) ?? 0n;
    expect(
      currentContributions[index],
      `${context}: contribution ledger for ${signer.address}`,
    ).to.equal(expectedContribution);
  }
  expect(
    outstandingContributions + model.refundsClaimed,
    `${context}: contributor/refund conservation`,
  ).to.equal(bill.totalFunded);

  if (expectedState === State.Settled) {
    expect(proceeds, `${context}: settled proceeds`).to.equal(
      model.proceedsWithdrawn ? 0n : bill.totalFunded,
    );
    expect(sum(claimableRefunds), `${context}: settled refunds excluded`).to.equal(0n);
  } else if (expectedState === State.Cancelled || expectedState === State.Expired) {
    expect(proceeds, `${context}: failed-bill proceeds excluded`).to.equal(0n);
    expect(claimableRefunds, `${context}: exact refundable ledgers`).to.deep.equal(
      currentContributions,
    );
  } else {
    expect(proceeds, `${context}: pre-settlement proceeds excluded`).to.equal(0n);
    expect(sum(claimableRefunds), `${context}: pre-terminal refunds excluded`).to.equal(0n);
  }
  expect(
    proceeds === 0n || sum(claimableRefunds) === 0n,
    `${context}: terminal ledger exclusivity`,
  ).to.equal(true);

  const expectedContractBalance = bill.totalFunded
    - model.refundsClaimed
    - (model.proceedsWithdrawn ? bill.totalFunded : 0n);
  expect(contractBalance, `${context}: native balance conservation`).to.equal(
    expectedContractBalance,
  );
  expect(bill.proceedsWithdrawn, `${context}: proceeds withdrawal flag`).to.equal(
    model.proceedsWithdrawn,
  );
}

async function assertDraftTerminal(tapTab, billId, model, expectedState, label) {
  const context = `${model.context}: ${label}`;
  const [bill, proceeds, contractBalance, split] = await Promise.all([
    tapTab.getBill(billId),
    tapTab.proceedsAvailable(billId),
    ethers.provider.getBalance(await tapTab.getAddress()),
    tapTab.getSplitStatus(billId),
  ]);
  expect(bill.state, `${context}: phase`).to.equal(expectedState);
  expect(bill.totalDue, `${context}: no locked due`).to.equal(0n);
  expect(bill.totalFunded, `${context}: no funding`).to.equal(0n);
  expect(bill.remainingToFund, `${context}: no remaining funding`).to.equal(0n);
  expect(proceeds, `${context}: no proceeds`).to.equal(0n);
  expect(contractBalance, `${context}: empty terminal balance`).to.equal(0n);
  expect(split.splitVersion, `${context}: terminal split version`).to.equal(model.splitVersion);
  expect(split.approvalCount, `${context}: terminal approval count`).to.equal(
    BigInt(model.approvals.size),
  );
  for (const signer of model.allPayers) {
    expect(await tapTab.contributionOf(billId, signer.address)).to.equal(0n);
    expect(await tapTab.claimableRefund(billId, signer.address)).to.equal(0n);
  }
  for (const participant of activeParticipants(model)) {
    const ledger = await tapTab.getParticipant(billId, participant.signer.address);
    expect(ledger.baseDue).to.equal(0n);
    expect(ledger.tipDue).to.equal(0n);
    expect(ledger.amountDue).to.equal(0n);
    expect(ledger.amountFunded).to.equal(0n);
  }
}

async function assertDraftRoleGuards(tapTab, billId, model) {
  const participant = activeParticipants(model)[0];
  const before = await tapTab.getSplitStatus(billId);
  await expect(
    tapTab.connect(model.outsider).inviteParticipant(billId, model.sponsor.address),
  ).to.be.revertedWithCustomError(tapTab, "NotCreator");
  await expect(tapTab.connect(model.outsider).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "NotCreator");
  await expect(tapTab.connect(participant.signer).openFunding(billId))
    .to.be.revertedWithCustomError(tapTab, "NotCreator");
  await expect(tapTab.connect(model.sponsor).updatePreferences(billId, true, 1_000))
    .to.be.revertedWithCustomError(tapTab, "NotParticipant");
  await expect(
    tapTab.connect(model.sponsor).approveSplit(billId, before.currentDigest),
  ).to.be.revertedWithCustomError(tapTab, "NotParticipant");
  const after = await tapTab.getSplitStatus(billId);
  expect(after.splitVersion, `${model.context}: role guards preserve version`).to.equal(
    before.splitVersion,
  );
  expect(after.approvalCount, `${model.context}: role guards preserve approvals`).to.equal(
    before.approvalCount,
  );
  await assertDraftInvariants(tapTab, billId, model, "draft role guards");
}

async function openFunding(tapTab, billId, model, random) {
  await ensureFairRemainderCoverage(tapTab, billId, model, random);
  await approveAll(tapTab, billId, model);
  model.allocation = expectedLockedAllocation(model);
  await tapTab.connect(model.creator).openFunding(billId);
  model.contributions = new Map();
  model.refundsClaimed = 0n;
  model.proceedsWithdrawn = false;
  for (const participant of activeParticipants(model)) participant.amountFunded = 0n;
  await assertFundingInvariants(tapTab, billId, model, State.Funding, "funding opened");
}

async function assertFundingPhaseGuards(tapTab, billId, model) {
  const beneficiary = activeParticipants(model).find((participant) =>
    model.allocation.ledgers.get(accountKey(participant.signer)).amountDue > 0n,
  );
  const due = model.allocation.ledgers.get(accountKey(beneficiary.signer)).amountDue;
  await expect(
    tapTab.connect(model.sponsor).fundParticipant(billId, beneficiary.signer.address, { value: 0 }),
  ).to.be.revertedWithCustomError(tapTab, "ZeroPayment");
  await expect(
    tapTab
      .connect(model.sponsor)
      .fundParticipant(billId, beneficiary.signer.address, { value: due + 1n }),
  ).to.be.revertedWithCustomError(tapTab, "PaymentExceedsRemaining");
  await expect(
    tapTab.connect(model.sponsor).fundParticipant(billId, model.sponsor.address, { value: 1n }),
  ).to.be.revertedWithCustomError(tapTab, "InvalidBeneficiary");
  await expect(tapTab.connect(model.outsider).settleBill(billId))
    .to.be.revertedWithCustomError(tapTab, "BillNotFullyFunded");
  await expect(tapTab.connect(model.outsider).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "NotCreator");
  await expect(tapTab.connect(model.outsider).expireBill(billId))
    .to.be.revertedWithCustomError(tapTab, "DeadlineNotReached");
  await expect(tapTab.connect(model.sponsor).claimRefund(billId))
    .to.be.revertedWithCustomError(tapTab, "NoRefundAvailable");
  await expect(tapTab.connect(model.payee).withdrawProceeds(billId))
    .to.be.revertedWithCustomError(tapTab, "NoProceedsAvailable");
  await expect(
    tapTab.connect(beneficiary.signer).claimItemShare(billId, 0, 0),
  ).to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(
    tapTab
      .connect(beneficiary.signer)
      .updatePreferences(billId, !beneficiary.fairRemainder, beneficiary.tipVoteBps),
  ).to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(tapTab.connect(beneficiary.signer).leaveBill(billId, ethers.ZeroAddress))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(tapTab.connect(model.creator).inviteParticipant(billId, model.sponsor.address))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(tapTab.connect(model.creator).openFunding(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await assertFundingInvariants(tapTab, billId, model, State.Funding, "funding phase guards");
}

async function fundToTarget(tapTab, billId, model, random, target) {
  let paymentIndex = 0;
  while (sum(activeParticipants(model).map(({ amountFunded }) => amountFunded)) < target) {
    const funded = sum(activeParticipants(model).map(({ amountFunded }) => amountFunded));
    const eligible = activeParticipants(model).filter((participant) => {
      const due = model.allocation.ledgers.get(accountKey(participant.signer)).amountDue;
      return participant.amountFunded < due;
    });
    const beneficiary = choose(random, eligible);
    const beneficiaryDue = model.allocation.ledgers.get(accountKey(beneficiary.signer)).amountDue;
    const cap = beneficiaryDue - beneficiary.amountFunded < target - funded
      ? beneficiaryDue - beneficiary.amountFunded
      : target - funded;
    const amount = paymentIndex >= 16 || cap === 1n || random(3) === 0
      ? cap
      : 1n + BigInt(random(Number(cap)));
    const payer = choose(random, model.allPayers);
    await tapTab
      .connect(payer)
      .fundParticipant(billId, beneficiary.signer.address, { value: amount });
    beneficiary.amountFunded += amount;
    const payerKey = accountKey(payer);
    model.contributions.set(payerKey, (model.contributions.get(payerKey) ?? 0n) + amount);
    paymentIndex += 1;
    await assertFundingInvariants(
      tapTab,
      billId,
      model,
      State.Funding,
      `bounded funding payment ${paymentIndex}`,
    );
    if (paymentIndex > 24) {
      throw new Error(`${model.context}: deterministic funding exceeded its 24-payment bound`);
    }
  }
}

async function refundAll(tapTab, billId, model, random, terminalState) {
  const contributors = model.allPayers.filter(
    (signer) => (model.contributions.get(accountKey(signer)) ?? 0n) !== 0n,
  );
  const refundOrder = [];
  while (contributors.length !== 0) {
    refundOrder.push(contributors.splice(random(contributors.length), 1)[0]);
  }
  for (const [index, contributor] of refundOrder.entries()) {
    const key = accountKey(contributor);
    const amount = model.contributions.get(key);
    await tapTab.connect(contributor).claimRefund(billId);
    model.contributions.set(key, 0n);
    model.refundsClaimed += amount;
    await assertFundingInvariants(
      tapTab,
      billId,
      model,
      terminalState,
      `refund ${index + 1} of ${refundOrder.length}`,
    );
  }
  await expect(tapTab.connect(refundOrder[0]).claimRefund(billId))
    .to.be.revertedWithCustomError(tapTab, "NoRefundAvailable");
}

async function moveToDeadline(model) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [model.deadline]);
  await ethers.provider.send("evm_mine", []);
}

async function completeSettled(tapTab, billId, model, random) {
  await fundToTarget(tapTab, billId, model, random, model.allocation.totalDue);
  const beneficiary = activeParticipants(model).find((participant) =>
    model.allocation.ledgers.get(accountKey(participant.signer)).amountDue !== 0n,
  );
  await expect(
    tapTab.connect(model.sponsor).fundParticipant(billId, beneficiary.signer.address, { value: 1n }),
  ).to.be.revertedWithCustomError(tapTab, "PaymentExceedsRemaining");
  await moveToDeadline(model);
  await expect(tapTab.connect(model.creator).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "BillAlreadyFullyFunded");
  await expect(tapTab.connect(model.outsider).expireBill(billId))
    .to.be.revertedWithCustomError(tapTab, "BillAlreadyFullyFunded");
  await tapTab.connect(model.outsider).settleBill(billId);
  await assertFundingInvariants(tapTab, billId, model, State.Settled, "settled ledger");

  await expect(tapTab.connect(model.sponsor).claimRefund(billId))
    .to.be.revertedWithCustomError(tapTab, "NoRefundAvailable");
  await expect(tapTab.connect(model.outsider).withdrawProceeds(billId))
    .to.be.revertedWithCustomError(tapTab, "NotPayee");
  await expect(tapTab.connect(model.creator).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(
    tapTab.connect(model.sponsor).fundParticipant(billId, beneficiary.signer.address, { value: 1n }),
  ).to.be.revertedWithCustomError(tapTab, "WrongState");
  await tapTab.connect(model.payee).withdrawProceeds(billId);
  model.proceedsWithdrawn = true;
  await assertFundingInvariants(tapTab, billId, model, State.Settled, "proceeds withdrawn");
  await expect(tapTab.connect(model.payee).withdrawProceeds(billId))
    .to.be.revertedWithCustomError(tapTab, "NoProceedsAvailable");
}

async function completeCancelledFunding(tapTab, billId, model, random) {
  const target = 1n + BigInt(random(Number(model.allocation.totalDue - 1n)));
  await fundToTarget(tapTab, billId, model, random, target);
  await expect(tapTab.connect(model.outsider).settleBill(billId))
    .to.be.revertedWithCustomError(tapTab, "BillNotFullyFunded");
  await expect(tapTab.connect(model.outsider).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "NotCreator");
  await tapTab.connect(model.creator).cancelBill(billId);
  await assertFundingInvariants(tapTab, billId, model, State.Cancelled, "cancelled ledger");
  await expect(tapTab.connect(model.payee).withdrawProceeds(billId))
    .to.be.revertedWithCustomError(tapTab, "NoProceedsAvailable");
  await expect(tapTab.connect(model.outsider).settleBill(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(tapTab.connect(model.outsider).expireBill(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await refundAll(tapTab, billId, model, random, State.Cancelled);
}

async function completeExpiredFunding(tapTab, billId, model, random) {
  const target = 1n + BigInt(random(Number(model.allocation.totalDue - 1n)));
  await fundToTarget(tapTab, billId, model, random, target);
  await expect(tapTab.connect(model.outsider).settleBill(billId))
    .to.be.revertedWithCustomError(tapTab, "BillNotFullyFunded");
  await expect(tapTab.connect(model.outsider).expireBill(billId))
    .to.be.revertedWithCustomError(tapTab, "DeadlineNotReached");
  await moveToDeadline(model);
  const beneficiary = activeParticipants(model).find((participant) => {
    const due = model.allocation.ledgers.get(accountKey(participant.signer)).amountDue;
    return participant.amountFunded < due;
  });
  await expect(
    tapTab.connect(model.sponsor).fundParticipant(billId, beneficiary.signer.address, { value: 1n }),
  ).to.be.revertedWithCustomError(tapTab, "DraftClosed");
  await tapTab.connect(model.outsider).expireBill(billId);
  await assertFundingInvariants(tapTab, billId, model, State.Expired, "expired ledger");
  await expect(tapTab.connect(model.creator).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(tapTab.connect(model.payee).withdrawProceeds(billId))
    .to.be.revertedWithCustomError(tapTab, "NoProceedsAvailable");
  await refundAll(tapTab, billId, model, random, State.Expired);
}

async function completeCancelledDraft(tapTab, billId, model) {
  await expect(tapTab.connect(model.outsider).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "NotCreator");
  await tapTab.connect(model.creator).cancelBill(billId);
  await assertDraftTerminal(tapTab, billId, model, State.Cancelled, "draft cancelled");
  await expect(tapTab.connect(model.payee).withdrawProceeds(billId))
    .to.be.revertedWithCustomError(tapTab, "NoProceedsAvailable");
  await expect(tapTab.connect(model.sponsor).claimRefund(billId))
    .to.be.revertedWithCustomError(tapTab, "NoRefundAvailable");
  await expect(tapTab.connect(model.creator).openFunding(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(tapTab.connect(model.outsider).settleBill(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(tapTab.connect(model.creator).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
}

async function completeExpiredDraft(tapTab, billId, model) {
  const participant = activeParticipants(model)[0];
  await expect(tapTab.connect(model.outsider).expireBill(billId))
    .to.be.revertedWithCustomError(tapTab, "DeadlineNotReached");
  await moveToDeadline(model);
  await expect(
    tapTab.connect(participant.signer).claimItemShare(billId, 0, 0),
  ).to.be.revertedWithCustomError(tapTab, "DraftClosed");
  await expect(tapTab.connect(model.creator).openFunding(billId))
    .to.be.revertedWithCustomError(tapTab, "DraftClosed");
  await tapTab.connect(model.outsider).expireBill(billId);
  await assertDraftTerminal(tapTab, billId, model, State.Expired, "draft expired");
  await expect(tapTab.connect(model.creator).cancelBill(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
  await expect(tapTab.connect(model.sponsor).claimRefund(billId))
    .to.be.revertedWithCustomError(tapTab, "NoRefundAvailable");
  await expect(tapTab.connect(model.outsider).expireBill(billId))
    .to.be.revertedWithCustomError(tapTab, "WrongState");
}

async function runCampaign(seed, outcome) {
  const random = deterministicRandom(seed);
  const [creator, payee, sponsor, outsider, ...participantPool] = await ethers.getSigners();
  const candidateParticipants = participantPool.slice(0, 7);
  const TapTab = await ethers.getContractFactory("TapTab");
  const tapTab = await TapTab.deploy();
  await tapTab.waitForDeployment();

  const itemCount = 2 + random(4);
  const items = Array.from({ length: itemCount }, () => {
    const shareCount = 1 + random(5);
    return {
      amount: BigInt(shareCount + 3 + random(997)),
      shareCount,
    };
  });
  const latest = await ethers.provider.getBlock("latest");
  const deadline = latest.timestamp + 100_000;
  await tapTab.connect(creator).createBill(
    payee.address,
    `data:application/json,${encodeURIComponent(JSON.stringify({ seed: seedLabel(seed) }))}`,
    deadline,
    items.map(({ amount }) => amount),
    items.map(({ shareCount }) => shareCount),
  );
  const billId = await tapTab.billCount();
  await tapTab
    .connect(creator)
    .inviteMany(billId, candidateParticipants.map(({ address }) => address));

  const initialParticipantCount = 3 + random(3);
  const model = {
    context: `seed ${seedLabel(seed)} (${outcome})`,
    creator,
    payee,
    sponsor,
    outsider,
    deadline,
    items,
    subtotal: sum(items.map(({ amount }) => amount)),
    owners: items.map(({ shareCount }) => Array(shareCount).fill(ethers.ZeroAddress)),
    participants: [],
    participantsByAddress: new Map(),
    waiting: candidateParticipants.slice(initialParticipantCount),
    approvals: new Set(),
    splitVersion: 1n,
    allPayers: uniqueSigners([creator, payee, sponsor, outsider, ...candidateParticipants]),
  };

  for (let index = 0; index < initialParticipantCount; index += 1) {
    const signer = candidateParticipants[index];
    const participant = {
      signer,
      joined: true,
      fairRemainder: index === 0 || random(2) === 1,
      tipVoteBps: random(3_001),
      amountFunded: 0n,
    };
    await tapTab
      .connect(signer)
      .joinBill(billId, participant.fairRemainder, participant.tipVoteBps);
    model.participants.push(participant);
    model.participantsByAddress.set(accountKey(signer), participant);
    model.splitVersion += 1n;
  }
  model.receiptDigest = (await tapTab.getSplitStatus(billId)).receiptDigest;

  await assertDraftInvariants(tapTab, billId, model, "initial generated draft");
  await assertDraftRoleGuards(tapTab, billId, model);

  await performClaim(tapTab, billId, model, random, "required generated claim");
  await performApprovalAction(tapTab, billId, model, random, "required approval");
  await performRevokeAction(tapTab, billId, model, random, "required revocation");
  await performApprovalAction(tapTab, billId, model, random, "approval before mutation");
  await performPreferenceMutation(
    tapTab,
    billId,
    model,
    random,
    "required preference mutation",
  );
  await performLateJoin(tapTab, billId, model, random, "required late join");
  await performLeave(tapTab, billId, model, random, "required claim-transfer leave", true);
  await performUnclaim(tapTab, billId, model, random, "required generated unclaim");

  for (let step = 1; step <= RANDOM_DRAFT_STEPS; step += 1) {
    await performRandomDraftAction(tapTab, billId, model, random, step);
  }

  if (outcome === "cancelled-draft") {
    await completeCancelledDraft(tapTab, billId, model);
    return;
  }
  if (outcome === "expired-draft") {
    await completeExpiredDraft(tapTab, billId, model);
    return;
  }

  await openFunding(tapTab, billId, model, random);
  await assertFundingPhaseGuards(tapTab, billId, model);
  if (outcome === "settled") {
    await completeSettled(tapTab, billId, model, random);
  } else if (outcome === "cancelled-funding") {
    await completeCancelledFunding(tapTab, billId, model, random);
  } else {
    await completeExpiredFunding(tapTab, billId, model, random);
  }
}

describe("TapTab bounded deterministic stateful campaign", function () {
  this.timeout(120_000);

  for (const seed of selectedSeeds()) {
    const outcome = OUTCOMES[seed % OUTCOMES.length];
    it(`replays seed ${seedLabel(seed)} through ${outcome}`, async function () {
      await runCampaign(seed, outcome);
    });
  }
});

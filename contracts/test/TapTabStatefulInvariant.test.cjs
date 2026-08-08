const { expect } = require("chai");
const { ethers } = require("hardhat");

const State = Object.freeze({ Draft: 1n, Funding: 2n, Settled: 3n, Cancelled: 4n, Expired: 5n });
const SEEDS = Object.freeze([
  0x1020_3040,
  0x5eed_c0de,
  0x7f4a_7c15,
  0x9e37_79b9,
  0xc001_d00d,
  0xf00d_baad,
]);

function deterministicRandom(seed) {
  let state = seed >>> 0;
  return (upperExclusive) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return upperExclusive === 0 ? 0 : state % upperExclusive;
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0n);
}

function uniqueSigners(signers) {
  return [...new Map(signers.map((signer) => [signer.address.toLowerCase(), signer])).values()];
}

async function assertDraftAccounting(tapTab, billId, activeSigners, context) {
  const [bill, items, activeAddresses, split] = await Promise.all([
    tapTab.getBill(billId),
    tapTab.getItems(billId),
    tapTab.getParticipants(billId),
    tapTab.getSplitStatus(billId),
  ]);

  expect(bill.state, `${context}: state`).to.equal(State.Draft);
  expect(sum(items.map(({ amount }) => amount)), `${context}: item subtotal`).to.equal(bill.subtotal);
  expect(bill.totalDue, `${context}: draft total due`).to.equal(0n);
  expect(bill.totalFunded, `${context}: draft total funded`).to.equal(0n);
  expect(activeAddresses, `${context}: active participant order`).to.deep.equal(
    activeSigners.map(({ address }) => address),
  );
  expect(split.requiredApprovals, `${context}: required approvals`).to.equal(
    BigInt(activeSigners.length),
  );
  expect(split.currentDigest, `${context}: canonical digest`).to.equal(
    await tapTab.currentSplitDigest(billId),
  );

  const approvals = await Promise.all(
    activeSigners.map(({ address }) => tapTab.hasApprovedCurrentSplit(billId, address)),
  );
  expect(BigInt(approvals.filter(Boolean).length), `${context}: current approval count`).to.equal(
    split.approvalCount,
  );

  for (const [itemIndex, item] of items.entries()) {
    const owners = await tapTab.getItemShareOwners(billId, itemIndex);
    const values = await Promise.all(
      owners.map((_, shareIndex) => tapTab.itemShareValue(billId, itemIndex, shareIndex)),
    );
    expect(sum(values), `${context}: item ${itemIndex} share conservation`).to.equal(item.amount);
    expect(
      BigInt(owners.filter((owner) => owner !== ethers.ZeroAddress).length),
      `${context}: item ${itemIndex} claimed count`,
    ).to.equal(item.claimedShareCount);
  }

  return split;
}

async function assertFundingAccounting(
  tapTab,
  billId,
  activeSigners,
  contributorSigners,
  context,
) {
  const [bill, items] = await Promise.all([tapTab.getBill(billId), tapTab.getItems(billId)]);
  const participants = await Promise.all(
    activeSigners.map(({ address }) => tapTab.getParticipant(billId, address)),
  );
  const contributors = uniqueSigners(contributorSigners);
  const contributions = await Promise.all(
    contributors.map(({ address }) => tapTab.contributionOf(billId, address)),
  );

  expect(sum(items.map(({ amount }) => amount)), `${context}: item subtotal`).to.equal(bill.subtotal);
  expect(sum(participants.map(({ baseDue }) => baseDue)), `${context}: base conservation`).to.equal(
    bill.subtotal,
  );
  expect(sum(participants.map(({ amountDue }) => amountDue)), `${context}: due conservation`).to.equal(
    bill.totalDue,
  );
  expect(sum(participants.map(({ tipDue }) => tipDue)), `${context}: tip conservation`).to.equal(
    bill.totalDue - bill.subtotal,
  );
  expect(
    sum(participants.map(({ amountFunded }) => amountFunded)),
    `${context}: beneficiary funding conservation`,
  ).to.equal(bill.totalFunded);
  expect(sum(contributions), `${context}: contributor funding conservation`).to.equal(
    bill.totalFunded,
  );
  expect(bill.totalFunded <= bill.totalDue, `${context}: totalFunded <= totalDue`).to.equal(true);
  expect(bill.remainingToFund, `${context}: remaining funding`).to.equal(
    bill.totalDue - bill.totalFunded,
  );
  for (const participant of participants) {
    expect(
      participant.amountFunded <= participant.amountDue,
      `${context}: beneficiary not overfunded`,
    ).to.equal(true);
  }
  if (bill.state === State.Funding) {
    expect(await tapTab.proceedsAvailable(billId), `${context}: no pre-settlement proceeds`).to.equal(
      0n,
    );
    for (const contributor of contributors) {
      expect(
        await tapTab.claimableRefund(billId, contributor.address),
        `${context}: no pre-terminal refund`,
      ).to.equal(0n);
    }
  }

  return { bill, participants, contributors, contributions };
}

describe("TapTab deterministic stateful invariants", function () {
  this.timeout(120_000);

  it("preserves accounting, approval versions, funding bounds and terminal-ledger exclusivity", async function () {
    const [creator, payee, sponsor, ...availableParticipants] = await ethers.getSigners();
    const TapTab = await ethers.getContractFactory("TapTab");
    const tapTab = await TapTab.deploy();
    await tapTab.waitForDeployment();

    for (const [sequenceIndex, seed] of SEEDS.entries()) {
      const random = deterministicRandom(seed);
      const context = `seed 0x${seed.toString(16).padStart(8, "0")}`;
      const participantCount = 3 + random(3);
      const joinedSigners = availableParticipants.slice(0, participantCount);
      const itemCount = 2 + random(4);
      const itemAmounts = [];
      const shareCounts = [];
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
        const shares = 1 + random(4);
        shareCounts.push(shares);
        itemAmounts.push(BigInt(shares + 20 + random(180)));
      }

      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 7_200;
      await tapTab.connect(creator).createBill(
        payee.address,
        `data:application/json,${encodeURIComponent(JSON.stringify({ seed }))}`,
        deadline,
        itemAmounts,
        shareCounts,
      );
      const billId = await tapTab.billCount();
      await tapTab
        .connect(creator)
        .inviteMany(billId, joinedSigners.map(({ address }) => address));

      const preferences = joinedSigners.map((_, participantIndex) => ({
        fairRemainder: participantIndex === 0 ? true : random(2) === 1,
        tipVoteBps: random(3_001),
      }));
      for (const [participantIndex, signer] of joinedSigners.entries()) {
        const before = await tapTab.getSplitStatus(billId);
        const preference = preferences[participantIndex];
        await tapTab
          .connect(signer)
          .joinBill(billId, preference.fairRemainder, preference.tipVoteBps);
        const after = await tapTab.getSplitStatus(billId);
        expect(after.splitVersion, `${context}: join advances version`).to.equal(
          before.splitVersion + 1n,
        );
        expect(after.approvalCount, `${context}: join clears approvals`).to.equal(0n);
      }

      const claimsByParticipant = joinedSigners.map(() => ({ itemIndexes: [], shareIndexes: [] }));
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
        for (let shareIndex = 0; shareIndex < shareCounts[itemIndex]; shareIndex += 1) {
          if (itemIndex === 0 && shareIndex === 0) continue;
          if (random(100) >= 58) continue;
          const ownerIndex = random(Math.max(1, participantCount - 1));
          claimsByParticipant[ownerIndex].itemIndexes.push(itemIndex);
          claimsByParticipant[ownerIndex].shareIndexes.push(shareIndex);
        }
      }
      for (const [participantIndex, claim] of claimsByParticipant.entries()) {
        if (claim.itemIndexes.length === 0) continue;
        const before = await tapTab.getSplitStatus(billId);
        await tapTab
          .connect(joinedSigners[participantIndex])
          .claimMany(billId, claim.itemIndexes, claim.shareIndexes);
        const after = await tapTab.getSplitStatus(billId);
        expect(after.splitVersion, `${context}: batched claim advances version once`).to.equal(
          before.splitVersion + 1n,
        );
        expect(after.approvalCount, `${context}: batched claim leaves no approvals`).to.equal(0n);
      }

      let activeSigners = [...joinedSigners];
      await assertDraftAccounting(tapTab, billId, activeSigners, `${context}: initial draft`);

      const stalePreferenceDigest = await tapTab.currentSplitDigest(billId);
      await tapTab.connect(activeSigners[0]).approveSplit(billId, stalePreferenceDigest);
      const beforePreference = await tapTab.getSplitStatus(billId);
      preferences[1] = {
        fairRemainder: !preferences[1].fairRemainder,
        tipVoteBps: preferences[1].tipVoteBps,
      };
      await tapTab
        .connect(activeSigners[1])
        .updatePreferences(
          billId,
          preferences[1].fairRemainder,
          preferences[1].tipVoteBps,
        );
      const afterPreference = await assertDraftAccounting(
        tapTab,
        billId,
        activeSigners,
        `${context}: preference mutation`,
      );
      expect(afterPreference.splitVersion).to.equal(beforePreference.splitVersion + 1n);
      expect(afterPreference.approvalCount).to.equal(0n);
      expect(await tapTab.hasApprovedCurrentSplit(billId, activeSigners[0].address)).to.equal(false);
      await expect(
        tapTab.connect(activeSigners[2]).approveSplit(billId, stalePreferenceDigest),
      ).to.be.revertedWithCustomError(tapTab, "SplitDigestMismatch");

      const staleClaimDigest = await tapTab.currentSplitDigest(billId);
      await tapTab.connect(activeSigners[1]).approveSplit(billId, staleClaimDigest);
      const beforeClaim = await tapTab.getSplitStatus(billId);
      await tapTab.connect(activeSigners[0]).claimItemShare(billId, 0, 0);
      const afterClaim = await assertDraftAccounting(
        tapTab,
        billId,
        activeSigners,
        `${context}: claim mutation`,
      );
      expect(afterClaim.splitVersion).to.equal(beforeClaim.splitVersion + 1n);
      expect(afterClaim.approvalCount).to.equal(0n);
      expect(await tapTab.hasApprovedCurrentSplit(billId, activeSigners[1].address)).to.equal(false);
      await expect(
        tapTab.connect(activeSigners[2]).approveSplit(billId, staleClaimDigest),
      ).to.be.revertedWithCustomError(tapTab, "SplitDigestMismatch");

      const staleUnclaimDigest = await tapTab.currentSplitDigest(billId);
      await tapTab.connect(activeSigners[2]).approveSplit(billId, staleUnclaimDigest);
      const beforeUnclaim = await tapTab.getSplitStatus(billId);
      await tapTab.connect(activeSigners[0]).unclaimItemShare(billId, 0, 0);
      const afterUnclaim = await assertDraftAccounting(
        tapTab,
        billId,
        activeSigners,
        `${context}: unclaim mutation`,
      );
      expect(afterUnclaim.splitVersion).to.equal(beforeUnclaim.splitVersion + 1n);
      expect(afterUnclaim.approvalCount).to.equal(0n);
      expect(await tapTab.hasApprovedCurrentSplit(billId, activeSigners[2].address)).to.equal(false);

      if (sequenceIndex % 2 === 1) {
        const departing = activeSigners.at(-1);
        const staleLeaveDigest = await tapTab.currentSplitDigest(billId);
        await tapTab.connect(activeSigners[0]).approveSplit(billId, staleLeaveDigest);
        const beforeLeave = await tapTab.getSplitStatus(billId);
        await tapTab.connect(departing).leaveBill(billId, ethers.ZeroAddress);
        activeSigners = activeSigners.slice(0, -1);
        const afterLeave = await assertDraftAccounting(
          tapTab,
          billId,
          activeSigners,
          `${context}: leave mutation`,
        );
        expect(afterLeave.splitVersion).to.equal(beforeLeave.splitVersion + 1n);
        expect(afterLeave.approvalCount).to.equal(0n);
        expect(await tapTab.hasApprovedCurrentSplit(billId, activeSigners[0].address)).to.equal(
          false,
        );
        expect(await tapTab.hasApprovedCurrentSplit(billId, departing.address)).to.equal(false);
      }

      const currentDigest = await tapTab.currentSplitDigest(billId);
      const versionBeforeApprovals = (await tapTab.getSplitStatus(billId)).splitVersion;
      for (const [approvalIndex, signer] of activeSigners.entries()) {
        await tapTab.connect(signer).approveSplit(billId, currentDigest);
        const status = await tapTab.getSplitStatus(billId);
        expect(status.splitVersion, `${context}: approval keeps version`).to.equal(
          versionBeforeApprovals,
        );
        expect(status.currentDigest, `${context}: approval keeps digest`).to.equal(currentDigest);
        expect(status.approvalCount, `${context}: approval count`).to.equal(
          BigInt(approvalIndex + 1),
        );
        expect(await tapTab.hasApprovedCurrentSplit(billId, signer.address)).to.equal(true);
      }

      await tapTab.connect(creator).openFunding(billId);
      const contributors = [sponsor, ...activeSigners];
      let accounting = await assertFundingAccounting(
        tapTab,
        billId,
        activeSigners,
        contributors,
        `${context}: funding opened`,
      );
      expect(accounting.bill.state).to.equal(State.Funding);

      const branch = sequenceIndex % 3;
      if (branch === 0) {
        for (const [participantIndex, participant] of accounting.participants.entries()) {
          if (participant.amountDue === 0n) continue;
          const beneficiary = activeSigners[participantIndex];
          const firstAmount = participant.amountDue > 1n
            ? 1n + BigInt(random(Number(participant.amountDue - 1n)))
            : participant.amountDue;
          const firstPayer = participantIndex % 2 === 0 ? sponsor : beneficiary;
          await tapTab
            .connect(firstPayer)
            .fundParticipant(billId, beneficiary.address, { value: firstAmount });
          await assertFundingAccounting(
            tapTab,
            billId,
            activeSigners,
            contributors,
            `${context}: bounded partial funding`,
          );
          const remaining = participant.amountDue - firstAmount;
          if (remaining > 0n) {
            await tapTab
              .connect(beneficiary)
              .fundParticipant(billId, beneficiary.address, { value: remaining });
          }
        }

        accounting = await assertFundingAccounting(
          tapTab,
          billId,
          activeSigners,
          contributors,
          `${context}: exact funding`,
        );
        expect(accounting.bill.totalFunded).to.equal(accounting.bill.totalDue);
        await tapTab.connect(sponsor).settleBill(billId);
        const settled = await tapTab.getBill(billId);
        expect(settled.state).to.equal(State.Settled);
        expect(await tapTab.proceedsAvailable(billId)).to.equal(settled.totalDue);
        for (const contributor of uniqueSigners(contributors)) {
          expect(await tapTab.claimableRefund(billId, contributor.address)).to.equal(0n);
        }
        await expect(tapTab.connect(sponsor).claimRefund(billId)).to.be.revertedWithCustomError(
          tapTab,
          "NoRefundAvailable",
        );
        await tapTab.connect(payee).withdrawProceeds(billId);
        expect(await tapTab.proceedsAvailable(billId)).to.equal(0n);
      } else {
        const beneficiaryIndex = accounting.participants.findIndex(({ amountDue }) => amountDue > 0n);
        const beneficiary = activeSigners[beneficiaryIndex];
        const due = accounting.participants[beneficiaryIndex].amountDue;
        const partialAmount = due > 1n ? due / 2n : due;
        await tapTab
          .connect(sponsor)
          .fundParticipant(billId, beneficiary.address, { value: partialAmount });
        accounting = await assertFundingAccounting(
          tapTab,
          billId,
          activeSigners,
          contributors,
          `${context}: failure-path funding`,
        );
        expect(accounting.bill.totalFunded < accounting.bill.totalDue).to.equal(true);

        if (branch === 1) {
          await tapTab.connect(creator).cancelBill(billId);
          expect((await tapTab.getBill(billId)).state).to.equal(State.Cancelled);
        } else {
          await ethers.provider.send("evm_setNextBlockTimestamp", [deadline]);
          await ethers.provider.send("evm_mine", []);
          await tapTab.connect(sponsor).expireBill(billId);
          expect((await tapTab.getBill(billId)).state).to.equal(State.Expired);
        }

        expect(await tapTab.proceedsAvailable(billId), `${context}: failure has no proceeds`).to.equal(
          0n,
        );
        const terminalContributors = uniqueSigners(contributors);
        const refundable = await Promise.all(
          terminalContributors.map(({ address }) => tapTab.claimableRefund(billId, address)),
        );
        expect(sum(refundable), `${context}: refundable contribution conservation`).to.equal(
          accounting.bill.totalFunded,
        );
        await expect(tapTab.connect(payee).withdrawProceeds(billId)).to.be.revertedWithCustomError(
          tapTab,
          "NoProceedsAvailable",
        );
        for (const [contributorIndex, contributor] of terminalContributors.entries()) {
          if (refundable[contributorIndex] === 0n) continue;
          await tapTab.connect(contributor).claimRefund(billId);
          expect(await tapTab.claimableRefund(billId, contributor.address)).to.equal(0n);
          expect(await tapTab.proceedsAvailable(billId)).to.equal(0n);
        }
      }
    }
  });
});

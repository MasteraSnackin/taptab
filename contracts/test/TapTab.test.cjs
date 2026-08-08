const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TapTab", function () {
  const State = {
    None: 0n,
    Draft: 1n,
    Funding: 2n,
    Settled: 3n,
    Cancelled: 4n,
    Expired: 5n,
  };

  let tapTab;
  let creator;
  let payee;
  let alice;
  let bob;
  let carol;
  let dave;
  let sponsor;
  let outsider;
  let signersByAddress;

  beforeEach(async function () {
    [creator, payee, alice, bob, carol, dave, sponsor, outsider] =
      await ethers.getSigners();
    signersByAddress = new Map(
      [creator, payee, alice, bob, carol, dave, sponsor, outsider].map((signer) => [
        signer.address.toLowerCase(),
        signer,
      ]),
    );
    const TapTab = await ethers.getContractFactory("TapTab");
    tapTab = await TapTab.deploy();
    await tapTab.waitForDeployment();
  });

  async function now() {
    return (await ethers.provider.getBlock("latest")).timestamp;
  }

  async function moveTo(timestamp) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
    await ethers.provider.send("evm_mine", []);
  }

  async function createBill({
    signer = creator,
    recipient = payee,
    duration = 3600,
    itemAmounts = [1000n],
    shares = [1],
    metadataURI = "ipfs://taptab/receipt.json",
  } = {}) {
    const deadline = (await now()) + duration;
    await tapTab
      .connect(signer)
      .createBill(recipient.address, metadataURI, deadline, itemAmounts, shares);
    return { billId: await tapTab.billCount(), deadline };
  }

  async function join(billId, participant, fairRemainder = false, tipVoteBps = 0) {
    await tapTab.connect(creator).inviteParticipant(billId, participant.address);
    return tapTab
      .connect(participant)
      .joinBill(billId, fairRemainder, tipVoteBps);
  }

  async function due(billId, participant) {
    return (await tapTab.getParticipant(billId, participant.address)).amountDue;
  }

  async function approveAll(billId) {
    const digest = await tapTab.currentSplitDigest(billId);
    const participants = await tapTab.getParticipants(billId);
    for (const address of participants) {
      const signer = signersByAddress.get(address.toLowerCase());
      if (!signer) throw new Error(`Missing test signer for ${address}`);
      await tapTab.connect(signer).approveSplit(billId, digest);
    }
    return digest;
  }

  async function approveAndOpen(billId) {
    await approveAll(billId);
    return tapTab.connect(creator).openFunding(billId);
  }

  describe("draft creation and item shares", function () {
    it("requires a unique creator invitation and consumes it on join", async function () {
      const { billId } = await createBill();

      await expect(tapTab.connect(alice).joinBill(billId, true, 1000))
        .to.be.revertedWithCustomError(tapTab, "NotInvited");
      await expect(tapTab.connect(outsider).inviteParticipant(billId, alice.address))
        .to.be.revertedWithCustomError(tapTab, "NotCreator");
      await expect(tapTab.connect(creator).inviteParticipant(billId, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(tapTab, "InvalidParticipant");

      await expect(tapTab.connect(creator).inviteParticipant(billId, alice.address))
        .to.emit(tapTab, "ParticipantInvited")
        .withArgs(billId, alice.address);
      expect(await tapTab.isInvited(billId, alice.address)).to.equal(true);
      await expect(tapTab.connect(creator).inviteParticipant(billId, alice.address))
        .to.be.revertedWithCustomError(tapTab, "AlreadyInvited");

      await tapTab.connect(alice).joinBill(billId, true, 1000);
      expect(await tapTab.isInvited(billId, alice.address)).to.equal(false);
      await expect(tapTab.connect(creator).inviteParticipant(billId, alice.address))
        .to.be.revertedWithCustomError(tapTab, "AlreadyJoined");

      // The creator is allowed to approve itself, but gets no implicit slot.
      await tapTab.connect(creator).inviteParticipant(billId, creator.address);
      await tapTab.connect(creator).joinBill(billId, false, 0);
      expect((await tapTab.getParticipant(billId, creator.address)).joined).to.equal(true);
    });

    it("atomically invites a bounded group while preserving single-invite rules", async function () {
      const { billId } = await createBill();

      const invitation = tapTab
        .connect(creator)
        .inviteMany(billId, [alice.address, bob.address, carol.address]);
      await expect(invitation)
        .to.emit(tapTab, "ParticipantInvited")
        .withArgs(billId, alice.address);
      await expect(invitation)
        .to.emit(tapTab, "ParticipantInvited")
        .withArgs(billId, bob.address);
      expect(await tapTab.isInvited(billId, alice.address)).to.equal(true);
      expect(await tapTab.isInvited(billId, bob.address)).to.equal(true);
      expect(await tapTab.isInvited(billId, carol.address)).to.equal(true);

      await tapTab.connect(alice).joinBill(billId, true, 1000);
      await tapTab.connect(bob).joinBill(billId, false, 1250);
      expect(await tapTab.getParticipants(billId)).to.deep.equal([
        alice.address,
        bob.address,
      ]);

      await expect(tapTab.connect(outsider).inviteMany(billId, [dave.address]))
        .to.be.revertedWithCustomError(tapTab, "NotCreator");
      await expect(tapTab.connect(creator).inviteMany(billId, []))
        .to.be.revertedWithCustomError(tapTab, "InvalidBatchConfiguration");
      await expect(
        tapTab.connect(creator).inviteMany(billId, Array(33).fill(dave.address)),
      ).to.be.revertedWithCustomError(tapTab, "InvalidBatchConfiguration");
      await expect(tapTab.connect(creator).inviteMany(billId, [alice.address]))
        .to.be.revertedWithCustomError(tapTab, "AlreadyJoined");
    });

    it("rolls back every invitation when any batch member is invalid or duplicated", async function () {
      const first = await createBill();
      await expect(
        tapTab
          .connect(creator)
          .inviteMany(first.billId, [alice.address, ethers.ZeroAddress]),
      ).to.be.revertedWithCustomError(tapTab, "InvalidParticipant");
      expect(await tapTab.isInvited(first.billId, alice.address)).to.equal(false);

      const second = await createBill();
      await expect(
        tapTab.connect(creator).inviteMany(second.billId, [bob.address, bob.address]),
      ).to.be.revertedWithCustomError(tapTab, "AlreadyInvited");
      expect(await tapTab.isInvited(second.billId, bob.address)).to.equal(false);
    });

    it("creates a UI-readable bill with exact item and share data", async function () {
      const deadline = (await now()) + 3600;
      await expect(
        tapTab.createBill(
          payee.address,
          "ipfs://receipt",
          deadline,
          [10n, 21n],
          [3, 2],
        ),
      )
        .to.emit(tapTab, "BillCreated")
        .withArgs(
          1n,
          creator.address,
          payee.address,
          BigInt(deadline),
          31n,
          "ipfs://receipt",
        );

      const bill = await tapTab.getBill(1);
      expect(bill.creator).to.equal(creator.address);
      expect(bill.payee).to.equal(payee.address);
      expect(bill.state).to.equal(State.Draft);
      expect(bill.subtotal).to.equal(31n);
      expect(bill.totalDue).to.equal(0n);
      expect(bill.remainingToFund).to.equal(0n);

      const items = await tapTab.getItems(1);
      expect(items.map((item) => item.amount)).to.deep.equal([10n, 21n]);
      expect(items.map((item) => item.shareCount)).to.deep.equal([3n, 2n]);
      expect(await tapTab.itemShareValue(1, 0, 0)).to.equal(4n);
      expect(await tapTab.itemShareValue(1, 0, 1)).to.equal(3n);
      expect(await tapTab.itemShareValue(1, 0, 2)).to.equal(3n);
    });

    it("rejects itself as payee before settled proceeds can become unreachable", async function () {
      const deadline = (await now()) + 3600;
      const contractAddress = await tapTab.getAddress();

      await expect(
        tapTab.createBill(contractAddress, "ipfs://receipt", deadline, [10n], [1]),
      ).to.be.revertedWithCustomError(tapTab, "InvalidPayee");
      expect(await tapTab.billCount()).to.equal(0n);
    });

    it("rejects invalid bills and bounded-loop violations", async function () {
      const timestamp = await now();
      await expect(
        tapTab.createBill(ethers.ZeroAddress, "", timestamp + 10, [1], [1]),
      ).to.be.revertedWithCustomError(tapTab, "InvalidPayee");
      await expect(
        tapTab.createBill(payee.address, "", timestamp, [1], [1]),
      ).to.be.revertedWithCustomError(tapTab, "InvalidDeadline");
      await expect(
        tapTab.createBill(payee.address, "", timestamp + 10, [], []),
      ).to.be.revertedWithCustomError(tapTab, "InvalidItemConfiguration");
      await expect(
        tapTab.createBill(payee.address, "", timestamp + 10, [1], [2]),
      ).to.be.revertedWithCustomError(tapTab, "InvalidItemConfiguration");
      await expect(
        tapTab.createBill(
          payee.address,
          "",
          timestamp + 10,
          Array(5).fill(100n),
          Array(5).fill(32),
        ),
      ).to.be.revertedWithCustomError(tapTab, "InvalidItemConfiguration");
      await expect(tapTab.getBill(99)).to.be.revertedWithCustomError(
        tapTab,
        "BillNotFound",
      );
    });

    it("enforces participant ownership while allowing claim and unclaim", async function () {
      const { billId } = await createBill({ itemAmounts: [20n], shares: [2] });
      await expect(tapTab.connect(alice).claimItemShare(billId, 0, 0))
        .to.be.revertedWithCustomError(tapTab, "NotParticipant");

      await join(billId, alice, true, 1000);
      await join(billId, bob, false, 1250);
      await expect(tapTab.connect(alice).claimItemShare(billId, 0, 0))
        .to.emit(tapTab, "ItemShareClaimed")
        .withArgs(billId, 0n, 0n, alice.address, 10n);
      await expect(tapTab.connect(bob).claimItemShare(billId, 0, 0))
        .to.be.revertedWithCustomError(tapTab, "ShareAlreadyClaimed");
      await expect(tapTab.connect(bob).unclaimItemShare(billId, 0, 0))
        .to.be.revertedWithCustomError(tapTab, "NotShareOwner");
      await tapTab.connect(alice).unclaimItemShare(billId, 0, 0);

      expect(await tapTab.getItemShareOwners(billId, 0)).to.deep.equal([
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      ]);
    });

    it("claims several share slots atomically and invalidates approvals only once", async function () {
      const { billId } = await createBill({
        itemAmounts: [11n, 20n],
        shares: [3, 2],
      });
      await join(billId, alice, true, 1000);
      const digest = await tapTab.currentSplitDigest(billId);
      await tapTab.connect(alice).approveSplit(billId, digest);
      const versionBefore = (await tapTab.getSplitStatus(billId)).splitVersion;

      const transaction = await tapTab
        .connect(alice)
        .claimMany(billId, [0, 1], [0, 1]);
      await expect(transaction)
        .to.emit(tapTab, "ItemShareClaimed")
        .withArgs(billId, 0n, 0n, alice.address, 4n);
      await expect(transaction)
        .to.emit(tapTab, "ItemShareClaimed")
        .withArgs(billId, 1n, 1n, alice.address, 10n);

      const receipt = await transaction.wait();
      const versionTopic = tapTab.interface.getEvent("SplitVersionAdvanced").topicHash;
      expect(receipt.logs.filter((log) => log.topics[0] === versionTopic)).to.have.length(1);
      const status = await tapTab.getSplitStatus(billId);
      expect(status.splitVersion).to.equal(versionBefore + 1n);
      expect(status.approvalCount).to.equal(0n);
      expect(await tapTab.hasApprovedCurrentSplit(billId, alice.address)).to.equal(false);
      expect(await tapTab.getItemShareOwners(billId, 0)).to.deep.equal([
        alice.address,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      ]);
      expect(await tapTab.getItemShareOwners(billId, 1)).to.deep.equal([
        ethers.ZeroAddress,
        alice.address,
      ]);
    });

    it("rejects malformed claim batches without leaving partial ownership behind", async function () {
      const { billId } = await createBill({ itemAmounts: [20n], shares: [2] });
      await join(billId, alice, true, 0);

      await expect(tapTab.connect(alice).claimMany(billId, [], []))
        .to.be.revertedWithCustomError(tapTab, "InvalidBatchConfiguration");
      await expect(tapTab.connect(alice).claimMany(billId, [0], []))
        .to.be.revertedWithCustomError(tapTab, "InvalidBatchConfiguration");
      await expect(
        tapTab.connect(alice).claimMany(billId, Array(129).fill(0), Array(129).fill(0)),
      ).to.be.revertedWithCustomError(tapTab, "InvalidBatchConfiguration");
      await expect(tapTab.connect(outsider).claimMany(billId, [0], [0]))
        .to.be.revertedWithCustomError(tapTab, "NotParticipant");

      await expect(tapTab.connect(alice).claimMany(billId, [0, 9], [0, 0]))
        .to.be.revertedWithCustomError(tapTab, "InvalidShare");
      expect(await tapTab.getItemShareOwners(billId, 0)).to.deep.equal([
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      ]);

      await expect(tapTab.connect(alice).claimMany(billId, [0, 0], [0, 0]))
        .to.be.revertedWithCustomError(tapTab, "ShareAlreadyClaimed");
      expect(await tapTab.getItemShareOwners(billId, 0)).to.deep.equal([
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      ]);
    });

    it("keeps batched claims inside the Draft deadline and lifecycle", async function () {
      const expiring = await createBill({ duration: 100 });
      await join(expiring.billId, alice, true, 0);
      await moveTo(expiring.deadline);
      await expect(tapTab.connect(alice).claimMany(expiring.billId, [0], [0]))
        .to.be.revertedWithCustomError(tapTab, "DraftClosed");

      const funding = await createBill();
      await join(funding.billId, bob, true, 0);
      await approveAndOpen(funding.billId);
      await expect(tapTab.connect(bob).claimMany(funding.billId, [0], [0]))
        .to.be.revertedWithCustomError(tapTab, "WrongState");
    });

    it("lets participants update fair-remainder and custom tip preferences only in Draft", async function () {
      const { billId } = await createBill();
      await join(billId, alice, false, 0);
      await expect(tapTab.connect(alice).updatePreferences(billId, true, 1777))
        .to.emit(tapTab, "PreferencesUpdated")
        .withArgs(billId, alice.address, true, 1777n);
      const participant = await tapTab.getParticipant(billId, alice.address);
      expect(participant.fairRemainder).to.equal(true);
      expect(participant.tipVoteBps).to.equal(1777n);

      await expect(join(billId, bob, true, 3001)).to.be.revertedWithCustomError(
        tapTab,
        "InvalidTipVote",
      );
      await approveAndOpen(billId);
      await expect(tapTab.connect(alice).updatePreferences(billId, false, 0))
        .to.be.revertedWithCustomError(tapTab, "WrongState");
    });
  });

  describe("unanimous split approval", function () {
    it("memoises one digest per split version for later approvals", async function () {
      const { billId } = await createBill({
        itemAmounts: [80n, 80n, 80n, 80n],
        shares: [8, 8, 8, 8],
      });
      await join(billId, alice, true, 1000);
      await join(billId, bob, true, 1250);
      const digest = await tapTab.currentSplitDigest(billId);

      const firstReceipt = await (
        await tapTab.connect(alice).approveSplit(billId, digest)
      ).wait();
      const cachedReceipt = await (
        await tapTab.connect(bob).approveSplit(billId, digest)
      ).wait();

      expect(cachedReceipt.gasUsed).to.be.lessThan(firstReceipt.gasUsed);
      expect(await tapTab.currentSplitDigest(billId)).to.equal(digest);
      expect((await tapTab.getSplitStatus(billId)).approvalCount).to.equal(2n);
    });

    it("invalidates the digest cache by version after a split mutation", async function () {
      const { billId } = await createBill({ itemAmounts: [20n], shares: [2] });
      await join(billId, alice, true, 1000);
      await join(billId, bob, true, 1250);
      await tapTab.connect(alice).claimItemShare(billId, 0, 0);
      const staleDigest = await tapTab.currentSplitDigest(billId);
      await tapTab.connect(alice).approveSplit(billId, staleDigest);

      await tapTab.connect(bob).claimItemShare(billId, 0, 1);
      const freshDigest = await tapTab.currentSplitDigest(billId);
      expect(freshDigest).to.not.equal(staleDigest);
      await expect(tapTab.connect(bob).approveSplit(billId, staleDigest))
        .to.be.revertedWithCustomError(tapTab, "SplitDigestMismatch")
        .withArgs(staleDigest, freshDigest);
      await expect(tapTab.connect(bob).approveSplit(billId, freshDigest))
        .to.emit(tapTab, "SplitApproved")
        .withArgs(billId, bob.address, 5n, freshDigest);
    });

    it("does not let a failed first stale approval poison an empty cache", async function () {
      const { billId } = await createBill({ itemAmounts: [20n], shares: [2] });
      await join(billId, alice, true, 1000);
      const currentDigest = await tapTab.currentSplitDigest(billId);
      const staleDigest = ethers.keccak256(ethers.toUtf8Bytes("stale split"));

      await expect(tapTab.connect(alice).approveSplit(billId, staleDigest))
        .to.be.revertedWithCustomError(tapTab, "SplitDigestMismatch")
        .withArgs(staleDigest, currentDigest);
      await expect(tapTab.connect(alice).approveSplit(billId, currentDigest))
        .to.emit(tapTab, "SplitApproved")
        .withArgs(billId, alice.address, 2n, currentDigest);
      expect(await tapTab.currentSplitDigest(billId)).to.equal(currentDigest);
    });

    it("blocks partial approval and rejects stale digests after a split mutation", async function () {
      const { billId } = await createBill({ itemAmounts: [20n], shares: [2] });
      await join(billId, alice, true, 1000);
      await join(billId, bob, true, 1250);
      await tapTab.connect(alice).claimItemShare(billId, 0, 0);

      const staleDigest = await tapTab.currentSplitDigest(billId);
      await tapTab.connect(alice).approveSplit(billId, staleDigest);
      await expect(tapTab.connect(creator).openFunding(billId))
        .to.be.revertedWithCustomError(tapTab, "SplitNotUnanimouslyApproved")
        .withArgs(1n, 2n);

      await tapTab.connect(bob).claimItemShare(billId, 0, 1);
      const status = await tapTab.getSplitStatus(billId);
      expect(status.approvalCount).to.equal(0n);
      expect(status.currentDigest).to.not.equal(staleDigest);
      expect(await tapTab.hasApprovedCurrentSplit(billId, alice.address)).to.equal(false);
      await expect(tapTab.connect(bob).approveSplit(billId, staleDigest))
        .to.be.revertedWithCustomError(tapTab, "SplitDigestMismatch");

      await approveAndOpen(billId);
      expect((await tapTab.getBill(billId)).state).to.equal(State.Funding);
    });

    it("invalidates approvals in O(1) for joins, claims, unclaims, preferences and leaving", async function () {
      const { billId } = await createBill({ itemAmounts: [20n], shares: [2] });
      await join(billId, alice, true, 0);
      await approveAll(billId);
      let status = await tapTab.getSplitStatus(billId);
      const firstVersion = status.splitVersion;
      expect(status.approvalCount).to.equal(1n);

      await join(billId, bob, true, 0);
      status = await tapTab.getSplitStatus(billId);
      expect(status.splitVersion).to.equal(firstVersion + 1n);
      expect(status.approvalCount).to.equal(0n);

      await approveAll(billId);
      await tapTab.connect(alice).claimItemShare(billId, 0, 0);
      expect((await tapTab.getSplitStatus(billId)).approvalCount).to.equal(0n);

      await approveAll(billId);
      await tapTab.connect(alice).unclaimItemShare(billId, 0, 0);
      expect((await tapTab.getSplitStatus(billId)).approvalCount).to.equal(0n);

      await approveAll(billId);
      await tapTab.connect(alice).updatePreferences(billId, false, 1777);
      expect((await tapTab.getSplitStatus(billId)).approvalCount).to.equal(0n);

      await approveAll(billId);
      await tapTab.connect(bob).leaveBill(billId, ethers.ZeroAddress);
      status = await tapTab.getSplitStatus(billId);
      expect(status.approvalCount).to.equal(0n);
      expect(status.requiredApprovals).to.equal(1n);
      expect(await tapTab.hasApprovedCurrentSplit(billId, alice.address)).to.equal(false);
    });

    it("supports explicit approval revocation and immutable receipt commitments", async function () {
      const first = await createBill({
        itemAmounts: [100n],
        shares: [1],
        metadataURI: "data:application/json,%7B%22quote%22%3A1%7D",
      });
      const second = await createBill({
        itemAmounts: [101n],
        shares: [1],
        metadataURI: "data:application/json,%7B%22quote%22%3A1%7D",
      });
      expect((await tapTab.getSplitStatus(first.billId)).receiptDigest).to.not.equal(
        (await tapTab.getSplitStatus(second.billId)).receiptDigest,
      );

      await join(first.billId, alice, true, 0);
      const digest = await tapTab.currentSplitDigest(first.billId);
      await expect(tapTab.connect(alice).approveSplit(first.billId, digest))
        .to.emit(tapTab, "SplitApproved");
      await expect(tapTab.connect(alice).approveSplit(first.billId, digest))
        .to.be.revertedWithCustomError(tapTab, "SplitAlreadyApproved");
      await expect(tapTab.connect(alice).revokeSplitApproval(first.billId))
        .to.emit(tapTab, "SplitApprovalRevoked");
      expect((await tapTab.getSplitStatus(first.billId)).approvalCount).to.equal(0n);
    });
  });

  describe("leave-table claim transfer", function () {
    it("atomically transfers every claimed slot and preserves remaining join order", async function () {
      const { billId } = await createBill({ itemAmounts: [10n, 20n], shares: [2, 2] });
      await join(billId, alice, true, 1000);
      await join(billId, bob, true, 1250);
      await join(billId, carol, true, 1500);
      await tapTab.connect(alice).claimItemShare(billId, 0, 0);
      await tapTab.connect(alice).claimItemShare(billId, 1, 1);
      await tapTab.connect(bob).claimItemShare(billId, 0, 1);
      await approveAll(billId);

      await expect(tapTab.connect(alice).leaveBill(billId, bob.address))
        .to.emit(tapTab, "ParticipantLeft")
        .withArgs(billId, alice.address, bob.address, 2n);
      expect(await tapTab.getItemShareOwners(billId, 0)).to.deep.equal([
        bob.address,
        bob.address,
      ]);
      expect(await tapTab.getItemShareOwners(billId, 1)).to.deep.equal([
        ethers.ZeroAddress,
        bob.address,
      ]);
      expect(await tapTab.getParticipants(billId)).to.deep.equal([bob.address, carol.address]);
      expect((await tapTab.getParticipant(billId, alice.address)).joined).to.equal(false);
      expect((await tapTab.getSplitStatus(billId)).approvalCount).to.equal(0n);

      await approveAndOpen(billId);
      expect(await due(billId, alice)).to.equal(0n);
      expect((await tapTab.getBill(billId)).participantCount).to.equal(2n);
    });

    it("allows leaving without shares and permanently prevents rejoining", async function () {
      const { billId } = await createBill();
      await join(billId, alice, true, 0);
      await join(billId, bob, true, 0);
      await expect(tapTab.connect(alice).leaveBill(billId, ethers.ZeroAddress))
        .to.emit(tapTab, "ParticipantLeft")
        .withArgs(billId, alice.address, ethers.ZeroAddress, 0n);
      expect(await tapTab.getParticipants(billId)).to.deep.equal([bob.address]);
      await expect(tapTab.connect(creator).inviteParticipant(billId, alice.address))
        .to.be.revertedWithCustomError(tapTab, "AlreadyParticipated");
    });

    it("rejects self, non-participant and missing transfer recipients", async function () {
      const { billId } = await createBill({ itemAmounts: [20n], shares: [2] });
      await join(billId, alice, true, 0);
      await join(billId, bob, true, 0);
      await tapTab.connect(alice).claimItemShare(billId, 0, 0);

      await expect(tapTab.connect(alice).leaveBill(billId, alice.address))
        .to.be.revertedWithCustomError(tapTab, "InvalidTransferRecipient");
      await expect(tapTab.connect(alice).leaveBill(billId, outsider.address))
        .to.be.revertedWithCustomError(tapTab, "InvalidTransferRecipient");
      await expect(tapTab.connect(alice).leaveBill(billId, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(tapTab, "ClaimedSharesRequireRecipient");
      await expect(tapTab.connect(outsider).leaveBill(billId, bob.address))
        .to.be.revertedWithCustomError(tapTab, "NotParticipant");
    });

    it("forbids transfers after Funding opens", async function () {
      const { billId } = await createBill();
      await join(billId, alice, true, 0);
      await join(billId, bob, true, 0);
      await approveAndOpen(billId);
      await expect(tapTab.connect(alice).leaveBill(billId, bob.address))
        .to.be.revertedWithCustomError(tapTab, "WrongState");
    });
  });

  describe("locked allocation", function () {
    it("splits shared items and charges unclaimed value only to opted-in participants", async function () {
      const { billId } = await createBill({
        itemAmounts: [10n, 7n],
        shares: [3, 1],
      });
      await join(billId, alice, true, 0);
      await join(billId, bob, true, 0);
      await join(billId, carol, false, 0);
      await tapTab.connect(alice).claimItemShare(billId, 0, 0); // 4
      await tapTab.connect(bob).claimItemShare(billId, 0, 1); // 3

      await approveAll(billId);
      const openTransaction = await tapTab.connect(creator).openFunding(billId);
      await expect(openTransaction)
        .to.emit(tapTab, "FundingOpened")
        .withArgs(billId, 0n, 17n, 0n, 17n);
      const openReceipt = await openTransaction.wait();
      const fundingOpenedTopic = tapTab.interface.getEvent("FundingOpened").topicHash;
      expect(
        openReceipt.logs.filter((log) => log.topics[0] === fundingOpenedTopic),
      ).to.have.length(1);

      // Ten unclaimed wei are divided between Alice and Bob. Carol opted out.
      expect(await due(billId, alice)).to.equal(9n);
      expect(await due(billId, bob)).to.equal(8n);
      expect(await due(billId, carol)).to.equal(0n);
      expect(
        (await Promise.all([alice, bob, carol].map((p) => due(billId, p)))).reduce(
          (sum, value) => sum + value,
          0n,
        ),
      ).to.equal(17n);
    });

    it("refuses to hide unclaimed value when nobody opted into the remainder", async function () {
      const { billId } = await createBill({ itemAmounts: [10n], shares: [2] });
      await join(billId, alice, false, 0);
      await tapTab.connect(alice).claimItemShare(billId, 0, 0);
      await approveAll(billId);
      await expect(tapTab.connect(creator).openFunding(billId))
        .to.be.revertedWithCustomError(tapTab, "UnclaimedValueWithoutOptIn");

      // The reverted calculation leaves no partial due amount behind.
      expect(await due(billId, alice)).to.equal(0n);
      await tapTab.connect(alice).updatePreferences(billId, true, 0);
      await approveAndOpen(billId);
      expect(await due(billId, alice)).to.equal(10n);
    });

    it("locks floor-average median tip voting including preset and custom votes", async function () {
      const { billId } = await createBill({ itemAmounts: [10_000n], shares: [1] });
      for (const [participant, vote] of [
        [alice, 0],
        [bob, 1000],
        [carol, 1250],
        [dave, 1777],
      ]) {
        await join(billId, participant, true, vote);
      }
      await tapTab.connect(alice).claimItemShare(billId, 0, 0);
      await approveAndOpen(billId);

      const bill = await tapTab.getBill(billId);
      expect(bill.lockedTipBps).to.equal(1125n); // floor((1000 + 1250) / 2)
      expect(bill.totalDue).to.equal(11_125n);
      expect(await due(billId, alice)).to.equal(11_125n);
    });

    it("accounts exactly for share, fair-remainder, and tip rounding dust", async function () {
      const { billId } = await createBill({ itemAmounts: [10n], shares: [3] });
      for (const participant of [alice, bob, carol]) {
        await join(billId, participant, false, 1250);
      }
      await tapTab.connect(alice).claimItemShare(billId, 0, 0); // 4
      await tapTab.connect(bob).claimItemShare(billId, 0, 1); // 3
      await tapTab.connect(carol).claimItemShare(billId, 0, 2); // 3
      for (const participant of [alice, bob, carol]) {
        const draftLedger = await tapTab.getParticipant(billId, participant.address);
        expect(draftLedger.baseDue).to.equal(0n);
        expect(draftLedger.tipDue).to.equal(0n);
        expect(draftLedger.amountDue).to.equal(0n);
      }
      await approveAndOpen(billId);

      // floor(10 * 12.5%) = 1. Individual floors are zero, so one dust wei
      // is deterministically assigned to the first positive-due participant.
      const ledgers = await Promise.all(
        [alice, bob, carol].map((participant) =>
          tapTab.getParticipant(billId, participant.address),
        ),
      );
      expect(
        ledgers.map((participant) => [
          participant.baseDue,
          participant.tipDue,
          participant.amountDue,
        ]),
      ).to.deep.equal([
        [4n, 1n, 5n],
        [3n, 0n, 3n],
        [3n, 0n, 3n],
      ]);
      for (const participant of ledgers) {
        expect(participant.baseDue + participant.tipDue).to.equal(participant.amountDue);
      }
      expect(ledgers.reduce((sum, participant) => sum + participant.baseDue, 0n)).to.equal(
        10n,
      );
      expect(ledgers.reduce((sum, participant) => sum + participant.tipDue, 0n)).to.equal(
        1n,
      );
      expect(ledgers.reduce((sum, participant) => sum + participant.amountDue, 0n)).to.equal(
        11n,
      );
      expect((await tapTab.getBill(billId)).totalDue).to.equal(11n);
    });

    it("restricts opening Funding to the creator before the deadline", async function () {
      const { billId, deadline } = await createBill({ duration: 100 });
      await join(billId, alice, true, 0);
      await expect(tapTab.connect(outsider).openFunding(billId))
        .to.be.revertedWithCustomError(tapTab, "NotCreator");
      await moveTo(deadline);
      await expect(tapTab.connect(creator).openFunding(billId))
        .to.be.revertedWithCustomError(tapTab, "DraftClosed");
    });
  });

  describe("funding, sponsorship, and settlement", function () {
    async function openTwoPersonBill() {
      const created = await createBill({ itemAmounts: [40n], shares: [2] });
      await join(created.billId, alice, false, 0);
      await join(created.billId, bob, false, 0);
      await tapTab.connect(alice).claimItemShare(created.billId, 0, 0);
      await tapTab.connect(bob).claimItemShare(created.billId, 0, 1);
      await approveAndOpen(created.billId);
      return created;
    }

    it("allows any payer to sponsor a participant without exceeding exact dues", async function () {
      const { billId } = await openTwoPersonBill();
      await expect(
        tapTab.connect(sponsor).fundParticipant(billId, alice.address, { value: 15n }),
      )
        .to.emit(tapTab, "ContributionReceived")
        .withArgs(billId, sponsor.address, alice.address, 15n, 15n, 15n);
      await tapTab.connect(alice).fundParticipant(billId, alice.address, { value: 5n });
      await tapTab.connect(sponsor).fundParticipant(billId, bob.address, { value: 20n });

      expect(await tapTab.contributionOf(billId, sponsor.address)).to.equal(35n);
      expect(await tapTab.remainingDue(billId, alice.address)).to.equal(0n);
      expect((await tapTab.getBill(billId)).totalFunded).to.equal(40n);
    });

    it("rejects zero payments, unknown beneficiaries, and overpayment", async function () {
      const { billId } = await openTwoPersonBill();
      await expect(
        tapTab.connect(sponsor).fundParticipant(billId, alice.address, { value: 0 }),
      ).to.be.revertedWithCustomError(tapTab, "ZeroPayment");
      await expect(
        tapTab.connect(sponsor).fundParticipant(billId, outsider.address, { value: 1 }),
      ).to.be.revertedWithCustomError(tapTab, "InvalidBeneficiary");
      await expect(
        tapTab.connect(sponsor).fundParticipant(billId, alice.address, { value: 21 }),
      )
        .to.be.revertedWithCustomError(tapTab, "PaymentExceedsRemaining")
        .withArgs(20n, 21n);
    });

    it("cannot settle an incomplete bill and settles exactly once when fully funded", async function () {
      const { billId } = await openTwoPersonBill();
      await tapTab.connect(alice).fundParticipant(billId, alice.address, { value: 20n });
      await expect(tapTab.connect(outsider).settleBill(billId))
        .to.be.revertedWithCustomError(tapTab, "BillNotFullyFunded")
        .withArgs(20n, 40n);
      await tapTab.connect(bob).fundParticipant(billId, bob.address, { value: 20n });

      await expect(tapTab.connect(outsider).settleBill(billId))
        .to.emit(tapTab, "BillSettled")
        .withArgs(billId, 40n);
      expect((await tapTab.getBill(billId)).state).to.equal(State.Settled);
      await expect(tapTab.settleBill(billId)).to.be.revertedWithCustomError(
        tapTab,
        "WrongState",
      );
    });

    it("lets only the payee pull settled proceeds once", async function () {
      const { billId } = await openTwoPersonBill();
      await tapTab.connect(sponsor).fundParticipant(billId, alice.address, { value: 20n });
      await tapTab.connect(sponsor).fundParticipant(billId, bob.address, { value: 20n });
      await tapTab.settleBill(billId);

      await expect(tapTab.connect(outsider).withdrawProceeds(billId))
        .to.be.revertedWithCustomError(tapTab, "NotPayee");
      await expect(tapTab.connect(payee).withdrawProceeds(billId))
        .to.emit(tapTab, "ProceedsWithdrawn")
        .withArgs(billId, payee.address, 40n);
      expect(await tapTab.proceedsAvailable(billId)).to.equal(0n);
      expect(await ethers.provider.getBalance(await tapTab.getAddress())).to.equal(0n);
      await expect(tapTab.connect(payee).withdrawProceeds(billId))
        .to.be.revertedWithCustomError(tapTab, "NoProceedsAvailable");
    });
  });

  describe("cancellation, expiry, and refunds", function () {
    async function partiallyFundedBill(duration = 3600) {
      const created = await createBill({ duration, itemAmounts: [30n], shares: [1] });
      await join(created.billId, alice, true, 0);
      await approveAndOpen(created.billId);
      await tapTab
        .connect(sponsor)
        .fundParticipant(created.billId, alice.address, { value: 12n });
      return created;
    }

    it("allows only the creator to cancel before settlement and refunds contributors", async function () {
      const { billId } = await partiallyFundedBill();
      await expect(tapTab.connect(outsider).cancelBill(billId))
        .to.be.revertedWithCustomError(tapTab, "NotCreator");
      await expect(tapTab.connect(creator).cancelBill(billId))
        .to.emit(tapTab, "BillCancelled")
        .withArgs(billId, creator.address);

      expect(await tapTab.claimableRefund(billId, sponsor.address)).to.equal(12n);
      await expect(tapTab.connect(sponsor).claimRefund(billId))
        .to.emit(tapTab, "RefundClaimed")
        .withArgs(billId, sponsor.address, 12n);
      expect(await tapTab.claimableRefund(billId, sponsor.address)).to.equal(0n);
      await expect(tapTab.connect(sponsor).claimRefund(billId))
        .to.be.revertedWithCustomError(tapTab, "NoRefundAvailable");
    });

    it("permits anyone to expire after the deadline and preserves full refunds", async function () {
      const { billId, deadline } = await partiallyFundedBill(100);
      await expect(tapTab.connect(outsider).expireBill(billId))
        .to.be.revertedWithCustomError(tapTab, "DeadlineNotReached");
      await moveTo(deadline);
      await expect(
        tapTab.connect(sponsor).fundParticipant(billId, alice.address, { value: 1n }),
      ).to.be.revertedWithCustomError(tapTab, "DraftClosed");
      await expect(tapTab.connect(outsider).expireBill(billId))
        .to.emit(tapTab, "BillExpired")
        .withArgs(billId, outsider.address);

      expect((await tapTab.getBill(billId)).state).to.equal(State.Expired);
      expect(await tapTab.claimableRefund(billId, sponsor.address)).to.equal(12n);
      await tapTab.connect(sponsor).claimRefund(billId);
      expect(await ethers.provider.getBalance(await tapTab.getAddress())).to.equal(0n);
    });

    it("gives a fully funded bill settlement precedence at the exact deadline", async function () {
      const { billId, deadline } = await createBill({
        duration: 100,
        itemAmounts: [30n],
        shares: [1],
      });
      await join(billId, alice, true, 0);
      await approveAndOpen(billId);
      await tapTab.connect(sponsor).fundParticipant(billId, alice.address, { value: 30n });
      await moveTo(deadline);

      await expect(tapTab.connect(outsider).expireBill(billId))
        .to.be.revertedWithCustomError(tapTab, "BillAlreadyFullyFunded");
      await expect(tapTab.connect(creator).cancelBill(billId))
        .to.be.revertedWithCustomError(tapTab, "BillAlreadyFullyFunded");
      await expect(tapTab.connect(outsider).settleBill(billId))
        .to.emit(tapTab, "BillSettled")
        .withArgs(billId, 30n);
      expect((await tapTab.getBill(billId)).state).to.equal(State.Settled);
    });

    it("expires an incomplete bill at the exact deadline instead of settling it", async function () {
      const { billId, deadline } = await partiallyFundedBill(100);
      await moveTo(deadline);

      await expect(tapTab.connect(outsider).settleBill(billId))
        .to.be.revertedWithCustomError(tapTab, "BillNotFullyFunded")
        .withArgs(12n, 30n);
      await tapTab.connect(outsider).expireBill(billId);
      expect((await tapTab.getBill(billId)).state).to.equal(State.Expired);
      expect(await tapTab.claimableRefund(billId, sponsor.address)).to.equal(12n);
    });

    it("does not expose refunds before cancellation or after successful settlement", async function () {
      const { billId } = await partiallyFundedBill();
      await expect(tapTab.connect(sponsor).claimRefund(billId))
        .to.be.revertedWithCustomError(tapTab, "NoRefundAvailable");

      await tapTab.connect(sponsor).fundParticipant(billId, alice.address, { value: 18n });
      await tapTab.settleBill(billId);
      expect(await tapTab.claimableRefund(billId, sponsor.address)).to.equal(0n);
      await expect(tapTab.connect(creator).cancelBill(billId))
        .to.be.revertedWithCustomError(tapTab, "WrongState");
    });
  });
});

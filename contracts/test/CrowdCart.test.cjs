const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrowdCart", function () {
  const METADATA_URI = "ipfs://crowdcart/demo-product.json";
  const MAX_PRICE = ethers.parseEther("10");
  const MID_PRICE = ethers.parseEther("8");
  const LOW_PRICE = ethers.parseEther("6");
  const THRESHOLDS = [1, 2, 4];
  const PRICES = [MAX_PRICE, MID_PRICE, LOW_PRICE];

  const State = {
    None: 0n,
    Active: 1n,
    Successful: 2n,
    Cancelled: 3n,
    Failed: 4n,
  };

  let crowdCart;
  let merchant;
  let buyer1;
  let buyer2;
  let buyer3;
  let buyer4;
  let outsider;

  beforeEach(async function () {
    [merchant, buyer1, buyer2, buyer3, buyer4, outsider] =
      await ethers.getSigners();
    const CrowdCart = await ethers.getContractFactory("CrowdCart");
    crowdCart = await CrowdCart.deploy();
    await crowdCart.waitForDeployment();
  });

  async function latestTimestamp() {
    return (await ethers.provider.getBlock("latest")).timestamp;
  }

  async function moveTo(timestamp) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
    await ethers.provider.send("evm_mine", []);
  }

  async function createDeal({
    creator = merchant,
    duration = 3600,
    minBuyers = 1,
    maxBuyers = 4,
    thresholds = THRESHOLDS,
    prices = PRICES,
    metadataURI = METADATA_URI,
  } = {}) {
    const endsAt = (await latestTimestamp()) + duration;
    const transaction = await crowdCart
      .connect(creator)
      .createDeal(
        metadataURI,
        endsAt,
        minBuyers,
        maxBuyers,
        thresholds,
        prices,
      );
    await transaction.wait();
    const dealId = await crowdCart.dealCount();
    return { dealId, endsAt };
  }

  async function join(dealId, buyer) {
    return crowdCart.connect(buyer).joinDeal(dealId, { value: MAX_PRICE });
  }

  describe("creation and reads", function () {
    it("stores a complete deal and emits its indexable creation event", async function () {
      const endsAt = (await latestTimestamp()) + 3600;

      await expect(
        crowdCart.createDeal(
          METADATA_URI,
          endsAt,
          1,
          4,
          THRESHOLDS,
          PRICES,
        ),
      )
        .to.emit(crowdCart, "DealCreated")
        .withArgs(
          1n,
          merchant.address,
          BigInt(endsAt),
          1n,
          4n,
          MAX_PRICE,
          METADATA_URI,
        );

      const deal = await crowdCart.getDeal(1);
      expect(deal.id).to.equal(1n);
      expect(deal.merchant).to.equal(merchant.address);
      expect(deal.metadataURI).to.equal(METADATA_URI);
      expect(deal.endsAt).to.equal(endsAt);
      expect(deal.minBuyers).to.equal(1n);
      expect(deal.maxBuyers).to.equal(4n);
      expect(deal.buyerCount).to.equal(0n);
      expect(deal.maxPrice).to.equal(MAX_PRICE);
      expect(deal.currentPrice).to.equal(MAX_PRICE);
      expect(deal.clearingPrice).to.equal(0n);
      expect(deal.state).to.equal(State.Active);
      expect(deal.canFinalise).to.equal(false);
      expect(deal.proceedsWithdrawn).to.equal(false);

      const [thresholds, prices] = await crowdCart.getTiers(1);
      expect(thresholds).to.deep.equal([1n, 2n, 4n]);
      expect(prices).to.deep.equal(PRICES);

      const preview = await crowdCart.previewFinalisation(1);
      expect(preview.canFinaliseNow).to.equal(false);
      expect(preview.wouldSucceed).to.equal(false);
      expect(preview.projectedClearingPrice).to.equal(0n);
      expect(preview.projectedMerchantProceeds).to.equal(0n);
    });

    it("rejects invalid deadlines, buyer limits and tier configurations", async function () {
      const now = await latestTimestamp();

      await expect(
        crowdCart.createDeal(METADATA_URI, now, 1, 4, THRESHOLDS, PRICES),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidDeadline");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 0, 4, THRESHOLDS, PRICES),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidBuyerLimits");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 5, 4, THRESHOLDS, PRICES),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidBuyerLimits");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 1, 4, [], []),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidTierCount");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 1, 4, [1, 2], PRICES),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidTierCount");

      await expect(
        crowdCart.createDeal(
          METADATA_URI,
          now + 100,
          1,
          20,
          Array.from({ length: 17 }, (_, index) => index + 1),
          Array.from({ length: 17 }, (_, index) => MAX_PRICE - BigInt(index)),
        ),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidTierCount");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 1, 4, [2, 3], [MAX_PRICE, MID_PRICE]),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidTierThresholds");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 1, 4, [1, 1], [MAX_PRICE, MID_PRICE]),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidTierThresholds");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 1, 4, [1, 5], [MAX_PRICE, MID_PRICE]),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidTierThresholds");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 1, 4, [1], [0]),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidTierPrices");

      await expect(
        crowdCart.createDeal(METADATA_URI, now + 100, 1, 4, [1, 2], [MAX_PRICE, MAX_PRICE]),
      ).to.be.revertedWithCustomError(crowdCart, "InvalidTierPrices");

      await expect(crowdCart.getDeal(999)).to.be.revertedWithCustomError(
        crowdCart,
        "DealNotFound",
      );
    });
  });

  describe("joining and live pricing", function () {
    it("accepts exact deposits once and drops the displayed price at each tier", async function () {
      const { dealId } = await createDeal();

      await expect(join(dealId, buyer1))
        .to.emit(crowdCart, "DealJoined")
        .withArgs(dealId, buyer1.address, 1n, MAX_PRICE);
      expect(await crowdCart.currentPrice(dealId)).to.equal(MAX_PRICE);

      await expect(join(dealId, buyer2))
        .to.emit(crowdCart, "DealJoined")
        .withArgs(dealId, buyer2.address, 2n, MID_PRICE);
      expect(await crowdCart.currentPrice(dealId)).to.equal(MID_PRICE);

      await join(dealId, buyer3);
      expect(await crowdCart.currentPrice(dealId)).to.equal(MID_PRICE);

      await expect(join(dealId, buyer4))
        .to.emit(crowdCart, "DealJoined")
        .withArgs(dealId, buyer4.address, 4n, LOW_PRICE);
      expect(await crowdCart.currentPrice(dealId)).to.equal(LOW_PRICE);

      const deal = await crowdCart.getDeal(dealId);
      expect(deal.buyerCount).to.equal(4n);
      expect(deal.canFinalise).to.equal(true);

      const preview = await crowdCart.previewFinalisation(dealId);
      expect(preview.canFinaliseNow).to.equal(true);
      expect(preview.wouldSucceed).to.equal(true);
      expect(preview.projectedClearingPrice).to.equal(LOW_PRICE);
      expect(preview.projectedMerchantProceeds).to.equal(LOW_PRICE * 4n);
    });

    it("rejects merchant joins, incorrect deposits, duplicates and excess buyers", async function () {
      const { dealId } = await createDeal({
        maxBuyers: 2,
        thresholds: [1, 2],
        prices: [MAX_PRICE, MID_PRICE],
      });

      await expect(
        crowdCart.connect(merchant).joinDeal(dealId, { value: MAX_PRICE }),
      ).to.be.revertedWithCustomError(crowdCart, "MerchantCannotJoin");

      await expect(
        crowdCart.connect(buyer1).joinDeal(dealId, { value: MAX_PRICE - 1n }),
      )
        .to.be.revertedWithCustomError(crowdCart, "IncorrectDeposit")
        .withArgs(MAX_PRICE, MAX_PRICE - 1n);

      await join(dealId, buyer1);
      await expect(join(dealId, buyer1)).to.be.revertedWithCustomError(
        crowdCart,
        "DealAlreadyJoined",
      );

      await join(dealId, buyer2);
      await expect(join(dealId, buyer3)).to.be.revertedWithCustomError(
        crowdCart,
        "DealSoldOut",
      );
    });

    it("closes joining at the deadline", async function () {
      const { dealId, endsAt } = await createDeal({ duration: 100 });
      await moveTo(endsAt);

      await expect(join(dealId, buyer1)).to.be.revertedWithCustomError(
        crowdCart,
        "DealNotActive",
      );
    });
  });

  describe("successful settlement", function () {
    it("settles sold-out deals early at one common price", async function () {
      const { dealId } = await createDeal();
      for (const buyer of [buyer1, buyer2, buyer3, buyer4]) {
        await join(dealId, buyer);
      }

      await expect(crowdCart.connect(outsider).finaliseDeal(dealId))
        .to.emit(crowdCart, "DealFinalised")
        .withArgs(dealId, true, 4n, LOW_PRICE, LOW_PRICE * 4n);

      const deal = await crowdCart.getDeal(dealId);
      expect(deal.state).to.equal(State.Successful);
      expect(deal.clearingPrice).to.equal(LOW_PRICE);
      expect(deal.currentPrice).to.equal(LOW_PRICE);
      expect(deal.canFinalise).to.equal(false);

      for (const buyer of [buyer1, buyer2, buyer3, buyer4]) {
        expect(await crowdCart.claimableRefund(dealId, buyer.address)).to.equal(
          MAX_PRICE - LOW_PRICE,
        );
      }
      expect(await crowdCart.merchantProceedsAvailable(dealId)).to.equal(
        LOW_PRICE * 4n,
      );
    });

    it("prevents early finalisation while a deal remains open", async function () {
      const { dealId } = await createDeal();
      await join(dealId, buyer1);

      await expect(crowdCart.finaliseDeal(dealId)).to.be.revertedWithCustomError(
        crowdCart,
        "DealStillOpen",
      );
    });

    it("lets buyers and the merchant pull exactly their reserved funds", async function () {
      const { dealId } = await createDeal();
      for (const buyer of [buyer1, buyer2, buyer3, buyer4]) {
        await join(dealId, buyer);
      }
      await crowdCart.finaliseDeal(dealId);

      const address = await crowdCart.getAddress();
      expect(await ethers.provider.getBalance(address)).to.equal(MAX_PRICE * 4n);

      await expect(crowdCart.connect(merchant).withdrawProceeds(dealId))
        .to.emit(crowdCart, "ProceedsWithdrawn")
        .withArgs(dealId, merchant.address, LOW_PRICE * 4n);
      expect(await ethers.provider.getBalance(address)).to.equal(
        (MAX_PRICE - LOW_PRICE) * 4n,
      );
      expect(await crowdCart.merchantProceedsAvailable(dealId)).to.equal(0n);

      await expect(crowdCart.connect(merchant).withdrawProceeds(dealId))
        .to.be.revertedWithCustomError(crowdCart, "NoProceedsAvailable");

      for (const buyer of [buyer1, buyer2, buyer3, buyer4]) {
        await expect(crowdCart.connect(buyer).claimRefund(dealId))
          .to.emit(crowdCart, "RefundClaimed")
          .withArgs(dealId, buyer.address, MAX_PRICE - LOW_PRICE);
      }
      expect(await ethers.provider.getBalance(address)).to.equal(0n);

      await expect(crowdCart.connect(buyer1).claimRefund(dealId))
        .to.be.revertedWithCustomError(crowdCart, "RefundAlreadyClaimed");
    });

    it("allows only the merchant to withdraw proceeds", async function () {
      const { dealId, endsAt } = await createDeal();
      await join(dealId, buyer1);
      await moveTo(endsAt);
      await crowdCart.finaliseDeal(dealId);

      await expect(crowdCart.connect(outsider).withdrawProceeds(dealId))
        .to.be.revertedWithCustomError(crowdCart, "NotMerchant");
    });

    it("has no refund when the final price remains at the maximum", async function () {
      const { dealId, endsAt } = await createDeal();
      await join(dealId, buyer1);
      await moveTo(endsAt);
      await crowdCart.finaliseDeal(dealId);

      expect(await crowdCart.claimableRefund(dealId, buyer1.address)).to.equal(0n);
      await expect(crowdCart.connect(buyer1).claimRefund(dealId))
        .to.be.revertedWithCustomError(crowdCart, "NoRefundAvailable");
    });
  });

  describe("failure and cancellation safety", function () {
    it("fails below the minimum and makes every full deposit refundable", async function () {
      const { dealId, endsAt } = await createDeal({
        minBuyers: 3,
        maxBuyers: 5,
      });
      await join(dealId, buyer1);
      await join(dealId, buyer2);
      await moveTo(endsAt);

      await expect(crowdCart.connect(buyer1).finaliseDeal(dealId))
        .to.emit(crowdCart, "DealFinalised")
        .withArgs(dealId, false, 2n, 0n, 0n);

      expect((await crowdCart.getDeal(dealId)).state).to.equal(State.Failed);
      expect(await crowdCart.claimableRefund(dealId, buyer1.address)).to.equal(
        MAX_PRICE,
      );
      expect(await crowdCart.claimableRefund(dealId, buyer2.address)).to.equal(
        MAX_PRICE,
      );
      await expect(crowdCart.connect(merchant).withdrawProceeds(dealId))
        .to.be.revertedWithCustomError(crowdCart, "NoProceedsAvailable");

      await crowdCart.connect(buyer1).claimRefund(dealId);
      await crowdCart.connect(buyer2).claimRefund(dealId);
      expect(
        await ethers.provider.getBalance(await crowdCart.getAddress()),
      ).to.equal(0n);
    });

    it("lets the merchant cancel, but never confiscate buyer deposits", async function () {
      const { dealId } = await createDeal();
      await join(dealId, buyer1);

      await expect(crowdCart.connect(outsider).cancelDeal(dealId))
        .to.be.revertedWithCustomError(crowdCart, "NotMerchant");
      await expect(crowdCart.connect(merchant).cancelDeal(dealId))
        .to.emit(crowdCart, "DealCancelled")
        .withArgs(dealId, merchant.address);

      expect((await crowdCart.getDeal(dealId)).state).to.equal(State.Cancelled);
      expect(await crowdCart.claimableRefund(dealId, buyer1.address)).to.equal(
        MAX_PRICE,
      );
      await expect(join(dealId, buyer2)).to.be.revertedWithCustomError(
        crowdCart,
        "DealNotActive",
      );
      await expect(crowdCart.finaliseDeal(dealId)).to.be.revertedWithCustomError(
        crowdCart,
        "DealNotActive",
      );

      await crowdCart.connect(buyer1).claimRefund(dealId);
      expect(
        await ethers.provider.getBalance(await crowdCart.getAddress()),
      ).to.equal(0n);
    });

    it("does not require the merchant to finalise an expired deal", async function () {
      const { dealId, endsAt } = await createDeal();
      await join(dealId, buyer1);
      await moveTo(endsAt);

      await crowdCart.connect(outsider).finaliseDeal(dealId);
      expect((await crowdCart.getDeal(dealId)).state).to.equal(State.Successful);
    });

    it("does not expose refunds before settlement or to non-participants", async function () {
      const { dealId } = await createDeal();
      await join(dealId, buyer1);

      await expect(crowdCart.connect(buyer1).claimRefund(dealId))
        .to.be.revertedWithCustomError(crowdCart, "DealNotSettled");

      await crowdCart.connect(merchant).cancelDeal(dealId);
      await expect(crowdCart.connect(outsider).claimRefund(dealId))
        .to.be.revertedWithCustomError(crowdCart, "NotParticipant");
    });
  });

  describe("adversarial payment recipients", function () {
    it("preserves a failed refund and blocks a reentrant second claim", async function () {
      const { dealId } = await createDeal();
      const Receiver = await ethers.getContractFactory("RefundReceiver");
      const receiver = await Receiver.deploy(await crowdCart.getAddress());
      await receiver.waitForDeployment();

      await receiver.join(dealId, { value: MAX_PRICE });
      await crowdCart.connect(merchant).cancelDeal(dealId);

      await receiver.configure(true, false);
      await expect(receiver.claim()).to.be.revertedWithCustomError(
        crowdCart,
        "TransferFailed",
      );

      let buyer = await crowdCart.getBuyer(dealId, await receiver.getAddress());
      expect(buyer.refundClaimed).to.equal(false);
      expect(buyer.refundAvailable).to.equal(MAX_PRICE);

      await receiver.configure(false, true);
      await expect(receiver.claim())
        .to.emit(crowdCart, "RefundClaimed")
        .withArgs(dealId, await receiver.getAddress(), MAX_PRICE);
      expect(await receiver.reentrancyWasBlocked()).to.equal(true);

      buyer = await crowdCart.getBuyer(dealId, await receiver.getAddress());
      expect(buyer.refundClaimed).to.equal(true);
      expect(buyer.refundAvailable).to.equal(0n);
    });

    it("preserves failed merchant proceeds so withdrawal can be retried", async function () {
      const Receiver = await ethers.getContractFactory("RefundReceiver");
      const receiver = await Receiver.deploy(await crowdCart.getAddress());
      await receiver.waitForDeployment();

      const endsAt = (await latestTimestamp()) + 3600;
      await receiver.create(
        METADATA_URI,
        endsAt,
        1,
        1,
        [1],
        [MAX_PRICE],
      );
      const dealId = await crowdCart.dealCount();
      await join(dealId, buyer1);
      await crowdCart.finaliseDeal(dealId);

      await receiver.configure(true, false);
      await expect(receiver.withdraw()).to.be.revertedWithCustomError(
        crowdCart,
        "TransferFailed",
      );
      expect((await crowdCart.getDeal(dealId)).proceedsWithdrawn).to.equal(false);
      expect(await crowdCart.merchantProceedsAvailable(dealId)).to.equal(MAX_PRICE);

      await receiver.configure(false, true);
      await expect(receiver.withdraw())
        .to.emit(crowdCart, "ProceedsWithdrawn")
        .withArgs(dealId, await receiver.getAddress(), MAX_PRICE);
      expect(await receiver.reentrancyWasBlocked()).to.equal(true);
      expect(await crowdCart.merchantProceedsAvailable(dealId)).to.equal(0n);
    });
  });
});

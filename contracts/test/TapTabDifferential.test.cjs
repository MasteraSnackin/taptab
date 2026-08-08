const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { expect } = require("chai");
const { ethers } = require("hardhat");

const GENERATED_FIXTURES_PER_SEED = 8;

function importedModule(relativePath) {
  return import(pathToFileURL(path.resolve(__dirname, relativePath)).href);
}

function expectedOwnerIds(input, item) {
  const owners = Array(item.shareSlots).fill(null);
  for (const claim of input.claims) {
    if (claim.itemId !== item.id) continue;
    for (const shareIndex of claim.shareIndexes) owners[shareIndex] = claim.participantId;
  }
  return owners;
}

function fundingStatus(funded, totalDue) {
  if (funded === 0n) return "unfunded";
  if (funded === totalDue) return "fully_funded";
  return "partially_funded";
}

describe("TapTab TypeScript/Solidity differential properties", function () {
  this.timeout(60_000);

  let calculateTapTabPreview;
  let curatedFixtures;
  let differentialSeeds;
  let generateTapTabFixture;

  before(async function () {
    ({ calculateTapTabPreview } = await importedModule("../../app/taptab-model.ts"));
    ({
      CURATED_DIFFERENTIAL_FIXTURES: curatedFixtures,
      DIFFERENTIAL_PROPERTY_SEEDS: differentialSeeds,
      generateTapTabFixture,
    } = await importedModule("../../tests/support/taptab-property-fixtures.mjs"));
  });

  it("matches 8 curated and 32 seeded allocations through funding", async function () {
    const [creator, payee, ...availableSigners] = await ethers.getSigners();
    const participantSigners = availableSigners.slice(0, 5);
    const externalSponsor = availableSigners[5];
    const TapTab = await ethers.getContractFactory("TapTab");
    const tapTab = await TapTab.deploy();
    await tapTab.waitForDeployment();

    const fixtures = [
      ...curatedFixtures.map((fixture) => ({
        context: `curated fixture ${fixture.id}`,
        input: fixture.input,
      })),
      ...differentialSeeds.flatMap((seed) =>
        Array.from({ length: GENERATED_FIXTURES_PER_SEED }, (_, fixtureIndex) => ({
          context: `seed 0x${seed.toString(16).padStart(8, "0")}, fixture ${fixtureIndex}`,
          input: generateTapTabFixture(seed, fixtureIndex),
        })),
      ),
    ];

    for (const { context, input } of fixtures) {
      try {
        const preview = calculateTapTabPreview(input);
        const signerByParticipantId = new Map(
          input.participants.map((participant, index) => [
            participant.id,
            participantSigners[index],
          ]),
        );
        const payerById = new Map(signerByParticipantId);
        const claimedByParticipantId = new Map(
          input.participants.map(({ id }) => [id, 0n]),
        );
        for (const { payerId } of input.payments) {
          if (!payerById.has(payerId)) payerById.set(payerId, externalSponsor);
        }

        const latest = await ethers.provider.getBlock("latest");
        const deadline = latest.timestamp + 86_400;
        await tapTab.connect(creator).createBill(
          payee.address,
          `data:application/json,${encodeURIComponent(JSON.stringify({ context }))}`,
          deadline,
          input.items.map(({ pricePence }) => BigInt(pricePence)),
          input.items.map(({ shareSlots }) => shareSlots),
        );
        const billId = await tapTab.billCount();

        await tapTab
          .connect(creator)
          .inviteMany(
            billId,
            input.participants.map(({ id }) => signerByParticipantId.get(id).address),
          );
        for (const participant of input.participants) {
          await tapTab
            .connect(signerByParticipantId.get(participant.id))
            .joinBill(billId, participant.remainderOptIn, participant.tipVoteBps);
        }

        for (const participant of input.participants) {
          const itemIndexes = [];
          const shareIndexes = [];
          for (const claim of input.claims) {
            if (claim.participantId !== participant.id) continue;
            const itemIndex = input.items.findIndex(({ id }) => id === claim.itemId);
            for (const shareIndex of claim.shareIndexes) {
              itemIndexes.push(itemIndex);
              shareIndexes.push(shareIndex);
            }
          }
          if (itemIndexes.length > 0) {
            await tapTab
              .connect(signerByParticipantId.get(participant.id))
              .claimMany(billId, itemIndexes, shareIndexes);
          }
        }

        for (const [itemIndex, item] of input.items.entries()) {
          const ownerIds = expectedOwnerIds(input, item);
          const expectedOwners = ownerIds.map((participantId) =>
            participantId === null
              ? ethers.ZeroAddress
              : signerByParticipantId.get(participantId).address,
          );
          expect(await tapTab.getItemShareOwners(billId, itemIndex), `${context}: owners for item ${itemIndex}`)
            .to.deep.equal(expectedOwners);

          const equalShare = Math.floor(item.pricePence / item.shareSlots);
          const dust = item.pricePence % item.shareSlots;
          for (let shareIndex = 0; shareIndex < item.shareSlots; shareIndex += 1) {
            const expectedValue = BigInt(equalShare + (shareIndex < dust ? 1 : 0));
            expect(
              await tapTab.itemShareValue(billId, itemIndex, shareIndex),
              `${context}: value for item ${itemIndex}, share ${shareIndex}`,
            ).to.equal(expectedValue);
            const ownerId = ownerIds[shareIndex];
            if (ownerId !== null) {
              claimedByParticipantId.set(
                ownerId,
                claimedByParticipantId.get(ownerId) + expectedValue,
              );
            }
          }
        }

        const storedItems = await tapTab.getItems(billId);
        for (const [itemIndex, item] of input.items.entries()) {
          expect(storedItems[itemIndex].amount, `${context}: item ${itemIndex} amount`).to.equal(
            BigInt(item.pricePence),
          );
          expect(storedItems[itemIndex].shareCount, `${context}: item ${itemIndex} shares`).to.equal(
            BigInt(item.shareSlots),
          );
          expect(
            storedItems[itemIndex].claimedShareCount,
            `${context}: item ${itemIndex} claimed shares`,
          ).to.equal(BigInt(expectedOwnerIds(input, item).filter((owner) => owner !== null).length));
        }

        const digest = await tapTab.currentSplitDigest(billId);
        for (const participant of input.participants) {
          await tapTab
            .connect(signerByParticipantId.get(participant.id))
            .approveSplit(billId, digest);
        }
        await tapTab.connect(creator).openFunding(billId);

        let bill = await tapTab.getBill(billId);
        expect(bill.lockedTipBps, `${context}: locked median tip`).to.equal(
          BigInt(preview.medianTipVoteBps),
        );
        expect(bill.subtotal, `${context}: subtotal`).to.equal(BigInt(preview.subtotalPence));
        expect(bill.totalDue, `${context}: total due`).to.equal(BigInt(preview.totalDuePence));

        for (const expected of preview.participants) {
          const signer = signerByParticipantId.get(expected.participantId);
          const actual = await tapTab.getParticipant(billId, signer.address);
          expect(actual.baseDue, `${context}: ${expected.participantId} base due`).to.equal(
            BigInt(expected.baseDuePence),
          );
          expect(actual.tipDue, `${context}: ${expected.participantId} tip due`).to.equal(
            BigInt(expected.tipPence),
          );
          expect(actual.amountDue, `${context}: ${expected.participantId} amount due`).to.equal(
            BigInt(expected.totalDuePence),
          );
          expect(
            claimedByParticipantId.get(expected.participantId),
            `${context}: ${expected.participantId} claimed value`,
          ).to.equal(BigInt(expected.claimedPence));
          expect(
            actual.baseDue - claimedByParticipantId.get(expected.participantId),
            `${context}: ${expected.participantId} fair remainder`,
          ).to.equal(BigInt(expected.remainderPence));
        }

        for (const payment of input.payments) {
          await tapTab
            .connect(payerById.get(payment.payerId))
            .fundParticipant(
              billId,
              signerByParticipantId.get(payment.beneficiaryId).address,
              { value: BigInt(payment.amountPence) },
            );
        }

        for (const expected of preview.participants) {
          const signer = signerByParticipantId.get(expected.participantId);
          const actual = await tapTab.getParticipant(billId, signer.address);
          expect(actual.amountFunded, `${context}: ${expected.participantId} funded`).to.equal(
            BigInt(expected.creditedPence),
          );
          expect(
            await tapTab.remainingDue(billId, signer.address),
            `${context}: ${expected.participantId} remaining`,
          ).to.equal(BigInt(expected.unpaidPence));
        }

        for (const contributor of preview.contributors) {
          expect(
            await tapTab.contributionOf(billId, payerById.get(contributor.payerId).address),
            `${context}: ${contributor.payerId} contribution`,
          ).to.equal(BigInt(contributor.contributedPence));
        }

        bill = await tapTab.getBill(billId);
        expect(bill.totalFunded, `${context}: total funded`).to.equal(
          BigInt(preview.funding.fundedPence),
        );
        expect(bill.remainingToFund, `${context}: remaining funding`).to.equal(
          BigInt(preview.funding.remainingPence),
        );
        expect(
          fundingStatus(bill.totalFunded, bill.totalDue),
          `${context}: funding status`,
        ).to.equal(preview.funding.status);
        expect(
          bill.totalFunded === bill.totalDue,
          `${context}: settlement eligibility`,
        ).to.equal(preview.funding.canSettle);

        if (preview.funding.canSettle) {
          await tapTab.connect(creator).settleBill(billId);
          expect((await tapTab.getBill(billId)).state, `${context}: settled state`).to.equal(3n);
        }
      } catch (error) {
        throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    }
  });
});

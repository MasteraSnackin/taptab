const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TapTab metadata bounds", function () {
  this.timeout(30_000);

  let creator;
  let payee;
  let tapTab;
  let deadline;

  beforeEach(async function () {
    [creator, payee] = await ethers.getSigners();
    const TapTab = await ethers.getContractFactory("TapTab");
    tapTab = await TapTab.deploy();
    await tapTab.waitForDeployment();
    const latest = await ethers.provider.getBlock("latest");
    deadline = latest.timestamp + 3_600;
  });

  function create(metadataURI, overrides = {}) {
    return tapTab
      .connect(creator)
      .createBill(payee.address, metadataURI, deadline, [1n], [1], overrides);
  }

  it("publishes the client-aligned 64,000-byte limit and accepts ordinary metadata", async function () {
    expect(await tapTab.MAX_METADATA_URI_BYTES()).to.equal(64_000n);

    const metadataURI = `data:application/json,${encodeURIComponent(
      JSON.stringify({ schema: "taptab-gbp-receipt", merchant: "Boundary Cafe" }),
    )}`;
    await expect(create(metadataURI)).to.emit(tapTab, "BillCreated");
    expect((await tapTab.getBill(1n)).metadataURI).to.equal(metadataURI);
  });

  it("accepts exactly 64,000 UTF-8 bytes", async function () {
    const prefix = "data:application/octet-stream,";
    const metadataURI = `${prefix}${"x".repeat(
      64_000 - ethers.toUtf8Bytes(prefix).length,
    )}`;
    expect(ethers.toUtf8Bytes(metadataURI).length).to.equal(64_000);

    await expect(create(metadataURI, { gasLimit: 55_000_000n })).to.emit(
      tapTab,
      "BillCreated",
    );
    const stored = (await tapTab.getBill(1n)).metadataURI;
    expect(ethers.toUtf8Bytes(stored).length).to.equal(64_000);
    expect(stored).to.equal(metadataURI);
  });

  it("rejects 64,001 ASCII bytes before creating any bill", async function () {
    const metadataURI = "x".repeat(64_001);
    expect(ethers.toUtf8Bytes(metadataURI).length).to.equal(64_001);

    await expect(create(metadataURI))
      .to.be.revertedWithCustomError(tapTab, "MetadataURITooLong")
      .withArgs(64_001n, 64_000n);
    expect(await tapTab.billCount()).to.equal(0n);
  });

  it("measures UTF-8 bytes rather than JavaScript character count", async function () {
    const metadataURI = "é".repeat(32_001);
    expect(metadataURI.length).to.equal(32_001);
    expect(ethers.toUtf8Bytes(metadataURI).length).to.equal(64_002);

    await expect(create(metadataURI))
      .to.be.revertedWithCustomError(tapTab, "MetadataURITooLong")
      .withArgs(64_002n, 64_000n);
    expect(await tapTab.billCount()).to.equal(0n);
  });
});

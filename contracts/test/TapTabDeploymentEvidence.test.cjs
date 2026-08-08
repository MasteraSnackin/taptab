const { expect } = require("chai");

const {
  CREATE_BILL_GAS_RESERVE,
  buildDeploymentEvidence,
  conservativeGasCost,
  explorerEvidence,
  feeCapFrom,
  requireConfirmedReceipt,
  withGasBuffer,
} = require("../scripts/deploy-taptab.cjs");

const CONTRACT = "0x1111111111111111111111111111111111111111";
const DEPLOYMENT_HASH = `0x${"22".repeat(32)}`;
const CREATE_BILL_HASH = `0x${"33".repeat(32)}`;

describe("TapTab deployment evidence helpers", function () {
  it("adds a ceiling-rounded 25% gas buffer", function () {
    expect(withGasBuffer(100n)).to.equal(125n);
    expect(withGasBuffer(1n)).to.equal(2n);
    expect(conservativeGasCost(100n, 3n)).to.equal(375n);
    expect(CREATE_BILL_GAS_RESERVE).to.equal(5_000_000n);
  });

  it("fails closed when gas or fee inputs are unavailable", function () {
    expect(() => withGasBuffer(0n)).to.throw("positive bigint");
    expect(() => conservativeGasCost(100n, 0n)).to.throw("positive bigint");
    expect(() => feeCapFrom({})).to.throw("refusing to calculate");
    expect(() => feeCapFrom({ maxFeePerGas: 0n, gasPrice: 7n })).to.throw(
      "refusing to calculate",
    );
  });

  it("prefers the EIP-1559 maximum fee and otherwise uses gasPrice", function () {
    expect(feeCapFrom({ maxFeePerGas: 9n, gasPrice: 7n })).to.equal(9n);
    expect(feeCapFrom({ maxFeePerGas: null, gasPrice: 7n })).to.equal(7n);
  });

  it("builds canonical MonadVision and Monadscan links", function () {
    expect(explorerEvidence(CONTRACT, DEPLOYMENT_HASH, CREATE_BILL_HASH)).to.deep.equal({
      MonadVision: {
        contract: `https://testnet.monadvision.com/address/${CONTRACT}`,
        deploymentTransaction: `https://testnet.monadvision.com/tx/${DEPLOYMENT_HASH}`,
        createBillTransaction: `https://testnet.monadvision.com/tx/${CREATE_BILL_HASH}`,
      },
      Monadscan: {
        contract: `https://testnet.monadscan.com/address/${CONTRACT}`,
        deploymentTransaction: `https://testnet.monadscan.com/tx/${DEPLOYMENT_HASH}`,
        createBillTransaction: `https://testnet.monadscan.com/tx/${CREATE_BILL_HASH}`,
      },
    });
  });

  it("serialises hashes and confirmed blocks into public evidence", function () {
    const evidence = buildDeploymentEvidence({
      contractAddress: CONTRACT,
      billId: 1n,
      deploymentReceipt: {
        hash: DEPLOYMENT_HASH,
        blockNumber: 123n,
      },
      createBillReceipt: {
        hash: CREATE_BILL_HASH,
        blockNumber: 124,
      },
    });

    expect(evidence).to.include({
      schema: "taptab-testnet-deployment-evidence",
      version: 1,
      contractAddress: CONTRACT,
      billId: "1",
    });
    expect(evidence.chain).to.deep.equal({ name: "Monad Testnet", chainId: "10143" });
    expect(evidence.transactions).to.deep.equal({
      contractDeployment: { hash: DEPLOYMENT_HASH, blockNumber: "123" },
      createBill: { hash: CREATE_BILL_HASH, blockNumber: "124" },
    });
  });

  it("requires successful receipts before evidence is emitted", function () {
    const receipt = { status: 1, hash: DEPLOYMENT_HASH };
    expect(requireConfirmedReceipt(receipt, "deployment")).to.equal(receipt);
    expect(() => requireConfirmedReceipt(undefined, "deployment")).to.throw(
      "deployment did not return a successful confirmed receipt",
    );
    expect(() => requireConfirmedReceipt({ status: 0 }, "createBill")).to.throw(
      "createBill did not return a successful confirmed receipt",
    );
  });
});

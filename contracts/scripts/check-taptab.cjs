const hre = require("hardhat");

const MONAD_TESTNET_CHAIN_ID = 10_143n;

function configuredBill() {
  const address = (
    process.env.TAPTAB_CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_TAPTAB_ADDRESS ||
    ""
  ).trim();
  const rawBillId = (
    process.env.TAPTAB_BILL_ID ||
    process.env.NEXT_PUBLIC_TAPTAB_BILL_ID ||
    ""
  ).trim();

  if (!address && !rawBillId) return undefined;
  if (!address || !rawBillId) {
    throw new Error(
      "Set both TAPTAB_CONTRACT_ADDRESS and TAPTAB_BILL_ID to validate a deployment.",
    );
  }
  if (!hre.ethers.isAddress(address) || address === hre.ethers.ZeroAddress) {
    throw new Error("TAPTAB_CONTRACT_ADDRESS must be a non-zero EVM address.");
  }
  if (!/^[1-9][0-9]*$/.test(rawBillId)) {
    throw new Error("TAPTAB_BILL_ID must be a positive decimal integer.");
  }
  return {
    address: hre.ethers.getAddress(address),
    billId: BigInt(rawBillId),
  };
}

async function main() {
  const startedAt = Date.now();
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== MONAD_TESTNET_CHAIN_ID) {
    throw new Error(
      `Expected Monad Testnet chain ID 10143, received ${network.chainId}.`,
    );
  }

  const latestBlock = await hre.ethers.provider.getBlock("latest");
  if (!latestBlock) throw new Error("Monad Testnet did not return its latest block.");

  console.log("Monad Testnet RPC is reachable.");
  console.log("Chain ID:", network.chainId.toString());
  console.log("Latest block:", latestBlock.number.toString());
  console.log("RPC check:", `${Date.now() - startedAt} ms`);

  const configured = configuredBill();
  if (!configured) {
    console.log(
      "TapTab deployment check skipped: set TAPTAB_CONTRACT_ADDRESS and TAPTAB_BILL_ID after deployment.",
    );
    return;
  }

  const code = await hre.ethers.provider.getCode(configured.address);
  if (code === "0x") {
    throw new Error(`No contract code exists at ${configured.address} on Monad Testnet.`);
  }

  const tapTab = await hre.ethers.getContractAt("TapTab", configured.address);
  const [billCount, bill] = await Promise.all([
    tapTab.billCount(),
    tapTab.getBill(configured.billId),
  ]);
  if (configured.billId > billCount || bill.id !== configured.billId) {
    throw new Error(`Bill ${configured.billId} does not exist in the configured TapTab contract.`);
  }
  if (bill.creator === hre.ethers.ZeroAddress || bill.payee === hre.ethers.ZeroAddress) {
    throw new Error("The configured bill returned invalid creator or payee state.");
  }
  if (bill.subtotal <= 0n || bill.deadline <= bill.createdAt) {
    throw new Error("The configured bill returned invalid monetary or deadline state.");
  }

  console.log("TapTab contract:", configured.address);
  console.log("Bill ID:", configured.billId.toString());
  console.log("Bill subtotal:", `${hre.ethers.formatEther(bill.subtotal)} MON`);
  console.log(
    "Explorer:",
    `https://testnet.monadvision.com/address/${configured.address}`,
  );
  console.log("Live deployment validation passed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown validation failure.";
  console.error(`TapTab Monad Testnet check failed: ${message}`);
  process.exitCode = 1;
});

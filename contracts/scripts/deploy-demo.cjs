const hre = require("hardhat");

async function main() {
  const duration = Number(process.env.DEMO_DURATION_SECONDS || "180");
  if (!Number.isInteger(duration) || duration < 90 || duration > 86_400) {
    throw new Error("DEMO_DURATION_SECONDS must be a whole number from 90 to 86400.");
  }

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error(
      `Deployment wallet ${deployer.address} has no Testnet MON. Fund it at https://faucet.monad.xyz first.`,
    );
  }

  const CrowdCart = await hre.ethers.getContractFactory("CrowdCart");
  const crowdCart = await CrowdCart.deploy();
  await crowdCart.waitForDeployment();

  const contractAddress = await crowdCart.getAddress();
  const latestBlock = await hre.ethers.provider.getBlock("latest");
  const endsAt = latestBlock.timestamp + duration;
  const metadata = encodeURIComponent(
    JSON.stringify({
      name: "The London Pizza Drop",
      pickup: "Encode Hub · Today",
      image: "crowdcart://pizza-drop",
    }),
  );

  const createTransaction = await crowdCart.createDeal(
    `data:application/json,${metadata}`,
    endsAt,
    2,
    7,
    [1, 2, 4, 7],
    ["0.010", "0.008", "0.006", "0.004"].map(hre.ethers.parseEther),
  );
  await createTransaction.wait();

  console.log("CrowdCart demo is live on Monad Testnet");
  console.log("Deployer:", deployer.address);
  console.log("Contract:", contractAddress);
  console.log("Deal ID: 1");
  console.log("Audience URL parameters:", `?contract=${contractAddress}&deal=1`);
  console.log("Deal duration:", `${duration} seconds`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const CrowdCart = await hre.ethers.getContractFactory("CrowdCart");
  const crowdCart = await CrowdCart.deploy();

  await crowdCart.waitForDeployment();

  console.log("Deployer:", deployer.address);
  console.log("CrowdCart:", await crowdCart.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

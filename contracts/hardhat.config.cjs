require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");

const networks = {
  hardhat: {
    chainId: 31_337,
    // Hardhat 2.29 defaults to Osaka's 16,777,216 per-transaction gas cap.
    // Pinning this ephemeral local network to Cancun is the smallest adjustment
    // that lets the accepted 64,000-byte metadata boundary be regression-tested.
    // It does not establish that the same transaction is viable publicly.
    hardfork: "cancun",
  },
  monadTestnet: {
    url:
      process.env.MONAD_TESTNET_RPC_URL ||
      "https://testnet-rpc.monad.xyz",
    chainId: 10143,
    accounts: process.env.DEPLOYER_PRIVATE_KEY
      ? [process.env.DEPLOYER_PRIVATE_KEY]
      : [],
  },
};

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
      metadata: {
        bytecodeHash: "ipfs",
      },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks,
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://monadvision.com",
  },
  etherscan: {
    enabled: true,
    // hardhat-verify 2.1.x uses a single API key for Etherscan API V2. Keeping
    // the chain ID in customChains lets the plugin append it consistently to
    // submission, pre-check and polling requests.
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "monadTestnet",
        chainId: 10143,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://testnet.monadscan.com",
        },
      },
    ],
  },
};

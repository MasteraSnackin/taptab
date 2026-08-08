const hre = require("hardhat");
const {
  numberQuoteToDecimal,
  parseDuration,
  parseGbpPerMon,
  table7Config,
} = require("./taptab-demo-config.cjs");

const MONAD_TESTNET_CHAIN_ID = 10_143n;
const GAS_BUFFER_BPS = 2_500n;
const BPS_DENOMINATOR = 10_000n;
// The local maximum-shape benchmark caps ordinary-metadata createBill calls at
// five million gas. Reserving that full ceiling before contract deployment is
// deliberately conservative for the much smaller fixed Table 7 seed.
const CREATE_BILL_GAS_RESERVE = 5_000_000n;
const TESTNET_EXPLORERS = Object.freeze([
  Object.freeze({ name: "MonadVision", origin: "https://testnet.monadvision.com" }),
  Object.freeze({ name: "Monadscan", origin: "https://testnet.monadscan.com" }),
]);
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=gbp&include_last_updated_at=true";

function withGasBuffer(gasUnits) {
  if (typeof gasUnits !== "bigint" || gasUnits <= 0n) {
    throw new Error("Gas estimates must be positive bigint values.");
  }
  return (
    (gasUnits * (BPS_DENOMINATOR + GAS_BUFFER_BPS) + BPS_DENOMINATOR - 1n) /
    BPS_DENOMINATOR
  );
}

function feeCapFrom(feeData) {
  const feeCap = feeData?.maxFeePerGas ?? feeData?.gasPrice;
  if (typeof feeCap !== "bigint" || feeCap <= 0n) {
    throw new Error(
      "Monad Testnet did not return a positive fee cap; refusing to calculate deployment affordability.",
    );
  }
  return feeCap;
}

function conservativeGasCost(gasUnits, feeCap) {
  if (typeof feeCap !== "bigint" || feeCap <= 0n) {
    throw new Error("Fee caps must be positive bigint values.");
  }
  return withGasBuffer(gasUnits) * feeCap;
}

function assertSufficientBalance({ balance, required, address, stage }) {
  if (balance >= required) return;
  throw new Error(
    `Deployment wallet ${address} has insufficient Testnet MON for ${stage}. ` +
      `Available ${hre.ethers.formatEther(balance)} MON; conservative minimum ` +
      `${hre.ethers.formatEther(required)} MON. Fund it at https://faucet.monad.xyz first.`,
  );
}

function explorerEvidence(contractAddress, deploymentHash, createBillHash) {
  return Object.fromEntries(
    TESTNET_EXPLORERS.map(({ name, origin }) => [
      name,
      {
        contract: `${origin}/address/${contractAddress}`,
        deploymentTransaction: `${origin}/tx/${deploymentHash}`,
        createBillTransaction: `${origin}/tx/${createBillHash}`,
      },
    ]),
  );
}

function buildDeploymentEvidence({
  contractAddress,
  billId,
  deploymentReceipt,
  createBillReceipt,
}) {
  return {
    schema: "taptab-testnet-deployment-evidence",
    version: 1,
    chain: { name: "Monad Testnet", chainId: MONAD_TESTNET_CHAIN_ID.toString() },
    contractAddress,
    billId: billId.toString(),
    transactions: {
      contractDeployment: {
        hash: deploymentReceipt.hash,
        blockNumber: deploymentReceipt.blockNumber.toString(),
      },
      createBill: {
        hash: createBillReceipt.hash,
        blockNumber: createBillReceipt.blockNumber.toString(),
      },
    },
    explorers: explorerEvidence(
      contractAddress,
      deploymentReceipt.hash,
      createBillReceipt.hash,
    ),
  };
}

function requireConfirmedReceipt(receipt, label) {
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} did not return a successful confirmed receipt.`);
  }
  return receipt;
}

async function fetchGbpPerMon() {
  const configured = process.env.TAPTAB_GBP_PER_MON?.trim();
  if (configured) {
    return {
      quote: parseGbpPerMon(configured),
      source: "TAPTAB_GBP_PER_MON",
      basis: "manual GBP per MON reference",
      observedAtUnixSeconds: Math.floor(Date.now() / 1_000),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(COINGECKO_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}.`);
    const data = await response.json();
    const gbp = data?.monad?.gbp;
    const updatedAt = data?.monad?.last_updated_at;
    if (!Number.isInteger(updatedAt)) throw new Error("CoinGecko omitted its quote timestamp.");
    const now = Math.floor(Date.now() / 1000);
    if (updatedAt < now - 300 || updatedAt > now + 300) {
      throw new Error("CoinGecko returned a stale or future-dated quote.");
    }
    return {
      quote: parseGbpPerMon(numberQuoteToDecimal(gbp)),
      source: "CoinGecko",
      basis: "mainnet MON",
      observedAtUnixSeconds: updatedAt,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown quote error";
    throw new Error(
      `Could not fetch a safe GBP-per-MON quote: ${reason} Set TAPTAB_GBP_PER_MON explicitly to continue.`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function configuredPayee(deployerAddress) {
  const value = process.env.TAPTAB_PAYEE_ADDRESS?.trim() || deployerAddress;
  if (!hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
    throw new Error("TAPTAB_PAYEE_ADDRESS must be a non-zero EVM address.");
  }
  return hre.ethers.getAddress(value);
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== MONAD_TESTNET_CHAIN_ID) {
    throw new Error(
      `Refusing to deploy: expected Monad Testnet chain ID 10143, received ${network.chainId}.`,
    );
  }

  const duration = parseDuration(process.env.TAPTAB_DURATION_SECONDS);
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployment signer is configured.");
  const payee = configuredPayee(deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error(
      `Deployment wallet ${deployer.address} has no Testnet MON. Fund it at https://faucet.monad.xyz first.`,
    );
  }

  const { quote, source, basis, observedAtUnixSeconds } = await fetchGbpPerMon();
  const demo = table7Config(quote);
  const TapTab = await hre.ethers.getContractFactory("TapTab");
  const deploymentRequest = await TapTab.getDeployTransaction();
  const [deploymentGasEstimate, deploymentFeeData] = await Promise.all([
    hre.ethers.provider.estimateGas({
      ...deploymentRequest,
      from: deployer.address,
    }),
    hre.ethers.provider.getFeeData(),
  ]);
  const deploymentFeeCap = feeCapFrom(deploymentFeeData);
  const conservativeDeploymentMinimum =
    conservativeGasCost(deploymentGasEstimate, deploymentFeeCap) +
    conservativeGasCost(CREATE_BILL_GAS_RESERVE, deploymentFeeCap);
  assertSufficientBalance({
    balance,
    required: conservativeDeploymentMinimum,
    address: deployer.address,
    stage: "contract deployment and the Table 7 seed transaction",
  });

  const tapTab = await TapTab.deploy();
  const deploymentTransaction = tapTab.deploymentTransaction();
  if (!deploymentTransaction) {
    throw new Error("TapTab deployment did not expose its transaction hash.");
  }
  const deploymentReceipt = requireConfirmedReceipt(
    await deploymentTransaction.wait(),
    "TapTab deployment",
  );
  await tapTab.waitForDeployment();

  const contractAddress = await tapTab.getAddress();
  const latestBlock = await hre.ethers.provider.getBlock("latest");
  if (!latestBlock) throw new Error("Monad Testnet did not return its latest block.");
  const deadline = latestBlock.timestamp + duration;
  const expectedSubtotal = demo.itemAmounts.reduce((total, amount) => total + amount, 0n);
  const metadata = {
    schema: "taptab-gbp-receipt",
    version: 1,
    ...demo.metadata,
    quote: {
      gbpPerMon: quote.text,
      source,
      basis,
      observedAtUnixSeconds,
      lockedAtUnixSeconds: Math.max(
        latestBlock.timestamp,
        observedAtUnixSeconds,
        Math.floor(Date.now() / 1_000),
      ),
      allocation: "per-row-half-up",
      subtotalWei: expectedSubtotal.toString(),
    },
  };
  const metadataURI = `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
  const [createBillGasEstimate, createBillFeeData, postDeploymentBalance] =
    await Promise.all([
      tapTab.createBill.estimateGas(
        payee,
        metadataURI,
        deadline,
        demo.itemAmounts,
        demo.shareCounts,
      ),
      hre.ethers.provider.getFeeData(),
      hre.ethers.provider.getBalance(deployer.address),
    ]);
  const conservativeCreateBillMinimum = conservativeGasCost(
    createBillGasEstimate,
    feeCapFrom(createBillFeeData),
  );
  assertSufficientBalance({
    balance: postDeploymentBalance,
    required: conservativeCreateBillMinimum,
    address: deployer.address,
    stage: "the Table 7 seed transaction after deployment",
  });

  const createTransaction = await tapTab.createBill(
    payee,
    metadataURI,
    deadline,
    demo.itemAmounts,
    demo.shareCounts,
  );
  const createBillReceipt = requireConfirmedReceipt(
    await createTransaction.wait(),
    "Table 7 createBill transaction",
  );

  const billId = await tapTab.billCount();
  const bill = await tapTab.getBill(billId);
  if (billId !== 1n || bill.subtotal !== expectedSubtotal) {
    throw new Error("Seeded bill verification failed after confirmation.");
  }
  const deploymentEvidence = buildDeploymentEvidence({
    contractAddress,
    billId,
    deploymentReceipt,
    createBillReceipt,
  });

  console.log("TapTab Table 7 is live on Monad Testnet (chain ID 10143)");
  console.log("Deployer:", deployer.address);
  console.log("Payee:", payee);
  console.log("TapTab:", contractAddress);
  console.log("Bill ID:", billId.toString());
  console.log("Receipt:", "Table 7 · Lina Stores · £48.50");
  console.log(
    "GBP per MON:",
    `${quote.text} (${source}, observed ${new Date(observedAtUnixSeconds * 1_000).toISOString()})`,
  );
  console.log("Native subtotal:", `${hre.ethers.formatEther(expectedSubtotal)} MON`);
  console.log("Deadline:", new Date(deadline * 1000).toISOString());
  console.log("Contract deployment transaction:", deploymentReceipt.hash);
  console.log("Contract deployment block:", deploymentReceipt.blockNumber.toString());
  console.log("Create bill transaction:", createBillReceipt.hash);
  console.log("Create bill block:", createBillReceipt.blockNumber.toString());
  for (const [explorerName, urls] of Object.entries(deploymentEvidence.explorers)) {
    console.log(`${explorerName} contract:`, urls.contract);
    console.log(`${explorerName} deployment transaction:`, urls.deploymentTransaction);
    console.log(`${explorerName} create bill transaction:`, urls.createBillTransaction);
  }
  console.log("");
  console.log("Frontend environment:");
  console.log(`NEXT_PUBLIC_TAPTAB_ADDRESS=${contractAddress}`);
  console.log(`NEXT_PUBLIC_TAPTAB_BILL_ID=${billId}`);
  console.log("");
  console.log("Audience query:", `?contract=${contractAddress}&bill=${billId}#live`);
  console.log("");
  console.log("Deployment evidence (public addresses and transaction data only):");
  console.log(JSON.stringify(deploymentEvidence, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown deployment failure.";
    console.error(`TapTab demo deployment failed: ${message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CREATE_BILL_GAS_RESERVE,
  TESTNET_EXPLORERS,
  buildDeploymentEvidence,
  conservativeGasCost,
  explorerEvidence,
  feeCapFrom,
  requireConfirmedReceipt,
  withGasBuffer,
};

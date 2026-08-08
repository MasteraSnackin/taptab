const hre = require("hardhat");
const {
  numberQuoteToDecimal,
  parseDuration,
  parseGbpPerMon,
  scaledTestnetMetadata,
  table7ScaledTestnetConfig,
} = require("./taptab-demo-config.cjs");

const MONAD_TESTNET_CHAIN_ID = 10_143n;
const EXPECTED_BILL_ID = 2n;
const GAS_BUFFER_BPS = 2_500n;
const BPS_DENOMINATOR = 10_000n;
const MAX_METADATA_URI_BYTES = 64_000;
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd,gbp&include_last_updated_at=true";
const COINBASE_GBP_URL = "https://api.coinbase.com/v2/prices/MON-GBP/spot";
const QUOTE_REQUEST_HEADERS = Object.freeze({
  accept: "application/json",
  "user-agent": "TapTab/1.0 (Monad Blitz price reference)",
});

function configuredContractAddress() {
  const value = (
    process.env.TAPTAB_CONTRACT_ADDRESS ||
    process.env.NEXT_PUBLIC_TAPTAB_ADDRESS ||
    ""
  ).trim();
  if (!hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
    throw new Error("TAPTAB_CONTRACT_ADDRESS must be the existing non-zero TapTab address.");
  }
  return hre.ethers.getAddress(value);
}

function configuredPayee(defaultAddress) {
  const value = process.env.TAPTAB_PAYEE_ADDRESS?.trim() || defaultAddress;
  if (!hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
    throw new Error("TAPTAB_PAYEE_ADDRESS must be a non-zero EVM address.");
  }
  return hre.ethers.getAddress(value);
}

function bufferedGas(gas) {
  if (typeof gas !== "bigint" || gas <= 0n) {
    throw new Error("Gas estimates must be positive bigint values.");
  }
  return (gas * (BPS_DENOMINATOR + GAS_BUFFER_BPS) + BPS_DENOMINATOR - 1n) /
    BPS_DENOMINATOR;
}

function feeCap(feeData) {
  const value = feeData?.maxFeePerGas ?? feeData?.gasPrice;
  if (typeof value !== "bigint" || value <= 0n) {
    throw new Error("Monad Testnet did not return a positive fee cap.");
  }
  return value;
}

function decodeMetadata(metadataURI) {
  const prefix = "data:application/json,";
  if (!metadataURI.startsWith(prefix)) return undefined;
  try {
    return JSON.parse(decodeURIComponent(metadataURI.slice(prefix.length)));
  } catch {
    return undefined;
  }
}

function isDisclosedScaledBill(bill) {
  const metadata = decodeMetadata(bill.metadataURI);
  if (!metadata || typeof metadata !== "object") return false;
  try {
    const quote = parseGbpPerMon(metadata.quote?.gbpPerMon);
    const demo = table7ScaledTestnetConfig(quote);
    const expected = scaledTestnetMetadata({
      demo,
      quote,
      source: metadata.quote?.source,
      basis: metadata.quote?.basis,
      observedAtUnixSeconds: metadata.quote?.observedAtUnixSeconds,
      lockedAtUnixSeconds: metadata.quote?.lockedAtUnixSeconds,
    });
    return Boolean(
      metadata.schema === "taptab-gbp-receipt" &&
      metadata.version === 2 &&
        metadata.settlement?.subtotalWei === bill.subtotal.toString() &&
        JSON.stringify(metadata) === JSON.stringify(expected),
    );
  } catch {
    return false;
  }
}

async function fetchCoinGeckoGbpPerMon() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(COINGECKO_URL, {
      signal: controller.signal,
      headers: QUOTE_REQUEST_HEADERS,
    });
    if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}.`);
    const data = await response.json();
    const gbp = data?.monad?.gbp;
    const observedAtUnixSeconds = data?.monad?.last_updated_at;
    if (!Number.isSafeInteger(observedAtUnixSeconds)) {
      throw new Error("CoinGecko omitted its quote timestamp.");
    }
    const now = Math.floor(Date.now() / 1_000);
    if (observedAtUnixSeconds < now - 300 || observedAtUnixSeconds > now + 300) {
      throw new Error("CoinGecko returned a stale or future-dated quote.");
    }
    return {
      quote: parseGbpPerMon(numberQuoteToDecimal(gbp)),
      source: "CoinGecko",
      basis: "mainnet MON",
      observedAtUnixSeconds,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseCoinbaseGbpSpot(payload) {
  const amount = payload?.data?.amount;
  if (
    payload?.data?.base !== "MON" ||
    payload?.data?.currency !== "GBP" ||
    typeof amount !== "string" ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount)
  ) {
    throw new Error("Coinbase returned an invalid MON-GBP quote.");
  }
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Coinbase returned a non-positive MON-GBP quote.");
  }
  return parseGbpPerMon(numberQuoteToDecimal(numeric));
}

async function fetchCoinbaseGbpPerMon() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(COINBASE_GBP_URL, {
      signal: controller.signal,
      headers: QUOTE_REQUEST_HEADERS,
    });
    if (!response.ok) throw new Error(`Coinbase returned HTTP ${response.status}.`);
    return {
      quote: parseCoinbaseGbpSpot(await response.json()),
      source: "Coinbase",
      basis: "mainnet MON",
      observedAtUnixSeconds: Math.floor(Date.now() / 1_000),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLiveGbpPerMon() {
  try {
    return await fetchCoinGeckoGbpPerMon();
  } catch {
    return fetchCoinbaseGbpPerMon();
  }
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== MONAD_TESTNET_CHAIN_ID) {
    throw new Error(
      `Refusing to seed outside Monad Testnet: received chain ID ${network.chainId}.`,
    );
  }

  const [creator] = await hre.ethers.getSigners();
  if (!creator) throw new Error("No Testnet creator signer is configured.");
  const contractAddress = configuredContractAddress();
  const payee = configuredPayee(creator.address);
  if ((await hre.ethers.provider.getCode(contractAddress)) === "0x") {
    throw new Error(`No contract code exists at ${contractAddress} on Monad Testnet.`);
  }

  const tapTab = await hre.ethers.getContractAt("TapTab", contractAddress, creator);
  const currentBillCount = await tapTab.billCount();
  if (currentBillCount >= EXPECTED_BILL_ID) {
    const existing = await tapTab.getBill(EXPECTED_BILL_ID);
    if (currentBillCount === EXPECTED_BILL_ID && isDisclosedScaledBill(existing)) {
      console.log("TapTab scaled Testnet bill already exists; no transaction was sent.");
      console.log("TapTab:", contractAddress);
      console.log("Bill ID:", EXPECTED_BILL_ID.toString());
      console.log(
        "Explorer:",
        `https://testnet.monadvision.com/address/${contractAddress}?tab=contract`,
      );
      return;
    }
    throw new Error(
      `Contract already has ${currentBillCount} bills and bill 2 is not the expected disclosed scaled demo. Refusing to create another bill.`,
    );
  }
  if (currentBillCount !== EXPECTED_BILL_ID - 1n) {
    throw new Error(
      `Expected the existing contract to contain bill 1 before seeding bill 2; found ${currentBillCount}.`,
    );
  }

  const duration = parseDuration(process.env.TAPTAB_DURATION_SECONDS);
  const [{ quote, source, basis, observedAtUnixSeconds }, latestBlock] =
    await Promise.all([fetchLiveGbpPerMon(), hre.ethers.provider.getBlock("latest")]);
  if (!latestBlock) throw new Error("Monad Testnet did not return its latest block.");

  const deadline = latestBlock.timestamp + duration;
  const lockedAtUnixSeconds = Math.max(
    latestBlock.timestamp,
    observedAtUnixSeconds,
    Math.floor(Date.now() / 1_000),
  );
  const demo = table7ScaledTestnetConfig(quote);
  const metadata = scaledTestnetMetadata({
    demo,
    quote,
    source,
    basis,
    observedAtUnixSeconds,
    lockedAtUnixSeconds,
  });
  const metadataURI = `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
  if (Buffer.byteLength(metadataURI, "utf8") > MAX_METADATA_URI_BYTES) {
    throw new Error("Scaled demo metadata exceeds the TapTab contract limit.");
  }

  const gasEstimate = await tapTab.createBill.estimateGas(
    payee,
    metadataURI,
    deadline,
    demo.itemAmounts,
    demo.shareCounts,
  );
  const [balance, networkFeeData] = await Promise.all([
    hre.ethers.provider.getBalance(creator.address),
    hre.ethers.provider.getFeeData(),
  ]);
  const conservativeFee = bufferedGas(gasEstimate) * feeCap(networkFeeData);
  if (balance < conservativeFee) {
    throw new Error(
      `Creator ${creator.address} has ${hre.ethers.formatEther(balance)} Testnet MON; ` +
        `${hre.ethers.formatEther(conservativeFee)} MON is the conservative creation-fee requirement.`,
    );
  }

  console.log("Scaled TapTab bill 2 preflight passed.");
  console.log("TapTab:", contractAddress);
  console.log("Creator:", creator.address);
  console.log("Payee:", payee);
  console.log("Receipt:", "Table 7 · Lina Stores · £48.50");
  console.log("Live mainnet reference:", `${quote.text} GBP per MON (${source})`);
  console.log(
    "Reference subtotal:",
    `${hre.ethers.formatEther(demo.referenceSubtotalWei)} mainnet-value MON`,
  );
  console.log(
    "Testnet settlement subtotal:",
    `${hre.ethers.formatEther(demo.subtotalWei)} Testnet MON (disclosed 1,000:1 scale)`,
  );
  console.log("Testnet MON has no cash value.");
  console.log("Estimated createBill gas:", gasEstimate.toString());

  if (process.env.TAPTAB_CONFIRM_SCALED_TESTNET_DEMO !== "YES") {
    throw new Error(
      "Preflight only: set TAPTAB_CONFIRM_SCALED_TESTNET_DEMO=YES to send this exact bill-2 transaction.",
    );
  }

  const transaction = await tapTab.createBill(
    payee,
    metadataURI,
    deadline,
    demo.itemAmounts,
    demo.shareCounts,
  );
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Scaled bill creation did not return a successful confirmed receipt.");
  }

  const [confirmedBillCount, bill, items] = await Promise.all([
    tapTab.billCount(),
    tapTab.getBill(EXPECTED_BILL_ID),
    tapTab.getItems(EXPECTED_BILL_ID),
  ]);
  if (
    confirmedBillCount !== EXPECTED_BILL_ID ||
    bill.id !== EXPECTED_BILL_ID ||
    bill.creator !== creator.address ||
    bill.payee !== payee ||
    bill.deadline !== BigInt(deadline) ||
    bill.subtotal !== demo.subtotalWei ||
    bill.metadataURI !== metadataURI ||
    items.length !== demo.itemAmounts.length ||
    items.some(
      (item, index) =>
        item.amount !== demo.itemAmounts[index] ||
        item.shareCount !== BigInt(demo.shareCounts[index]),
    )
  ) {
    throw new Error("Confirmed bill 2 does not match the prepared scaled receipt exactly.");
  }

  console.log("TapTab scaled Testnet bill 2 confirmed.");
  console.log("Transaction:", receipt.hash);
  console.log("Block:", receipt.blockNumber.toString());
  console.log("Explorer:", `https://testnet.monadvision.com/tx/${receipt.hash}`);
  console.log("");
  console.log("Frontend environment:");
  console.log(`NEXT_PUBLIC_TAPTAB_ADDRESS=${contractAddress}`);
  console.log(`NEXT_PUBLIC_TAPTAB_BILL_ID=${EXPECTED_BILL_ID}`);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown scaled seed failure.";
    console.error(`TapTab scaled Testnet seed failed: ${message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_BILL_ID,
  bufferedGas,
  decodeMetadata,
  feeCap,
  fetchLiveGbpPerMon,
  isDisclosedScaledBill,
  parseCoinbaseGbpSpot,
};

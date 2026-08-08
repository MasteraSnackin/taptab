const { expect } = require("chai");
const hre = require("hardhat");
const {
  parseGbpPerMon,
  scaledTestnetMetadata,
  table7ScaledTestnetConfig,
} = require("../scripts/taptab-demo-config.cjs");
const {
  EXPECTED_BILL_ID,
  bufferedGas,
  decodeMetadata,
  feeCap,
  fetchLiveGbpPerMon,
  isDisclosedScaledBill,
  parseCoinbaseGbpSpot,
} = require("../scripts/seed-taptab-scaled.cjs");

describe("TapTab scaled Testnet seed", function () {
  it("creates an exactly reconciled schema-v2 bill in the existing contract", async function () {
    const [creator, payee] = await hre.ethers.getSigners();
    const TapTab = await hre.ethers.getContractFactory("TapTab");
    const tapTab = await TapTab.deploy();
    await tapTab.waitForDeployment();
    const now = (await hre.ethers.provider.getBlock("latest")).timestamp;

    await tapTab.createBill(payee.address, "bill-one", now + 3_600, [1n], [1]);
    const quote = parseGbpPerMon("0.025");
    const demo = table7ScaledTestnetConfig(quote);
    const metadata = scaledTestnetMetadata({
      demo,
      quote,
      source: "CoinGecko",
      basis: "mainnet MON",
      observedAtUnixSeconds: now,
      lockedAtUnixSeconds: now,
    });
    const metadataURI = `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
    await tapTab
      .connect(creator)
      .createBill(payee.address, metadataURI, now + 3_600, demo.itemAmounts, demo.shareCounts);

    const [bill, items] = await Promise.all([
      tapTab.getBill(EXPECTED_BILL_ID),
      tapTab.getItems(EXPECTED_BILL_ID),
    ]);
    expect(bill.subtotal).to.equal(demo.subtotalWei);
    expect(bill.metadataURI).to.equal(metadataURI);
    expect(items.map((item) => item.amount)).to.deep.equal(demo.itemAmounts);
    expect(isDisclosedScaledBill(bill)).to.equal(true);
    expect(decodeMetadata(metadataURI)).to.deep.equal(metadata);
  });

  it("fails closed for ambiguous evidence and unsafe fee inputs", function () {
    expect(bufferedGas(1n)).to.equal(2n);
    expect(bufferedGas(100n)).to.equal(125n);
    expect(() => bufferedGas(0n)).to.throw("positive bigint");
    expect(feeCap({ maxFeePerGas: 9n, gasPrice: 7n })).to.equal(9n);
    expect(feeCap({ maxFeePerGas: null, gasPrice: 7n })).to.equal(7n);
    expect(() => feeCap({})).to.throw("positive fee cap");
    expect(decodeMetadata("https://example.test/receipt.json")).to.equal(undefined);
    expect(
      isDisclosedScaledBill({
        subtotal: 1n,
        metadataURI: `data:application/json,${encodeURIComponent(
          JSON.stringify({
            schema: "taptab-gbp-receipt",
            version: 2,
            settlement: {
              mode: "scaled-testnet-demo",
              divisor: 999,
              allocation: "largest-remainder-half-up",
              subtotalWei: "1",
              network: "Monad Testnet",
            },
          }),
        )}`,
      }),
    ).to.equal(false);
  });

  it("validates Coinbase MON-GBP and uses it only after CoinGecko fails", async function () {
    expect(
      parseCoinbaseGbpSpot({
        data: {
          amount: "0.015353852551903350143",
          base: "MON",
          currency: "GBP",
        },
      }).text,
    ).to.equal("0.01535385255190335");
    expect(() =>
      parseCoinbaseGbpSpot({
        data: { amount: "0.02", base: "ETH", currency: "GBP" },
      }),
    ).to.throw("invalid MON-GBP");

    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const requested = [];
    try {
      Date.now = () => 1_800_000_000_000;
      globalThis.fetch = async (url) => {
        requested.push(url);
        if (String(url).includes("coingecko.com")) {
          return new Response("Rate limited", { status: 429 });
        }
        return Response.json({
          data: { amount: "0.02", base: "MON", currency: "GBP" },
        });
      };
      expect(await fetchLiveGbpPerMon()).to.deep.equal({
        quote: parseGbpPerMon("0.02"),
        source: "Coinbase",
        basis: "mainnet MON",
        observedAtUnixSeconds: 1_800_000_000,
      });
      expect(requested).to.have.length(2);
      expect(String(requested[0])).to.include("coingecko.com");
      expect(String(requested[1])).to.equal(
        "https://api.coinbase.com/v2/prices/MON-GBP/spot",
      );
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
    }
  });
});

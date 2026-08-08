const { expect } = require("chai");
const {
  TABLE_7_ITEMS,
  TESTNET_SETTLEMENT_DIVISOR,
  numberQuoteToDecimal,
  parseDuration,
  parseGbpPerMon,
  penceToWei,
  scaleWeiAmounts,
  scaledTestnetMetadata,
  table7Config,
  table7ScaledTestnetConfig,
} = require("../scripts/taptab-demo-config.cjs");

describe("TapTab demo configuration", function () {
  it("matches the five-item £48.50 Table 7 preview exactly", function () {
    const config = table7Config(parseGbpPerMon("0.025"));

    expect(TABLE_7_ITEMS.map((item) => item.name)).to.deep.equal([
      "Wood-fired margherita",
      "Truffle fries",
      "Burrata & tomatoes",
      "Bottle of house red",
      "Pistachio gelato",
    ]);
    expect(config.metadata.subtotalPence).to.equal(4_850);
    expect(config.metadata.items.map((item) => item.amountPence)).to.deep.equal([
      1_200, 750, 900, 1_400, 600,
    ]);
    expect(config.shareCounts).to.deep.equal([1, 2, 2, 4, 2]);
    expect(config.itemAmounts).to.have.length(5);
    expect(config.itemAmounts.every((amount) => amount > 0n)).to.equal(true);
  });

  it("converts exact pence to wei without floating-point monetary arithmetic", function () {
    const oneGbpPerMon = parseGbpPerMon("1.0");
    expect(penceToWei(100, oneGbpPerMon)).to.equal(10n ** 18n);
    expect(penceToWei(1, oneGbpPerMon)).to.equal(10n ** 16n);
    expect(parseGbpPerMon("0.025")).to.deep.include({
      numerator: 25n,
      scale: 1_000n,
    });
  });

  it("reconciles the disclosed 1,000:1 Testnet settlement deterministically", function () {
    const quote = parseGbpPerMon("0.025");
    const config = table7ScaledTestnetConfig(quote);
    const repeated = table7ScaledTestnetConfig(quote);

    expect(TESTNET_SETTLEMENT_DIVISOR).to.equal(1_000n);
    expect(config.referenceSubtotalWei).to.equal(1_940_000n * 10n ** 15n);
    expect(config.subtotalWei).to.equal(1_940n * 10n ** 15n);
    expect(config.itemAmounts).to.deep.equal(repeated.itemAmounts);
    expect(config.itemAmounts.reduce((sum, amount) => sum + amount, 0n)).to.equal(
      config.subtotalWei,
    );
    expect(config.referenceItemAmounts).to.deep.equal([
      480n * 10n ** 18n,
      300n * 10n ** 18n,
      360n * 10n ** 18n,
      560n * 10n ** 18n,
      240n * 10n ** 18n,
    ]);
  });

  it("uses stable largest-remainder tie-breaking for exact scaled reconciliation", function () {
    const scaled = scaleWeiAmounts([1_499n, 1_499n, 1_002n], 1_000n);
    expect(scaled.referenceSubtotalWei).to.equal(4_000n);
    expect(scaled.subtotalWei).to.equal(4n);
    expect(scaled.itemAmountsWei).to.deep.equal([2n, 1n, 1n]);
    expect(() => scaleWeiAmounts([], 1_000n)).to.throw("At least one");
    expect(() => scaleWeiAmounts([1n], 1n)).to.throw("greater than one");
  });

  it("builds explicit schema-v2 reference and scaled-settlement evidence", function () {
    const quote = parseGbpPerMon("0.025");
    const demo = table7ScaledTestnetConfig(quote);
    const metadata = scaledTestnetMetadata({
      demo,
      quote,
      source: "CoinGecko",
      basis: "mainnet MON",
      observedAtUnixSeconds: 1_800_000_000,
      lockedAtUnixSeconds: 1_800_000_030,
    });

    expect(metadata).to.deep.include({
      schema: "taptab-gbp-receipt",
      version: 2,
      currency: "GBP",
      subtotalPence: 4_850,
    });
    expect(metadata.quote).to.deep.equal({
      gbpPerMon: "0.025",
      source: "CoinGecko",
      basis: "mainnet MON",
      observedAtUnixSeconds: 1_800_000_000,
      lockedAtUnixSeconds: 1_800_000_030,
      allocation: "per-row-half-up",
      referenceSubtotalWei: demo.referenceSubtotalWei.toString(),
    });
    expect(metadata.settlement).to.deep.equal({
      mode: "scaled-testnet-demo",
      divisor: 1_000,
      allocation: "largest-remainder-half-up",
      subtotalWei: demo.subtotalWei.toString(),
      network: "Monad Testnet",
    });

    expect(() =>
      scaledTestnetMetadata({
        demo: { ...demo, subtotalWei: demo.subtotalWei + 1n },
        quote,
        source: "CoinGecko",
        basis: "mainnet MON",
        observedAtUnixSeconds: 1_800_000_000,
        lockedAtUnixSeconds: 1_800_000_030,
      }),
    ).to.throw(/reconcile|1,000:1/);
  });

  it("rejects unsafe or implausible quote inputs", function () {
    for (const value of ["", "0", "-1", "1e-2", "0.0000000001", "1000001"]) {
      expect(() => parseGbpPerMon(value), value).to.throw();
    }
    expect(() => penceToWei(0, parseGbpPerMon("1"))).to.throw();
    expect(() => numberQuoteToDecimal(Number.NaN)).to.throw();
  });

  it("keeps demo deadlines inside the supported pitch window", function () {
    expect(parseDuration(undefined)).to.equal(14_400);
    expect(parseDuration("300")).to.equal(300);
    expect(parseDuration("604800")).to.equal(604_800);
    for (const value of ["299", "604801", "1.5", "not-a-number"]) {
      expect(() => parseDuration(value), value).to.throw();
    }
  });
});

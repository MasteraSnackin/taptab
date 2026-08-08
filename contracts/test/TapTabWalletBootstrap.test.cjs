const { expect } = require("chai");
const {
  promises: { chmod, mkdtemp, readFile, rm, stat, writeFile },
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Wallet } = require("ethers");

const {
  PRIVATE_MODE,
  bootstrapTestnetWallet,
  insertPrivateKey,
} = require("../scripts/bootstrap-testnet-wallet.cjs");

const TEST_PRIVATE_KEY = `0x${"11".repeat(32)}`;
const TEST_WALLET = new Wallet(TEST_PRIVATE_KEY);

describe("Monad Testnet wallet bootstrap", function () {
  let directory;
  let envPath;

  beforeEach(async function () {
    directory = await mkdtemp(join(tmpdir(), "taptab-wallet-test-"));
    envPath = join(directory, ".env");
  });

  afterEach(async function () {
    await rm(directory, { recursive: true, force: true });
  });

  it("refuses to create a wallet when .env does not exist", async function () {
    let generated = false;
    let failure;
    try {
      await bootstrapTestnetWallet({
        envPath,
        createWallet: () => {
          generated = true;
          return TEST_WALLET;
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).to.include("does not exist");
    expect(generated).to.equal(false);
  });

  it("refuses to replace an existing deployment key", async function () {
    const original = "MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz\nDEPLOYER_PRIVATE_KEY=already-set\n";
    await writeFile(envPath, original, { mode: PRIVATE_MODE });

    await expect(
      bootstrapTestnetWallet({ envPath, createWallet: () => TEST_WALLET }),
    ).to.be.rejectedWith("already configured");
    expect(await readFile(envPath, "utf8")).to.equal(original);
  });

  it("refuses missing and duplicate deployment-key fields", function () {
    expect(() => insertPrivateKey("ETHERSCAN_API_KEY=\n", TEST_PRIVATE_KEY)).to.throw(
      "is missing",
    );
    expect(() =>
      insertPrivateKey(
        "DEPLOYER_PRIVATE_KEY=\nDEPLOYER_PRIVATE_KEY=\n",
        TEST_PRIVATE_KEY,
      ),
    ).to.throw("more than once");
  });

  it("atomically stores the key with owner-only permissions", async function () {
    await writeFile(
      envPath,
      "MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz\nDEPLOYER_PRIVATE_KEY=\nETHERSCAN_API_KEY=\n",
      { mode: 0o644 },
    );

    await bootstrapTestnetWallet({
      envPath,
      createWallet: () => TEST_WALLET,
      output: () => {},
    });

    const written = await readFile(envPath, "utf8");
    const writtenStat = await stat(envPath);
    expect(written).to.include(`DEPLOYER_PRIVATE_KEY=${TEST_PRIVATE_KEY}`);
    expect(writtenStat.mode & 0o777).to.equal(PRIVATE_MODE);
  });

  it("outputs only the checksum public address", async function () {
    await writeFile(envPath, "DEPLOYER_PRIVATE_KEY=\n", { mode: PRIVATE_MODE });
    const output = [];

    const address = await bootstrapTestnetWallet({
      envPath,
      createWallet: () => TEST_WALLET,
      output: (line) => output.push(line),
    });

    expect(address).to.equal(TEST_WALLET.address);
    expect(output).to.deep.equal([TEST_WALLET.address]);
    expect(output.join("\n")).not.to.include(TEST_PRIVATE_KEY);
    expect(output.join("\n").split(/\s+/)).to.have.length(1);
  });

  it("restores owner-only permissions even when the existing file is broader", async function () {
    await writeFile(envPath, "DEPLOYER_PRIVATE_KEY=\n", { mode: 0o666 });
    await chmod(envPath, 0o666);

    await bootstrapTestnetWallet({
      envPath,
      createWallet: () => TEST_WALLET,
      output: () => {},
    });

    expect((await stat(envPath)).mode & 0o777).to.equal(PRIVATE_MODE);
  });
});

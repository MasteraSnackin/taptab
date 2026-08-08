const {
  constants,
  promises: { chmod, lstat, open, rename, unlink },
} = require("node:fs");
const { basename, dirname, join, resolve } = require("node:path");
const { randomBytes } = require("node:crypto");
const { Wallet, getAddress } = require("ethers");

const PRIVATE_KEY_NAME = "DEPLOYER_PRIVATE_KEY";
const PRIVATE_MODE = 0o600;

function sameFileVersion(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

function insertPrivateKey(contents, privateKey) {
  const pattern = /^([ \t]*DEPLOYER_PRIVATE_KEY[ \t]*=[ \t]*)([^\r\n]*)(\r?\n|$)/gm;
  const matches = [...contents.matchAll(pattern)];

  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `${PRIVATE_KEY_NAME} is missing from contracts/.env.`
        : `${PRIVATE_KEY_NAME} appears more than once in contracts/.env.`,
    );
  }

  const match = matches[0];
  if (match[2].trim() !== "") {
    throw new Error(
      `${PRIVATE_KEY_NAME} is already configured; refusing to replace it.`,
    );
  }

  return (
    contents.slice(0, match.index) +
    match[1] +
    privateKey +
    match[3] +
    contents.slice(match.index + match[0].length)
  );
}

async function readExistingRegularFile(filePath) {
  let handle;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await open(filePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "contracts/.env does not exist. Copy .env.example to .env first.",
      );
    }
    if (error?.code === "ELOOP") {
      throw new Error("Refusing to write through a symbolic-link .env file.");
    }
    throw error;
  }

  try {
    const fileStat = await handle.stat({ bigint: true });
    if (!fileStat.isFile()) {
      throw new Error("contracts/.env must be a regular file.");
    }
    return {
      contents: await handle.readFile({ encoding: "utf8" }),
      fileStat,
    };
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicPrivateWrite(filePath, contents, expectedStat) {
  const directory = dirname(filePath);
  const temporaryPath = join(
    directory,
    `.${basename(filePath)}.wallet-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  let temporaryHandle;

  try {
    temporaryHandle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      PRIVATE_MODE,
    );
    await temporaryHandle.writeFile(contents, { encoding: "utf8" });
    await temporaryHandle.chmod(PRIVATE_MODE);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;

    const currentStat = await lstat(filePath, { bigint: true });
    if (!currentStat.isFile() || currentStat.isSymbolicLink()) {
      throw new Error(
        "contracts/.env is no longer the regular file that was checked.",
      );
    }
    if (!sameFileVersion(currentStat, expectedStat)) {
      throw new Error(
        "contracts/.env changed during wallet creation; refusing to overwrite it.",
      );
    }

    await rename(temporaryPath, filePath);
    await chmod(filePath, PRIVATE_MODE);
    await syncDirectory(directory);
  } catch (error) {
    await temporaryHandle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function validateGeneratedWallet(wallet) {
  try {
    const derivedWallet = new Wallet(wallet.privateKey);
    const derivedAddress = getAddress(derivedWallet.address);
    if (derivedAddress !== getAddress(wallet.address)) throw new Error("mismatch");
    return { privateKey: derivedWallet.privateKey, address: derivedAddress };
  } catch {
    throw new Error("The wallet generator returned invalid key material.");
  }
}

async function bootstrapTestnetWallet({
  envPath = resolve(__dirname, "..", ".env"),
  createWallet = () => Wallet.createRandom(),
  output = (address) => process.stdout.write(`${address}\n`),
} = {}) {
  const resolvedPath = resolve(envPath);
  const { contents, fileStat } = await readExistingRegularFile(resolvedPath);

  // Validate the file before generating any key material.
  insertPrivateKey(contents, "validation-placeholder");
  const generated = validateGeneratedWallet(createWallet());
  const updatedContents = insertPrivateKey(contents, generated.privateKey);
  await atomicPrivateWrite(resolvedPath, updatedContents, fileStat);
  output(generated.address);
  return generated.address;
}

async function main() {
  try {
    await bootstrapTestnetWallet();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown refusal";
    process.stderr.write(`Wallet bootstrap refused: ${message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  PRIVATE_MODE,
  atomicPrivateWrite,
  bootstrapTestnetWallet,
  insertPrivateKey,
  sameFileVersion,
};

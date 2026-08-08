import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../..");
const videoRoot = join(root, "docs/submission/video/2min");
const work = join(videoRoot, "v4");
const v2 = join(videoRoot, "v2");
const v3 = join(videoRoot, "v3");
const generated = join(work, "generated");
const frameDir = join(generated, "frames");
const overlayDir = join(generated, "overlays");
const subtitleDir = join(generated, "subtitles");
const segmentDir = join(generated, "segments");
const reviewDir = join(work, "review");
const teaserDir = join(work, "teaser");
const evidenceDir = join(work, "evidence");
const evidenceFile = join(root, "docs/submission/monad-testnet-multiwallet-evidence.json");

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION = 117;
const CAPTION_TOP = 842;
const directBillUrl =
  "https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout.trim();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function requireFile(file, label) {
  if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
  return file;
}

function renderSvg(name, svg, directory = overlayDir) {
  const svgFile = join(directory, `${name}.svg`);
  const pngFile = join(directory, `${name}.png`);
  writeFileSync(svgFile, svg);
  run("sips", ["-s", "format", "png", svgFile, "--out", pngFile]);
  return pngFile;
}

function makeFillFrame(name, source) {
  const output = join(frameDir, `${name}.png`);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    source,
    "-vf",
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${WIDTH}:${HEIGHT},setsar=1`,
    "-frames:v",
    "1",
    output,
  ]);
  return output;
}

function makeBrowserFrame(name, source, label, address = "taptab.local · sample walkthrough") {
  const base = renderSvg(
    `${name}-browser-base`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#090c13"/><stop offset="1" stop-color="#211a47"/></linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="12" stdDeviation="22" flood-color="#000" flood-opacity=".55"/></filter>
      </defs>
      <rect width="1920" height="1080" fill="url(#bg)"/>
      <rect x="270" y="8" width="1380" height="826" rx="22" fill="#151923" stroke="#60568d" stroke-width="3" filter="url(#shadow)"/>
      <path d="M270 62h1380" stroke="#403a58" stroke-width="2"/>
      <circle cx="306" cy="35" r="8" fill="#ed6a5e"/><circle cx="334" cy="35" r="8" fill="#f4bf4f"/><circle cx="362" cy="35" r="8" fill="#61c554"/>
      <rect x="420" y="19" width="844" height="32" rx="16" fill="#242938"/>
      <text x="842" y="41" text-anchor="middle" fill="#c8cad3" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(address)}</text>
      <rect x="1286" y="19" width="330" height="32" rx="16" fill="#312663"/>
      <text x="1451" y="41" text-anchor="middle" fill="#ddd4ff" font-family="Arial, sans-serif" font-size="15" font-weight="800">${escapeXml(label)}</text>
      <rect x="275" y="61" width="1370" height="772" fill="#151923"/>
      <text x="150" y="220" transform="rotate(-90 150 220)" fill="#8f78ff" font-family="Arial, sans-serif" font-size="20" font-weight="800" letter-spacing="3">WHOLE APPLICATION WINDOW</text>
    </svg>`,
  );
  const output = join(frameDir, `${name}.png`);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    base,
    "-i",
    source,
    "-filter_complex",
    `[1:v]scale=1368:768:force_original_aspect_ratio=decrease:flags=lanczos,pad=1368:768:(ow-iw)/2:(oh-ih)/2:color=0x151923,setsar=1[shot];[0:v][shot]overlay=276:63[v]`,
    "-map",
    "[v]",
    "-frames:v",
    "1",
    output,
  ]);
  return output;
}

function makeActionInset(name, fullFrame, detailFrame, actionLabel) {
  const chrome = renderSvg(
    `${name}-inset-chrome`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs><filter id="s" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-opacity=".62"/></filter></defs>
      <rect x="1248" y="88" width="612" height="405" rx="26" fill="#101521" stroke="#9a86ff" stroke-width="5" filter="url(#s)"/>
      <rect x="1274" y="108" width="300" height="38" rx="19" fill="#6d45ff"/>
      <text x="1424" y="134" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="17" font-weight="800">ACTION DETAIL · ${escapeXml(actionLabel)}</text>
    </svg>`,
  );
  const output = join(frameDir, `${name}.png`);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    fullFrame,
    "-i",
    chrome,
    "-i",
    detailFrame,
    "-filter_complex",
    `[0:v][1:v]overlay=0:0[base];[2:v]scale=570:321:force_original_aspect_ratio=increase:flags=lanczos,crop=570:321[detail];[base][detail]overlay=1269:154[v]`,
    "-map",
    "[v]",
    "-frames:v",
    "1",
    output,
  ]);
  return output;
}

function overlayFrame(name, background, foreground, x = 0, y = 0, directory = frameDir) {
  const output = join(directory, `${name}.png`);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    background,
    "-i",
    foreground,
    "-filter_complex",
    `[0:v][1:v]overlay=${x}:${y}:eof_action=repeat[v]`,
    "-map",
    "[v]",
    "-frames:v",
    "1",
    output,
  ]);
  return output;
}

rmSync(generated, { recursive: true, force: true });
rmSync(reviewDir, { recursive: true, force: true });
rmSync(teaserDir, { recursive: true, force: true });
for (const directory of [
  generated,
  frameDir,
  overlayDir,
  subtitleDir,
  segmentDir,
  reviewDir,
  teaserDir,
  evidenceDir,
]) {
  mkdirSync(directory, { recursive: true });
}

const audio = {
  narration: requireFile(join(v3, "audio/narration-master.wav"), "V3 narration master"),
  music: requireFile(join(v3, "audio/music-bed.wav"), "V3 original music bed"),
  sfx: requireFile(join(v3, "audio/ui-sfx.wav"), "V3 original interface effects"),
  captions: requireFile(join(v3, "audio/captions.json"), "V3 caption source"),
};

const evidence = JSON.parse(readFileSync(requireFile(evidenceFile, "sealed multi-wallet Testnet evidence"), "utf8"));
if (
  evidence.schema !== "taptab-monad-testnet-multiwallet-rehearsal" ||
  evidence.chain?.chainId !== "10143" ||
  evidence.contract?.address !== "0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198" ||
  evidence.journeys?.settlement?.billId !== "3" ||
  evidence.journeys?.settlement?.finalState !== "Settled" ||
  evidence.journeys?.cancellationRefund?.billId !== "4" ||
  evidence.journeys?.cancellationRefund?.finalState !== "Cancelled" ||
  evidence.transactions?.length !== 31
) {
  throw new Error("The sealed Testnet evidence does not match the expected Bills 3 and 4 rehearsal");
}

const findTransaction = (billId, event, from = null) => {
  const transaction = evidence.transactions.find(
    (entry) =>
      entry.billId === billId &&
      entry.events?.includes(event) &&
      (!from || entry.from?.toLowerCase() === from.toLowerCase()),
  );
  if (!transaction) throw new Error(`Missing ${event} transaction for Bill ${billId}`);
  return transaction;
};
const shorten = (value, left = 10, right = 8) => `${value.slice(0, left)}…${value.slice(-right)}`;
const proof = {
  bill3Create: findTransaction("3", "BillCreated"),
  creatorFund: findTransaction("3", "ContributionReceived", evidence.actors.creator.address),
  aliceFund: findTransaction("3", "ContributionReceived", evidence.actors.alice.address),
  bobFund: findTransaction("3", "ContributionReceived", evidence.actors.bob.address),
  settle: findTransaction("3", "BillSettled"),
  withdraw: findTransaction("3", "ProceedsWithdrawn"),
  bill4Create: findTransaction("4", "BillCreated"),
  cancel: findTransaction("4", "BillCancelled"),
  aliceRefund: findTransaction("4", "RefundClaimed", evidence.actors.alice.address),
  bobRefund: findTransaction("4", "RefundClaimed", evidence.actors.bob.address),
};

const screens = {
  hero: requireFile(join(v2, "screens/01-hook-hero.jpg"), "hero screen"),
  receipt: requireFile(join(v2, "screens/02-receipt.jpg"), "receipt screen"),
  claim: requireFile(join(v2, "screens/03-shared-claim.jpg"), "claim screen"),
  remainderOff: requireFile(join(v2, "screens/04a-remainder-opt-out.jpg"), "remainder opt-out screen"),
  remainderOn: requireFile(join(v2, "screens/04b-remainder-opt-in.jpg"), "remainder opt-in screen"),
  tip: requireFile(join(v2, "screens/04-tip-fair-remainder.jpg"), "tip screen"),
  review: requireFile(join(v2, "screens/05-review.jpg"), "review screen"),
  approved: requireFile(join(v2, "screens/06-all-approved.jpg"), "approval screen"),
  payOpen: requireFile(join(v2, "screens/07-protected-payments.jpg"), "protected payment screen"),
  selfPaid: requireFile(join(v2, "screens/08-self-paid.jpg"), "self payment screen"),
  sponsored: requireFile(join(v2, "screens/09-sponsored-incomplete.jpg"), "sponsor screen"),
  exact: requireFile(join(v2, "screens/10-exact-funded.jpg"), "exact funding screen"),
  settled: requireFile(join(v2, "screens/11-settled.jpg"), "settled screen"),
  refundReady: requireFile(join(v2, "screens/13-refund-ready.jpg"), "refund-ready screen"),
  refundReturned: requireFile(join(v2, "screens/16-stage-refund-returned.jpg"), "returned-refund screen"),
  liveBill: requireFile(join(v3, "screens/live-bill2-raw.png"), "canonical live Bill 2 screen"),
  billTransaction: requireFile(join(v3, "screens/bill2-transaction-evidence.png"), "Bill 2 transaction evidence"),
  contractEvidence: requireFile(join(v3, "assets/live-evidence-card.png"), "contract evidence card"),
};

const v3Frames = {
  hook: requireFile(join(v3, "generated/frames/hero-hook.png"), "V3 hook frame"),
  receipt: requireFile(join(v3, "generated/frames/receipt-close.png"), "V3 receipt detail"),
  remainderOff: requireFile(join(v3, "generated/frames/remainder-off-close.png"), "V3 opt-out detail"),
  remainderOn: requireFile(join(v3, "generated/frames/remainder-on-close.png"), "V3 opt-in detail"),
  review: requireFile(join(v3, "generated/frames/review-close.png"), "V3 review detail"),
  payOpen: requireFile(join(v3, "generated/frames/pay-open-close.png"), "V3 payment detail"),
  selfPaid: requireFile(join(v3, "generated/frames/self-paid-close.png"), "V3 sponsor detail"),
  sponsored: requireFile(join(v3, "generated/frames/sponsored-close.png"), "V3 funding detail"),
  exact: requireFile(join(v3, "generated/frames/exact-close.png"), "V3 settlement detail"),
  stageIncomplete: requireFile(join(v3, "generated/frames/stage-incomplete.png"), "V3 Stage incomplete"),
  stageFinal: requireFile(join(v3, "generated/frames/stage-final-contribution.png"), "V3 Stage final contribution"),
  stageSettled: requireFile(join(v3, "generated/frames/stage-settled.png"), "V3 Stage settled"),
  comparison: requireFile(join(v3, "generated/overlays/outcome-comparison-v3.png"), "V3 outcome comparison"),
  whyMonad: requireFile(join(v3, "generated/overlays/why-monad-v3.png"), "V3 Monad evidence slide"),
  endCard: requireFile(join(v3, "generated/frames/end-card-v3.png"), "V3 direct Bill 2 end card"),
  poster: requireFile(join(v3, "generated/frames/poster-v3.png"), "V3 poster"),
};

const directBillQr = requireFile(
  join(v3, "generated/overlays/direct-bill-2-qr-500.png"),
  "direct Bill 2 QR",
);

const multiwalletSummary = renderSvg(
  "multiwallet-summary",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#091710"/><stop offset="1" stop-color="#28205a"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <text x="88" y="82" fill="#9ee8a6" font-family="Arial, sans-serif" font-size="25" font-weight="800" letter-spacing="3">RPC-VERIFIED MONAD TESTNET REHEARSAL</text>
    <text x="88" y="170" fill="#fff" font-family="Arial, sans-serif" font-size="66" font-weight="800">Three wallets. Both protected outcomes.</text>
    <text x="88" y="224" fill="#c7d3ca" font-family="Arial, sans-serif" font-size="27">Chain 10143 · contract 0xa2fb0B3b…46FAA198 · 31 confirmed contract transactions</text>
    <rect x="88" y="292" width="820" height="540" rx="34" fill="#122b1b" stroke="#72dc7e" stroke-width="4"/>
    <text x="138" y="364" fill="#9ee8a6" font-family="Arial, sans-serif" font-size="25" font-weight="800">BILL 3 · SUCCESS PATH</text>
    <text x="138" y="452" fill="#fff" font-family="Arial, sans-serif" font-size="56" font-weight="800">Settled</text>
    <text x="138" y="518" fill="#d7efda" font-family="Arial, sans-serif" font-size="29">Creator · Alice · Bob</text>
    <text x="138" y="578" fill="#fff" font-family="Arial, sans-serif" font-size="28">Three claims · unanimous approval</text>
    <text x="138" y="630" fill="#fff" font-family="Arial, sans-serif" font-size="28">Exact funding · payee withdrawal</text>
    <text x="138" y="708" fill="#9ee8a6" font-family="Arial, sans-serif" font-size="23" font-weight="700">SETTLE ${shorten(proof.settle.hash)}</text>
    <text x="138" y="756" fill="#9ee8a6" font-family="Arial, sans-serif" font-size="23" font-weight="700">WITHDRAW ${shorten(proof.withdraw.hash)}</text>
    <rect x="1012" y="292" width="820" height="540" rx="34" fill="#302016" stroke="#eca25b" stroke-width="4"/>
    <text x="1062" y="364" fill="#ffc688" font-family="Arial, sans-serif" font-size="25" font-weight="800">BILL 4 · FAILURE PATH</text>
    <text x="1062" y="452" fill="#fff" font-family="Arial, sans-serif" font-size="56" font-weight="800">Cancelled</text>
    <text x="1062" y="518" fill="#ffe2c4" font-family="Arial, sans-serif" font-size="29">Alice and Bob contributed</text>
    <text x="1062" y="578" fill="#fff" font-family="Arial, sans-serif" font-size="28">Venue received nothing</text>
    <text x="1062" y="630" fill="#fff" font-family="Arial, sans-serif" font-size="28">Both original contributors refunded</text>
    <text x="1062" y="708" fill="#ffc688" font-family="Arial, sans-serif" font-size="23" font-weight="700">CANCEL ${shorten(proof.cancel.hash)}</text>
    <text x="1062" y="756" fill="#ffc688" font-family="Arial, sans-serif" font-size="23" font-weight="700">2 × REFUND CLAIMED</text>
    <rect x="88" y="878" width="1744" height="104" rx="25" fill="#171d27" stroke="#6d638d" stroke-width="2"/>
    <text x="132" y="922" fill="#ddd4ff" font-family="Arial, sans-serif" font-size="22" font-weight="800">EVIDENCE BOUNDARY</text>
    <text x="132" y="958" fill="#fff" font-family="Arial, sans-serif" font-size="24">Public transaction and historical eth_call evidence · Testnet MON has no cash value · private keys excluded</text>
  </svg>`,
);

const multiwalletDetail = renderSvg(
  "multiwallet-detail",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b0e16"/><stop offset="1" stop-color="#211846"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <text x="88" y="82" fill="#a993ff" font-family="Arial, sans-serif" font-size="25" font-weight="800" letter-spacing="3">LIVE REHEARSAL · TRANSACTION EVIDENCE</text>
    <text x="88" y="166" fill="#fff" font-family="Arial, sans-serif" font-size="62" font-weight="800">Exact funding, settlement and refunds confirmed.</text>
    <rect x="88" y="240" width="850" height="650" rx="34" fill="#111a19" stroke="#72dc7e" stroke-width="4"/>
    <text x="138" y="308" fill="#9ee8a6" font-family="Arial, sans-serif" font-size="24" font-weight="800">BILL 3 · THREE SIGNERS</text>
    <text x="138" y="382" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">Creator funding</text><text x="138" y="418" fill="#b9c9c0" font-family="Courier, monospace" font-size="20">${shorten(proof.creatorFund.hash, 16, 14)}</text>
    <text x="138" y="478" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">Alice funding</text><text x="138" y="514" fill="#b9c9c0" font-family="Courier, monospace" font-size="20">${shorten(proof.aliceFund.hash, 16, 14)}</text>
    <text x="138" y="574" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">Bob funding</text><text x="138" y="610" fill="#b9c9c0" font-family="Courier, monospace" font-size="20">${shorten(proof.bobFund.hash, 16, 14)}</text>
    <text x="138" y="670" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">BillSettled</text><text x="138" y="706" fill="#9ee8a6" font-family="Courier, monospace" font-size="20">${shorten(proof.settle.hash, 16, 14)}</text>
    <text x="138" y="766" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">ProceedsWithdrawn</text><text x="138" y="802" fill="#9ee8a6" font-family="Courier, monospace" font-size="20">${shorten(proof.withdraw.hash, 16, 14)}</text>
    <rect x="982" y="240" width="850" height="650" rx="34" fill="#241913" stroke="#eca25b" stroke-width="4"/>
    <text x="1032" y="308" fill="#ffc688" font-family="Arial, sans-serif" font-size="24" font-weight="800">BILL 4 · CONTRIBUTOR-OWNED REFUNDS</text>
    <text x="1032" y="382" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">BillCancelled</text><text x="1032" y="418" fill="#ffc688" font-family="Courier, monospace" font-size="20">${shorten(proof.cancel.hash, 16, 14)}</text>
    <text x="1032" y="478" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">Alice RefundClaimed</text><text x="1032" y="514" fill="#d7c3ae" font-family="Courier, monospace" font-size="20">${shorten(proof.aliceRefund.hash, 16, 14)}</text>
    <text x="1032" y="574" fill="#fff" font-family="Arial, sans-serif" font-size="25" font-weight="700">Bob RefundClaimed</text><text x="1032" y="610" fill="#d7c3ae" font-family="Courier, monospace" font-size="20">${shorten(proof.bobRefund.hash, 16, 14)}</text>
    <text x="1032" y="686" fill="#ffc688" font-family="Arial, sans-serif" font-size="24" font-weight="800">INCOMPLETE SETTLEMENT REFUSED</text>
    <text x="1032" y="730" fill="#fff" font-family="Arial, sans-serif" font-size="23">Historical eth_call · block 51,738,556</text>
    <text x="1032" y="770" fill="#fff" font-family="Arial, sans-serif" font-size="23">BillNotFullyFunded · selector 0x487ec984</text>
    <text x="1032" y="810" fill="#fff" font-family="Arial, sans-serif" font-size="23">0.001125 funded · 0.003375 MON due</text>
    <text x="88" y="960" fill="#b4b7c3" font-family="Arial, sans-serif" font-size="23">Source: docs/submission/monad-testnet-multiwallet-evidence.json · 31 contract transactions · chain 10143</text>
    <text x="1832" y="960" text-anchor="end" fill="#b4b7c3" font-family="Arial, sans-serif" font-size="23">Testnet MON has no cash value</text>
  </svg>`,
);

const endCardBase = renderSvg(
  "end-card-v4-base",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0c0f17"/><stop offset=".62" stop-color="#18162b"/><stop offset="1" stop-color="#392778"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <rect x="104" y="76" width="76" height="76" rx="19" fill="#6d45ff"/><text x="142" y="131" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="44" font-weight="800">T</text>
    <text x="205" y="130" fill="#fff" font-family="Arial, sans-serif" font-size="34" font-weight="800">TapTab · Monad Testnet</text>
    <text x="104" y="270" fill="#fff" font-family="Arial, sans-serif" font-size="78" font-weight="800">Scan to open live Bill 2.</text>
    <text x="108" y="338" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="31">£48.50 reference value · direct contract-and-bill route</text>
    <rect x="104" y="402" width="1086" height="336" rx="34" fill="#fff" fill-opacity=".09" stroke="#8b73ff" stroke-width="4"/>
    <text x="154" y="474" fill="#a993ff" font-family="Arial, sans-serif" font-size="23" font-weight="800">LIVE BILL 2 · CHAIN 10143</text>
    <text x="154" y="552" fill="#fff" font-family="Arial, sans-serif" font-size="38" font-weight="800">0xa2fb0B3b…46FAA198</text>
    <text x="154" y="614" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="29" font-weight="800">CONFIRMED · SOURCE VERIFIED · PUBLICLY READABLE</text>
    <text x="154" y="674" fill="#fff" font-family="Arial, sans-serif" font-size="28" font-weight="700">taptab.mythicmindlabs.workers.dev · Bill 2</text>
    <rect x="1280" y="160" width="560" height="650" rx="34" fill="#fff"/><text x="1560" y="768" text-anchor="middle" fill="#0c0f17" font-family="Arial, sans-serif" font-size="28" font-weight="800">OPEN LIVE BILL 2</text>
    <rect x="104" y="806" width="1736" height="154" rx="26" fill="#10251a" stroke="#72dc7e" stroke-width="3"/>
    <text x="148" y="850" fill="#9ee8a6" font-family="Arial, sans-serif" font-size="19" font-weight="800">MULTI-WALLET TESTNET REHEARSAL VERIFIED · BILLS 3 + 4 · 31 CONTRACT TRANSACTIONS</text>
    <text x="148" y="892" fill="#fff" font-family="Arial, sans-serif" font-size="23">Bill 3: three wallets, exact funding, settlement and withdrawal · Bill 4: cancellation and both refunds</text>
    <text x="148" y="930" fill="#c8d5ca" font-family="Arial, sans-serif" font-size="21">RPC and explorer-linked evidence · Testnet MON has no cash value · private keys excluded</text>
  </svg>`,
);
const endCardV4 = overlayFrame("end-card-v4", endCardBase, directBillQr, 1310, 196);

const pointer = renderSvg(
  "pointer-v4",
  `<svg xmlns="http://www.w3.org/2000/svg" width="82" height="98" viewBox="0 0 82 98"><defs><filter id="s"><feDropShadow dx="3" dy="4" stdDeviation="4" flood-opacity=".65"/></filter></defs><path d="M8 7 33 68 45 48 68 70 78 57 54 36 73 29Z" fill="#fff" stroke="#0c0f17" stroke-width="5" stroke-linejoin="round" filter="url(#s)"/></svg>`,
);
const clickRing = renderSvg(
  "click-ring-v4",
  `<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130" viewBox="0 0 130 130"><circle cx="65" cy="65" r="47" fill="#6d45ff" fill-opacity=".18" stroke="#a993ff" stroke-width="6"/><circle cx="65" cy="65" r="18" fill="none" stroke="#fff" stroke-width="4"/></svg>`,
);

const frames = {
  heroHook: makeFillFrame("hero-hook", v3Frames.hook),
  receipt: makeBrowserFrame("receipt-full-window", screens.receipt, "LOCAL SAMPLE · CLAIM"),
  claim: makeBrowserFrame("claim-full-window", screens.claim, "LOCAL SAMPLE · SHARED ITEMS"),
  remainderOff: makeBrowserFrame("remainder-off-full-window", screens.remainderOff, "LOCAL SAMPLE · FAIR REMAINDER"),
  remainderOn: makeBrowserFrame("remainder-on-full-window", screens.remainderOn, "LOCAL SAMPLE · FAIR REMAINDER"),
  tip: makeBrowserFrame("tip-full-window", screens.tip, "LOCAL SAMPLE · TIP VOTE"),
  review: makeBrowserFrame("review-full-window", screens.review, "LOCAL SAMPLE · REVIEW"),
  approved: makeBrowserFrame("approved-full-window", screens.approved, "LOCAL SAMPLE · APPROVED"),
  payOpen: makeBrowserFrame("pay-open-full-window", screens.payOpen, "LOCAL SAMPLE · PROTECTED PAYMENT"),
  selfPaid: makeBrowserFrame("self-paid-full-window", screens.selfPaid, "LOCAL SAMPLE · SELF PAYMENT"),
  sponsored: makeBrowserFrame("sponsored-full-window", screens.sponsored, "LOCAL SAMPLE · SPONSOR"),
  exact: makeBrowserFrame("exact-full-window", screens.exact, "LOCAL SAMPLE · EXACTLY FUNDED"),
  settled: makeBrowserFrame("settled-full-window", screens.settled, "LOCAL SAMPLE · SETTLED"),
  refundReady: makeBrowserFrame("refund-ready-full-window", screens.refundReady, "LOCAL SAMPLE · REFUNDS OPEN"),
  refundReturned: makeBrowserFrame("refund-returned-full-window", screens.refundReturned, "LOCAL SAMPLE · REFUNDS RETURNED"),
  stageIncomplete: makeFillFrame("stage-incomplete", v3Frames.stageIncomplete),
  stageFinal: makeFillFrame("stage-final-contribution", v3Frames.stageFinal),
  stageSettled: makeFillFrame("stage-settled", v3Frames.stageSettled),
  comparison: makeFillFrame("outcome-comparison", v3Frames.comparison),
  liveBill: makeBrowserFrame(
    "live-bill-2-full-window",
    screens.liveBill,
    "LIVE MONAD TESTNET · BILL 2",
    "taptab.mythicmindlabs.workers.dev · canonical Bill 2",
  ),
  billTransaction: makeFillFrame("bill-2-transaction-evidence", screens.billTransaction),
  multiwalletSummary: makeFillFrame("multiwallet-summary", multiwalletSummary),
  multiwalletDetail: makeFillFrame("multiwallet-detail", multiwalletDetail),
  endCard: makeFillFrame("end-card", endCardV4),
};

frames.receiptAction = makeActionInset("receipt-action", frames.receipt, v3Frames.receipt, "CLAIM SHARE");
frames.remainderOffAction = makeActionInset("remainder-opt-in-action", frames.remainderOff, v3Frames.remainderOff, "OPT IN");
frames.remainderOnAction = makeActionInset("continue-to-tip-action", frames.remainderOn, v3Frames.remainderOn, "CONTINUE");
frames.reviewAction = makeActionInset("approve-action", frames.review, v3Frames.review, "APPROVE");
frames.payOpenAction = makeActionInset("self-payment-action", frames.payOpen, v3Frames.payOpen, "PAY SHARE");
frames.selfPaidAction = makeActionInset("sponsor-action", frames.selfPaid, v3Frames.selfPaid, "SPONSOR");
frames.sponsoredAction = makeActionInset("complete-funding-action", frames.sponsored, v3Frames.sponsored, "FUND EXACTLY");
frames.exactAction = makeActionInset("settle-action", frames.exact, v3Frames.exact, "SETTLE");

const visualSegments = [
  [0, 5, "heroHook"],
  [5, 8.55, "receipt"],
  [8.55, 9.5, "receiptAction", { to: [1718, 296], clickAt: 0.69 }],
  [9.5, 13.7, "claim"],
  [13.7, 16, "claim"],
  [16, 21, "claim"],
  [21, 22.65, "remainderOff"],
  [22.65, 23.5, "remainderOffAction", { to: [1698, 297], clickAt: 0.61 }],
  [23.5, 26, "remainderOn"],
  [26, 27.65, "remainderOn"],
  [27.65, 28.5, "remainderOnAction", { to: [1690, 292], clickAt: 0.61 }],
  [28.5, 31, "tip"],
  [31, 32.45, "review"],
  [32.45, 33.3, "reviewAction", { to: [1670, 305], clickAt: 0.61 }],
  [33.3, 35, "approved"],
  [35, 37.15, "payOpen"],
  [37.15, 38, "payOpenAction", { to: [1668, 329], clickAt: 0.61 }],
  [38, 42, "selfPaid"],
  [42, 44.15, "selfPaid"],
  [44.15, 45, "selfPaidAction", { to: [1678, 300], clickAt: 0.61 }],
  [45, 49, "sponsored"],
  [49, 51.15, "sponsored"],
  [51.15, 52, "sponsoredAction", { to: [1674, 329], clickAt: 0.61 }],
  [52, 54.15, "exact"],
  [54.15, 55, "exactAction", { to: [1718, 302], clickAt: 0.61 }],
  [55, 57, "settled"],
  [57, 58.4, "stageIncomplete"],
  [58.4, 60.2, "stageFinal"],
  [60.2, 62, "stageSettled"],
  [62, 65, "settled"],
  [65, 70, "settled"],
  [70, 72.5, "refundReady"],
  [72.5, 75, "refundReturned"],
  [75, 83, "comparison"],
  [83, 89, "liveBill"],
  [89, 95, "billTransaction"],
  [95, 99, "multiwalletSummary"],
  [99, 105, "multiwalletDetail"],
  [105, 117, "endCard"],
];

for (let index = 0; index < visualSegments.length; index += 1) {
  const previousEnd = index === 0 ? 0 : visualSegments[index - 1][1];
  if (visualSegments[index][0] !== previousEnd || visualSegments[index][1] <= visualSegments[index][0]) {
    throw new Error(`Invalid V4 visual timeline at segment ${index + 1}`);
  }
}
if (visualSegments.at(-1)[1] !== DURATION) throw new Error("V4 timeline must end at 117 seconds");

function encodeStaticSegments(segments, destination, options = {}) {
  const files = [];
  for (let index = 0; index < segments.length; index += 1) {
    const [start, end, frameKey, action] = segments[index];
    const frame = typeof frameKey === "string" ? frames[frameKey] : frameKey;
    const count = Math.round((end - start) * FPS);
    const output = join(segmentDir, `${options.prefix ?? "master"}-${String(index + 1).padStart(2, "0")}.mp4`);
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-i",
      frame,
    ];
    let filter = `[0:v]scale=${WIDTH}:${HEIGHT},setsar=1[base]`;
    let label = "base";
    if (action) {
      const [targetX, targetY] = action.to;
      const travelEnd = Math.max(action.clickAt - 0.15, 0.3);
      args.push("-loop", "1", "-framerate", String(FPS), "-i", pointer);
      args.push("-loop", "1", "-framerate", String(FPS), "-i", clickRing);
      filter +=
        `;[base][1:v]overlay=x='1460+(${targetX - 1460})*min(max(t/${travelEnd},0),1)':` +
        `y='100+(${targetY - 100})*min(max(t/${travelEnd},0),1)':eof_action=repeat:` +
        `enable='between(t,0,${action.clickAt + 0.16})'[pointed]` +
        `;[pointed][2:v]overlay=${targetX - 65}:${targetY - 65}:eof_action=repeat:` +
        `enable='between(t,${action.clickAt - 0.10},${action.clickAt + 0.12})'[clicked]`;
      label = "clicked";
    }
    args.push(
      "-filter_complex",
      filter,
      "-map",
      `[${label}]`,
      "-frames:v",
      String(count),
      "-r",
      String(FPS),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      "-an",
      output,
    );
    run("ffmpeg", args);
    files.push(output);
  }
  const concatFile = join(generated, `${options.prefix ?? "master"}.ffconcat`);
  writeFileSync(concatFile, ["ffconcat version 1.0", ...files.map((file) => `file '${file}'`)].join("\n") + "\n");
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFile,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    destination,
  ]);
  return { files, concatFile };
}

const visualsOnly = join(generated, "visuals-only.mp4");
const masterSegments = encodeStaticSegments(visualSegments, visualsOnly, { prefix: "master" });

const captions = JSON.parse(readFileSync(audio.captions, "utf8"));
if (!Array.isArray(captions) || captions.length !== 31) throw new Error("Expected the verified 31-cue narration source");
for (const [index, cue] of captions.entries()) {
  if (
    typeof cue.start !== "number" ||
    typeof cue.end !== "number" ||
    typeof cue.text !== "string" ||
    cue.start < 0 ||
    cue.end <= cue.start ||
    cue.end > DURATION ||
    (index > 0 && cue.start < captions[index - 1].end)
  ) {
    throw new Error(`Invalid or overlapping caption cue ${index + 1}`);
  }
}

function srtTimestamp(seconds) {
  const total = Math.round(seconds * 1000);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

const srt = captions
  .map((cue, index) => `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text.trim()}\n`)
  .join("\n");
const finalSrt = join(videoRoot, "taptab-demo-2min.srt");
writeFileSync(finalSrt, srt);

function wrapCaption(value, maxLength = 56) {
  const words = value.replaceAll(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const proposed = line ? `${line} ${word}` : word;
    if (line && proposed.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = proposed;
    }
  }
  if (line) lines.push(line);
  return lines.length <= 2 ? lines : [lines[0], lines.slice(1).join(" ")];
}

const subtitleInputs = [];
const subtitleFilters = [];
let subtitleLabel = "0:v";
for (let index = 0; index < captions.length; index += 1) {
  const cue = captions[index];
  const lines = wrapCaption(cue.text);
  const text = lines
    .map(
      (line, lineIndex) =>
        `<text x="220" y="${lines.length === 1 ? 968 : 936 + lineIndex * 52}" fill="#fff" font-family="Arial, sans-serif" font-size="40" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join("\n");
  const overlay = renderSvg(
    `caption-${String(index + 1).padStart(2, "0")}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect y="${CAPTION_TOP}" width="1920" height="238" fill="#090c13" fill-opacity=".97"/>
      <rect y="${CAPTION_TOP}" width="1920" height="4" fill="#6d45ff"/>
      <rect x="56" y="900" width="116" height="72" rx="36" fill="#6d45ff"/>
      <text x="114" y="947" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="24" font-weight="800">${String(index + 1).padStart(2, "0")}</text>
      ${text}
    </svg>`,
    subtitleDir,
  );
  subtitleInputs.push("-loop", "1", "-framerate", String(FPS), "-i", overlay);
  const next = `sub${index}`;
  subtitleFilters.push(`[${subtitleLabel}][${index + 1}:v]overlay=0:0:eof_action=repeat:enable='between(t,${cue.start},${cue.end})'[${next}]`);
  subtitleLabel = next;
}

const captionedVideo = join(generated, "captioned.mp4");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  visualsOnly,
  ...subtitleInputs,
  "-filter_complex",
  subtitleFilters.join(";"),
  "-map",
  `[${subtitleLabel}]`,
  "-frames:v",
  String(DURATION * FPS),
  "-r",
  String(FPS),
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-an",
  captionedVideo,
]);

const masteredAudio = join(generated, "mastered-audio.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  audio.narration,
  "-i",
  audio.music,
  "-i",
  audio.sfx,
  "-filter_complex",
  `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${DURATION},atrim=0:${DURATION}[n];` +
    `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${DURATION},atrim=0:${DURATION}[m];` +
    `[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${DURATION},atrim=0:${DURATION}[s];` +
    `[n][m][s]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${DURATION},atrim=0:${DURATION}[master]`,
  "-map",
  "[master]",
  "-ar",
  "48000",
  "-c:a",
  "pcm_s24le",
  masteredAudio,
]);

const finalVideo = join(videoRoot, "taptab-demo-2min.mp4");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  captionedVideo,
  "-i",
  masteredAudio,
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-t",
  String(DURATION),
  "-movflags",
  "+faststart",
  finalVideo,
]);

const poster = join(videoRoot, "poster.jpg");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  v3Frames.poster,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  poster,
]);

function makeTeaserCard(name, background, eyebrow, headline) {
  const overlay = renderSvg(
    `${name}-copy`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs><filter id="s" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-opacity=".6"/></filter></defs>
      <rect x="74" y="86" width="920" height="202" rx="30" fill="#0d111b" fill-opacity=".96" stroke="#8b73ff" stroke-width="4" filter="url(#s)"/>
      <text x="122" y="150" fill="#a993ff" font-family="Arial, sans-serif" font-size="24" font-weight="800" letter-spacing="2">${escapeXml(eyebrow)}</text>
      <text x="122" y="236" fill="#fff" font-family="Arial, sans-serif" font-size="54" font-weight="800">${escapeXml(headline)}</text>
    </svg>`,
    teaserDir,
  );
  return overlayFrame(name, background, overlay, 0, 0, teaserDir);
}

const teaserFrames = {
  hook: frames.heroHook,
  receipt: makeTeaserCard("teaser-receipt", frames.receipt, "ONE TABLE · ONE SHARED STATE", "Claim only what you had."),
  claim: makeTeaserCard("teaser-claim", frames.claim, "WHOLE AND SHARED ITEMS", "Split wine, starters and taxis."),
  outcome: makeTeaserCard("teaser-outcome", frames.comparison, "SMART-CONTRACT PROTECTION", "Settle exactly — or refund safely."),
  cta: frames.endCard,
};
const teaserSegments = [
  [0, 3, teaserFrames.hook],
  [3, 6, teaserFrames.receipt],
  [6, 9, teaserFrames.claim],
  [9, 12, teaserFrames.outcome],
  [12, 15, teaserFrames.cta],
];
const teaserVisuals = join(teaserDir, "teaser-visuals.mp4");
const teaserSegmentFiles = [];
for (let index = 0; index < teaserSegments.length; index += 1) {
  const [start, end, frame] = teaserSegments[index];
  const output = join(segmentDir, `teaser-${String(index + 1).padStart(2, "0")}.mp4`);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-i",
    frame,
    "-frames:v",
    String(Math.round((end - start) * FPS)),
    "-r",
    String(FPS),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-an",
    output,
  ]);
  teaserSegmentFiles.push(output);
}
const teaserConcat = join(teaserDir, "teaser.ffconcat");
writeFileSync(teaserConcat, ["ffconcat version 1.0", ...teaserSegmentFiles.map((file) => `file '${file}'`)].join("\n") + "\n");
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", teaserConcat, "-c", "copy", teaserVisuals]);
const teaser = join(teaserDir, "taptab-teaser-15s.mp4");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  teaserVisuals,
  "-i",
  audio.narration,
  "-i",
  audio.music,
  "-i",
  audio.sfx,
  "-filter_complex",
  `[1:a]atrim=0:4.25,afade=t=out:st=3.8:d=0.45,apad=whole_dur=15,atrim=0:15[n];` +
    `[2:a]atrim=0:15,afade=t=out:st=13:d=2[m];` +
    `[3:a]atrim=0:15[s];[n][m][s]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,` +
    `acompressor=threshold=0.08:ratio=4:attack=20:release=250:makeup=3,` +
    `loudnorm=I=-16:TP=-1.5:LRA=7,volume=3dB,atrim=0:15[a]`,
  "-map",
  "0:v:0",
  "-map",
  "[a]",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-t",
  "15",
  "-movflags",
  "+faststart",
  teaser,
]);

function evidenceDataSlide(index, eyebrow, heading, subheading, leftTitle, leftLines, rightTitle, rightLines, footer) {
  return renderSvg(
    `evidence-${String(index).padStart(2, "0")}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#08140e"/><stop offset="1" stop-color="#251d52"/></linearGradient></defs>
      <rect width="1920" height="1080" fill="url(#bg)"/>
      <rect x="56" y="38" width="1808" height="74" rx="22" fill="#12351f" stroke="#72dc7e" stroke-width="3"/>
      <text x="960" y="86" text-anchor="middle" fill="#b9f4bf" font-family="Arial, sans-serif" font-size="25" font-weight="800">PUBLIC MONAD TESTNET EVIDENCE · TESTNET MON HAS NO CASH VALUE · PRIVATE KEYS EXCLUDED</text>
      <text x="88" y="184" fill="#a993ff" font-family="Arial, sans-serif" font-size="24" font-weight="800" letter-spacing="2">${escapeXml(eyebrow)} · RECORD ${String(index).padStart(2, "0")}</text>
      <text x="88" y="272" fill="#fff" font-family="Arial, sans-serif" font-size="62" font-weight="800">${escapeXml(heading)}</text>
      <text x="88" y="326" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="27">${escapeXml(subheading)}</text>
      <rect x="88" y="386" width="836" height="486" rx="32" fill="#fff" fill-opacity=".07" stroke="#72dc7e" stroke-width="3"/>
      <text x="136" y="452" fill="#9ee8a6" font-family="Arial, sans-serif" font-size="24" font-weight="800">${escapeXml(leftTitle)}</text>
      ${leftLines.map((line, lineIndex) => `<circle cx="148" cy="${516 + lineIndex * 67}" r="9" fill="#72dc7e"/><text x="176" y="${525 + lineIndex * 67}" fill="#fff" font-family="Arial, sans-serif" font-size="24">${escapeXml(line)}</text>`).join("\n")}
      <rect x="996" y="386" width="836" height="486" rx="32" fill="#fff" fill-opacity=".07" stroke="#a993ff" stroke-width="3"/>
      <text x="1044" y="452" fill="#cfc4ff" font-family="Arial, sans-serif" font-size="24" font-weight="800">${escapeXml(rightTitle)}</text>
      ${rightLines.map((line, lineIndex) => `<circle cx="1056" cy="${516 + lineIndex * 67}" r="9" fill="#8b73ff"/><text x="1084" y="${525 + lineIndex * 67}" fill="#fff" font-family="Arial, sans-serif" font-size="24">${escapeXml(line)}</text>`).join("\n")}
      <rect x="88" y="912" width="1744" height="96" rx="24" fill="#111722" stroke="#514a6d" stroke-width="2"/>
      <text x="132" y="970" fill="#c7c9d1" font-family="Arial, sans-serif" font-size="21">${escapeXml(footer)}</text>
    </svg>`,
    evidenceDir,
  );
}

const evidenceFrames = [
  evidenceDataSlide(1, "REHEARSAL OVERVIEW", "Three wallets completed both contract paths.", "Bills 3 and 4 · chain 10143 · 31 confirmed contract transactions", "SUCCESS PATH", ["Bill 3 final state: Settled", "Creator, Alice and Bob signed", "Three item claims and approvals", "Exact funding and withdrawal"], "PROTECTED FAILURE PATH", ["Bill 4 final state: Cancelled", "Alice and Bob contributed", "Venue received nothing", "Both RefundClaimed events confirmed"], `Contract ${shorten(evidence.contract.address, 14, 12)} · final observed block ${evidence.chain.finalBlock}`),
  evidenceDataSlide(2, "BILL 3 · AGREEMENT", "Creation, claims and unanimous approval were signed onchain.", "Every displayed hash links to the sealed public rehearsal record", "BILL CREATED", [`Block ${proof.bill3Create.blockNumber}`, shorten(proof.bill3Create.hash, 18, 16), "Three participants invited", "Three deterministic shares claimed"], "UNANIMOUS APPROVAL", ["Creator approved the final digest", "Alice approved the same version", "Bob approved the same version", "Funding opened after consent"], `CreateBill ${proof.bill3Create.hash}`),
  evidenceDataSlide(3, "BILL 3 · PAYMENT PROTECTION", "Incomplete settlement was refused before exact funding.", "The historical call preserves the failed-state evidence without broadcasting a transaction", "INCOMPLETE SETTLEMENT REFUSAL", ["Historical eth_call at block 51,738,556", "BillNotFullyFunded · 0x487ec984", "0.001125 MON funded", "0.003375 MON due"], "EXACT PARTICIPANT FUNDING", [`Creator ${shorten(proof.creatorFund.hash, 14, 12)}`, `Alice ${shorten(proof.aliceFund.hash, 14, 12)}`, `Bob ${shorten(proof.bobFund.hash, 14, 12)}`, "0.001125 Testnet MON each"], `Revert data and all contribution receipts are stored in ${evidenceFile.slice(root.length + 1)}`),
  evidenceDataSlide(4, "BILL 3 · SUCCESS", "Exact funding unlocked settlement and payee withdrawal.", "Two final receipts prove the successful branch", "BILL SETTLED", [`Block ${proof.settle.blockNumber}`, shorten(proof.settle.hash, 18, 16), "BillSettled event confirmed", "Final state: Settled"], "PROCEEDS WITHDRAWN", [`Block ${proof.withdraw.blockNumber}`, shorten(proof.withdraw.hash, 18, 16), "ProceedsWithdrawn confirmed", "Payee withdrawal completed"], `Settlement ${proof.settle.hash} · withdrawal ${proof.withdraw.hash}`),
  evidenceDataSlide(5, "BILL 4 · REFUND PROTECTION", "Cancellation returned funds only to the original contributors.", "Two independent RefundClaimed transactions complete the failure branch", "BILL CANCELLED", [`Block ${proof.cancel.blockNumber}`, shorten(proof.cancel.hash, 18, 16), "Alice and Bob had contributed", "Venue received nothing"], "REFUNDS CLAIMED", [`Alice ${shorten(proof.aliceRefund.hash, 14, 12)}`, `Bob ${shorten(proof.bobRefund.hash, 14, 12)}`, "Both original contributors refunded", "Final state: Cancelled"], `Cancel ${proof.cancel.hash}`),
  evidenceDataSlide(6, "EVIDENCE PROVENANCE", "The record is public, reproducible and contains no private keys.", "Use the sealed JSON to inspect every block, event, signer and explorer link", "SEALED SOURCE", [evidenceFile.slice(root.length + 1), `SHA-256 ${createHash("sha256").update(readFileSync(evidenceFile)).digest("hex").slice(0, 32)}…`, "31 contract transactions", "Historical failure call included"], "BOUNDARY", ["Monad Testnet · chain 10143", "Testnet MON has no cash value", "Wallet addresses are public", "Private keys are excluded"], `Generated ${evidence.generatedAt} · contract ${evidence.contract.address}`),
];
const evidenceDurations = [4, 5, 6, 5, 7, 3];
const evidenceSegmentFiles = [];
for (let index = 0; index < evidenceFrames.length; index += 1) {
  const output = join(segmentDir, `evidence-${String(index + 1).padStart(2, "0")}.mp4`);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", String(FPS), "-i", evidenceFrames[index], "-frames:v", String(evidenceDurations[index] * FPS), "-r", String(FPS), "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", output]);
  evidenceSegmentFiles.push(output);
}
const evidenceConcat = join(evidenceDir, "evidence.ffconcat");
writeFileSync(evidenceConcat, ["ffconcat version 1.0", ...evidenceSegmentFiles.map((file) => `file '${file}'`)].join("\n") + "\n");
const evidenceVideo = join(evidenceDir, "taptab-multiwallet-evidence-30s.mp4");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  evidenceConcat,
  "-i",
  audio.music,
  "-filter_complex",
  "[1:a]atrim=0:30,afade=t=out:st=28:d=2,volume=5.6,apad=whole_dur=30[a]",
  "-map",
  "0:v:0",
  "-map",
  "[a]",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "160k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-t",
  "30",
  "-movflags",
  "+faststart",
  evidenceVideo,
]);

function probe(file, output, expectedDuration, expectedFrames) {
  const report = run("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,pix_fmt,nb_read_frames",
    "-of",
    "json",
    file,
  ]);
  writeFileSync(output, `${report}\n`);
  const parsed = JSON.parse(report);
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  const audioStream = parsed.streams.find((stream) => stream.codec_type === "audio");
  if (
    parsed.format.duration !== expectedDuration ||
    video?.codec_name !== "h264" ||
    video?.width !== WIDTH ||
    video?.height !== HEIGHT ||
    video?.r_frame_rate !== "30/1" ||
    video?.pix_fmt !== "yuv420p" ||
    video?.nb_read_frames !== String(expectedFrames) ||
    audioStream?.codec_name !== "aac" ||
    audioStream?.sample_rate !== "48000" ||
    audioStream?.channels !== 2
  ) {
    throw new Error(`Technical verification failed for ${file}:\n${report}`);
  }
  run("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
  return parsed;
}

const masterProbe = probe(finalVideo, join(reviewDir, "ffprobe-v4.json"), "117.000000", 3510);
const teaserProbe = probe(teaser, join(teaserDir, "ffprobe-teaser.json"), "15.000000", 450);
const evidenceProbe = probe(evidenceVideo, join(evidenceDir, "ffprobe-evidence.json"), "30.000000", 900);
writeFileSync(join(reviewDir, "decode-v4.txt"), "PASS · FFmpeg decoded every video and audio stream without errors.\n");

function loudness(file, output) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(`Loudness analysis failed for ${file}\n${result.stderr ?? ""}`);
  writeFileSync(output, `${result.stderr ?? ""}\n`);
}
loudness(finalVideo, join(reviewDir, "loudness-v4.txt"));
loudness(teaser, join(teaserDir, "loudness-teaser.txt"));
loudness(evidenceVideo, join(evidenceDir, "loudness-evidence.txt"));

function loudnessMetrics(file) {
  const report = readFileSync(file, "utf8");
  const metric = (key) => {
    const match = report.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (!match) throw new Error(`Missing ${key} in ${file}`);
    return Number(match[1]);
  };
  return { integratedLufs: metric("input_i"), truePeakDbtp: metric("input_tp"), lra: metric("input_lra") };
}
const masterLoudness = loudnessMetrics(join(reviewDir, "loudness-v4.txt"));
const teaserLoudness = loudnessMetrics(join(teaserDir, "loudness-teaser.txt"));
const evidenceLoudness = loudnessMetrics(join(evidenceDir, "loudness-evidence.txt"));

const reviewTimes = [2.5, 6.5, 9.05, 11.5, 17.5, 22, 23.1, 25, 28.05, 29.5, 31.8, 32.9, 34, 36, 37.6, 39.5, 44.6, 47, 51.6, 53.2, 54.6, 57.7, 59.2, 61.2, 66.5, 71, 74, 78, 85, 91, 96, 102, 108, 114.5];
for (const time of reviewTimes) {
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(time), "-i", finalVideo, "-frames:v", "1", "-q:v", "2", join(reviewDir, `frame-${String(time).replace(".", "-")}.jpg`)]);
}
const sheetTimes = [2.5, 6.5, 11.5, 17.5, 25, 29.5, 34, 39.5, 47, 53.2, 57.7, 61.2, 66.5, 74, 78, 85, 91, 96, 102, 114.5];
const sheetSelect = sheetTimes.map((time) => `eq(n,${Math.round(time * FPS)})`).join("+");
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", finalVideo, "-vf", `select='${sheetSelect}',setpts=N/FRAME_RATE/TB,scale=384:216,tile=5x4`, "-frames:v", "1", "-q:v", "2", join(reviewDir, "contact-sheet-v4.jpg")]);
const actionTimes = [8.65, 9.16, 9.65, 22.72, 23.25, 23.7, 27.72, 28.26, 28.7, 32.52, 33.05, 33.5, 37.22, 37.75, 38.2, 44.22, 44.75, 45.2, 51.22, 51.75, 52.2, 54.22, 54.75, 55.2];
const actionSelect = actionTimes.map((time) => `eq(n,${Math.round(time * FPS)})`).join("+");
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", finalVideo, "-vf", `select='${actionSelect}',setpts=N/FRAME_RATE/TB,scale=320:180,tile=6x4`, "-frames:v", "1", "-q:v", "2", join(reviewDir, "action-continuity-v4.jpg")]);
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "14.5", "-i", teaser, "-frames:v", "1", "-q:v", "2", join(teaserDir, "frame-14-5.jpg")]);
const evidenceSheetSelect = [60, 180, 360, 510, 690, 855].map((frame) => `eq(n,${frame})`).join("+");
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", evidenceVideo, "-vf", `select='${evidenceSheetSelect}',setpts=N/FRAME_RATE/TB,scale=640:360,tile=3x2`, "-frames:v", "1", "-q:v", "2", join(evidenceDir, "contact-sheet-evidence.jpg")]);
const teaserSheetSelect = [45, 135, 225, 315, 405].map((frame) => `eq(n,${frame})`).join("+");
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", teaser, "-vf", `select='${teaserSheetSelect}',setpts=N/FRAME_RATE/TB,scale=480:270,tile=5x1`, "-frames:v", "1", "-q:v", "2", join(teaserDir, "contact-sheet-teaser.jpg")]);

const qrDecoder = requireFile(join(work, "decode-qr.swift"), "V4 QR decoder");
const masterQrPayload = run("swift", [qrDecoder, join(reviewDir, "frame-114-5.jpg")]);
const teaserQrPayload = run("swift", [qrDecoder, join(teaserDir, "frame-14-5.jpg")]);
if (masterQrPayload !== directBillUrl || teaserQrPayload !== directBillUrl) {
  throw new Error(`Compressed-video QR verification failed\nmaster: ${masterQrPayload}\nteaser: ${teaserQrPayload}`);
}
writeFileSync(join(reviewDir, "qr-decode-master.txt"), `${masterQrPayload}\n`);
writeFileSync(join(teaserDir, "qr-decode-teaser.txt"), `${teaserQrPayload}\n`);

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const checksumSets = [
  [join(reviewDir, "SHA256SUMS.txt"), [finalVideo, finalSrt, poster]],
  [join(teaserDir, "SHA256SUMS.txt"), [teaser]],
  [join(evidenceDir, "SHA256SUMS.txt"), [evidenceVideo, evidenceFile]],
];
for (const [destination, files] of checksumSets) {
  writeFileSync(destination, files.map((file) => `${sha256(file)}  ${file.slice(root.length + 1)}`).join("\n") + "\n");
}

const fullWindowSeconds = visualSegments
  .filter((segment) => ["receipt", "claim", "remainderOff", "remainderOn", "tip", "review", "approved", "payOpen", "selfPaid", "sponsored", "exact", "settled", "refundReady", "refundReturned", "liveBill"].includes(segment[2]))
  .reduce((total, segment) => total + segment[1] - segment[0], 0);
const insetSeconds = visualSegments
  .filter((segment) => String(segment[2]).endsWith("Action"))
  .reduce((total, segment) => total + segment[1] - segment[0], 0);

const release = {
  generatedAt: new Date().toISOString(),
  composition: {
    default: "Complete application viewport inside a visible browser window",
    fullWindowSeconds: Number(fullWindowSeconds.toFixed(3)),
    actionInsetSeconds: Number(insetSeconds.toFixed(3)),
    actionInsetCount: visualSegments.filter((segment) => String(segment[2]).endsWith("Action")).length,
    note: "Action details appear as brief insets; the full application window remains visible underneath.",
  },
  master: {
    path: finalVideo.slice(root.length + 1),
    bytes: statSync(finalVideo).size,
    sha256: sha256(finalVideo),
    durationSeconds: Number(masterProbe.format.duration),
    frames: 3510,
    loudness: masterLoudness,
  },
  subtitles: {
    path: finalSrt.slice(root.length + 1),
    bytes: statSync(finalSrt).size,
    sha256: sha256(finalSrt),
    cues: captions.length,
    lastCueEnd: captions.at(-1).end,
  },
  poster: {
    path: poster.slice(root.length + 1),
    bytes: statSync(poster).size,
    sha256: sha256(poster),
  },
  teaser: {
    path: teaser.slice(root.length + 1),
    bytes: statSync(teaser).size,
    sha256: sha256(teaser),
    durationSeconds: Number(teaserProbe.format.duration),
    frames: 450,
    loudness: teaserLoudness,
  },
  multiwalletEvidence: {
    path: evidenceVideo.slice(root.length + 1),
    bytes: statSync(evidenceVideo).size,
    sha256: sha256(evidenceVideo),
    durationSeconds: Number(evidenceProbe.format.duration),
    frames: 900,
    loudness: evidenceLoudness,
    sourcePath: evidenceFile.slice(root.length + 1),
    sourceSha256: sha256(evidenceFile),
    transactionCount: evidence.transactions.length,
    successBill: evidence.journeys.settlement.billId,
    successFinalState: evidence.journeys.settlement.finalState,
    refundBill: evidence.journeys.cancellationRefund.billId,
    refundFinalState: evidence.journeys.cancellationRefund.finalState,
    boundary: evidence.boundary,
  },
  directBillUrl,
};
writeFileSync(join(reviewDir, "release-v4.json"), `${JSON.stringify(release, null, 2)}\n`);

writeFileSync(
  join(reviewDir, "QA_SUMMARY.md"),
  `# TapTab V4 video QA summary

## Definitive master

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| \`taptab-demo-2min.mp4\` | ${release.master.bytes.toLocaleString("en-GB")} | \`${release.master.sha256}\` |
| \`taptab-demo-2min.srt\` | ${release.subtitles.bytes.toLocaleString("en-GB")} | \`${release.subtitles.sha256}\` |
| \`poster.jpg\` | ${release.poster.bytes.toLocaleString("en-GB")} | \`${release.poster.sha256}\` |

## Technical verification

- Duration: exactly ${release.master.durationSeconds.toFixed(3)} seconds.
- Video: H.264, 1920×1080, yuv420p, 30 fps, exactly ${release.master.frames.toLocaleString("en-GB")} decoded frames.
- Audio: AAC, stereo, 48 kHz; ${release.master.loudness.integratedLufs.toFixed(2)} LUFS-I and ${release.master.loudness.truePeakDbtp.toFixed(2)} dBTP after decoding.
- Captions: ${release.subtitles.cues} ordered, non-overlapping cues; the last cue ends at ${release.subtitles.lastCueEnd.toFixed(3)} seconds, leaving a ${(DURATION - release.subtitles.lastCueEnd).toFixed(3)}-second speech-free, music-backed QR hold.
- FFmpeg decoded every master, teaser and evidence-cut stream without error.

## Full-window composition

- The complete application viewport is shown inside a visible browser window for ${release.composition.fullWindowSeconds.toFixed(1)} seconds.
- ${release.composition.actionInsetCount} action details total ${release.composition.actionInsetSeconds.toFixed(1)} seconds. Each appears as a short inset while the full application window remains visible underneath.
- Stage Mode, successful settlement and refund outcomes remain intentionally full-screen because those are presentation surfaces, not crop zooms.
- \`contact-sheet-v4.jpg\` covers the complete story and \`action-continuity-v4.jpg\` covers each before/action/after sequence.

## Genuine Testnet evidence

- The master shows canonical Bill 2 and its confirmed creation transaction.
- Bill 3 was completed by three distinct wallets and reached \`Settled\` after exact funding; proceeds were withdrawn.
- Bill 4 reached \`Cancelled\`; Alice and Bob each confirmed \`RefundClaimed\`.
- A historical \`eth_call\` at block 51,738,556 decoded \`BillNotFullyFunded\`, with 0.001125 Testnet MON funded and 0.003375 due.
- The sealed record contains ${release.multiwalletEvidence.transactionCount} contract transactions and has SHA-256 \`${release.multiwalletEvidence.sourceSha256}\`.
- Every evidence screen retains the disclosure that Testnet MON has no cash value and that private keys are excluded.

## Direct-link QR

macOS Vision decoded the QR from the compressed master at 114.5 seconds and from the compressed teaser at 14.5 seconds to the exact same URL:

\`${release.directBillUrl}\`

## Auxiliary cuts

| Cut | Duration | Frames | Loudness | True peak | Bytes | SHA-256 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Social teaser | ${release.teaser.durationSeconds.toFixed(3)} s | ${release.teaser.frames} | ${release.teaser.loudness.integratedLufs.toFixed(2)} LUFS-I | ${release.teaser.loudness.truePeakDbtp.toFixed(2)} dBTP | ${release.teaser.bytes.toLocaleString("en-GB")} | \`${release.teaser.sha256}\` |
| Multi-wallet evidence | ${release.multiwalletEvidence.durationSeconds.toFixed(3)} s | ${release.multiwalletEvidence.frames} | ${release.multiwalletEvidence.loudness.integratedLufs.toFixed(2)} LUFS-I | ${release.multiwalletEvidence.loudness.truePeakDbtp.toFixed(2)} dBTP | ${release.multiwalletEvidence.bytes.toLocaleString("en-GB")} | \`${release.multiwalletEvidence.sha256}\` |

The evidence cut is a concise visualisation of the sealed RPC record. It does not claim to be an uninterrupted recording of the three wallet interfaces.
`,
);

for (const file of [visualsOnly, captionedVideo, masteredAudio, masterSegments.concatFile, teaserVisuals, teaserConcat, evidenceConcat]) {
  rmSync(file, { force: true });
}
rmSync(segmentDir, { recursive: true, force: true });

console.log(JSON.stringify(release, null, 2));

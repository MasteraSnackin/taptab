import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import QRCode from "qrcode";

const root = resolve(import.meta.dirname, "../../../../..");
const videoRoot = join(root, "docs/submission/video/2min");
const work = join(videoRoot, "v3");
const audioDir = join(work, "audio");
const assetDir = join(work, "assets");
const screenDir = join(work, "screens");
const v2Screens = join(videoRoot, "v2/screens");
const generated = join(work, "generated");
const frameDir = join(generated, "frames");
const overlayDir = join(generated, "overlays");
const subtitleDir = join(generated, "subtitles");
const segmentDir = join(generated, "segments");
const reviewDir = join(work, "review");

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION = 117;
const CAPTION_TOP = 842;
const contract = "0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198";
const contractShort = "0xa2fb0B3b…46FAA198";
const billId = "2";
const billTransactionShort = "0xc089eb04…2effd70";
const directBillUrl =
  `https://taptab.mythicmindlabs.workers.dev/?contract=${contract}&bill=${billId}#live`;
const directBillDisplay = "taptab.mythicmindlabs.workers.dev · Bill 2";

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

function firstExisting(candidates) {
  const file = candidates.find((candidate) => existsSync(candidate));
  return file ?? null;
}

function sourceCandidates(stems, fallback) {
  const candidates = [];
  for (const stem of stems) {
    for (const directory of [screenDir, assetDir]) {
      for (const extension of ["png", "jpg", "jpeg", "webp"]) {
        candidates.push(join(directory, `${stem}.${extension}`));
      }
    }
  }
  if (fallback) candidates.push(join(v2Screens, fallback));
  return candidates;
}

function renderSvg(name, svg, directory = overlayDir) {
  const svgFile = join(directory, `${name}.svg`);
  const pngFile = join(directory, `${name}.png`);
  writeFileSync(svgFile, svg);
  run("sips", ["-s", "format", "png", svgFile, "--out", pngFile]);
  return pngFile;
}

function makeFillFrame(name, source, crop = null) {
  const output = join(frameDir, `${name}.png`);
  const cropFilter = crop
    ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},`
    : "";
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    source,
    "-vf",
    `${cropFilter}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1`,
    "-frames:v",
    "1",
    output,
  ]);
  return output;
}

function makeFramedBrowser(name, source, crop = null) {
  const output = join(frameDir, `${name}.png`);
  const cropFilter = crop
    ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},`
    : "";
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x0c0f17:s=${WIDTH}x${HEIGHT}:r=${FPS}`,
    "-i",
    source,
    "-filter_complex",
    `[1:v]${cropFilter}scale=1856:1000:force_original_aspect_ratio=increase,crop=1856:1000,setsar=1[s];` +
      "[0:v][s]overlay=32:18,drawbox=x=30:y=16:w=1860:h=1004:color=0x3b4052:t=2[v]",
    "-map",
    "[v]",
    "-frames:v",
    "1",
    output,
  ]);
  return output;
}

function overlayFrame(name, background, foreground, x = 0, y = 0) {
  const output = join(frameDir, `${name}.png`);
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
for (const directory of [
  generated,
  frameDir,
  overlayDir,
  subtitleDir,
  segmentDir,
  reviewDir,
]) {
  mkdirSync(directory, { recursive: true });
}

const narrationMaster = firstExisting([
  join(audioDir, "narration-master.wav"),
  join(audioDir, "narration-master.mp3"),
]);
const captionsFile = join(audioDir, "captions.json");
if (!narrationMaster || !existsSync(captionsFile)) {
  throw new Error(
    "V3 audio integration is incomplete. Expected v3/audio/narration-master.wav (or .mp3) and captions.json.",
  );
}

const sources = {
  hero: firstExisting(sourceCandidates(["01-hook-hero", "hook-hero"], "01-hook-hero.jpg")),
  receipt: firstExisting(sourceCandidates(["02-receipt", "receipt"], "02-receipt.jpg")),
  claim: firstExisting(sourceCandidates(["03-shared-claim", "shared-claim"], "03-shared-claim.jpg")),
  remainderOff: firstExisting(
    sourceCandidates(["04a-remainder-opt-out", "remainder-opt-out"], "04a-remainder-opt-out.jpg"),
  ),
  remainderOn: firstExisting(
    sourceCandidates(["04b-remainder-opt-in", "remainder-opt-in"], "04b-remainder-opt-in.jpg"),
  ),
  tip: firstExisting(
    sourceCandidates(["04-tip-fair-remainder", "tip-fair-remainder"], "04-tip-fair-remainder.jpg"),
  ),
  review: firstExisting(sourceCandidates(["05-review", "review"], "05-review.jpg")),
  approved: firstExisting(
    sourceCandidates(["06-all-approved", "all-approved"], "06-all-approved.jpg"),
  ),
  payOpen: firstExisting(
    sourceCandidates(["07-protected-payments", "protected-payments"], "07-protected-payments.jpg"),
  ),
  selfPaid: firstExisting(sourceCandidates(["08-self-paid", "self-paid"], "08-self-paid.jpg")),
  sponsored: firstExisting(
    sourceCandidates(["09-sponsored-incomplete", "sponsored-incomplete"], "09-sponsored-incomplete.jpg"),
  ),
  exact: firstExisting(sourceCandidates(["10-exact-funded", "exact-funded"], "10-exact-funded.jpg")),
  settled: firstExisting(sourceCandidates(["11-settled", "settled"], "11-settled.jpg")),
  stageIncomplete: firstExisting(
    sourceCandidates(
      [
        "sample-funding-incomplete",
        "stage-01-incomplete",
        "stage-incomplete",
        "12-stage-incomplete",
      ],
      "14-stage-refund-ready.jpg",
    ),
  ),
  stageFinal: firstExisting(
    sourceCandidates(
      [
        "sample-final-contribution",
        "stage-02-final-contribution",
        "stage-final-contribution",
        "stage-exact-funded",
      ],
      "10-exact-funded.jpg",
    ),
  ),
  stageSettled: firstExisting(
    sourceCandidates(
      ["sample-stage-settled", "stage-03-settled", "stage-settled", "12-stage-settled"],
      "12-stage-settled.jpg",
    ),
  ),
  refundReady: firstExisting(
    sourceCandidates(["protected-failure", "refund-ready", "14-stage-refund-ready"], "14-stage-refund-ready.jpg"),
  ),
  refundReturned: firstExisting(
    sourceCandidates(["refund-returned", "stage-refund-returned", "16-stage-refund-returned"], "16-stage-refund-returned.jpg"),
  ),
  liveBill: firstExisting(
    sourceCandidates(
      ["live-bill2-canonical", "live-bill-2", "bill-2-live", "live-bill2", "bill2-live"],
      null,
    ),
  ),
  billTransaction: firstExisting(
    sourceCandidates(
      [
        "bill2-transaction-evidence",
        "bill-2-transaction",
        "bill2-transaction",
        "bill-2-explorer",
        "bill2-explorer",
      ],
      null,
    ),
  ),
  contractEvidence: firstExisting(
    sourceCandidates(
      ["live-evidence-card", "contract-evidence", "verified-contract", "contract-explorer"],
      null,
    ),
  ),
  hookPoster: firstExisting(sourceCandidates(["hook-poster"], null)),
};

for (const [name, source] of Object.entries(sources)) {
  if (
    !source &&
    !["liveBill", "billTransaction", "contractEvidence", "hookPoster"].includes(name)
  ) {
    throw new Error(`Missing V3 visual source for ${name}`);
  }
}

const hookOverlay = renderSvg(
  "hook-overlay-v3",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="panel" x1="0" x2="1"><stop stop-color="#101521" stop-opacity=".98"/><stop offset="1" stop-color="#282054" stop-opacity=".96"/></linearGradient>
    </defs>
    <rect x="118" y="112" width="1684" height="322" rx="34" fill="url(#panel)" stroke="#8b73ff" stroke-width="4"/>
    <text x="176" y="178" fill="#a993ff" font-family="Arial, sans-serif" font-size="26" font-weight="800">TAPTAB · LIVE ON MONAD TESTNET</text>
    <text x="176" y="296" fill="#ffffff" font-family="Arial, sans-serif" font-size="88" font-weight="800">Nobody fronts the bill.</text>
    <text x="176" y="378" fill="#ffffff" font-family="Arial, sans-serif" font-size="46" font-weight="700">£53.95 · four diners · exact protected payments</text>
  </svg>`,
);

const pointerIcon = renderSvg(
  "pointer-v3",
  `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="124" viewBox="0 0 104 124">
    <defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="3" dy="5" stdDeviation="5" flood-opacity=".6"/></filter></defs>
    <path d="M10 8 42 84 57 59 86 87 100 71 70 45 94 36Z" fill="#fff" stroke="#0c0f17" stroke-width="6" stroke-linejoin="round" filter="url(#s)"/>
  </svg>`,
);

const clickRing = renderSvg(
  "click-ring-v3",
  `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
    <circle cx="90" cy="90" r="62" fill="#6d45ff" fill-opacity=".16" stroke="#8f78ff" stroke-width="7"/>
    <circle cx="90" cy="90" r="24" fill="none" stroke="#ffffff" stroke-width="5"/>
  </svg>`,
);

const frames = {
  hero: makeFramedBrowser("hero", sources.hero),
  receipt: makeFillFrame("receipt-close", sources.receipt, { w: 1180, h: 560, x: 35, y: 120 }),
  claim: makeFillFrame("claim-close", sources.claim, { w: 990, h: 520, x: 245, y: 95 }),
  remainderOff: makeFillFrame("remainder-off-close", sources.remainderOff, { w: 710, h: 520, x: 515, y: 80 }),
  remainderOn: makeFillFrame("remainder-on-close", sources.remainderOn, { w: 710, h: 520, x: 515, y: 80 }),
  tip: makeFillFrame("tip-close", sources.tip, { w: 690, h: 520, x: 540, y: 75 }),
  review: makeFillFrame("review-close", sources.review, { w: 830, h: 540, x: 390, y: 80 }),
  approved: makeFillFrame("approved-close", sources.approved, { w: 830, h: 540, x: 390, y: 80 }),
  payOpen: makeFillFrame("pay-open-close", sources.payOpen, { w: 900, h: 530, x: 300, y: 85 }),
  selfPaid: makeFillFrame("self-paid-close", sources.selfPaid, { w: 930, h: 530, x: 280, y: 85 }),
  sponsored: makeFillFrame("sponsored-close", sources.sponsored, { w: 930, h: 530, x: 280, y: 85 }),
  exact: makeFillFrame("exact-close", sources.exact, { w: 930, h: 530, x: 280, y: 85 }),
  settled: makeFillFrame("settled-full", sources.settled),
  stageIncomplete: makeFillFrame("stage-incomplete", sources.stageIncomplete),
  stageFinal: makeFillFrame("stage-final-contribution", sources.stageFinal),
  stageSettled: makeFillFrame("stage-settled", sources.stageSettled),
  refundReady: makeFillFrame("refund-ready-full", sources.refundReady),
  refundReturned: makeFillFrame("refund-returned-full", sources.refundReturned),
};
frames.heroHook = sources.hookPoster
  ? makeFillFrame("hero-hook", sources.hookPoster)
  : overlayFrame("hero-hook", frames.hero, hookOverlay);

const comparisonSlide = renderSvg(
  "outcome-comparison-v3",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0c0f17"/><stop offset="1" stop-color="#211b48"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <text x="960" y="128" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="58" font-weight="800">One approved bill. Two protected outcomes.</text>
    <rect x="110" y="210" width="810" height="520" rx="34" fill="#15271b" stroke="#7adf86" stroke-width="5"/>
    <text x="170" y="288" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="28" font-weight="800">EXACTLY FUNDED</text>
    <text x="170" y="402" fill="#ffffff" font-family="Arial, sans-serif" font-size="72" font-weight="800">£53.95 settled</text>
    <text x="170" y="488" fill="#d8f8dc" font-family="Arial, sans-serif" font-size="36" font-weight="700">Venue receives the exact total.</text>
    <text x="170" y="570" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="30">Every contribution is accounted for.</text>
    <rect x="1000" y="210" width="810" height="520" rx="34" fill="#312216" stroke="#e8a45a" stroke-width="5"/>
    <text x="1060" y="288" fill="#ffc887" font-family="Arial, sans-serif" font-size="28" font-weight="800">INCOMPLETE OR CANCELLED</text>
    <text x="1060" y="402" fill="#ffffff" font-family="Arial, sans-serif" font-size="72" font-weight="800">£0 to venue</text>
    <text x="1060" y="488" fill="#ffe4c3" font-family="Arial, sans-serif" font-size="36" font-weight="700">Settlement remains locked.</text>
    <text x="1060" y="570" fill="#ffc887" font-family="Arial, sans-serif" font-size="30">Each payer claims their own refund.</text>
  </svg>`,
);
frames.comparison = comparisonSlide;

function evidenceFallback(name, heading, value, detail, accent) {
  return renderSvg(
    name,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0c0f17"/><stop offset="1" stop-color="#251e52"/></linearGradient></defs>
      <rect width="1920" height="1080" fill="url(#bg)"/>
      <text x="130" y="142" fill="${accent}" font-family="Arial, sans-serif" font-size="27" font-weight="800">LIVE MONAD TESTNET EVIDENCE</text>
      <text x="130" y="242" fill="#ffffff" font-family="Arial, sans-serif" font-size="66" font-weight="800">${escapeXml(heading)}</text>
      <rect x="130" y="316" width="1660" height="410" rx="36" fill="#ffffff" fill-opacity=".08" stroke="${accent}" stroke-width="4"/>
      <text x="190" y="426" fill="${accent}" font-family="Arial, sans-serif" font-size="28" font-weight="800">${escapeXml(value)}</text>
      <text x="190" y="516" fill="#ffffff" font-family="Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(detail)}</text>
      <text x="190" y="602" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="27">Chain 10143 · confirmed public read evidence</text>
    </svg>`,
  );
}

frames.liveBill = sources.liveBill
  ? makeFramedBrowser("live-bill-2", sources.liveBill)
  : evidenceFallback("live-bill-fallback", "Live Bill 2", "£48.50 REFERENCE BILL", "3.157527415150402471 Testnet MON", "#a993ff");
frames.billTransaction = sources.billTransaction
  ? makeFramedBrowser("bill-2-transaction", sources.billTransaction)
  : evidenceFallback("bill-transaction-fallback", "Bill 2 confirmed", billTransactionShort, "Creation transaction succeeded on Monad Testnet", "#7adf86");
frames.contractEvidence = sources.contractEvidence
  ? makeFramedBrowser("contract-evidence", sources.contractEvidence)
  : evidenceFallback("contract-evidence-fallback", "Contract and source", contractShort, "Sourcify perfect match · deployment confirmed", "#ffc887");

const whyMonad = renderSvg(
  "why-monad-v3",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0c0f17"/><stop offset="1" stop-color="#2b2061"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <text x="120" y="144" fill="#a993ff" font-family="Arial, sans-serif" font-size="28" font-weight="800">WHY MONAD</text>
    <text x="120" y="234" fill="#ffffff" font-family="Arial, sans-serif" font-size="64" font-weight="800">Fast confirmation. Explicit evidence.</text>
    <rect x="120" y="318" width="510" height="390" rx="30" fill="#ffffff" fill-opacity=".08" stroke="#8b73ff" stroke-width="4"/>
    <text x="166" y="390" fill="#a993ff" font-family="Arial, sans-serif" font-size="22" font-weight="800">NETWORK</text>
    <text x="166" y="492" fill="#ffffff" font-family="Arial, sans-serif" font-size="48" font-weight="800">Chain 10143</text>
    <text x="166" y="558" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="25">Monad Testnet</text>
    <rect x="705" y="318" width="510" height="390" rx="30" fill="#ffffff" fill-opacity=".08" stroke="#7adf86" stroke-width="4"/>
    <text x="751" y="390" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="22" font-weight="800">LIVE BILL 2</text>
    <text x="751" y="492" fill="#ffffff" font-family="Arial, sans-serif" font-size="48" font-weight="800">Confirmed</text>
    <text x="751" y="558" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="25">${billTransactionShort}</text>
    <rect x="1290" y="318" width="510" height="390" rx="30" fill="#ffffff" fill-opacity=".08" stroke="#e8a45a" stroke-width="4"/>
    <text x="1336" y="390" fill="#ffc887" font-family="Arial, sans-serif" font-size="22" font-weight="800">SOURCE INTEGRITY</text>
    <text x="1336" y="492" fill="#ffffff" font-family="Arial, sans-serif" font-size="48" font-weight="800">Perfect match</text>
    <text x="1336" y="558" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="25">Verified with Sourcify</text>
  </svg>`,
);
frames.whyMonad = whyMonad;

const qrAsset = firstExisting(
  sourceCandidates(
    ["bill2-direct-qr", "direct-bill-2-qr", "bill-2-qr", "bill2-qr"],
    null,
  ),
);
const qrCode = qrAsset ?? join(overlayDir, "direct-bill-2-qr.png");
if (!qrAsset) {
  await QRCode.toFile(qrCode, directBillUrl, {
    width: 520,
    margin: 4,
    errorCorrectionLevel: "H",
    color: { dark: "#0c0f17ff", light: "#ffffffff" },
  });
}

const qrSized = join(overlayDir, "direct-bill-2-qr-500.png");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  qrCode,
  "-vf",
  "scale=500:500",
  "-frames:v",
  "1",
  qrSized,
]);

const endCardBase = renderSvg(
  "end-card-v3-base",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0c0f17"/><stop offset=".62" stop-color="#18162b"/><stop offset="1" stop-color="#392778"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <rect x="104" y="76" width="76" height="76" rx="19" fill="#6d45ff"/>
    <text x="142" y="131" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="44" font-weight="800">T</text>
    <text x="205" y="130" fill="#fff" font-family="Arial, sans-serif" font-size="34" font-weight="800">TapTab · Monad Testnet</text>
    <text x="104" y="270" fill="#ffffff" font-family="Arial, sans-serif" font-size="78" font-weight="800">Scan to open live Bill 2.</text>
    <text x="108" y="338" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="31">£48.50 reference value · direct contract-and-bill route</text>
    <rect x="104" y="402" width="1086" height="336" rx="34" fill="#ffffff" fill-opacity=".09" stroke="#8b73ff" stroke-width="4"/>
    <text x="154" y="474" fill="#a993ff" font-family="Arial, sans-serif" font-size="23" font-weight="800">LIVE BILL 2 · CHAIN 10143</text>
    <text x="154" y="552" fill="#ffffff" font-family="Arial, sans-serif" font-size="38" font-weight="800">${contractShort}</text>
    <text x="154" y="614" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="29" font-weight="800">CONFIRMED · SOURCE VERIFIED · PUBLICLY READABLE</text>
    <text x="154" y="674" fill="#ffffff" font-family="Arial, sans-serif" font-size="28" font-weight="700">${directBillDisplay}</text>
    <rect x="1280" y="160" width="560" height="650" rx="34" fill="#ffffff"/>
    <text x="1560" y="768" text-anchor="middle" fill="#0c0f17" font-family="Arial, sans-serif" font-size="28" font-weight="800">OPEN LIVE BILL 2</text>
    <rect x="104" y="806" width="1736" height="112" rx="26" fill="#211d18" fill-opacity=".9" stroke="#b17843" stroke-width="2"/>
    <text x="148" y="852" fill="#d8b68f" font-family="Arial, sans-serif" font-size="18" font-weight="800">EVIDENCE BOUNDARY</text>
    <text x="148" y="890" fill="#e9e1d8" font-family="Arial, sans-serif" font-size="23">Multi-wallet settlement and refund rehearsal remains a separate final test.</text>
  </svg>`,
);
frames.endCard = overlayFrame("end-card-v3", endCardBase, qrSized, 1310, 196);

const posterBase = renderSvg(
  "poster-v3-base",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0c0f17"/><stop offset="1" stop-color="#302267"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <rect x="82" y="76" width="1756" height="928" rx="42" fill="#0f1320" fill-opacity=".94" stroke="#8b73ff" stroke-width="4"/>
    <text x="142" y="172" fill="#a993ff" font-family="Arial, sans-serif" font-size="27" font-weight="800">TAPTAB · MONAD TESTNET</text>
    <text x="142" y="300" fill="#ffffff" font-family="Arial, sans-serif" font-size="96" font-weight="800">Nobody fronts the bill.</text>
    <text x="142" y="394" fill="#ffffff" font-family="Arial, sans-serif" font-size="62" font-weight="800">£53.95 · paid together</text>
    <rect x="142" y="458" width="692" height="402" rx="30" fill="#182c1e" stroke="#7adf86" stroke-width="4"/>
    <text x="190" y="536" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="26" font-weight="800">SUCCESSFUL OUTCOME</text>
    <text x="190" y="646" fill="#ffffff" font-family="Arial, sans-serif" font-size="70" font-weight="800">Exact total</text>
    <text x="190" y="728" fill="#ffffff" font-family="Arial, sans-serif" font-size="44" font-weight="700">Venue paid.</text>
    <text x="190" y="800" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="31">Nobody chased.</text>
  </svg>`,
);

const posterStage = join(frameDir, "poster-stage-crop.png");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  frames.stageSettled,
  "-vf",
  "crop=1080:720:420:80,scale=870:580",
  "-frames:v",
  "1",
  posterStage,
]);
const generatedPoster = overlayFrame("poster-v3", posterBase, posterStage, 908, 394);
const posterPng = sources.hookPoster ?? generatedPoster;

const visualSegments = [
  [0, 5, "heroHook"],
  [5, 7.2, "receipt"],
  [7.2, 9.5, "receipt", { to: [1460, 494], clickAt: 2.02 }],
  [9.5, 13.7, "claim"],
  [13.7, 16, "claim"],
  [16, 21, "claim"],
  [21, 23.5, "remainderOff", { to: [1445, 498], clickAt: 2.18 }],
  [23.5, 26, "remainderOn"],
  [26, 28.5, "remainderOn", { to: [1425, 480], clickAt: 2.18 }],
  [28.5, 31, "tip"],
  [31, 33.3, "review", { to: [1400, 526], clickAt: 2.0 }],
  [33.3, 35, "approved"],
  [35, 38, "payOpen", { to: [1390, 610], clickAt: 2.65 }],
  [38, 42, "selfPaid"],
  [42, 45, "selfPaid", { to: [1430, 510], clickAt: 2.65 }],
  [45, 49, "sponsored"],
  [49, 52, "sponsored", { to: [1420, 610], clickAt: 2.65 }],
  [52, 55, "exact", { to: [1460, 515], clickAt: 2.65 }],
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
  [95, 99, "contractEvidence"],
  [99, 105, "whyMonad"],
  [105, 117, "endCard"],
];

if (visualSegments[0][0] !== 0 || visualSegments.at(-1)[1] !== DURATION) {
  throw new Error("Visual timeline does not span exactly 0–117 seconds");
}
for (let index = 1; index < visualSegments.length; index += 1) {
  if (visualSegments[index - 1][1] !== visualSegments[index][0]) {
    throw new Error(`Visual timeline gap at segment ${index + 1}`);
  }
}

const segmentFiles = [];
for (let index = 0; index < visualSegments.length; index += 1) {
  const [start, end, frameKey, action] = visualSegments[index];
  const frameCount = Math.round((end - start) * FPS);
  const output = join(segmentDir, `segment-${String(index + 1).padStart(2, "0")}.mp4`);
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
    frames[frameKey],
  ];
  let filter = `[0:v]scale=${WIDTH}:${HEIGHT},setsar=1[base]`;
  let outputLabel = "base";
  if (action) {
    const [targetX, targetY] = action.to;
    const startX = 1740;
    const startY = 120;
    const travelEnd = Math.max(action.clickAt - 0.2, 0.45);
    args.push("-loop", "1", "-framerate", String(FPS), "-i", pointerIcon);
    args.push("-loop", "1", "-framerate", String(FPS), "-i", clickRing);
    filter +=
      `;[base][1:v]overlay=x='${startX}+(${targetX - startX})*min(max(t/${travelEnd},0),1)':` +
      `y='${startY}+(${targetY - startY})*min(max(t/${travelEnd},0),1)':` +
      `eof_action=repeat:enable='between(t,0,${action.clickAt + 0.18})'[pointed]` +
      `;[pointed][2:v]overlay=${targetX - 90}:${targetY - 90}:eof_action=repeat:` +
      `enable='between(t,${action.clickAt - 0.12},${action.clickAt + 0.12})'[clicked]`;
    outputLabel = "clicked";
  }
  args.push(
    "-filter_complex",
    filter,
    "-map",
    `[${outputLabel}]`,
    "-frames:v",
    String(frameCount),
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
  segmentFiles.push(output);
}

const concatFile = join(generated, "segments.ffconcat");
writeFileSync(
  concatFile,
  ["ffconcat version 1.0", ...segmentFiles.map((file) => `file '${file}'`)].join("\n") + "\n",
);
const visualsOnly = join(generated, "visuals-only.mp4");
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
  visualsOnly,
]);

const captions = JSON.parse(readFileSync(captionsFile, "utf8"));
if (!Array.isArray(captions) || captions.length === 0) {
  throw new Error("captions.json must be a non-empty array");
}
for (const [index, cue] of captions.entries()) {
  if (
    typeof cue.start !== "number" ||
    typeof cue.end !== "number" ||
    typeof cue.text !== "string" ||
    cue.start < 0 ||
    cue.end <= cue.start ||
    cue.end > DURATION
  ) {
    throw new Error(`Invalid caption cue ${index + 1}`);
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
  .map(
    (cue, index) =>
      `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text.trim()}\n`,
  )
  .join("\n");
const finalSrt = join(videoRoot, "taptab-demo-2min.srt");
writeFileSync(finalSrt, srt);

function wrapCaption(text, maxLength = 56) {
  const words = text.replaceAll(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const proposed = line ? `${line} ${word}` : word;
    if (proposed.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = proposed;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(" ")];
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
        `<text x="220" y="${lines.length === 1 ? 968 : 936 + lineIndex * 52}" fill="#ffffff" font-family="Arial, sans-serif" font-size="40" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join("\n");
  const subtitle = renderSvg(
    `caption-${String(index + 1).padStart(2, "0")}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect x="0" y="${CAPTION_TOP}" width="1920" height="238" fill="#090c13" fill-opacity=".97"/>
      <rect x="0" y="${CAPTION_TOP}" width="1920" height="4" fill="#6d45ff"/>
      <rect x="56" y="900" width="116" height="72" rx="36" fill="#6d45ff"/>
      <text x="114" y="947" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="24" font-weight="800">${String(index + 1).padStart(2, "0")}</text>
      ${text}
    </svg>`,
    subtitleDir,
  );
  subtitleInputs.push("-loop", "1", "-framerate", String(FPS), "-i", subtitle);
  const nextLabel = `sub${index}`;
  subtitleFilters.push(
    `[${subtitleLabel}][${index + 1}:v]overlay=0:0:eof_action=repeat:enable='between(t,${cue.start},${cue.end})'[${nextLabel}]`,
  );
  subtitleLabel = nextLabel;
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

const optionalMusic = firstExisting([
  join(audioDir, "music-bed.wav"),
  join(audioDir, "music-bed.mp3"),
]);
const optionalSfx = firstExisting([
  join(audioDir, "ui-sfx.wav"),
  join(audioDir, "ui-sfx.mp3"),
]);
if (!optionalMusic || !optionalSfx) {
  throw new Error(
    "V3 mix is incomplete. Expected v3/audio/music-bed.wav and ui-sfx.wav.",
  );
}
const audioInputs = ["-i", narrationMaster];
const audioLabels = ["[n]"];
const audioFilters = [
  `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${DURATION},atrim=0:${DURATION},volume=1[n]`,
];
let nextAudioInput = 1;
if (optionalMusic) {
  audioInputs.push("-i", optionalMusic);
  audioFilters.push(
    `[${nextAudioInput}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${DURATION},atrim=0:${DURATION},volume=1[m]`,
  );
  audioLabels.push("[m]");
  nextAudioInput += 1;
}
if (optionalSfx) {
  audioInputs.push("-i", optionalSfx);
  audioFilters.push(
    `[${nextAudioInput}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${DURATION},atrim=0:${DURATION},volume=1[s]`,
  );
  audioLabels.push("[s]");
}
audioFilters.push(
  `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,` +
    `apad=whole_dur=${DURATION},atrim=0:${DURATION}[master]`,
);
const masteredAudio = join(generated, "mastered-audio.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  ...audioInputs,
  "-filter_complex",
  audioFilters.join(";"),
  "-map",
  "[master]",
  "-ar",
  "48000",
  "-c:a",
  "pcm_s24le",
  masteredAudio,
]);

const pcmLoudnessResult = spawnSync("ffmpeg", [
  "-hide_banner",
  "-i",
  masteredAudio,
  "-af",
  "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json",
  "-f",
  "null",
  "-",
], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (pcmLoudnessResult.status !== 0) {
  throw new Error(`PCM loudness verification failed:\n${pcmLoudnessResult.stderr ?? ""}`);
}
writeFileSync(
  join(reviewDir, "loudness-pcm-v3.txt"),
  `${pcmLoudnessResult.stderr ?? ""}\n`,
);

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
  posterPng,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  poster,
]);

const reviewTimes = [2.5, 8.7, 17.5, 24, 29.7, 34, 39.5, 47, 53.5, 57.7, 59.2, 61.2, 66.5, 71, 74, 78, 85, 91, 96, 102, 108, 114.5];
for (const time of reviewTimes) {
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(time),
    "-i",
    finalVideo,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    join(reviewDir, `frame-${String(time).replace(".", "-")}.jpg`),
  ]);
}

const contactFrames = reviewTimes
  .filter((_, index) => index % 2 === 0)
  .slice(0, 12)
  .map((time) => `eq(n,${Math.round(time * FPS)})`)
  .join("+");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  finalVideo,
  "-vf",
  `select='${contactFrames}',setpts=N/FRAME_RATE/TB,scale=480:270,tile=4x3`,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  join(reviewDir, "contact-sheet-v3.jpg"),
]);

const detailFrames = reviewTimes
  .slice(0, 20)
  .map((time) => `eq(n,${Math.round(time * FPS)})`)
  .join("+");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  finalVideo,
  "-vf",
  `select='${detailFrames}',setpts=N/FRAME_RATE/TB,scale=384:216,tile=5x4`,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  join(reviewDir, "detail-sheet-v3.jpg"),
]);

const actionReviewTimes = [
  9.0, 9.23, 9.65,
  22.9, 23.19, 23.6,
  27.9, 28.19, 28.7,
  32.7, 33.01, 33.5,
  37.4, 37.66, 38.2,
  44.4, 44.66, 45.2,
  51.4, 51.66, 52.2,
  54.4, 54.66, 55.2,
];
const actionFrames = actionReviewTimes
  .map((time) => `eq(n,${Math.round(time * FPS)})`)
  .join("+");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  finalVideo,
  "-vf",
  `select='${actionFrames}',setpts=N/FRAME_RATE/TB,scale=320:180,tile=6x4`,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  join(reviewDir, "action-continuity-v3.jpg"),
]);

const probe = run("ffprobe", [
  "-v",
  "error",
  "-show_entries",
  "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,pix_fmt",
  "-of",
  "json",
  finalVideo,
]);
writeFileSync(join(reviewDir, "ffprobe-v3.json"), `${probe}\n`);

const parsedProbe = JSON.parse(probe);
const videoStream = parsedProbe.streams.find((stream) => stream.codec_type === "video");
const audioStream = parsedProbe.streams.find((stream) => stream.codec_type === "audio");
if (
  parsedProbe.format.duration !== "117.000000" ||
  videoStream?.width !== WIDTH ||
  videoStream?.height !== HEIGHT ||
  videoStream?.r_frame_rate !== "30/1" ||
  videoStream?.pix_fmt !== "yuv420p" ||
  audioStream?.sample_rate !== "48000" ||
  audioStream?.channels !== 2
) {
  throw new Error(`Final technical verification failed:\n${probe}`);
}

const loudnessResult = spawnSync("ffmpeg", [
  "-hide_banner",
  "-i",
  finalVideo,
  "-af",
  "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json",
  "-f",
  "null",
  "-",
], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (loudnessResult.status !== 0) {
  throw new Error(`Loudness verification failed:\n${loudnessResult.stderr ?? ""}`);
}
writeFileSync(
  join(reviewDir, "loudness-v3.txt"),
  `${loudnessResult.stderr ?? ""}\n`,
);

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const checksumFiles = [finalVideo, finalSrt, poster];
writeFileSync(
  join(reviewDir, "SHA256SUMS.txt"),
  checksumFiles
    .map((file) => `${sha256(file)}  ${file.slice(root.length + 1)}`)
    .join("\n") + "\n",
);

writeFileSync(
  join(reviewDir, "INTEGRATED_SOURCES.txt"),
  Object.entries(sources)
    .map(([name, file]) => `${name}: ${file ? file.slice(root.length + 1) : "generated fallback"}`)
    .concat([
      `qr: ${qrAsset ? qrAsset.slice(root.length + 1) : "generated direct Bill 2 QR"}`,
      `narration: ${narrationMaster.slice(root.length + 1)}`,
      `music: ${optionalMusic.slice(root.length + 1)}`,
      `uiSfx: ${optionalSfx.slice(root.length + 1)}`,
      `captions: ${captionsFile.slice(root.length + 1)}`,
    ])
    .join("\n") + "\n",
);

for (const temporary of [visualsOnly, captionedVideo, masteredAudio, concatFile]) {
  rmSync(temporary, { force: true });
}
rmSync(segmentDir, { recursive: true, force: true });

console.log(finalVideo);
console.log(probe);

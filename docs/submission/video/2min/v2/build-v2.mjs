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
const work = join(videoRoot, "v2");
const screens = join(work, "screens");
const audio = join(work, "audio");
const generated = join(work, "generated");
const framesDir = join(generated, "frames");
const subtitleDir = join(generated, "subtitles");
const overlayDir = join(generated, "overlays");
const segmentDir = join(generated, "segments");
const reviewDir = join(work, "review");
const targetDuration = 117;
const publicPreviewUrl = "https://taptab.mythicmindlabs.workers.dev";
const liveContract = "0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198";
const liveContractShort = "0xa2fb0B3b…46FAA198";
const deployTransaction =
  "0xc48ab94b9e503d09f52e32dd8b2f97adb9b0ca80ab83a6a544dc72fa338ba488";
const deployTransactionShort = "0xc48ab94b…38ba488";

// Generated assets are disposable. Clear them first so retired cue cards or
// evidence overlays cannot survive a rebuild and contradict the current cut.
rmSync(generated, { recursive: true, force: true });
rmSync(reviewDir, { recursive: true, force: true });

for (const directory of [
  generated,
  framesDir,
  subtitleDir,
  overlayDir,
  segmentDir,
  reviewDir,
]) {
  mkdirSync(directory, { recursive: true });
}

const required = [
  "01-hook-hero.jpg",
  "02-receipt.jpg",
  "03-shared-claim.jpg",
  "04-tip-fair-remainder.jpg",
  "04a-remainder-opt-out.jpg",
  "04b-remainder-opt-in.jpg",
  "05-review.jpg",
  "06-all-approved.jpg",
  "07-protected-payments.jpg",
  "08-self-paid.jpg",
  "09-sponsored-incomplete.jpg",
  "10-exact-funded.jpg",
  "11-settled.jpg",
  "12-stage-settled.jpg",
  "14-stage-refund-ready.jpg",
  "16-stage-refund-returned.jpg",
].map((file) => join(screens, file));

for (let index = 1; index <= 8; index += 1) {
  required.push(join(audio, `scene-${String(index).padStart(2, "0")}.mp3`));
}

for (const file of required) {
  if (!existsSync(file)) {
    throw new Error(`Missing required V2 source: ${file}`);
  }
}

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
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSvg(name, content, directory = overlayDir) {
  const svg = join(directory, `${name}.svg`);
  const png = join(directory, `${name}.png`);
  writeFileSync(svg, content);
  run("sips", ["-s", "format", "png", svg, "--out", png]);
  return png;
}

function makeFrame(name, source, mode = "browser") {
  const output = join(framesDir, `${name}.png`);
  const base = `color=c=0x0d0f16:s=1920x1080:r=30`;
  let filter;
  if (mode === "stage") {
    filter =
      "[1:v]scale=1860:1073[s];" +
      "[0:v][s]overlay=30:3,drawbox=x=28:y=1:w=1864:h=1077:color=0x3b3f52:t=2[v]";
  } else {
    filter =
      "[1:v]scale=1612:930[s];" +
      "[0:v][s]overlay=154:12," +
      "drawbox=x=142:y=0:w=1636:h=954:color=0x343848:t=2[v]";
  }
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    base,
    "-i",
    source,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-frames:v",
    "1",
    output,
  ]);
  return output;
}

const frameSources = {
  hero: ["01-hook-hero.jpg", "browser"],
  receipt: ["02-receipt.jpg", "browser"],
  claim: ["03-shared-claim.jpg", "browser"],
  tip: ["04-tip-fair-remainder.jpg", "browser"],
  remainderOff: ["04a-remainder-opt-out.jpg", "browser"],
  remainderOn: ["04b-remainder-opt-in.jpg", "browser"],
  review: ["05-review.jpg", "browser"],
  approved: ["06-all-approved.jpg", "browser"],
  payOpen: ["07-protected-payments.jpg", "browser"],
  selfPaid: ["08-self-paid.jpg", "browser"],
  sponsored: ["09-sponsored-incomplete.jpg", "browser"],
  exact: ["10-exact-funded.jpg", "browser"],
  settled: ["11-settled.jpg", "browser"],
  stageSettled: ["12-stage-settled.jpg", "stage"],
  stageRefund: ["14-stage-refund-ready.jpg", "stage"],
  stageReturned: ["16-stage-refund-returned.jpg", "stage"],
};

const frames = {};
for (const [key, [file, mode]] of Object.entries(frameSources)) {
  frames[key] = makeFrame(key, join(screens, file), mode);
}

const branchLabels = renderSvg(
  "branch-labels",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <rect width="1920" height="1080" fill="none"/>
    <text x="960" y="74" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="46" font-weight="700">SAME APPROVED BILL · £53.95</text>
    <rect x="28" y="104" width="922" height="658" rx="24" fill="none" stroke="#7adf86" stroke-width="5"/>
    <rect x="970" y="104" width="922" height="658" rx="24" fill="none" stroke="#e8a45a" stroke-width="5"/>
    <text x="60" y="155" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="32" font-weight="700">SUCCESS · EXACTLY FUNDED</text>
    <text x="1002" y="155" fill="#ffc887" font-family="Arial, sans-serif" font-size="32" font-weight="700">PROTECTED FAILURE · INCOMPLETE</text>
    <rect x="55" y="692" width="868" height="50" rx="25" fill="#173421"/>
    <rect x="997" y="692" width="868" height="50" rx="25" fill="#3c2b1c"/>
    <text x="489" y="726" text-anchor="middle" fill="#c9ffd0" font-family="Arial, sans-serif" font-size="25" font-weight="700">£53.95 SETTLED · VENUE PAID EXACTLY</text>
    <text x="1431" y="726" text-anchor="middle" fill="#ffe0b7" font-family="Arial, sans-serif" font-size="25" font-weight="700">£35.04 PROTECTED · VENUE RECEIVES £0.00</text>
    <text x="960" y="816" text-anchor="middle" fill="#bcc1ce" font-family="Arial, sans-serif" font-size="27">One approved split. Either exact settlement, or payer-owned refunds.</text>
  </svg>`,
);

function makeBranchFrame(name, rightFrame) {
  const output = join(framesDir, `${name}.png`);
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x0d0f16:s=1920x1080:r=30",
    "-i",
    frames.stageSettled,
    "-i",
    rightFrame,
    "-i",
    branchLabels,
    "-filter_complex",
    "[1:v]crop=1920:1080,scale=910:512[left];" +
      "[2:v]crop=1920:1080,scale=910:512[right];" +
      "[0:v][left]overlay=34:172[b1];" +
      "[b1][right]overlay=976:172[b2];" +
      "[b2][3:v]overlay=0:0[v]",
    "-map",
    "[v]",
    "-frames:v",
    "1",
    output,
  ]);
  return output;
}

frames.branchReady = makeBranchFrame("branch-ready", frames.stageRefund);
frames.branchReturned = makeBranchFrame("branch-returned", frames.stageReturned);

const hookOverlay = renderSvg(
  "hook-overlay",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="hook" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#111522" stop-opacity="0.98"/>
        <stop offset="1" stop-color="#24204d" stop-opacity="0.96"/>
      </linearGradient>
    </defs>
    <rect x="194" y="96" width="1532" height="236" rx="30" fill="url(#hook)" stroke="#8b73ff" stroke-width="4"/>
    <text x="252" y="205" fill="#ffffff" font-family="Arial, sans-serif" font-size="92" font-weight="800">£53.95</text>
    <text x="698" y="181" fill="#a993ff" font-family="Arial, sans-serif" font-size="30" font-weight="800">FOUR DINERS</text>
    <text x="698" y="247" fill="#ffffff" font-family="Arial, sans-serif" font-size="54" font-weight="800">NOBODY FRONTS THE BILL.</text>
    <text x="252" y="292" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="24">One familiar total. Four exact contributions. Protected settlement.</text>
  </svg>`,
);

function overlayFrame(name, background, foreground, x = 0, y = 0) {
  const output = join(framesDir, `${name}.png`);
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

frames.heroHook = overlayFrame("hero-hook", frames.hero, hookOverlay);

frames.whyMonad = renderSvg(
  "why-monad",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0d0f16"/>
        <stop offset="0.58" stop-color="#171a2a"/>
        <stop offset="1" stop-color="#2b1f64"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <text x="120" y="154" fill="#a993ff" font-family="Arial, sans-serif" font-size="28" font-weight="800">WHY MONAD</text>
    <text x="120" y="248" fill="#ffffff" font-family="Arial, sans-serif" font-size="64" font-weight="800">Live on Monad Testnet. Evidence stays explicit.</text>
    <rect x="120" y="332" width="520" height="360" rx="28" fill="#ffffff" fill-opacity="0.08" stroke="#8b73ff" stroke-width="3"/>
    <text x="164" y="402" fill="#a993ff" font-family="Arial, sans-serif" font-size="22" font-weight="800">LIVE DEPLOYMENT</text>
    <text x="164" y="482" fill="#ffffff" font-family="Arial, sans-serif" font-size="42" font-weight="800">Chain ID 10143</text>
    <text x="164" y="548" fill="#ffffff" font-family="Arial, sans-serif" font-size="31" font-weight="800">${liveContractShort}</text>
    <text x="164" y="608" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="25">Deploy tx ${deployTransactionShort}</text>
    <text x="164" y="650" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="25">Confirmed on Monad Testnet</text>
    <rect x="700" y="332" width="520" height="360" rx="28" fill="#ffffff" fill-opacity="0.08" stroke="#7adf86" stroke-width="3"/>
    <text x="744" y="402" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="22" font-weight="800">SOURCE INTEGRITY</text>
    <text x="744" y="500" fill="#ffffff" font-family="Arial, sans-serif" font-size="46" font-weight="800">Sourcify</text>
    <text x="744" y="562" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="38" font-weight="800">Perfect match</text>
    <text x="744" y="628" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="25">Published bytecode matches source.</text>
    <rect x="1280" y="332" width="520" height="360" rx="28" fill="#ffffff" fill-opacity="0.08" stroke="#e8a45a" stroke-width="3"/>
    <text x="1324" y="402" fill="#ffc887" font-family="Arial, sans-serif" font-size="22" font-weight="800">PUBLIC READINESS</text>
    <text x="1324" y="500" fill="#ffffff" font-family="Arial, sans-serif" font-size="48" font-weight="800">HTTP 200</text>
    <text x="1324" y="562" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="800">App ready</text>
    <text x="1324" y="628" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="25">Public HTTPS sample reached.</text>
    <rect x="120" y="758" width="1680" height="110" rx="24" fill="#10131c" fill-opacity="0.94" stroke="#555c70" stroke-width="2"/>
    <text x="960" y="808" text-anchor="middle" fill="#ffc887" font-family="Arial, sans-serif" font-size="23" font-weight="800">REMAINING EVIDENCE BOUNDARY</text>
    <text x="960" y="846" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="27" font-weight="700">Real multi-wallet writes, settlement and refund rehearsal remain.</text>
  </svg>`,
);

const qrCode = join(overlayDir, "public-preview-qr.png");
await QRCode.toFile(qrCode, publicPreviewUrl, {
  width: 420,
  margin: 4,
  errorCorrectionLevel: "H",
  color: { dark: "#10131cff", light: "#ffffffff" },
});

const endCardBase = renderSvg(
  "end-card-base",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0d0f16"/>
        <stop offset="0.56" stop-color="#15182a"/>
        <stop offset="1" stop-color="#2b1f64"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.76" cy="0.28" r="0.55">
        <stop offset="0" stop-color="#6d45ff" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#6d45ff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <rect width="1920" height="1080" fill="url(#glow)"/>
    <rect x="112" y="104" width="74" height="74" rx="18" fill="#6d45ff"/>
    <text x="149" y="158" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="42" font-weight="800">T</text>
    <text x="208" y="155" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="700">TapTab</text>
    <text x="112" y="286" fill="#ffffff" font-family="Arial, sans-serif" font-size="72" font-weight="700">Paid together. Nobody chased.</text>
    <text x="116" y="348" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="28">Live contract evidence · Monad Testnet</text>
    <rect x="112" y="402" width="1128" height="374" rx="28" fill="#ffffff" fill-opacity="0.09" stroke="#8b73ff" stroke-width="3"/>
    <text x="158" y="462" fill="#a993ff" font-family="Arial, sans-serif" font-size="22" font-weight="800">LIVE CONTRACT · CHAIN 10143</text>
    <text x="158" y="518" fill="#ffffff" font-family="Arial, sans-serif" font-size="40" font-weight="800">${liveContractShort}</text>
    <text x="158" y="574" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="25">Deploy tx ${deployTransactionShort}</text>
    <text x="158" y="638" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="28" font-weight="800">SOURCE VERIFIED · SOURCIFY PERFECT MATCH</text>
    <text x="158" y="696" fill="#ffffff" font-family="Arial, sans-serif" font-size="28" font-weight="700">PUBLIC READINESS · 200 OK</text>
    <text x="158" y="740" fill="#c8cbd6" font-family="Arial, sans-serif" font-size="21">${publicPreviewUrl}</text>
    <rect x="1308" y="214" width="468" height="562" rx="28" fill="#ffffff"/>
    <text x="1542" y="728" text-anchor="middle" fill="#10131c" font-family="Arial, sans-serif" font-size="22" font-weight="800">OPEN THE PUBLIC SAMPLE</text>
    <rect x="112" y="822" width="1664" height="128" rx="28" fill="#251f1b" fill-opacity="0.96" stroke="#e8a45a" stroke-width="3"/>
    <text x="154" y="868" fill="#ffc887" font-family="Arial, sans-serif" font-size="21" font-weight="800">REMAINING EVIDENCE BOUNDARY</text>
    <text x="154" y="914" fill="#ffffff" font-family="Arial, sans-serif" font-size="27" font-weight="700">Real multi-wallet writes, settlement and refund rehearsal remain.</text>
  </svg>`,
);
frames.endCard = overlayFrame("end-card", endCardBase, qrCode, 1332, 238);

const protectionOverlays = {
  fundingLock: renderSvg(
    "protection-funding-lock",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect x="910" y="78" width="828" height="172" rx="24" fill="#111522" fill-opacity="0.96" stroke="#e8a45a" stroke-width="4"/>
      <text x="950" y="130" fill="#b8becc" font-family="Arial, sans-serif" font-size="22" font-weight="700">PROTECTED FUNDING</text>
      <text x="950" y="191" fill="#ffffff" font-family="Arial, sans-serif" font-size="40" font-weight="800">£35.04 funded</text>
      <text x="1330" y="191" fill="#ffc887" font-family="Arial, sans-serif" font-size="36" font-weight="800">£18.91 outstanding</text>
      <rect x="950" y="209" width="748" height="25" rx="12" fill="#2d313b"/>
      <rect x="950" y="209" width="486" height="25" rx="12" fill="#6d45ff"/>
      <text x="1698" y="132" text-anchor="end" fill="#ffc887" font-family="Arial, sans-serif" font-size="22" font-weight="800">SETTLEMENT LOCKED</text>
    </svg>`,
  ),
  refundReady: renderSvg(
    "protection-refund-ready",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect x="194" y="130" width="1532" height="104" rx="26" fill="#151923" fill-opacity="0.96" stroke="#e8a45a" stroke-width="4"/>
      <text x="248" y="195" fill="#ffffff" font-family="Arial, sans-serif" font-size="36" font-weight="800">£35.04 FUNDED</text>
      <text x="624" y="195" fill="#ffc887" font-family="Arial, sans-serif" font-size="36" font-weight="800">£18.91 OUTSTANDING</text>
      <text x="1095" y="195" fill="#ffc887" font-family="Arial, sans-serif" font-size="30" font-weight="800">SETTLEMENT LOCKED</text>
      <text x="1668" y="195" text-anchor="end" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="30" font-weight="800">VENUE £0.00</text>
    </svg>`,
  ),
  refundReturned: renderSvg(
    "protection-refund-returned",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect x="360" y="130" width="1200" height="116" rx="28" fill="#14241a" fill-opacity="0.97" stroke="#7adf86" stroke-width="5"/>
      <text x="960" y="183" text-anchor="middle" fill="#a8f0ad" font-family="Arial, sans-serif" font-size="22" font-weight="800">PAYER-OWNED REFUND COMPLETE</text>
      <text x="960" y="226" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="40" font-weight="800">£35.04 RETURNED TO THE ORIGINAL CONTRIBUTOR</text>
    </svg>`,
  ),
};

const cues = [
  [0, 1.12, "heroHook", ["Four diners. One restaurant bill."], "01 / 08"],
  [1.12, 5, "heroHook", ["Nobody has to front the money."], "01 / 08", "cta"],
  [5, 5.19, "receipt", [], ""],
  [5.19, 7.7, "receipt", ["Start with the familiar GBP receipt."], "02 / 08"],
  [7.7, 10.9, "claim", ["Claim a whole item, or choose a share", "of something shared."], "02 / 08", "claim"],
  [10.9, 14.3, "claim", ["Wine, starters and extras stay visible to the table."], "02 / 08"],
  [14.3, 17.2, "claim", ["Your own pound total updates immediately."], "02 / 08"],
  [17.2, 21, "claim", [], ""],
  [21, 23.7, "remainderOff", ["Unclaimed value is never forced onto everyone."], "03 / 08"],
  [23.7, 26.4, "remainderOn", ["Only diners who opt in share the fair remainder."], "03 / 08", "toggle"],
  [26.4, 29, "remainderOn", ["Silence cannot become consent to pay."], "03 / 08"],
  [29, 34, "remainderOn", [], ""],
  [34, 38, "tip", ["Everyone votes on the tip; the median becomes", "the group choice."], "04 / 08", "tip"],
  [38, 41.3, "review", ["Then every participant reviews the same exact split."], "04 / 08", "approve"],
  [41.3, 45.2, "approved", ["Any change clears approval, so consent matches", "the current version."], "04 / 08"],
  [45.2, 49, "payOpen", [], ""],
  [49, 52.8, "payOpen", ["Funding is exact: each diner pays only the agreed amount."], "05 / 08", "pay", "", 0.12],
  [52.8, 56, "selfPaid", ["A friend can sponsor another diner's remaining balance."], "05 / 08", "sponsor"],
  [56, 58.28, "sponsored", ["The original obligation does not change."], "05 / 08", "", "fundingLock"],
  [58.28, 62.3, "sponsored", ["Settlement stays locked while £18.91 remains."], "05 / 08", "", "fundingLock"],
  [62.3, 67, "sponsored", [], "", "", "fundingLock"],
  [67, 67.17, "stageSettled", [], ""],
  [67.17, 70.5, "stageSettled", ["Stage Mode makes the same table state projector-ready."], "06 / 08"],
  [70.5, 75.8, "stageSettled", ["Participants, approvals, funding and activity", "stay visible across the room."], "06 / 08"],
  [75.8, 80, "stageSettled", ["It is the same data, simply arranged", "for everyone to follow."], "06 / 08"],
  [80, 85.2, "branchReady", ["From the same approved £53.95 bill,", "there are two outcomes."], "07 / 08"],
  [85.2, 88.2, "stageSettled", ["Exact funding unlocks settlement for the venue."], "07 / 08"],
  [88.2, 91.7, "stageRefund", ["Cancellation or expiry pays the venue nothing."], "07 / 08", "", "refundReady"],
  [91.7, 95.7, "stageReturned", ["Every refund returns to the account that paid,", "including a sponsor."], "07 / 08", "", "refundReturned"],
  [95.7, 99, "branchReturned", [], ""],
  [99, 101.2, "settled", ["Paid together. Nobody chased."], "08 / 08", "", "", 0.17],
  [101.2, 104.1, "whyMonad", [], ""],
  [104.1, 108.2, "whyMonad", ["Rehearsed on Hardhat 31337 and targeting Monad Testnet."], "08 / 08"],
  [108.2, 110.75, "endCard", ["Rehearsed on Hardhat 31337 and targeting Monad Testnet."], "08 / 08"],
  [110.75, 117, "endCard", [], ""],
];

function srtTimestamp(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

const srtCues = cues
  .filter(([, , , lines]) => lines.length > 0)
  .reduce((merged, [start, end, , lines, , , , captionDelay = 0]) => {
    const captionStart = start + captionDelay;
    const previous = merged.at(-1);
    if (
      previous &&
      previous.end === captionStart &&
      previous.lines.join("\n") === lines.join("\n")
    ) {
      previous.end = end;
    } else {
      merged.push({ start: captionStart, end, lines });
    }
    return merged;
  }, []);
const srt = srtCues
  .map(
    ({ start, end, lines }, index) =>
      `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${lines.join("\n")}\n`,
  )
  .join("\n");
writeFileSync(join(videoRoot, "taptab-demo-2min.srt"), srt);

const actionCoordinates = {
  cta: [1380, 250, 380, 532, 2.2],
  claim: [1390, 350, 320, 475, 2.8],
  toggle: [1240, 300, 1472, 486, 1.8],
  tip: [1210, 660, 1460, 468, 1.5],
  approve: [1050, 640, 1350, 484, 3.0],
  pay: [1000, 400, 320, 705, 3.4],
  sponsor: [1550, 600, 1130, 470, 2.8],
};

const cursorIcon = renderSvg(
  "action-cursor",
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="112" viewBox="0 0 96 112">
    <defs><filter id="shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="2" dy="4" stdDeviation="4" flood-opacity="0.48"/></filter></defs>
    <path d="M 10 8 L 39 76 L 52 55 L 76 80 L 89 67 L 64 44 L 85 36 Z" fill="#ffffff" stroke="#11141d" stroke-width="5" stroke-linejoin="round" filter="url(#shadow)"/>
  </svg>`,
);

const actionRings = {};
for (const [name, [, , x, y]] of Object.entries(actionCoordinates)) {
  actionRings[name] = renderSvg(
    `action-ring-${name}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <circle cx="${x}" cy="${y}" r="42" fill="#6d45ff" fill-opacity="0.15" stroke="#6d45ff" stroke-width="5"/>
      <circle cx="${x}" cy="${y}" r="17" fill="none" stroke="#d9d0ff" stroke-width="4"/>
    </svg>`,
  );
}

function subtitleSvg(index, lines, badge) {
  if (lines.length === 0) {
    return renderSvg(
      `cue-${String(index + 1).padStart(2, "0")}`,
      '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"/>',
      subtitleDir,
    );
  }
  const lineHeight = 45;
  const firstY = lines.length === 1 ? 1012 : 989;
  const text = lines
    .map(
      (line, lineIndex) =>
        `<text x="252" y="${firstY + lineIndex * lineHeight}" fill="#ffffff" font-family="Arial, sans-serif" font-size="37" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join("\n");
  return renderSvg(
    `cue-${String(index + 1).padStart(2, "0")}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <rect x="0" y="930" width="1920" height="150" fill="#0b0e16" fill-opacity="0.97"/>
      <rect x="0" y="930" width="1920" height="3" fill="#6d45ff"/>
      <rect x="60" y="970" width="156" height="66" rx="33" fill="#6d45ff"/>
      <text x="138" y="1013" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="23" font-weight="700">${badge}</text>
      ${text}
    </svg>`,
    subtitleDir,
  );
}

const segmentFiles = [];
for (let index = 0; index < cues.length; index += 1) {
  const [start, end, frameKey, lines, badge, action, emphasis, captionDelay = 0] = cues[index];
  const duration = end - start;
  const frameCount = Math.round(duration * 30);
  const subtitle = subtitleSvg(index, lines, badge);
  const output = join(segmentDir, `segment-${String(index + 1).padStart(2, "0")}.mp4`);
  const inputs = ["-i", frames[frameKey], "-i", subtitle];
  let filter =
    `[0:v]zoompan=z='1+0.014*on/${Math.max(frameCount - 1, 1)}':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=1920x1080:fps=30[bg];` +
    `[bg][1:v]overlay=0:0:eof_action=repeat:enable='gte(t,${captionDelay})'[captioned]`;
  let outputLabel = "captioned";
  if (action) {
    const [startX, startY, endX, endY, clickAt] = actionCoordinates[action];
    const travelDuration = Math.max(clickAt - 0.35, 0.5);
    inputs.push("-i", cursorIcon, "-i", actionRings[action]);
    filter +=
      `;[captioned][2:v]overlay=x='${startX - 10}+(${endX - startX})*min(max((t-0.12)/${travelDuration},0),1)':` +
      `y='${startY - 8}+(${endY - startY})*min(max((t-0.12)/${travelDuration},0),1)':` +
      `eof_action=repeat:enable='between(t,0.12,${clickAt + 0.42})'[cursorMoved];` +
      `[cursorMoved][3:v]overlay=0:0:eof_action=repeat:` +
      `enable='between(t,${clickAt - 0.18},${clickAt + 0.34})'[actioned]`;
    outputLabel = "actioned";
  }
  if (emphasis) {
    inputs.push("-i", protectionOverlays[emphasis]);
    const emphasisInput = action ? 4 : 2;
    filter += `;[${outputLabel}][${emphasisInput}:v]overlay=0:0:eof_action=repeat[emphasised]`;
    outputLabel = "emphasised";
  }
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    `[${outputLabel}]`,
    "-frames:v",
    String(frameCount),
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-an",
    output,
  ]);
  segmentFiles.push(output);
}

const concatFile = join(generated, "segments.ffconcat");
writeFileSync(
  concatFile,
  ["ffconcat version 1.0", ...segmentFiles.map((file) => `file '${file}'`)].join("\n") + "\n",
);

const videoOnly = join(generated, "video-only.mp4");
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
  videoOnly,
]);

const bed = join(audio, "ambient-bed-v2.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=73.42:sample_rate=48000:duration=${targetDuration}`,
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=110:sample_rate=48000:duration=${targetDuration}`,
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=146.83:sample_rate=48000:duration=${targetDuration}`,
  "-f",
  "lavfi",
  "-i",
  `anoisesrc=color=pink:sample_rate=48000:duration=${targetDuration}`,
  "-filter_complex",
  "[0:a]volume=0.018,pan=stereo|c0=c0|c1=0.35*c0[a0];" +
    "[1:a]volume=0.012,pan=stereo|c0=0.45*c0|c1=c0[a1];" +
    "[2:a]volume=0.008,pan=stereo|c0=0.75*c0|c1=c0[a2];" +
    "[3:a]highpass=f=100,lowpass=f=850,volume=0.0018,aformat=channel_layouts=stereo[noise];" +
    "[a0][a1][a2][noise]amix=inputs=4:normalize=0," +
    `afade=t=in:st=0:d=2,afade=t=out:st=${targetDuration - 2}:d=2,atrim=0:${targetDuration}[bed]`,
  "-map",
  "[bed]",
  "-ar",
  "48000",
  "-c:a",
  "pcm_s16le",
  bed,
]);

const click = join(audio, "ui-click-v2.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=900:sample_rate=48000:duration=0.065",
  "-af",
  "volume=0.07,afade=t=out:st=0.012:d=0.053,aformat=channel_layouts=stereo",
  "-c:a",
  "pcm_s16le",
  click,
]);

const confirm = join(audio, "ui-confirm-v2.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=660:sample_rate=48000:duration=0.20",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:sample_rate=48000:duration=0.20",
  "-filter_complex",
  "[0:a]volume=0.035,afade=t=out:st=0.08:d=0.12[a0];" +
    "[1:a]volume=0.028,adelay=55|55,afade=t=out:st=0.10:d=0.10[a1];" +
    "[a0][a1]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo[a]",
  "-map",
  "[a]",
  "-c:a",
  "pcm_s16le",
  confirm,
]);

const refund = join(audio, "ui-refund-v2.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=520:sample_rate=48000:duration=0.28",
  "-af",
  "volume=0.045,lowpass=f=700,afade=t=out:st=0.07:d=0.21,aformat=channel_layouts=stereo",
  "-c:a",
  "pcm_s16le",
  refund,
]);

const settle = join(audio, "ui-settle-v2.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=0.52",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=660:sample_rate=48000:duration=0.52",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:sample_rate=48000:duration=0.52",
  "-filter_complex",
  "[0:a]volume=0.03,afade=t=out:st=0.24:d=0.28[a0];" +
    "[1:a]volume=0.027,adelay=85|85,afade=t=out:st=0.27:d=0.25[a1];" +
    "[2:a]volume=0.022,adelay=170|170,afade=t=out:st=0.30:d=0.22[a2];" +
    "[a0][a1][a2]amix=inputs=3:normalize=0,aformat=channel_layouts=stereo[a]",
  "-map",
  "[a]",
  "-c:a",
  "pcm_s16le",
  settle,
]);

const narration = join(audio, "narration-v2.wav");
const narrationStarts = [0, 5, 21, 34, 49, 67, 80, 99];
const narrationInputs = [];
const narrationFilters = [];
for (let index = 0; index < 8; index += 1) {
  narrationInputs.push("-i", join(audio, `scene-${String(index + 1).padStart(2, "0")}.mp3`));
  const delay = narrationStarts[index] * 1000;
  const sceneEightEdits =
    index === 7
      ? "volume=0:enable='between(t,2.30,5.05)'," +
        "volume=0:enable='between(t,11.90,17.32)',"
      : "";
  narrationFilters.push(
    `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `${sceneEightEdits}loudnorm=I=-18:TP=-3:LRA=7,adelay=${delay}|${delay}[n${index}]`,
  );
}
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  ...narrationInputs,
  "-filter_complex",
  narrationFilters.join(";") +
    ";" +
    Array.from({ length: 8 }, (_, index) => `[n${index}]`).join("") +
    "amix=inputs=8:duration=longest:dropout_transition=0," +
    `apad=whole_dur=${targetDuration},atrim=0:${targetDuration}[narration]`,
  "-map",
  "[narration]",
  "-ar",
  "48000",
  "-c:a",
  "pcm_s16le",
  narration,
]);

const sfx = join(audio, "ui-sfx-v2.wav");
const clickTimes = [4.2, 10.5, 25.5, 35.5, 41.0, 52.4, 55.6, 96.4];
const clickSplits = clickTimes.map((_, index) => `[c${index}]`).join("");
const sfxFilters = [`[0:a]asplit=${clickTimes.length}${clickSplits}`];
for (let index = 0; index < clickTimes.length; index += 1) {
  const delay = Math.round(clickTimes[index] * 1000);
  sfxFilters.push(`[c${index}]adelay=${delay}|${delay}[cd${index}]`);
}
sfxFilters.push("[1:a]asplit=2[k0][k1]");
sfxFilters.push("[k0]adelay=43500|43500[kd0]");
sfxFilters.push("[k1]adelay=84500|84500[kd1]");
sfxFilters.push("[2:a]adelay=91000|91000[refund]");
sfxFilters.push("[3:a]adelay=99000|99000[settle]");
const sfxLabels = [
  ...clickTimes.map((_, index) => `[cd${index}]`),
  "[kd0]",
  "[kd1]",
  "[refund]",
  "[settle]",
].join("");
sfxFilters.push(
  `${sfxLabels}amix=inputs=${clickTimes.length + 4}:duration=longest:dropout_transition=0,` +
    `apad=whole_dur=${targetDuration},atrim=0:${targetDuration}[sfx]`,
);
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  click,
  "-i",
  confirm,
  "-i",
  refund,
  "-i",
  settle,
  "-filter_complex",
  sfxFilters.join(";"),
  "-map",
  "[sfx]",
  "-ar",
  "48000",
  "-c:a",
  "pcm_s16le",
  sfx,
]);

const finalAudio = join(audio, "master-audio-v2.wav");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  narration,
  "-i",
  bed,
  "-i",
  sfx,
  "-filter_complex",
  "[1:a]volume=0.52[bed];[2:a]volume=0.72[sfx];" +
    "[0:a][bed][sfx]amix=inputs=3:normalize=0:dropout_transition=0," +
    `loudnorm=I=-16:TP=-1.5:LRA=7,volume=-2.6dB,atrim=0:${targetDuration}[mix]`,
  "-map",
  "[mix]",
  "-ar",
  "48000",
  "-c:a",
  "pcm_s24le",
  finalAudio,
]);

// The primary master is the only retained MP4. Earlier builds also kept an
// identical copy inside v2/, needlessly doubling a public repository checkout.
const finalVideo = join(videoRoot, "taptab-demo-2min.mp4");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  videoOnly,
  "-i",
  finalAudio,
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
  String(targetDuration),
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
  "-ss",
  "112",
  "-i",
  finalVideo,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  poster,
]);

const contactSheet = join(reviewDir, "contact-sheet-v2.jpg");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  finalVideo,
  "-vf",
  "select='eq(n,30)+eq(n,330)+eq(n,750)+eq(n,1140)+eq(n,1590)+eq(n,1830)+eq(n,2220)+eq(n,2580)+eq(n,2700)+eq(n,2910)+eq(n,3150)+eq(n,3360)',setpts=N/FRAME_RATE/TB,scale=384:216,tile=4x3",
  "-frames:v",
  "1",
  "-q:v",
  "2",
  contactSheet,
]);

const reviewTimes = [2, 11, 27, 37, 46, 57, 65, 73, 86, 98, 108, 116.8];
const reviewNames = [2, 11, 27, 37, 46, 57, 65, 73, 86, 98, 108, 117];
for (let index = 0; index < reviewTimes.length; index += 1) {
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(reviewTimes[index]),
    "-i",
    finalVideo,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    join(reviewDir, `frame-${reviewNames[index]}.jpg`),
  ]);
}

run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-ss",
  "9.5",
  "-i",
  finalVideo,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  join(reviewDir, "action-size-v2.jpg"),
]);

const detailFrames = reviewTimes
  .map((time) => `eq(n,${Math.round(time * 30)})`)
  .join("+");
run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  finalVideo,
  "-vf",
  `select='${detailFrames}',setpts=N/FRAME_RATE/TB,scale=480:270,tile=4x3`,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  join(reviewDir, "detail-sheet-v2.jpg"),
]);

const probe = run("ffprobe", [
  "-v",
  "error",
  "-show_entries",
  "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
  "-of",
  "json",
  finalVideo,
]);
writeFileSync(join(reviewDir, "ffprobe-v2.json"), `${probe}\n`);

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const checksumFiles = [finalVideo, join(videoRoot, "taptab-demo-2min.srt"), poster];
writeFileSync(
  join(reviewDir, "SHA256SUMS.txt"),
  checksumFiles
    .map((file) => `${sha256(file)}  ${file.slice(root.length + 1)}`)
    .join("\n") + "\n",
);

const sourceNote = `# V2 audio provenance\n\n` +
  `- Narration: eight scene-specific exports generated with the project's ElevenLabs Voice Design voice, \`Nora - Blackpool Product Guide\`, using Eleven Multilingual v2.\n` +
  `- Scene 08: the localhost phrase (2.30–5.05 seconds) and obsolete closing claims (11.90 seconds to clip end) are muted at phrase boundaries. No replacement speech is synthesised.\n` +
  `- Ambient bed: generated locally from sine oscillators and filtered pink noise by \`build-v2.mjs\`.\n` +
  `- Interface sounds: generated locally from simple sine sources by \`build-v2.mjs\`.\n` +
  `- No stock music or third-party sound-effect library is used.\n` +
  `- Final evidence card: Monad Testnet contract \`${liveContract}\`, deployment transaction \`${deployTransaction}\`, Sourcify perfect match, and public readiness at \`${publicPreviewUrl}\` (200 OK).\n` +
  `- Remaining boundary: no real multi-wallet write, settlement or refund rehearsal is claimed.\n`;
writeFileSync(join(audio, "PROVENANCE.md"), sourceNote);

for (const temporaryFile of [bed, narration, sfx, finalAudio, videoOnly, concatFile]) {
  rmSync(temporaryFile, { force: true });
}
rmSync(segmentDir, { recursive: true, force: true });

console.log(finalVideo);
console.log(probe);

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import QRCode from "qrcode";

const root = resolve(import.meta.dirname, "../../../..");
const work = import.meta.dirname;
const generated = join(work, "generated");
const framesDir = join(generated, "frames");
const overlaysDir = join(generated, "overlays");
const audioDir = join(work, "audio");
const audioSourceDir = join(audioDir, "source");
const evidenceDir = join(work, "evidence");
const workDir = join(work, "work");
const output = join(work, "taptab-demo-2min30.mp4");
const poster = join(work, "taptab-demo-2min30-poster.png");
const captionsAss = join(work, "taptab-demo-2min30.ass");
const captionsSrt = join(work, "taptab-demo-2min30.srt");

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION = 150;
const FRAME_COUNT = FPS * DURATION;

const URL_ROOT = "https://taptab-eosin.vercel.app/";
const URL_BILL =
  "https://taptab-eosin.vercel.app/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live";
const URL_READY = "https://taptab-eosin.vercel.app/api/health/ready";
const CONTRACT = "0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198";
const SETTLEMENT = "0xc232584b63ad27e7aa53b2526a2bcf8ebb6765bd8657cc804b7e76ec48e6d885";
const CHAIN_ID = 10143;

const colours = {
  bg: "#090b12",
  panel: "#131722",
  panel2: "#1a1f2d",
  text: "#f7f7fb",
  muted: "#b5bac8",
  purple: "#8c72ff",
  purpleSoft: "#d7ceff",
  purpleDark: "#241c4e",
  green: "#72e392",
  greenSoft: "#c8f7d4",
  greenDark: "#102c1a",
  amber: "#ffb667",
  amberSoft: "#ffe0bc",
  amberDark: "#382313",
  red: "#ff7e8a",
};

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
  return (result.stdout ?? "").trim();
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
  return path;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textLine(x, y, text, size = 30, options = {}) {
  const {
    fill = colours.text,
    weight = 600,
    family = "Arial, sans-serif",
    anchor = "start",
    spacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}">${esc(text)}</text>`;
}

function lines(x, y, values, size = 30, gap = 42, options = {}) {
  return values.map((value, index) => textLine(x, y + index * gap, value, size, options)).join("\n");
}

function svgShell(body, background = colours.bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${background}"/>
        <stop offset="0.62" stop-color="#111524"/>
        <stop offset="1" stop-color="#221b44"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
        <feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000" flood-opacity="0.48"/>
      </filter>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    ${body}
  </svg>`;
}

function renderSvg(name, svg) {
  const svgPath = join(overlaysDir, `${name}.svg`);
  const pngPath = join(overlaysDir, `${name}.png`);
  writeFileSync(svgPath, svg);
  run("sips", ["-s", "format", "png", svgPath, "--out", pngPath]);
  return pngPath;
}

function fillImage(name, source) {
  const destination = join(framesDir, `${name}.png`);
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
    destination,
  ]);
  return destination;
}

function composite(name, background, foreground, x = 0, y = 0) {
  const destination = join(framesDir, `${name}.png`);
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
    destination,
  ]);
  return destination;
}

function phasePill(phase, tone = "purple", width = 530) {
  const colour = colours[tone];
  const dark = colours[`${tone}Dark`];
  return `<rect x="${1810 - width}" y="34" width="${width}" height="54" rx="27" fill="${dark}" stroke="${colour}" stroke-width="2"/>
    <circle cx="${1810 - width + 32}" cy="61" r="8" fill="${colour}"/>
    ${textLine(1810 - width + 54, 70, phase, 20, { fill: colours[`${tone}Soft`], weight: 800, spacing: 1.3 })}`;
}

function brandHeader(section, phase, tone = "purple") {
  return `<rect x="70" y="34" width="52" height="52" rx="14" fill="#6d45ff"/>
    ${textLine(96, 72, "T", 31, { weight: 850, anchor: "middle" })}
    ${textLine(142, 70, "TapTab", 28, { weight: 800 })}
    ${textLine(286, 69, section, 18, { fill: colours.muted, weight: 700, spacing: 1.3 })}
    ${phasePill(phase, tone)}`;
}

function bottomBoundary(text, tone = "purple") {
  return `<rect x="0" y="1014" width="1920" height="66" fill="#080a10"/>
    <rect x="70" y="1034" width="10" height="10" rx="5" fill="${colours[tone]}"/>
    ${textLine(98, 1050, text, 19, { fill: colours.muted, weight: 650 })}`;
}

function makeImageWindow(name, source, options) {
  const {
    section,
    phase,
    address,
    tone = "purple",
    headline,
    detail,
    contentX = 190,
    contentY = 146,
    contentW = 1540,
    contentH = 730,
  } = options;
  const base = renderSvg(
    `${name}-base`,
    svgShell(`<rect x="150" y="104" width="1620" height="810" rx="28" fill="#151923" stroke="${colours[tone]}" stroke-width="3" filter="url(#shadow)"/>
      <path d="M150 160h1620" stroke="#33394a" stroke-width="2"/>
      <circle cx="187" cy="132" r="8" fill="#ed6a5e"/><circle cx="215" cy="132" r="8" fill="#f4bf4f"/><circle cx="243" cy="132" r="8" fill="#61c554"/>
      <rect x="338" y="116" width="1030" height="34" rx="17" fill="#252a38"/>
      ${textLine(853, 140, address, 18, { fill: "#cfd2dc", weight: 650, anchor: "middle" })}
      ${brandHeader(section, phase, tone)}
      ${textLine(150, 964, headline, 36, { weight: 800 })}
      ${textLine(150, 999, detail, 21, { fill: colours.muted, weight: 600 })}
      ${bottomBoundary(
        tone === "purple"
          ? "LOCAL SAMPLE · deterministic walkthrough · no wallet transaction is claimed"
          : tone === "amber"
            ? "PROTECTED FAILURE PATH · local sample · venue receives £0"
            : "VERIFIED PUBLIC EVIDENCE · no new wallet write in this recording",
        tone,
      )}`),
  );
  const destination = join(framesDir, `${name}.png`);
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
    `[1:v]scale=${contentW}:${contentH}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${contentW}:${contentH}:(ow-iw)/2:(oh-ih)/2:color=0x11141d,setsar=1[shot];[0:v][shot]overlay=${contentX}:${contentY}[v]`,
    "-map",
    "[v]",
    "-frames:v",
    "1",
    destination,
  ]);
  return destination;
}

function statCard(x, y, w, h, eyebrow, headline, detail, tone = "purple") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="${colours.panel}" stroke="${colours[tone]}" stroke-width="3"/>
    ${textLine(x + 34, y + 52, eyebrow, 18, { fill: colours[`${tone}Soft`], weight: 800, spacing: 1.5 })}
    ${textLine(x + 34, y + 116, headline, 38, { weight: 800 })}
    ${lines(x + 34, y + 160, Array.isArray(detail) ? detail : [detail], 21, 31, { fill: colours.muted, weight: 600 })}`;
}

function localFeatureFrame(name, options) {
  const { title, subtitle, body, phase, tone = "purple", boundary } = options;
  const svg = svgShell(`${brandHeader("PRODUCT WALKTHROUGH", phase, tone)}
    ${textLine(88, 174, title, 62, { weight: 850 })}
    ${textLine(90, 224, subtitle, 25, { fill: colours.muted, weight: 600 })}
    ${body}
    ${bottomBoundary(boundary ?? "LOCAL SAMPLE · illustrated deterministic product state · no wallet write", tone)}`);
  return fillImage(name, renderSvg(name, svg));
}

function browserEvidenceFrame(name, options) {
  const {
    section,
    phase,
    address,
    eyebrow,
    title,
    subtitle,
    body,
    footer = "VERIFIED PUBLIC EVIDENCE · direct HTTPS/RPC read · no new wallet write",
  } = options;
  const svg = svgShell(`${brandHeader(section, phase, "green")}
    <rect x="92" y="108" width="1736" height="856" rx="30" fill="#111720" stroke="${colours.green}" stroke-width="3" filter="url(#shadow)"/>
    <path d="M92 174h1736" stroke="#2d4435" stroke-width="2"/>
    <circle cx="132" cy="141" r="8" fill="#ed6a5e"/><circle cx="160" cy="141" r="8" fill="#f4bf4f"/><circle cx="188" cy="141" r="8" fill="#61c554"/>
    <rect x="272" y="122" width="1410" height="38" rx="19" fill="#202934"/>
    ${textLine(977, 148, address, 20, { fill: "#d7e4da", weight: 650, anchor: "middle" })}
    ${textLine(138, 234, eyebrow, 19, { fill: colours.green, weight: 800, spacing: 1.8 })}
    ${textLine(138, 307, title, 50, { weight: 850 })}
    ${textLine(140, 350, subtitle, 22, { fill: colours.muted, weight: 600 })}
    ${body}
    <rect x="92" y="976" width="1736" height="70" rx="20" fill="${colours.greenDark}" stroke="#326941" stroke-width="2"/>
    ${textLine(132, 1021, footer, 19, { fill: colours.greenSoft, weight: 650 })}`);
  return fillImage(name, renderSvg(name, svg));
}

function monoBlock(x, y, w, h, rows, tone = "green") {
  const rowSvg = rows
    .map((row, index) => textLine(x + 28, y + 47 + index * 37, row, 21, {
      fill: index === 0 ? colours[`${tone}Soft`] : "#e5e9ed",
      weight: index === 0 ? 800 : 560,
      family: "Courier, monospace",
    }))
    .join("\n");
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#0b1017" stroke="#30463a" stroke-width="2"/>
    ${rowSvg}`;
}

function createFrames(evidence) {
  const screenshots = join(root, "docs/submission/screenshots");
  const cover = requireFile(join(screenshots, "taptab-project-cover-v1.png"), "project cover");
  const desktop = requireFile(join(screenshots, "desktop-overview.jpg"), "desktop overview");
  const mobile = requireFile(join(screenshots, "mobile-bill.jpg"), "mobile bill");
  const stage = requireFile(join(screenshots, "stage-mode.jpg"), "Stage Mode");

  const coverFull = fillImage("cover-full", cover);
  const coverOverlay = renderSvg(
    "cover-overlay",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.48" stop-color="#070710" stop-opacity="0"/><stop offset="1" stop-color="#070710" stop-opacity="0.94"/></linearGradient></defs>
      <rect width="1920" height="1080" fill="url(#shade)"/>
      <rect x="90" y="850" width="650" height="72" rx="36" fill="#231a4d" stroke="${colours.purple}" stroke-width="3"/>
      ${textLine(415, 896, "TAPTAB · BUILT ON MONAD TESTNET", 25, { fill: colours.purpleSoft, weight: 850, anchor: "middle", spacing: 1.2 })}
      ${textLine(90, 982, "A complete 2:30 product and public-chain evidence walkthrough", 31, { weight: 780 })}
      ${textLine(1830, 1024, "Nobody fronts the bill.", 25, { fill: colours.greenSoft, weight: 750, anchor: "end" })}
    </svg>`,
  );

  const frames = {};
  frames.cover = composite("cover", coverFull, coverOverlay);
  frames.overview = makeImageWindow("overview", desktop, {
    section: "LOCAL SAMPLE",
    phase: "LOCAL SAMPLE · £53.95 · NO WALLET WRITE",
    address: "taptab.local · complete desktop viewport",
    headline: "Start in pounds. Keep MON behind the familiar interface.",
    detail: "The full application window remains visible; this is the deterministic sample journey.",
  });

  frames.claimWhole = makeImageWindow("claim-whole", mobile, {
    section: "LOCAL SAMPLE",
    phase: "LOCAL SAMPLE · WHOLE ITEMS + SHARES",
    address: "taptab.local · complete mobile viewport",
    headline: "Claim the whole item you had.",
    detail: "The complete mobile viewport is retained, including current share and next-step controls.",
    contentX: 660,
    contentY: 146,
    contentW: 600,
    contentH: 730,
  });
  const claimWholeOverlay = renderSvg(
    "claim-whole-callouts",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      ${statCard(170, 280, 430, 250, "WHOLE ITEM", "Margherita · Mine", ["One tap assigns the whole row.", "£12.00 enters your share."], "purple")}
      ${statCard(1320, 280, 430, 250, "CURRENT TOTAL", "£23.64", ["Pounds update immediately.", "No Testnet receipt is claimed."], "purple")}
    </svg>`,
  );
  frames.claimWhole = composite("claim-whole-labelled", frames.claimWhole, claimWholeOverlay);

  frames.claimShared = makeImageWindow("claim-shared", mobile, {
    section: "LOCAL SAMPLE",
    phase: "LOCAL SAMPLE · SELECTED SHARES",
    address: "taptab.local · complete mobile viewport",
    headline: "Share wine, starters or a taxi between selected diners.",
    detail: "TapTab records each selected portion rather than forcing an equal table-wide split.",
    contentX: 660,
    contentY: 146,
    contentW: 600,
    contentH: 730,
  });
  const sharedOverlay = renderSvg(
    "claim-shared-callouts",
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      ${statCard(170, 275, 430, 285, "SELECTED SHARES", "House red · 4 shares", ["Amina · Theo · Jules", "Only chosen diners receive a share."], "purple")}
      ${statCard(1320, 275, 430, 285, "FAIR ACCOUNTING", "Each portion is visible", ["Shared extras remain itemised.", "Pound totals update at once."], "purple")}
    </svg>`,
  );
  frames.claimShared = composite("claim-shared-labelled", frames.claimShared, sharedOverlay);

  frames.remainder = localFeatureFrame("remainder", {
    phase: "LOCAL SAMPLE · FAIR REMAINDER",
    title: "Unclaimed extras are opt-in.",
    subtitle: "People who did not volunteer never inherit the remainder.",
    body: `${statCard(92, 300, 525, 410, "AMINA", "Opted in", ["Shares fair remainder", "£5.50 estimated"], "purple")}
      ${statCard(698, 300, 525, 410, "THEO", "Opted out", ["No remainder allocated", "Choice stays explicit"], "purple")}
      ${statCard(1304, 300, 525, 410, "UNCLAIMED EXTRA", "£11.00", ["Divided only among volunteers", "No silent consent"], "purple")}
      <rect x="92" y="764" width="1737" height="126" rx="28" fill="${colours.purpleDark}" stroke="${colours.purple}" stroke-width="3"/>
      ${textLine(132, 817, "FAIR REMAINDER", 19, { fill: colours.purpleSoft, weight: 850, spacing: 1.5 })}
      ${textLine(132, 858, "A simple rule the entire table can read before approval.", 29, { weight: 760 })}`,
  });

  frames.tip = localFeatureFrame("tip-vote", {
    phase: "LOCAL SAMPLE · GROUP TIP VOTE",
    title: "The table chooses the tip together.",
    subtitle: "Every vote is visible; the group result is deterministic.",
    body: `<rect x="92" y="300" width="1736" height="450" rx="34" fill="${colours.panel}" stroke="${colours.purple}" stroke-width="3"/>
      ${["0%", "10%", "12.5%", "CUSTOM"].map((vote, index) => `<rect x="${150 + index * 405}" y="390" width="330" height="160" rx="28" fill="${index === 2 ? colours.purpleDark : colours.panel2}" stroke="${index === 2 ? colours.purple : "#353b4d"}" stroke-width="3"/>
        ${textLine(315 + index * 405, 482, vote, 43, { fill: index === 2 ? colours.purpleSoft : colours.muted, weight: 850, anchor: "middle" })}`).join("\n")}
      <rect x="420" y="628" width="1080" height="88" rx="44" fill="#15261d" stroke="${colours.green}" stroke-width="2"/>
      ${textLine(960, 683, "GROUP RESULT · 11.25% · chosen together", 28, { fill: colours.greenSoft, weight: 800, anchor: "middle" })}
      ${textLine(92, 842, "Silence never becomes consent to pay.", 32, { weight: 760 })}`,
  });

  frames.review = localFeatureFrame("review", {
    phase: "LOCAL SAMPLE · REVIEW VERSION 1",
    title: "Everyone approves the same split.",
    subtitle: "Item claims, extras, tip and totals are locked to one visible version.",
    body: `${[
      ["YOU", "£23.64", "Approved"],
      ["AMINA", "£14.18", "Approved"],
      ["THEO", "£8.90", "Approved"],
      ["JULES", "£7.23", "Approved"],
    ].map((row, index) => {
      const x = 92 + (index % 2) * 870;
      const y = 316 + Math.floor(index / 2) * 218;
      return `<rect x="${x}" y="${y}" width="790" height="170" rx="28" fill="${colours.panel}" stroke="${colours.green}" stroke-width="2"/>
        ${textLine(x + 38, y + 56, row[0], 19, { fill: colours.greenSoft, weight: 800, spacing: 1.5 })}
        ${textLine(x + 38, y + 120, row[1], 36, { weight: 820 })}
        ${textLine(x + 740, y + 100, `✓ ${row[2]}`, 23, { fill: colours.green, weight: 800, anchor: "end" })}`;
    }).join("\n")}
      <rect x="92" y="772" width="1660" height="102" rx="26" fill="${colours.purpleDark}" stroke="${colours.purple}" stroke-width="3"/>
      ${textLine(132, 834, "4 / 4 approvals · split version 1", 28, { fill: colours.purpleSoft, weight: 800 })}`,
  });

  frames.approvalReset = localFeatureFrame("approval-reset", {
    phase: "LOCAL SAMPLE · CONSENT RESET",
    title: "Any split change clears old approvals.",
    subtitle: "Nobody remains signed up to a calculation they have not seen.",
    body: `<rect x="92" y="300" width="760" height="470" rx="34" fill="${colours.panel}" stroke="${colours.purple}" stroke-width="3"/>
      ${textLine(138, 372, "CHANGE DETECTED", 19, { fill: colours.purpleSoft, weight: 850, spacing: 1.6 })}
      ${lines(138, 458, ["Theo changes", "fair remainder", "preference"], 48, 58, { weight: 850 })}
      <path d="M902 520h122" stroke="${colours.purple}" stroke-width="8" stroke-linecap="round"/><path d="m1008 493 32 27-32 27" fill="none" stroke="${colours.purple}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="1080" y="300" width="748" height="470" rx="34" fill="#221923" stroke="${colours.red}" stroke-width="3"/>
      ${textLine(1126, 372, "SPLIT VERSION 2", 19, { fill: "#ffd0d5", weight: 850, spacing: 1.6 })}
      ${textLine(1126, 498, "0 / 4", 92, { weight: 850 })}
      ${textLine(1370, 493, "approvals", 31, { fill: colours.muted, weight: 650 })}
      ${textLine(1126, 588, "Previous consent cleared", 30, { fill: colours.red, weight: 800 })}
      ${textLine(1126, 638, "Review the new totals, then approve again.", 22, { fill: colours.muted, weight: 600 })}`,
  });

  frames.fundingLocked = localFeatureFrame("funding-locked", {
    phase: "LOCAL SAMPLE · SAMPLE PAYMENT",
    title: "Settlement stays locked until every penny arrives.",
    subtitle: "Protected funding is exact, not best effort.",
    body: `<rect x="92" y="300" width="1736" height="480" rx="34" fill="${colours.panel}" stroke="${colours.purple}" stroke-width="3"/>
      ${textLine(140, 378, "GROUP TOTAL", 19, { fill: colours.purpleSoft, weight: 850, spacing: 1.5 })}
      ${textLine(140, 468, "£53.95", 72, { weight: 850 })}
      ${textLine(640, 378, "FUNDED", 19, { fill: colours.greenSoft, weight: 850, spacing: 1.5 })}
      ${textLine(640, 468, "£35.04", 72, { fill: colours.green, weight: 850 })}
      ${textLine(1160, 378, "MISSING", 19, { fill: colours.amberSoft, weight: 850, spacing: 1.5 })}
      ${textLine(1160, 468, "£18.91", 72, { fill: colours.amber, weight: 850 })}
      <rect x="140" y="560" width="1600" height="24" rx="12" fill="#2c3240"/>
      <rect x="140" y="560" width="1039" height="24" rx="12" fill="${colours.green}"/>
      <rect x="140" y="638" width="1600" height="88" rx="26" fill="#281b21" stroke="${colours.red}" stroke-width="2"/>
      ${textLine(940, 692, "SETTLEMENT LOCKED · £18.91 remains", 28, { fill: "#ffd0d5", weight: 850, anchor: "middle" })}`,
  });

  frames.sponsor = localFeatureFrame("sponsor", {
    phase: "LOCAL SAMPLE · SPONSOR A FRIEND",
    title: "Cover a friend without rewriting what they owed.",
    subtitle: "The payment source changes; the agreed obligation stays auditable.",
    body: `<rect x="92" y="300" width="760" height="500" rx="34" fill="${colours.panel}" stroke="${colours.purple}" stroke-width="3"/>
      ${textLine(138, 376, "YOU", 19, { fill: colours.purpleSoft, weight: 850, spacing: 1.6 })}
      ${textLine(138, 480, "Cover Theo's", 51, { weight: 850 })}
      ${textLine(138, 544, "remaining share", 51, { weight: 850 })}
      ${textLine(138, 640, "£18.91 sample contribution", 28, { fill: colours.purpleSoft, weight: 750 })}
      <rect x="138" y="692" width="490" height="68" rx="34" fill="${colours.purple}"/>
      ${textLine(383, 736, "SPONSOR THEO", 22, { weight: 850, anchor: "middle" })}
      <rect x="950" y="300" width="878" height="500" rx="34" fill="#11261a" stroke="${colours.green}" stroke-width="3"/>
      ${textLine(1000, 376, "AFTER SPONSOR PAYMENT", 19, { fill: colours.greenSoft, weight: 850, spacing: 1.6 })}
      ${textLine(1000, 500, "£53.95 / £53.95", 58, { fill: colours.green, weight: 850 })}
      ${textLine(1000, 586, "Exactly funded", 34, { weight: 800 })}
      ${textLine(1000, 646, "Settlement is now permitted.", 24, { fill: colours.muted, weight: 650 })}`,
  });

  frames.stage = makeImageWindow("stage", stage, {
    section: "LOCAL SAMPLE",
    phase: "LOCAL SAMPLE · STAGE MODE",
    address: "taptab.local/stage · full projector viewport",
    headline: "Stage Mode makes the table state room-readable.",
    detail: "Participants, approvals, QR and activity remain visible from across the room.",
    contentX: 170,
    contentY: 146,
    contentW: 1580,
    contentH: 730,
  });

  frames.stageSettled = localFeatureFrame("stage-settled", {
    phase: "LOCAL SAMPLE · EXACT FUNDING",
    title: "Exact funding unlocks settlement.",
    subtitle: "A room-readable final state closes the sample journey.",
    body: `<rect x="92" y="300" width="1736" height="510" rx="34" fill="#101c16" stroke="${colours.green}" stroke-width="4"/>
      ${textLine(960, 406, "TABLE 7 · SETTLED", 22, { fill: colours.greenSoft, weight: 850, anchor: "middle", spacing: 2 })}
      ${textLine(960, 550, "£53.95", 104, { fill: colours.green, weight: 850, anchor: "middle" })}
      ${textLine(960, 622, "exactly funded", 31, { weight: 780, anchor: "middle" })}
      <rect x="450" y="682" width="1020" height="82" rx="41" fill="${colours.greenDark}" stroke="#356f46" stroke-width="2"/>
      ${textLine(960, 734, "✓ Settlement protection satisfied", 27, { fill: colours.greenSoft, weight: 800, anchor: "middle" })}`,
  });

  frames.refundOpen = localFeatureFrame("refund-open", {
    tone: "amber",
    phase: "PROTECTED FAILURE PATH · LOCAL SAMPLE",
    title: "Cancelled or expired? Contributions become refunds.",
    subtitle: "An incomplete bill cannot settle to the venue.",
    boundary: "PROTECTED FAILURE PATH · local sample · refund belongs to the original contributor",
    body: `<rect x="92" y="300" width="760" height="470" rx="34" fill="${colours.amberDark}" stroke="${colours.amber}" stroke-width="3"/>
      ${textLine(138, 376, "VENUE RECEIVES", 19, { fill: colours.amberSoft, weight: 850, spacing: 1.6 })}
      ${textLine(138, 516, "£0", 112, { fill: colours.amber, weight: 850 })}
      ${textLine(138, 602, "Incomplete settlement is blocked.", 26, { fill: colours.amberSoft, weight: 700 })}
      <rect x="940" y="300" width="888" height="470" rx="34" fill="${colours.panel}" stroke="${colours.amber}" stroke-width="3"/>
      ${textLine(988, 376, "REFUNDS OPEN", 19, { fill: colours.amberSoft, weight: 850, spacing: 1.6 })}
      ${lines(988, 476, ["Original contributors", "claim their own funds"], 49, 61, { weight: 850 })}
      ${textLine(988, 650, "No organiser custody. No venue payout.", 26, { fill: colours.muted, weight: 650 })}`,
  });

  frames.refundClaim = localFeatureFrame("refund-claim", {
    tone: "amber",
    phase: "PROTECTED FAILURE PATH · REFUND CLAIM",
    title: "The refund belongs to the contributor.",
    subtitle: "Sponsorship does not redirect the refund to the sponsored diner.",
    boundary: "PROTECTED FAILURE PATH · local sample · Testnet MON has no cash value",
    body: `<rect x="92" y="300" width="1736" height="500" rx="34" fill="${colours.panel}" stroke="${colours.amber}" stroke-width="3"/>
      ${textLine(140, 388, "ORIGINAL CONTRIBUTOR", 19, { fill: colours.amberSoft, weight: 850, spacing: 1.6 })}
      ${textLine(140, 490, "You sponsored Theo", 50, { weight: 850 })}
      ${textLine(140, 558, "Refund returns to you", 50, { fill: colours.amber, weight: 850 })}
      <rect x="140" y="650" width="1540" height="86" rx="43" fill="${colours.amberDark}" stroke="#704620" stroke-width="2"/>
      ${textLine(910, 705, "REFUND CLAIMABLE · contributor-owned pull payment", 27, { fill: colours.amberSoft, weight: 800, anchor: "middle" })}`,
  });

  frames.vercel = browserEvidenceFrame("vercel-live", {
    section: "PUBLIC DEPLOYMENT",
    phase: "LIVE MONAD TESTNET EVIDENCE · CHAIN 10143",
    address: URL_ROOT,
    eyebrow: "VERIFIED HTTPS RESPONSE · 8 AUG 2026",
    title: "The Vercel application is live.",
    subtitle: "Public hostname and server response verified directly; this panel is not a browser recreation.",
    body: `${statCard(138, 410, 500, 320, "PUBLIC URL", "HTTP 200", ["Content type: text/html", "Response time at capture: 0.403 s"], "green")}
      ${statCard(708, 410, 500, 320, "CANONICAL BILL", "Bill 2", ["£48.50 receipt", "Contract state: Draft"], "green")}
      ${statCard(1278, 410, 500, 320, "NETWORK", "Monad Testnet", ["Chain ID 10143", "Wallet write: none in this video"], "green")}
      <rect x="138" y="780" width="1640" height="116" rx="24" fill="${colours.greenDark}" stroke="#386f48" stroke-width="2"/>
      ${textLine(958, 850, "taptab-eosin.vercel.app", 38, { fill: colours.greenSoft, weight: 850, anchor: "middle" })}`,
  });

  frames.bill2 = browserEvidenceFrame("bill2-rpc", {
    section: "PUBLIC RPC READ",
    phase: "LIVE MONAD TESTNET EVIDENCE · CHAIN 10143",
    address: URL_BILL,
    eyebrow: "VERIFIED RPC READ · GETBILL(2)",
    title: "Bill 2 is publicly readable on Monad Testnet.",
    subtitle: "The £48.50 interface receipt and contract state are distinct from the settled historical Bill 3.",
    body: `${monoBlock(138, 408, 1640, 324, [
      "eth_chainId                    0x279f  →  10143",
      "contract                       0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198",
      "getBill(2).state                1  →  Draft",
      "metadata.receipt.subtotal       £48.50",
      "settlement mode                 scaled-testnet-demo",
    ])}
      <rect x="138" y="776" width="1640" height="120" rx="24" fill="#141e19" stroke="#386f48" stroke-width="2"/>
      ${textLine(182, 829, "CREATION TRANSACTION · SUCCESS", 19, { fill: colours.green, weight: 850, spacing: 1.5 })}
      ${textLine(182, 872, "0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70", 22, { fill: "#e1f7e6", weight: 600, family: "Courier, monospace" })}`,
  });

  frames.ready = browserEvidenceFrame("readiness", {
    section: "VERCEL READINESS",
    phase: "LIVE MONAD TESTNET EVIDENCE · CHAIN 10143",
    address: URL_READY,
    eyebrow: `GENUINE HTTPS RESPONSE · ${evidence.readiness.checkedAt}`,
    title: "HTTP 200 · every required check passes.",
    subtitle: "The public deployment reached the configured RPC, network, contract and canonical bill.",
    body: `${monoBlock(138, 408, 1000, 394, [
      '{ "status": "ready",',
      '  "configuration": "pass",',
      '  "rpc":           "pass",',
      '  "network":       "pass",',
      '  "contract":      "pass",',
      '  "bill":          "pass"',
      '}',
    ])}
      <rect x="1192" y="408" width="586" height="394" rx="24" fill="${colours.greenDark}" stroke="${colours.green}" stroke-width="3"/>
      ${textLine(1234, 476, "NETWORK", 19, { fill: colours.greenSoft, weight: 850, spacing: 1.5 })}
      ${textLine(1234, 570, "10143", 72, { fill: colours.green, weight: 850 })}
      ${textLine(1234, 622, "Monad Testnet", 27, { weight: 760 })}
      ${textLine(1234, 700, "Observed block", 19, { fill: colours.muted, weight: 650 })}
      ${textLine(1234, 754, evidence.readiness.blockNumber, 35, { fill: colours.greenSoft, weight: 800, family: "Courier, monospace" })}`,
  });

  frames.readyChecks = browserEvidenceFrame("readiness-checks", {
    section: "VERCEL READINESS",
    phase: "LIVE MONAD TESTNET EVIDENCE · CHAIN 10143",
    address: URL_READY,
    eyebrow: "WHAT THIS PROVES",
    title: "The deployed app can read Monad Testnet.",
    subtitle: "Readiness is public read evidence, not a newly broadcast contribution or settlement.",
    body: `${[
      ["01", "CONFIGURATION", "pass"],
      ["02", "RPC", "pass"],
      ["03", "NETWORK", "pass"],
      ["04", "CONTRACT", "pass"],
      ["05", "BILL 2", "pass"],
    ].map((row, index) => {
      const x = 138 + index * 328;
      return `<rect x="${x}" y="430" width="280" height="310" rx="28" fill="#13231a" stroke="${colours.green}" stroke-width="2"/>
        ${textLine(x + 30, 490, row[0], 20, { fill: colours.greenSoft, weight: 850 })}
        ${textLine(x + 30, 590, "✓", 64, { fill: colours.green, weight: 850 })}
        ${textLine(x + 30, 658, row[1], 23, { weight: 850 })}
        ${textLine(x + 30, 700, row[2], 21, { fill: colours.greenSoft, weight: 700 })}`;
    }).join("\n")}
      ${textLine(138, 858, "Public read connectivity confirmed at the timestamp shown in the genuine response.", 25, { fill: colours.muted, weight: 650 })}`,
  });

  frames.contract = browserEvidenceFrame("contract-source", {
    section: "PUBLIC CONTRACT",
    phase: "LIVE MONAD TESTNET EVIDENCE · CHAIN 10143",
    address: `https://testnet.monadscan.com/address/${CONTRACT}#code`,
    eyebrow: "VERIFIED MONADSCAN HTML RESPONSE · 8 AUG 2026",
    title: "Deployed bytecode and published source match exactly.",
    subtitle: "Monadscan labels the source as verified with an Exact Match. Source publication is not an audit.",
    body: `<rect x="138" y="420" width="1640" height="350" rx="30" fill="#101b15" stroke="${colours.green}" stroke-width="3"/>
      ${textLine(188, 492, "TAPTAB CONTRACT · MONAD TESTNET", 20, { fill: colours.greenSoft, weight: 850, spacing: 1.6 })}
      ${textLine(188, 575, CONTRACT, 31, { weight: 700, family: "Courier, monospace" })}
      <rect x="188" y="632" width="360" height="76" rx="38" fill="${colours.greenDark}" stroke="${colours.green}" stroke-width="2"/>
      ${textLine(368, 680, "SOURCE CODE VERIFIED", 20, { fill: colours.greenSoft, weight: 850, anchor: "middle" })}
      <rect x="580" y="632" width="280" height="76" rx="38" fill="#173e25" stroke="${colours.green}" stroke-width="2"/>
      ${textLine(720, 680, "EXACT MATCH", 20, { fill: colours.greenSoft, weight: 850, anchor: "middle" })}
      ${textLine(138, 846, "Published settings: Solidity 0.8.24 · optimiser 200 runs · EVM paris · MIT", 24, { fill: colours.muted, weight: 650 })}`,
  });

  frames.sourceMatch = browserEvidenceFrame("source-match", {
    section: "SOURCE MATCH RECORD",
    phase: "LIVE MONAD TESTNET EVIDENCE · CHAIN 10143",
    address: `https://monadvision.com/contracts/full_match/10143/${CONTRACT}/`,
    eyebrow: "RETAINED EXPLORER VERIFICATION RECORD",
    title: "MonadVision reports a Sourcify full match.",
    subtitle: "This wording records the explorer's report; it is not a fresh independent Sourcify API verification.",
    body: `<rect x="138" y="420" width="1640" height="350" rx="30" fill="#101b15" stroke="${colours.green}" stroke-width="3"/>
      ${textLine(188, 492, "MONADVISION REPORTS", 20, { fill: colours.greenSoft, weight: 850, spacing: 1.6 })}
      ${textLine(188, 600, "Sourcify · full match", 61, { fill: colours.green, weight: 850 })}
      ${textLine(188, 686, CONTRACT, 26, { weight: 650, family: "Courier, monospace" })}
      <rect x="138" y="810" width="1640" height="86" rx="24" fill="#2a2114" stroke="${colours.amber}" stroke-width="2"/>
      ${textLine(958, 865, "SOURCE MATCH IS NOT A SECURITY AUDIT", 23, { fill: colours.amberSoft, weight: 850, anchor: "middle", spacing: 1.3 })}`,
  });

  frames.settlement = browserEvidenceFrame("settlement", {
    section: "HISTORICAL SETTLEMENT",
    phase: "BILL 3 · SUCCESS · HISTORICAL REPLAY",
    address: `https://testnet.monadscan.com/tx/${SETTLEMENT}`,
    eyebrow: "DIRECT RPC RECEIPT · NO NEW WRITE",
    title: "Bill 3 settlement succeeded on Monad Testnet.",
    subtitle: "This is a genuine historical receipt replayed for judging evidence.",
    body: `<rect x="138" y="402" width="500" height="410" rx="30" fill="#102b1a" stroke="${colours.green}" stroke-width="4"/>
      ${textLine(182, 468, "STATUS", 19, { fill: colours.greenSoft, weight: 850, spacing: 1.6 })}
      ${textLine(182, 578, "SUCCESS", 62, { fill: colours.green, weight: 850 })}
      ${textLine(182, 650, "receipt status · 0x1", 24, { weight: 700 })}
      ${textLine(182, 738, "Block 51,739,005", 28, { fill: colours.greenSoft, weight: 800 })}
      ${monoBlock(696, 402, 1082, 410, [
        "transactionHash",
        "0xc232584b63ad27e7aa53b2526a2bcf8ebb6765bd8657cc804b7e76ec48e6d885",
        "to",
        "0xa2fb0b3bf41b0b50687f4807e8a1ccc346faa198",
        "event  BillSettled(3)",
        "captured by direct Monad Testnet RPC read",
      ])}
      ${textLine(138, 884, "Historical replay · no wallet transaction was submitted for this recording", 24, { fill: colours.muted, weight: 650 })}`,
  });

  frames.end = browserEvidenceFrame("end-card", {
    section: "OPEN THE LIVE BILL",
    phase: "TAPTAB · MONAD TESTNET · CHAIN 10143",
    address: URL_BILL,
    eyebrow: "PUBLIC FALLBACK DEMO COMPLETE",
    title: "Nobody fronts the bill.",
    subtitle: "Scan to open canonical Bill 2 on the live Vercel deployment.",
    body: `<rect x="138" y="404" width="1040" height="420" rx="34" fill="#17182a" stroke="${colours.purple}" stroke-width="3"/>
      ${textLine(188, 480, "LIVE VERCEL APPLICATION", 20, { fill: colours.purpleSoft, weight: 850, spacing: 1.6 })}
      ${textLine(188, 566, "taptab-eosin.vercel.app", 44, { weight: 850 })}
      ${textLine(188, 638, "Monad Testnet · chain 10143", 28, { fill: colours.greenSoft, weight: 780 })}
      ${textLine(188, 700, CONTRACT, 23, { fill: "#e0e3eb", weight: 650, family: "Courier, monospace" })}
      ${textLine(188, 770, "Bill 2 · £48.50 · Contract state: Draft", 25, { fill: colours.muted, weight: 700 })}
      <rect x="1260" y="392" width="470" height="470" rx="34" fill="#fff"/>
      ${textLine(1495, 918, "SCAN · OPEN BILL 2", 21, { fill: colours.text, weight: 850, anchor: "middle" })}`,
    footer: "GBP values are interface references · Testnet MON has no cash value",
  });

  return frames;
}

function createCaptions() {
  const cues = [
    [0.52, 3.73, "TapTab on Monad splits restaurant bills, so nobody fronts the money."],
    [7.52, 11.57, "This £53.95 table is a clearly labelled local sample."],
    [11.82, 15.85, "Diners claim whole items or selected shares of wine and starters."],
    [15.85, 17.69, "Each pound total updates instantly."],
    [31.54, 33.65, "Only volunteers share the fair remainder."],
    [33.91, 37.82, "The table votes on the tip, then every diner approves the same split."],
    [38.28, 39.71, "Any change clears consent."],
    [45.53, 47.72, "Payment opens only after approval."],
    [48.14, 50.80, "Each diner funds exactly what they owe,"],
    [50.80, 54.22, "or sponsors somebody else without changing the underlying obligation."],
    [54.66, 56.85, "If £18.91 is still missing,"],
    [56.85, 58.73, "settlement stays locked."],
    [59.07, 61.48, "Once the full £53.95 arrives,"],
    [61.48, 62.99, "the venue can be paid."],
    [73.53, 75.70, "Stage Mode turns the same live table state"],
    [75.70, 77.83, "into a room-readable progress board."],
    [83.12, 85.25, "The contract protects both outcomes."],
    [85.25, 87.85, "Exact funding unlocks settlement."],
    [88.22, 90.85, "Cancellation or expiry pays the venue nothing,"],
    [90.85, 93.50, "and opens refunds to each original contributor,"],
    [93.50, 95.59, "including a sponsor."],
    [96.54, 100.00, "Now switch from the £53.95 local sample"],
    [100.00, 101.46, "to live evidence."],
    [101.97, 105.80, "Bill 2 represents £48.50 on Monad Testnet,"],
    [105.80, 107.95, "with a confirmed creation transaction."],
    [108.44, 112.51, "Monad turns claims, approvals, sponsored payments and refunds"],
    [112.51, 115.05, "into shared state for the whole table,"],
    [115.05, 116.21, "without a central bill keeper."],
  ];

  const assTime = (seconds) => {
    const centiseconds = Math.round(seconds * 100);
    const hours = Math.floor(centiseconds / 360000);
    const minutes = Math.floor((centiseconds % 360000) / 6000);
    const secs = Math.floor((centiseconds % 6000) / 100);
    const cs = centiseconds % 100;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  };
  const srtTime = (seconds) => {
    const milliseconds = Math.round(seconds * 1000);
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    const secs = Math.floor((milliseconds % 60000) / 1000);
    const ms = milliseconds % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  };

  const ass = `[Script Info]
Title: TapTab 2:30 fallback demo
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,38,&H00FFFFFF,&H00FFFFFF,&H00101016,&H9C101016,-1,0,0,0,100,100,0,0,3,2,0,2,130,130,104,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cues.map(([start, end, text]) => `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text.replaceAll("\n", "\\N")}`).join("\n")}
`;
  writeFileSync(captionsAss, ass);
  writeFileSync(
    captionsSrt,
    cues
      .map(([start, end, text], index) => `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`)
      .join("\n"),
  );
  return cues;
}

function createAudio() {
  const download = "/Users/darkcomet/Downloads";
  const sourceFiles = [
    "ElevenLabs_2026-08-07T17_26_26_Nora - Blackpool Product Guide_gen_sp100_s50_sb75_se0_b_m2.mp3",
    "ElevenLabs_2026-08-07T17_28_06_Nora - Blackpool Product Guide_gen_sp100_s50_sb75_se0_b_m2.mp3",
    "ElevenLabs_2026-08-07T17_28_28_Nora - Blackpool Product Guide_gen_sp100_s50_sb75_se0_b_m2.mp3",
    "ElevenLabs_2026-08-07T17_28_44_Nora - Blackpool Product Guide_gen_sp100_s50_sb75_se0_b_m2.mp3",
    "ElevenLabs_2026-08-07T17_29_06_Nora - Blackpool Product Guide_gen_sp100_s50_sb75_se0_b_m2.mp3",
    "ElevenLabs_2026-08-07T17_29_23_Nora - Blackpool Product Guide_gen_sp100_s50_sb75_se0_b_m2.mp3",
    "ElevenLabs_2026-08-07T17_30_04_Nora - Blackpool Product Guide_gen_sp100_s50_sb75_se0_b_m2.mp3",
  ];
  sourceFiles.forEach((file, index) => {
    const source = requireFile(join(download, file), `Nora source ${index + 1}`);
    copyFileSync(source, join(audioSourceDir, `scene-${String(index + 1).padStart(2, "0")}.mp3`));
  });

  const narration = join(audioDir, "narration-master.wav");
  const offsetsMs = [350, 7350, 31350, 45350, 73350, 83000, 96350];
  const narrationArgs = ["-y", "-hide_banner", "-loglevel", "error"];
  sourceFiles.forEach((_, index) => narrationArgs.push("-i", join(audioSourceDir, `scene-${String(index + 1).padStart(2, "0")}.mp3`)));
  narrationArgs.push(
    "-f",
    "lavfi",
    "-t",
    String(DURATION),
    "-i",
    "anullsrc=r=48000:cl=stereo",
  );
  const clipFilters = offsetsMs.map(
    (offset, index) => `[${index}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,highpass=f=70,adelay=${offset}|${offset}[n${index}]`,
  );
  narrationArgs.push(
    "-filter_complex",
    `${clipFilters.join(";")};${offsetsMs.map((_, index) => `[n${index}]`).join("")}[7:a]amix=inputs=8:duration=longest:normalize=0,atrim=0:${DURATION},asetpts=N/SR/TB[narration]`,
    "-map",
    "[narration]",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    narration,
  );
  run("ffmpeg", narrationArgs);

  const music = join(audioDir, "music-bed.wav");
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=73.42:sample_rate=48000:duration=${DURATION}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=110:sample_rate=48000:duration=${DURATION}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=146.83:sample_rate=48000:duration=${DURATION}`,
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=color=pink:sample_rate=48000:duration=${DURATION}:seed=143`,
    "-filter_complex",
    `[0:a]volume=0.011[a0];[1:a]volume=0.006[a1];[2:a]volume=0.0035[a2];[3:a]lowpass=f=1100,highpass=f=180,volume=0.0014[a3];[a0][a1][a2][a3]amix=inputs=4:normalize=0,afade=t=in:st=0:d=2,afade=t=out:st=146:d=4,pan=stereo|c0=c0|c1=c0,atrim=0:${DURATION}[music]`,
    "-map",
    "[music]",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    music,
  ]);

  const sfx = join(audioDir, "ui-sfx.wav");
  const sfxEvents = [7, 17, 31, 45, 59, 73, 84, 96, 102, 108, 120, 132, 143];
  const sfxArgs = ["-y", "-hide_banner", "-loglevel", "error"];
  sfxEvents.forEach((_, index) => {
    const freq = index >= 7 ? 740 : index >= 6 ? 360 : 520;
    sfxArgs.push("-f", "lavfi", "-i", `sine=frequency=${freq}:sample_rate=48000:duration=0.12`);
  });
  sfxArgs.push("-f", "lavfi", "-t", String(DURATION), "-i", "anullsrc=r=48000:cl=stereo");
  const sfxFilters = sfxEvents.map((time, index) => {
    const delay = Math.round(time * 1000);
    return `[${index}:a]volume=0.025,afade=t=out:st=0.02:d=0.1,pan=stereo|c0=c0|c1=c0,adelay=${delay}|${delay}[s${index}]`;
  });
  sfxArgs.push(
    "-filter_complex",
    `${sfxFilters.join(";")};${sfxEvents.map((_, index) => `[s${index}]`).join("")}[${sfxEvents.length}:a]amix=inputs=${sfxEvents.length + 1}:duration=longest:normalize=0,atrim=0:${DURATION}[sfx]`,
    "-map",
    "[sfx]",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    sfx,
  );
  run("ffmpeg", sfxArgs);

  const premaster = join(audioDir, "mix-premaster.wav");
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    narration,
    "-i",
    music,
    "-i",
    sfx,
    "-filter_complex",
    `[0:a]volume=1.0[n];[1:a]volume=0.70[m];[2:a]volume=0.75[s];[n][m][s]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.82:attack=5:release=80,atrim=0:${DURATION}[mix]`,
    "-map",
    "[mix]",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    premaster,
  ]);

  const master = join(audioDir, "master-150s.wav");
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    premaster,
    "-af",
    `loudnorm=I=-16:LRA=8:TP=-1.5,atrim=0:${DURATION},apad=whole_dur=${DURATION}`,
    "-t",
    String(DURATION),
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    master,
  ]);
  return { narration, music, sfx, master };
}

function evidenceSnapshot() {
  const readiness = JSON.parse(readFileSync(requireFile(join(workDir, "readiness.json"), "current readiness response"), "utf8"));
  const rootCheck = JSON.parse(readFileSync(requireFile(join(workDir, "vercel-root-check.json"), "Vercel root check"), "utf8"));
  const chain = JSON.parse(readFileSync(requireFile(join(workDir, "chain-id.json"), "chain ID response"), "utf8"));
  const bill2 = JSON.parse(readFileSync(requireFile(join(workDir, "bill2.json"), "Bill 2 RPC response"), "utf8"));
  const settlement = JSON.parse(readFileSync(requireFile(join(workDir, "settlement-receipt.json"), "settlement RPC receipt"), "utf8"));
  const deployment = JSON.parse(
    readFileSync(requireFile(join(root, "docs/submission/monad-testnet-deployment-evidence.json"), "deployment evidence"), "utf8"),
  );
  const sourceStatus = readFileSync(requireFile(join(root, "docs/submission/SOURCE_VERIFICATION_STATUS.md"), "source status"), "utf8");
  const monadscanHtml = readFileSync(requireFile(join(workDir, "monadscan-contract.html"), "Monadscan contract HTML"), "utf8");

  const checks = readiness.checks ?? {};
  const allChecks = ["configuration", "rpc", "network", "contract", "bill"];
  if (
    rootCheck.httpCode !== 200 ||
    readiness.status !== "ready" ||
    readiness.network?.chainId !== CHAIN_ID ||
    !allChecks.every((key) => checks[key] === "pass") ||
    chain.result !== "0x279f" ||
    bill2.state !== 1 ||
    bill2.stateLabel !== "Draft" ||
    !decodeURIComponent(bill2.metadataURI).includes('"subtotalPence":4850') ||
    settlement.result?.status !== "0x1" ||
    settlement.result?.transactionHash?.toLowerCase() !== SETTLEMENT ||
    settlement.result?.to?.toLowerCase() !== CONTRACT.toLowerCase() ||
    deployment.contract?.sourceVerification?.reportedStatus !== "perfect" ||
    !sourceStatus.includes("MonadVision reports a Sourcify full match") ||
    !monadscanHtml.includes("Source Code Verified") ||
    !monadscanHtml.includes("Exact Match")
  ) {
    throw new Error("Current evidence does not satisfy the video's public-chain claims");
  }

  const snapshot = {
    schema: "taptab-video-2min30-verification-snapshot",
    capturedAt: readiness.checkedAt,
    publicDeployment: {
      url: URL_ROOT,
      httpCode: rootCheck.httpCode,
      contentType: rootCheck.contentType,
      responseSeconds: rootCheck.timeTotal,
    },
    readiness: {
      url: URL_READY,
      status: readiness.status,
      checks,
      chainId: readiness.network.chainId,
      blockNumber: readiness.network.blockNumber,
      checkedAt: readiness.checkedAt,
      requestId: readiness.requestId,
    },
    rpc: { chainIdHex: chain.result, chainId: CHAIN_ID },
    bill2: {
      canonicalUrl: URL_BILL,
      contractStateRaw: bill2.state,
      contractState: "Draft",
      receiptGbp: "48.50",
      creationTransaction: deployment.transactions.find((entry) => entry.purpose === "create-canonical-live-demo-bill-2")?.hash,
    },
    contract: {
      address: CONTRACT,
      monadscanSource: "Source Code Verified · Exact Match",
      sourceRecord: "MonadVision reports · Sourcify full match",
      sourceBoundary: "Source publication/matching is not a security audit.",
    },
    historicalBill3Settlement: {
      transactionHash: SETTLEMENT,
      statusHex: settlement.result.status,
      status: "Success",
      blockNumber: parseInt(settlement.result.blockNumber, 16),
      to: settlement.result.to,
      noNewWriteInVideo: true,
    },
    disclosure: "Testnet MON has no cash value.",
  };
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "verification-snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

function renderVideo(frames, audioMaster, captionCues) {
  const visualTimeline = [
    [0, 7, "cover"],
    [7, 11.75, "overview"],
    [11.75, 14.5, "claimWhole"],
    [14.5, 31, "claimShared"],
    [31, 34, "remainder"],
    [34, 38, "tip"],
    [38, 40, "approvalReset"],
    [40, 48, "review"],
    [48, 51, "fundingLocked"],
    [51, 54, "sponsor"],
    [54, 58, "fundingLocked"],
    [58, 73, "sponsor"],
    [73, 78, "stage"],
    [78, 88.15, "stageSettled"],
    [88.15, 90.85, "refundOpen"],
    [90.85, 96, "refundClaim"],
    [96, 102, "vercel"],
    [102, 116.25, "bill2"],
    [116.25, 120.25, "ready"],
    [120.25, 124.25, "readyChecks"],
    [124.25, 130.25, "contract"],
    [130.25, 136.25, "sourceMatch"],
    [136.25, 143, "settlement"],
    [143, 150, "end"],
  ];
  visualTimeline.forEach(([start, end, key], index) => {
    const expectedStart = index === 0 ? 0 : visualTimeline[index - 1][1];
    if (start !== expectedStart || end <= start || !frames[key]) throw new Error(`Invalid visual timeline at item ${index + 1}`);
  });
  if (visualTimeline.at(-1)[1] !== DURATION) throw new Error("Visual timeline does not end at 150 seconds");

  const boundaries = [...new Set([
    0,
    DURATION,
    ...visualTimeline.flatMap(([start, end]) => [start, end]),
    ...captionCues.flatMap(([start, end]) => [start, end]),
  ])].sort((a, b) => a - b);
  const captionFrames = new Map();
  const wrappedCaption = (value, maximum = 56) => {
    const words = value.split(/\s+/);
    const result = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maximum && current) {
        result.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) result.push(current);
    return result.slice(0, 2);
  };
  const frameFor = (visualKey, cueIndex) => {
    if (cueIndex < 0) return frames[visualKey];
    const cacheKey = `${visualKey}-${cueIndex}`;
    if (captionFrames.has(cacheKey)) return captionFrames.get(cacheKey);
    const cueText = captionCues[cueIndex][2];
    const cueLines = wrappedCaption(cueText);
    const height = cueLines.length === 1 ? 76 : 114;
    const top = cueLines.length === 1 ? 872 : 834;
    const overlay = renderSvg(
      `caption-${cueIndex}-${visualKey}`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <rect x="200" y="${top}" width="1520" height="${height}" rx="24" fill="#070910" fill-opacity="0.88" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
        ${cueLines.map((line, index) => textLine(960, top + 48 + index * 40, line, 34, { weight: 760, anchor: "middle" })).join("\n")}
      </svg>`,
    );
    const result = composite(`captioned-${visualKey}-${cueIndex}`, frames[visualKey], overlay);
    captionFrames.set(cacheKey, result);
    return result;
  };

  const timeline = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    const visual = visualTimeline.find(([visualStart, visualEnd]) => start >= visualStart && start < visualEnd);
    if (!visual) throw new Error(`No visual at ${start}`);
    const cueIndex = captionCues.findIndex(([cueStart, cueEnd]) => start >= cueStart && start < cueEnd);
    timeline.push([start, end, frameFor(visual[2], cueIndex)]);
  }

  const list = join(generated, "visuals.ffconcat");
  const contents = ["ffconcat version 1.0"];
  for (const [start, end, frame] of timeline) {
    contents.push(`file '${frame.replaceAll("'", "'\\''")}'`);
    contents.push(`duration ${(end - start).toFixed(6)}`);
  }
  contents.push(`file '${frames.end.replaceAll("'", "'\\''")}'`);
  writeFileSync(list, `${contents.join("\n")}\n`);

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
    list,
    "-i",
    audioMaster,
    "-vf",
    `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,setsar=1,fade=t=in:st=0:d=0.35,fade=t=out:st=149.45:d=0.55,format=yuv420p`,
    "-frames:v",
    String(FRAME_COUNT),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-profile:v",
    "high",
    "-level",
    "4.2",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
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
    output,
  ], { cwd: work });

  copyFileSync(frames.end, poster);
}

function writeProvenance(audio, evidence) {
  const sourceHashes = {};
  for (let index = 1; index <= 7; index += 1) {
    const key = `scene-${String(index).padStart(2, "0")}.mp3`;
    sourceHashes[key] = sha256(join(audioSourceDir, key));
  }
  const provenance = {
    schema: "taptab-video-2min30-provenance",
    programmeSeconds: DURATION,
    voice: {
      provider: "ElevenLabs",
      voice: "Nora - Blackpool Product Guide",
      model: "Eleven Multilingual v2",
      sourceFiles: sourceHashes,
      boundary: "Existing approved Nora clips are reused. The final public-evidence hold is intentionally speech-free rather than substituting another voice.",
    },
    music: {
      original: true,
      generatedSources: ["73.42 Hz sine", "110 Hz sine", "146.83 Hz sine", "seeded filtered pink noise"],
    },
    publicEvidence: {
      snapshot: "evidence/verification-snapshot.json",
      checkedAt: evidence.readiness.checkedAt,
      noFreshTransactionBroadcast: true,
    },
    rebuildableIntermediates: {
      narration: { path: "audio/narration-master.wav", sha256: sha256(audio.narration) },
      music: { path: "audio/music-bed.wav", sha256: sha256(audio.music) },
      sfx: { path: "audio/ui-sfx.wav", sha256: sha256(audio.sfx) },
      master: { path: "audio/master-150s.wav", sha256: sha256(audio.master) },
      retention: "Removed after QA; these PCM files are recreated by build-video.mjs.",
    },
    retainedFiles: {
      masterVideo: { path: "taptab-demo-2min30.mp4", sha256: sha256(output) },
      poster: { path: "taptab-demo-2min30-poster.png", sha256: sha256(poster) },
      captionsAss: { path: "taptab-demo-2min30.ass", sha256: sha256(captionsAss) },
      captionsSrt: { path: "taptab-demo-2min30.srt", sha256: sha256(captionsSrt) },
    },
  };
  writeFileSync(join(work, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);
}

async function main() {
  rmSync(generated, { recursive: true, force: true });
  rmSync(audioDir, { recursive: true, force: true });
  for (const directory of [generated, framesDir, overlaysDir, audioDir, audioSourceDir, evidenceDir, workDir]) {
    mkdirSync(directory, { recursive: true });
  }

  const evidence = evidenceSnapshot();
  const captionCues = createCaptions();
  const audio = createAudio();
  const frames = createFrames(evidence);
  const qr = join(overlaysDir, "bill2-qr.png");
  await QRCode.toFile(qr, URL_BILL, {
    width: 390,
    margin: 2,
    color: { dark: "#090b12", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
  frames.end = composite("end-card-with-qr", frames.end, qr, 1300, 432);
  renderVideo(frames, audio.master, captionCues);
  writeProvenance(audio, evidence);

  const probe = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-count_frames",
      "-show_entries",
      "format=duration,size:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels,nb_read_frames",
      "-of",
      "json",
      output,
    ]),
  );
  writeFileSync(join(work, "build-probe.json"), `${JSON.stringify(probe, null, 2)}\n`);
  console.log(JSON.stringify({ output, bytes: statSync(output).size, sha256: sha256(output), probe }, null, 2));
}

await main();

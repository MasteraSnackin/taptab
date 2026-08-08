import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../..");
const captureDir = join(here, "capture");
const rawDir = join(here, "generated", "continuous-raw");
const origin = "https://taptab.mythicmindlabs.workers.dev/";
const trimmedCapture = join(captureDir, "continuous-public-sample-15s.mp4");
const contactSheet = join(captureDir, "continuous-contact-sheet.jpg");
const manifestPath = join(captureDir, "continuous-capture-manifest.json");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

mkdirSync(captureDir, { recursive: true });
if (existsSync(rawDir)) rmSync(rawDir, { recursive: true });
mkdirSync(rawDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1856, height: 1000 },
  recordVideo: { dir: rawDir, size: { width: 1856, height: 1000 } },
  locale: "en-GB",
  reducedMotion: "no-preference",
});
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(origin, { waitUntil: "networkidle", timeout: 60_000 });
await page.getByRole("heading", {
  name: "Claim what you had. Pay only your part.",
}).waitFor({ state: "visible" });

await page.evaluate(() => {
  const style = document.createElement("style");
  style.textContent = `
    #taptab-capture-pointer {
      position: fixed;
      z-index: 2147483647;
      width: 30px;
      height: 30px;
      margin: -15px 0 0 -15px;
      border: 3px solid #ffffff;
      border-radius: 50%;
      background: rgba(109, 69, 255, .34);
      box-shadow: 0 0 0 7px rgba(109, 69, 255, .20), 0 4px 16px rgba(0,0,0,.45);
      pointer-events: none;
      transform: translate(150px, 120px);
      transition: width .14s ease, height .14s ease, margin .14s ease;
    }
    #taptab-capture-pointer[data-down="true"] {
      width: 50px;
      height: 50px;
      margin: -25px 0 0 -25px;
      background: rgba(158, 232, 166, .45);
    }
  `;
  document.head.append(style);
  const pointer = document.createElement("div");
  pointer.id = "taptab-capture-pointer";
  pointer.setAttribute("aria-hidden", "true");
  document.body.append(pointer);
  window.addEventListener("mousemove", (event) => {
    pointer.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  });
  window.addEventListener("mousedown", () => {
    pointer.dataset.down = "true";
  });
  window.addEventListener("mouseup", () => {
    pointer.dataset.down = "false";
  });
});

await page.waitForTimeout(800);
await page.getByRole("button", { name: /Try TapTab/ }).click();
await page.waitForTimeout(1_200);

const guide = page.locator(".try-taptab-guide");
await guide.waitFor({ state: "visible" });
await guide.getByRole("button", { name: "Show a shared claim" }).click();
await page.waitForTimeout(1_200);

await page.getByRole("button", { name: /Change tip or extras/ }).click();
await page.waitForTimeout(800);

const startedAt = Date.now();
const actions = [];
const mark = (action) => actions.push({ action, milliseconds: Date.now() - startedAt });
const holdUntil = async (milliseconds) => {
  await page.waitForTimeout(Math.max(0, milliseconds - (Date.now() - startedAt)));
};

mark("Continuous take begins on the volunteer-controlled fair-remainder and tip controls");
await holdUntil(2_500);

mark("12.5% tip selected in the real sample controls");
await page.getByRole("button", { name: "12.5%" }).first().click();
await holdUntil(3_300);

mark("The updated pound total opened for review");
await page.getByRole("button", { name: /^(?:Review my .+|Review total)$/ }).click();
await holdUntil(4_200);

mark("The exact split approved through the real sample guide");
await guide.getByRole("button", { name: "Approve the split" }).click();
await holdUntil(6_800);

mark("The approved split reopened at the real tip and extras controls");
await page.getByRole("button", { name: /Change tip or extras/ }).click();
await holdUntil(7_100);

mark("A new 10% vote changed the split and cleared the previous approvals");
await page.getByRole("button", { name: "10%" }).first().click();
await holdUntil(7_800);

mark("The changed split reopened for review with consent reset");
await page.getByRole("button", { name: /^(?:Review my .+|Review total)$/ }).click();
await holdUntil(13_300);
mark("Continuous interaction recording completed");

const finalState = {
  url: page.url(),
  guideHeading: await guide.getByRole("heading").innerText(),
  sampleLabelVisible: await page.getByText("Sample bill · local only").isVisible(),
  viewport: await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  })),
};

await context.close();
await browser.close();

const rawFiles = readdirSync(rawDir).filter((name) => name.endsWith(".webm"));
if (rawFiles.length !== 1) {
  throw new Error(`Expected exactly one raw Playwright video, found ${rawFiles.length}`);
}
const rawVideo = join(rawDir, rawFiles[0]);
const rawDuration = Number(
  run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    rawVideo,
  ]),
);
if (!Number.isFinite(rawDuration) || rawDuration < 15) {
  throw new Error(`Raw capture is too short: ${rawDuration}`);
}

run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-sseof",
  "-15",
  "-i",
  rawVideo,
  "-t",
  "15",
  "-vf",
  "fps=30,scale=1856:1000:flags=lanczos,setsar=1",
  "-frames:v",
  "450",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  trimmedCapture,
]);

const trimmedDuration = Number(
  run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    trimmedCapture,
  ]),
);
if (trimmedDuration !== 15) {
  throw new Error(`Trimmed capture must be exactly 15 seconds, got ${trimmedDuration}`);
}

run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  trimmedCapture,
  "-vf",
  "select='eq(n,45)+eq(n,105)+eq(n,135)+eq(n,180)+eq(n,255)+eq(n,300)+eq(n,360)+eq(n,420)',setpts=N/FRAME_RATE/TB,scale=464:250,tile=4x2",
  "-frames:v",
  "1",
  "-q:v",
  "2",
  contactSheet,
]);

const manifest = {
  schema: "taptab-continuous-public-sample-capture",
  version: 1,
  capturedAt: new Date().toISOString(),
  source: {
    url: origin,
    workspace: "Sample bill · local only",
    walletWrite: false,
    browser: "Playwright Chromium",
    viewport: { width: 1856, height: 1000 },
  },
  continuity: {
    singleBrowserContext: true,
    singleRawVideoFile: true,
    internalCuts: 0,
    endpointTrimOnly: true,
    trimRule:
      "The final 15 seconds of one raw Playwright recording retain a stable pre-roll and the complete planned interaction; endpoint trimming only",
    finalDurationSeconds: trimmedDuration,
    frames: 450,
  },
  actions,
  finalState,
  consoleErrors: errors,
  artifacts: {
    raw: {
      path: rawVideo.slice(root.length + 1),
      bytes: statSync(rawVideo).size,
      sha256: sha256(rawVideo),
      durationSeconds: rawDuration,
      ignoredIntermediate: true,
    },
    releaseCapture: {
      path: trimmedCapture.slice(root.length + 1),
      bytes: statSync(trimmedCapture).size,
      sha256: sha256(trimmedCapture),
      durationSeconds: trimmedDuration,
    },
    contactSheet: {
      path: contactSheet.slice(root.length + 1),
      bytes: statSync(contactSheet).size,
      sha256: sha256(contactSheet),
      sampledSeconds: [1.5, 3.5, 4.5, 6, 8.5, 10, 12, 14],
    },
  },
  boundary:
    "This is one uncut public-sample browser stream showing fair-remainder controls, tip/approval and a consent-clearing change. It uses endpoint trimming only and is not a wallet transaction or Monad Testnet write.",
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Continuous capture: ${trimmedCapture}`);
console.log(`SHA-256: ${manifest.artifacts.releaseCapture.sha256}`);
console.log(`Raw duration: ${rawDuration.toFixed(3)} seconds`);
console.log(`Console errors: ${errors.length}`);

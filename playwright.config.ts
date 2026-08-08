import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.TAPTAB_E2E_BASE_URL?.trim();
const baseURL = externalBaseURL || "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // An explicit target is already hosted, so Playwright must not also try to
  // boot a local server or wait for that external URL as a managed process.
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: "npm run dev -- --port 3100",
          url: baseURL,
          // The managed suite must own its server so it cannot silently reuse a
          // stale build with different wallet or contract configuration.
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            NEXT_PUBLIC_TAPTAB_ADDRESS:
              "0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198",
            NEXT_PUBLIC_TAPTAB_BILL_ID: "2",
            NEXT_PUBLIC_SITE_URL: "https://taptab.example",
            NEXT_PUBLIC_REOWN_PROJECT_ID:
              "11111111111111111111111111111111",
            NEXT_PUBLIC_MONAD_TESTNET_FALLBACK_RPC_URL: "",
          },
        },
      }),
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 812, height: 900 },
        hasTouch: true,
      },
    },
    {
      name: "tablet-768-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
      },
    },
    {
      name: "portrait-430-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 430, height: 932 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
});

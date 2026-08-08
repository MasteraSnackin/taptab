import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  MONAD_TESTNET_CHAIN_HEX,
  MOCK_WALLET_NAME,
  SECOND_MOCK_WALLET_ACCOUNT,
  disconnectMockWallet,
  getMockWalletSnapshot,
  installMockEip1193Provider,
  setMockWalletAccounts,
  setMockWalletChainId,
} from "./support/mock-eip1193";
import { installMockMonadRpc } from "./support/mock-monad-rpc";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const PARTICIPANT = "0x2222222222222222222222222222222222222222";
const LIVE_CONTRACT = "0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198";
const LIVE_PARTICIPANT = "0x1091A22b34e0E6BFb93C31913B926335EFB078D3";
const WALLET_WRITE_METHODS = [
  "eth_sendTransaction",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
] as const;

const freshQuote = () => ({
  gbp: 8.25,
  usd: 10.75,
  lastUpdatedAt: Math.floor(Date.now() / 1_000),
  source: "CoinGecko",
  basis: "mainnet MON",
});

async function waitForHydration(page: import("@playwright/test").Page) {
  await expect(page.locator(".rate-readout strong[class^='price-']")).not.toContainText(
    "loading",
  );
}

async function tabUntilFocused(page: Page, target: Locator, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) return;
  }
  throw new Error(`Keyboard focus did not reach the target after ${attempts} Tab presses.`);
}

async function openMockWalletPicker(page: Page, connect: Locator) {
  await connect.click();
  const walletOption = page
    .locator("wui-list-wallet")
    .filter({ hasText: MOCK_WALLET_NAME })
    .first();
  const continueWithWallet = page.getByRole("button", {
    name: "Continue with a wallet",
    exact: true,
  });
  await expect
    .poll(async () => (await walletOption.isVisible()) || (await continueWithWallet.isVisible()), {
      timeout: 15_000,
    })
    .toBe(true);
  if (await continueWithWallet.isVisible()) await continueWithWallet.click();
  await expect(walletOption).toBeVisible({ timeout: 15_000 });
  return walletOption;
}

async function selectMockWallet(page: Page, connect: Locator) {
  const walletOption = await openMockWalletPicker(page, connect);
  await walletOption.click();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/mon-price", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(freshQuote()),
    });
  });
});

test("shows the linked Testnet runbook and editable live bill fields", async ({ page }) => {
  await installMockMonadRpc(page);
  await page.goto(`/?workspace=live&contract=${LIVE_CONTRACT}&bill=2#bill`);
  await waitForHydration(page);

  const guide = page.getByTestId("testnet-demo-guide");
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading", { name: "From sign-in to explorer proof" })).toBeVisible();
  await expect(guide.locator('[data-testid^="testnet-demo-step-"]')).toHaveCount(8);

  await page.getByTestId("testnet-demo-step-receipt").click();
  await expect(page.getByTestId("live-bill-fields")).toHaveAttribute("open", "");
  await expect(page.getByRole("textbox", { name: "Merchant" }).last()).toBeEditable();
});

test("discovers an announced browser wallet through the production Reown adapter", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One controlled wallet fixture");
  await installMockEip1193Provider(page);
  await page.goto("/");
  await waitForHydration(page);

  const connect = page.getByRole("button", { name: /Continue with .*wallet/ }).first();
  await expect(connect).toBeEnabled({ timeout: 15_000 });
  await expect
    .poll(async () => (await getMockWalletSnapshot(page)).eip6963Requests)
    .toBeGreaterThan(0);
  await openMockWalletPicker(page, connect);
  const appKitDialog = page.getByRole("alertdialog");
  await expect(appKitDialog).toContainText(MOCK_WALLET_NAME, { timeout: 15_000 });

  await page.keyboard.press("Escape");
  const snapshot = await getMockWalletSnapshot(page);
  expect(snapshot.accounts).toEqual([]);
  expect(snapshot.requests).toEqual([]);
  expect(snapshot.eip6963Announcements).toBeGreaterThan(0);
});

test("surfaces mocked wallet rejection without connecting or attempting a write", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One controlled wallet fixture");
  await installMockEip1193Provider(page, {
    rejectMethods: {
      eth_requestAccounts: { code: 4_001, message: "Connection declined in test wallet." },
    },
  });
  const rpc = await installMockMonadRpc(page);
  await page.goto(`/?workspace=live&contract=${LIVE_CONTRACT}&bill=2#bill`);

  const walletRegion = page.getByRole("region", { name: "Identity and invitation" });
  const connect = walletRegion.getByRole("button", { name: /Continue with .*wallet/ });
  await expect(connect).toBeEnabled({ timeout: 20_000 });
  await selectMockWallet(page, connect);
  await expect(page.getByText("Connection declined", { exact: true })).toBeVisible();

  const snapshot = await getMockWalletSnapshot(page);
  expect(snapshot.accounts).toEqual([]);
  expect(snapshot.requests.map(({ method }) => method)).toContain("eth_requestAccounts");
  expect(
    snapshot.requests.some(({ method }) =>
      WALLET_WRITE_METHODS.some((writeMethod) => writeMethod === method),
    ),
  ).toBe(false);
  await expect(walletRegion.getByText("Connected", { exact: true })).toHaveCount(0);
  expect(rpc.snapshot().unknownMethods).toEqual([]);
});

test("reacts to mocked account, network and disconnect events without a wallet write", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One controlled wallet fixture");
  await installMockEip1193Provider(page, { chainId: MONAD_TESTNET_CHAIN_HEX });
  const rpc = await installMockMonadRpc(page);
  await page.goto(`/?workspace=live&contract=${LIVE_CONTRACT}&bill=2#bill`);

  const walletRegion = page.getByRole("region", { name: "Identity and invitation" });
  let connect = walletRegion.getByRole("button", { name: /Continue with .*wallet/ });
  await expect(connect).toBeEnabled({ timeout: 20_000 });
  await selectMockWallet(page, connect);
  await expect(walletRegion.getByText("Connected", { exact: true })).toBeVisible();

  await setMockWalletChainId(page, "0x1");
  await expect(walletRegion.getByText("Switch to Monad Testnet", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("alertdialog")).toContainText("Switch Network");

  await setMockWalletChainId(page, MONAD_TESTNET_CHAIN_HEX);
  await expect(walletRegion.getByText("Monad Testnet balance", { exact: true })).toBeVisible();

  await setMockWalletAccounts(page, [SECOND_MOCK_WALLET_ACCOUNT]);
  await expect(walletRegion.locator(".live-account-row strong")).toContainText(
    "0x2222…2222",
  );

  await disconnectMockWallet(page);
  connect = walletRegion.getByRole("button", { name: /Continue with .*wallet/ });
  await expect(connect).toBeVisible();
  await expect(walletRegion.getByText("Connected", { exact: true })).toHaveCount(0);

  const snapshot = await getMockWalletSnapshot(page);
  expect(snapshot.accounts).toEqual([]);
  expect(snapshot.requests.map(({ method }) => method)).toContain("eth_chainId");
  expect(
    snapshot.requests.some(({ method }) =>
      WALLET_WRITE_METHODS.some((writeMethod) => writeMethod === method),
    ),
  ).toBe(false);
  expect(rpc.snapshot().unknownMethods).toEqual([]);
});

test("blocks submission when the connected wallet changes during the exact-action preflight", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One controlled wallet fixture");
  await installMockEip1193Provider(page, { chainId: MONAD_TESTNET_CHAIN_HEX });
  const rpc = await installMockMonadRpc(page);
  await page.goto(`/?workspace=live&contract=${LIVE_CONTRACT}&bill=2#bill`);

  await expect(page.getByText(/Table 2 mock · Bill #2/)).toBeVisible({ timeout: 20_000 });
  const walletRegion = page.getByRole("region", { name: "Identity and invitation" });
  const connect = walletRegion.getByRole("button", { name: /Continue with .*wallet/ });
  await expect(connect).toBeEnabled({ timeout: 20_000 });
  await selectMockWallet(page, connect);
  await expect(walletRegion.getByText("Connected", { exact: true })).toBeVisible();

  const releaseShare = page.getByRole("button", {
    name: "Release share 1 of item 1",
    exact: true,
  });
  await expect(releaseShare).toBeEnabled();
  const delayedSimulation = rpc.holdNextDirectTapTabCall("unclaimItemShare");
  await releaseShare.click();
  await delayedSimulation.started;
  try {
    await setMockWalletAccounts(page, [SECOND_MOCK_WALLET_ACCOUNT]);
    await expect(walletRegion.locator(".live-account-row strong")).toContainText(
      "0x2222…2222",
    );
  } finally {
    delayedSimulation.release();
  }

  await expect
    .poll(
      () =>
        rpc
          .snapshot()
          .observations.some(
            ({ method, billIds }) => method === "eth_call" && billIds.includes("2"),
          ),
      { timeout: 10_000 },
    )
    .toBe(true);
  const walletSnapshot = await getMockWalletSnapshot(page);
  expect(
    walletSnapshot.requests.some(({ method }) =>
      WALLET_WRITE_METHODS.some((writeMethod) => writeMethod === method),
    ),
  ).toBe(false);
  expect(rpc.snapshot().unknownMethods).toEqual([]);
});

test("keeps a trusted personal-payment entry locked until its delayed bill data arrives", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One controlled live fixture");
  const rpc = await installMockMonadRpc(page);
  const delayedRequest = rpc.holdNextRequest();

  await page.goto(
    `/pay?contract=${LIVE_CONTRACT}&bill=3&pay=${LIVE_PARTICIPANT}#pay`,
  );
  try {
    await delayedRequest.started;
    await expect(
      page.getByRole("heading", { name: "Checking your personal payment link." }),
    ).toBeVisible();
    await expect(page.getByText("No wallet action is available while these checks are in progress."))
      .toBeVisible();
    await expect(page.locator(".payment-route-live")).toHaveClass(/is-payment-locked/);
    await expect(page.locator(".payment-route-wallet")).toHaveCount(0);
  } finally {
    delayedRequest.release();
  }

  await expect(
    page.getByRole("heading", { name: "Your personal payment is ready." }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Verified beneficiary 0x1091…78D3")).toBeVisible();
  await expect(page.locator(".payment-route-wallet")).toBeVisible();
  const undersizedOperationalText = await page.locator(".payment-route-live").evaluate(
    (root) =>
      [...root.querySelectorAll<HTMLElement>(
        "a, button, dd, dt, label, p, small, span, strong, summary",
      )]
        .filter((element) => {
          if (element.matches(".sr-only, [aria-hidden='true']")) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity) > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            Boolean(element.textContent?.trim()) &&
            Number.parseFloat(style.fontSize) < 11
          );
        })
        .map((element) => ({
          text: element.textContent?.trim().slice(0, 80),
          fontSize: getComputedStyle(element).fontSize,
        })),
  );
  expect(undersizedOperationalText).toEqual([]);
  const rpcSnapshot = rpc.snapshot();
  expect(rpcSnapshot.unknownMethods).toEqual([]);
  expect(rpcSnapshot.observations.some(({ method }) => method.startsWith("eth_send"))).toBe(false);
  expect(rpcSnapshot.observations.some(({ method }) => method.startsWith("wallet_"))).toBe(false);
});

test("ignores a delayed bill snapshot after the trusted URL selects another bill", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "One controlled live fixture");
  const rpc = await installMockMonadRpc(page);
  const delayedBillTwoRequest = rpc.holdNextBillSnapshot(2n);

  await page.goto(`/?workspace=live&contract=${LIVE_CONTRACT}&bill=2#bill`);
  await delayedBillTwoRequest.started;
  await page.evaluate(
    ({ contract }) => {
      const url = new URL(window.location.href);
      url.searchParams.set("workspace", "live");
      url.searchParams.set("contract", contract);
      url.searchParams.set("bill", "3");
      url.hash = "bill";
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    { contract: LIVE_CONTRACT },
  );

  try {
    await expect(page.getByText(/Table 3 mock · Bill #3/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Table 2 mock · Bill #2/)).toHaveCount(0);
  } finally {
    delayedBillTwoRequest.release();
  }
  await expect
    .poll(
      () =>
        rpc
          .snapshot()
          .observations.some(({ billIds }) => billIds.includes("2")),
      { timeout: 10_000 },
    )
    .toBe(true);
  await expect(page.getByText(/Table 3 mock · Bill #3/)).toBeVisible();
  await expect(page.getByText(/Table 2 mock · Bill #2/)).toHaveCount(0);
  expect(rpc.snapshot().unknownMethods).toEqual([]);
});

test("renders the price loading state until the reference request completes", async ({ page }) => {
  await page.unroute("**/api/mon-price");
  let releaseQuote = () => {};
  const heldQuote = new Promise<void>((resolve) => {
    releaseQuote = resolve;
  });
  await page.route("**/api/mon-price", async (route) => {
    await heldQuote;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(freshQuote()),
    });
  });

  await page.goto("/?workspace=preview&preview=table-7#bill");
  const readout = page.locator(".rate-readout").first();
  try {
    await expect(readout.locator(".price-loading")).toHaveText("loading");
  } finally {
    releaseQuote();
  }
  await expect(readout.locator(".price-live")).toHaveText("Live");
});

test("supports visible keyboard focus and keyboard activation of the primary journey", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  const primaryJourney = page.getByRole("button", { name: /Try sample bill/ });
  await tabUntilFocused(page, primaryJourney);
  await expect(primaryJourney).toBeFocused();
  const focusStyle = await primaryJourney.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(3);

  await page.keyboard.press("Enter");
  await expect(page.locator("#bill")).toBeInViewport();
  await page.keyboard.press("Tab");
  const focusedControl = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return undefined;
    const rect = element.getBoundingClientRect();
    return {
      tagName: element.tagName,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(focusedControl).toBeDefined();
  expect(focusedControl?.tagName).not.toBe("BODY");
  expect(focusedControl?.bottom).toBeGreaterThan(0);
  expect(focusedControl?.top).toBeLessThan(focusedControl?.viewportHeight ?? 0);
});

test("keeps the mobile sticky action and focused inputs usable as viewport height contracts", async ({
  page,
}, testInfo) => {
  test.skip(
    !["portrait-430-chromium", "mobile-chromium"].includes(testInfo.project.name),
    "Mobile viewport check",
  );
  await page.goto("/?workspace=preview&preview=table-7#bill");
  await waitForHydration(page);

  const dock = page.locator(".mobile-personal-action");
  const dockAction = dock.getByRole("button", { name: "Tip & extras" });
  await expect(dock).toBeVisible();
  await dock.scrollIntoViewIfNeeded();
  const dockMetrics = await dock.evaluate((element) => {
    const style = getComputedStyle(element);
    const button = element.querySelector("button");
    return {
      position: style.position,
      minHeight: Number.parseFloat(style.minHeight),
      buttonHeight: button?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(dockMetrics.position).toBe("sticky");
  expect(dockMetrics.minHeight).toBeGreaterThanOrEqual(76);
  expect(dockMetrics.buttonHeight).toBeGreaterThanOrEqual(44);

  const contractedWidth = page.viewportSize()?.width ?? 390;
  await page.setViewportSize({ width: contractedWidth, height: 520 });
  await dockAction.focus();
  await dockAction.scrollIntoViewIfNeeded();
  await expect(dockAction).toBeFocused();
  const dockActionRect = await dockAction.boundingBox();
  expect(dockActionRect).not.toBeNull();
  expect((dockActionRect?.y ?? 0) + (dockActionRect?.height ?? 0)).toBeLessThanOrEqual(520);

  const organiser = page.locator("details.organiser-area").first();
  await organiser.locator(":scope > summary").click();
  await organiser.locator("details.receipt-tool > summary").click();
  const merchant = page.getByRole("textbox", { name: "Merchant" });
  await merchant.focus();
  await merchant.scrollIntoViewIfNeeded();
  await expect(merchant).toBeFocused();
  const inputMetrics = await merchant.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      fontSize: Number.parseFloat(style.fontSize),
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(inputMetrics.fontSize).toBeGreaterThanOrEqual(16);
  expect(inputMetrics.height).toBeGreaterThanOrEqual(44);
  expect(inputMetrics.top).toBeGreaterThanOrEqual(0);
  expect(inputMetrics.bottom).toBeLessThanOrEqual(inputMetrics.viewportHeight);
});

test("keeps a selectable canonical link when native sharing is cancelled", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("Cancelled by user", "AbortError");
      },
    });
  });
  await page.goto("/?workspace=preview&preview=table-7#bill");
  await waitForHydration(page);

  await page.getByRole("button", { name: "Share bill" }).click();
  await expect(page.getByRole("button", { name: "Share cancelled" })).toBeVisible();
  const recovery = page.getByRole("textbox", { name: "Canonical bill link ready to select" });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveValue(/\?workspace=preview&preview=table-7#bill$/);
});

test("keeps the exact personal URL selectable when clipboard copying fails", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Clipboard denied", "NotAllowedError");
        },
      },
    });
  });
  await page.goto("/?workspace=preview&preview=table-7#bill");
  await waitForHydration(page);

  await page
    .getByRole("button", { name: /^(?:Continue to tip & extras|Tip & extras)$/ })
    .click();
  await page.getByRole("button", { name: /^(?:Review my .+|Review total)$/ }).click();
  await page.getByRole("button", { name: /^(?:Approve this .+ split|Approve)$/ }).click();

  const organiser = page.locator("details.organiser-area").first();
  await organiser.locator(":scope > summary").click();
  const remainingApprovals = organiser.getByRole("button", {
    name: /^Record .+'s approval for split version 1$/,
  });
  while ((await remainingApprovals.count()) > 0) {
    await remainingApprovals.first().click();
  }
  await page
    .getByRole("button", { name: /^(?:Open protected payments|Start payments)$/ })
    .click();
  await page.getByRole("button", { name: "Copy You payment link" }).click();

  const recovery = page.getByRole("textbox", {
    name: "Personal payment link ready to select",
  });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveValue(
    /\?workspace=preview&preview=table-7&pay=p1#current-action$/,
  );
});

test("keeps workspace links canonical and isolates the personal payment route", async ({ page }) => {
  await page.goto(`/?workspace=live&contract=${CONTRACT}&bill=7#bill`);
  await waitForHydration(page);

  const switcher = page.getByRole("group", { name: "Bill workspace" });
  await expect(page.getByText("Monad Testnet · contract backed").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "This bill link is not trusted" })).toBeVisible();
  await expect(
    page.getByText("This link does not use the TapTab contract trusted by this build."),
  ).toBeVisible();

  await switcher.getByRole("button", { name: "Sample bill" }).click();
  await expect(page).toHaveURL(/\?workspace=preview&preview=table-7#bill$/);

  await page.goto(`/pay?contract=${CONTRACT}&bill=7&pay=${PARTICIPANT}#pay`);
  await expect(
    page.getByRole("heading", { name: "This payment link cannot be used safely." }),
  ).toBeVisible();
  await expect(page.getByText("Payments on Monad are public.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Full bill" })).toHaveAttribute(
    "href",
    `/?workspace=live&contract=${CONTRACT}&bill=7#bill`,
  );
  await expect(page.locator(".payment-route-wallet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open Stage mode/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share bill" })).toHaveCount(0);
});

test("keeps the personal payment route accessible and free of page-level overflow", async ({ page }) => {
  await page.goto(`/pay?contract=${CONTRACT}&bill=7&pay=${PARTICIPANT}#pay`);
  await expect(
    page.getByRole("heading", { name: "This payment link cannot be used safely." }),
  ).toBeVisible();

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter(({ impact }) =>
    impact === "serious" || impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test("keeps the sample journey clear and free of page-level overflow", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  await expect(
    page.getByRole("heading", { name: "Nobody fronts the bill." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Try sample bill/ }).click();
  await expect(page.locator("#bill")).toBeInViewport();
  await expect(page.getByText("Sample bill · local only")).toBeVisible();
  await expect(page.locator(".price-live")).toHaveText("Live");

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  await page
    .getByRole("button", { name: /^(?:Continue to tip & extras|Tip & extras)$/ })
    .click();
  await expect(page.getByRole("heading", { name: "Finish your choices" })).toBeVisible();
  await page.getByRole("button", { name: /^(?:Review my .+|Review total)$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Check your total before approving" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^(?:Approve this .+ split|Approve)$/ }).click();
  await expect(page.getByRole("button", { name: /Waiting for/ })).toBeDisabled();
});

test("runs and resets the complete Try TapTab sample with a privacy-safe receipt", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);

  await page.getByRole("button", { name: /Try sample bill/ }).click();
  const guide = page.locator(".try-taptab-guide");
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Claim a shared item" })).toBeVisible();
  await guide.getByRole("button", { name: "Show a shared claim" }).click();
  await expect(guide.getByRole("heading", { name: "Approve one exact split" })).toBeVisible();
  await guide.getByRole("button", { name: "Approve the split" }).click();
  await guide.getByRole("button", { name: "Sponsor Theo" }).click();
  await expect(
    guide.getByRole("heading", { name: "Fund the exact remainder" }),
  ).toBeVisible();
  await guide.getByRole("button", { name: "Fund the exact remainder" }).click();
  await guide.getByRole("button", { name: "Settle and open receipt" }).click();

  const receipt = page.locator("#sample-settlement-receipt");
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("Sample settlement receipt")).toBeVisible();
  await expect(receipt.getByText("No blockchain transaction")).toBeVisible();
  await expect(receipt.getByText(/sponsored .* for others/).first()).toBeVisible();
  await expect(receipt.getByRole("checkbox")).toHaveCount(0);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  const accessibility = await new AxeBuilder({ page })
    .include("#sample-settlement-receipt")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
    JSON.stringify(accessibility.violations, null, 2),
  ).toEqual([]);

  const downloadPromise = page.waitForEvent("download");
  await receipt.getByRole("button", { name: "Download receipt image" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("taptab-lina-stores-sample-receipt.png");

  await receipt.getByRole("button", { name: "Reset sample" }).click();
  await expect(receipt).toBeHidden();
  await expect(page.locator(".try-taptab-guide")).toHaveCount(0);
  await expect(page.getByText("Claiming items").first()).toBeVisible();
});

test("stage mode traps focus, closes with Escape and restores the trigger", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  const trigger = page.getByRole("button", { name: /Open Stage mode/ }).first();
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "TapTab stage mode" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("TapTab Local Demo")).toBeVisible();
  await expect(dialog.getByText("Preview activity")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Exit stage mode" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("has no automatically detectable serious accessibility violations", async ({ page }) => {
  await page.goto("/#bill");
  await waitForHydration(page);
  await expect(page.locator("#bill")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter(({ impact }) =>
    impact === "serious" || impact === "critical",
  );

  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test("shows stale and unavailable price states without inventing a value", async ({ page }) => {
  await page.unroute("**/api/mon-price");
  await page.route("**/api/mon-price", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "x-taptab-price-status": "stale" },
      contentType: "application/json",
      body: JSON.stringify({ ...freshQuote(), lastUpdatedAt: Math.floor(Date.now() / 1_000) - 600 }),
    });
  });
  await page.goto("/#bill");
  await waitForHydration(page);
  const proofTools = page.locator("details.proof-tools");
  await proofTools.locator("summary").click();
  await expect(proofTools.locator(".price-stale")).toHaveText("stale");

  await page.unroute("**/api/mon-price");
  await page.route("**/api/mon-price", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Price unavailable for this controlled test." }),
    });
  });
  await page.reload();
  await waitForHydration(page);
  await proofTools.locator("summary").click();
  await expect(proofTools.locator(".price-unavailable")).toHaveText("unavailable");
  await expect(
    proofTools.locator(".rate-readout").getByText("—", { exact: true }).first(),
  ).toBeVisible();
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildParticipantPaymentUrl,
  parsePrivateNameMappings,
  resolveParticipantPaymentUrl,
  serialiseVenueSettlementRecord,
} from "../app/taptab-identity.ts";

import {
  buildTapTabFullBillHref,
  buildTapTabShareUrl,
  formatMonAmount,
  formatTapTabAmount,
  formatTipBps,
  parseTapTabGbpMetadata,
  parseTipPercentToBps,
  presentTapTabChainEvent,
  resolveTrustedTapTabQuery,
  shortTapTabAddress,
  tapTabPhaseLabel,
} from "../app/taptab-live-helpers.ts";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const OTHER_CONTRACT = "0x2222222222222222222222222222222222222222";
const PARTICIPANT = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"a".repeat(64)}`;
const DEPLOYMENT = { status: "configured", address: CONTRACT, billId: 7n };

test("uses the pinned deployment when no shared context is present", () => {
  assert.deepEqual(resolveTrustedTapTabQuery("?utm_source=demo", DEPLOYMENT), {
    status: "trusted",
    context: { address: CONTRACT, billId: 7n },
    source: "configured",
  });
});

test("accepts any positive bill from the exact, singular trusted contract", () => {
  assert.deepEqual(
    resolveTrustedTapTabQuery(`?contract=${CONTRACT}&bill=7`, DEPLOYMENT),
    {
      status: "trusted",
      context: { address: CONTRACT, billId: 7n },
      source: "query",
    },
  );

  assert.deepEqual(
    resolveTrustedTapTabQuery(`?contract=${CONTRACT}&bill=8`, DEPLOYMENT),
    {
      status: "trusted",
      context: { address: CONTRACT, billId: 8n },
      source: "query",
    },
  );

  for (const search of [
    `?contract=${OTHER_CONTRACT}&bill=7`,
    `?contract=${CONTRACT}`,
    "?bill=7",
    `?contract=${CONTRACT}&contract=${CONTRACT}&bill=7`,
    `?contract=${CONTRACT}&bill=7&bill=7`,
    "?contract=not-an-address&bill=7",
    `?contract=${CONTRACT}&bill=0`,
    `?contract=${CONTRACT}&bill=0x7`,
  ]) {
    assert.equal(resolveTrustedTapTabQuery(search, DEPLOYMENT).status, "rejected", search);
  }
});

test("never lets a query rescue an absent or invalid build deployment", () => {
  assert.equal(
    resolveTrustedTapTabQuery(`?contract=${CONTRACT}&bill=7`, {
      status: "unconfigured",
      reason: "not set",
    }).status,
    "unavailable",
  );
  assert.equal(
    resolveTrustedTapTabQuery(`?contract=${CONTRACT}&bill=7`, {
      status: "invalid",
      reason: "bad address",
    }).status,
    "unavailable",
  );
});

test("builds a clean same-origin QR link for the trusted context", () => {
  const share = buildTapTabShareUrl(
    "https://taptab.example",
    "/table?ignored=yes#old",
    { address: CONTRACT, billId: 7n },
  );
  const url = new URL(share);
  assert.equal(url.origin, "https://taptab.example");
  assert.equal(url.pathname, "/table");
  assert.equal(url.searchParams.get("contract"), CONTRACT);
  assert.equal(url.searchParams.get("bill"), "7");
  assert.equal([...url.searchParams].length, 2);
  assert.equal(url.hash, "#live");
});

test("returns from a personal route to the exact canonical bill without the beneficiary", () => {
  assert.equal(
    buildTapTabFullBillHref(
      `https://taptab.example/pay?contract=${CONTRACT}&bill=7&pay=${PARTICIPANT}#pay`,
    ),
    `/?workspace=live&contract=${CONTRACT}&bill=7#bill`,
  );

  for (const unsafe of [
    "not a URL",
    `https://taptab.example/pay?contract=${CONTRACT}&pay=${PARTICIPANT}#pay`,
    `https://taptab.example/pay?contract=invalid&bill=7&pay=${PARTICIPANT}#pay`,
    `https://taptab.example/pay?contract=${CONTRACT}&bill=0&pay=${PARTICIPANT}#pay`,
    `https://taptab.example/pay?contract=${CONTRACT}&contract=${CONTRACT}&bill=7#pay`,
  ]) {
    assert.equal(buildTapTabFullBillHref(unsafe), "/?workspace=live#bill", unsafe);
  }
});

test("keeps every payment control hidden until the personal link is verified", async () => {
  const [routeSource, cssSource] = await Promise.all([
    readFile(new URL("../app/TapTabPaymentRoute.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(routeSource, /const trustedPayment = paymentLinkState\.status === "trusted"/);
  assert.match(routeSource, /trustedPayment \? "is-payment-trusted" : "is-payment-locked"/);
  assert.match(routeSource, /\{trustedPayment \? \(\s*<section className="payment-route-wallet"/);
  assert.match(cssSource, /\.payment-route-live\.is-payment-locked\s*\{\s*display: none;/);
});

test("presents GBP only from a bill-scoped receipt quote and keeps MON visible", () => {
  const quote = {
    subtotalPence: 4_850,
    subtotalWei: 10_000_000_000_000_000_000n,
  };
  assert.deepEqual(formatTapTabAmount(2_000_000_000_000_000_000n, quote), {
    primary: "£9.70",
    secondary: "2 MON",
    unit: "GBP",
  });
  assert.deepEqual(formatTapTabAmount(2_000_000_000_000_000_000n), {
    primary: "2 MON",
    unit: "MON",
  });
  assert.deepEqual(
    formatTapTabAmount(2_000_000_000_000_000_000n, {
      subtotalPence: 4_850,
      subtotalWei: 0n,
    }),
    { primary: "2 MON", unit: "MON" },
  );
  assert.equal(formatMonAmount(1_234_567_890_000_000_000n), "1.234567 MON");
});

test("validates GBP receipt metadata before using its names or values", () => {
  assert.deepEqual(
    parseTapTabGbpMetadata(
      {
        currency: "GBP",
        merchant: "The Green Room",
        items: [
          { name: "Starter", amountPence: 900 },
          { name: "Wine", amountPence: 1_400 },
        ],
        subtotalPence: 2_300,
        quote: {
          gbpPerMon: "0.025",
          source: "CoinGecko",
          basis: "mainnet MON",
          observedAtUnixSeconds: 1_800_000_000,
          lockedAtUnixSeconds: 1_800_000_030,
          subtotalWei: "920000000000000000000",
        },
      },
      2,
    ),
    {
      currency: "GBP",
      merchant: "The Green Room",
      subtotalPence: 2_300,
      items: [
        { name: "Starter", amountPence: 900 },
        { name: "Wine", amountPence: 1_400 },
      ],
      quote: {
        gbpPerMon: "0.025",
        source: "CoinGecko",
        basis: "mainnet MON",
        observedAtUnixSeconds: 1_800_000_000,
        lockedAtUnixSeconds: 1_800_000_030,
        subtotalWei: "920000000000000000000",
      },
    },
  );
  assert.equal(
    parseTapTabGbpMetadata(
      {
        currency: "GBP",
        items: [{ name: "Starter", amountPence: 900 }],
        subtotalPence: 2_300,
      },
      1,
    ),
    undefined,
    "a declared subtotal that conflicts with the item total is rejected",
  );
  assert.equal(
    parseTapTabGbpMetadata({ currency: "USD", subtotalPence: 2_300 }, 0),
    undefined,
  );
  assert.deepEqual(
    parseTapTabGbpMetadata(
      {
        currency: "GBP",
        subtotalPence: 2_300,
        quote: {
          gbpPerMon: "0",
          source: "CoinGecko",
          basis: "mainnet MON",
          observedAtUnixSeconds: 1_800_000_000,
          lockedAtUnixSeconds: 1_799_999_999,
          subtotalWei: "0",
        },
      },
      0,
    ),
    { currency: "GBP", subtotalPence: 2_300 },
    "invalid optional quote provenance is ignored",
  );
  assert.deepEqual(
    parseTapTabGbpMetadata(
      {
        currency: "GBP",
        subtotalPence: 2_300,
        quote: {
          gbpPerMon: "0.025",
          source: "CoinGecko",
          basis: "mainnet MON",
          observedAtUnixSeconds: 1_800_000_000,
          lockedAtUnixSeconds: 1_800_000_030,
          subtotalWei: "1",
        },
      },
      0,
    ),
    { currency: "GBP", subtotalPence: 2_300 },
    "quote provenance that contradicts its GBP/MON arithmetic is ignored",
  );
});

test("accepts only fully disclosed schema-v2 scaling that matches every onchain row", () => {
  const scaled = {
    schema: "taptab-gbp-receipt",
    version: 2,
    currency: "GBP",
    merchant: "The Green Room",
    subtotalPence: 300,
    items: [
      { name: "Starter", amountPence: 100 },
      { name: "Wine", amountPence: 200 },
    ],
    quote: {
      gbpPerMon: "1",
      source: "Coinbase",
      basis: "mainnet MON",
      observedAtUnixSeconds: 1_800_000_000,
      lockedAtUnixSeconds: 1_800_000_030,
      allocation: "per-row-half-up",
      referenceSubtotalWei: "3000000000000000000",
    },
    settlement: {
      mode: "scaled-testnet-demo",
      divisor: 1_000,
      allocation: "largest-remainder-half-up",
      subtotalWei: "3000000000000000",
      network: "Monad Testnet",
    },
  };
  const onchain = {
    subtotalWei: 3_000_000_000_000_000n,
    itemAmountsWei: [1_000_000_000_000_000n, 2_000_000_000_000_000n],
  };

  assert.deepEqual(parseTapTabGbpMetadata(scaled, 2, onchain), {
    currency: "GBP",
    merchant: "The Green Room",
    subtotalPence: 300,
    items: scaled.items,
    quote: {
      gbpPerMon: "1",
      source: "Coinbase",
      basis: "mainnet MON",
      observedAtUnixSeconds: 1_800_000_000,
      lockedAtUnixSeconds: 1_800_000_030,
      referenceSubtotalWei: "3000000000000000000",
    },
    settlement: scaled.settlement,
  });

  for (const malformed of [
    { ...scaled, version: 1 },
    { ...scaled, settlement: { ...scaled.settlement, divisor: 999 } },
    { ...scaled, settlement: { ...scaled.settlement, subtotalWei: "3000000000000001" } },
    { ...scaled, quote: { ...scaled.quote, referenceSubtotalWei: "2999999999999999999" } },
    { ...scaled, quote: { ...scaled.quote, subtotalWei: scaled.settlement.subtotalWei } },
    { ...scaled, settlement: undefined },
  ]) {
    assert.equal(
      parseTapTabGbpMetadata(malformed, 2, onchain),
      undefined,
      JSON.stringify(malformed),
    );
  }

  assert.equal(
    parseTapTabGbpMetadata(scaled, 2, {
      ...onchain,
      itemAmountsWei: [1_000_000_000_000_001n, 1_999_999_999_999_999n],
    }),
    undefined,
    "the subtotal alone cannot conceal changed onchain rows",
  );
  assert.equal(
    parseTapTabGbpMetadata(scaled, 2),
    undefined,
    "scaled receipt values require their exact onchain evidence",
  );
});

test("accepts the deployed Table 7 scaling when several rows receive remainder wei", () => {
  const metadata = {
    schema: "taptab-gbp-receipt",
    version: 2,
    currency: "GBP",
    merchant: "Lina Stores · Shoreditch",
    subtotalPence: 4_850,
    items: [
      { name: "Wood-fired margherita", amountPence: 1_200 },
      { name: "Truffle fries", amountPence: 750 },
      { name: "Burrata & tomatoes", amountPence: 900 },
      { name: "Bottle of house red", amountPence: 1_400 },
      { name: "Pistachio gelato", amountPence: 600 },
    ],
    quote: {
      gbpPerMon: "0.01536012",
      source: "CoinGecko",
      basis: "mainnet MON",
      observedAtUnixSeconds: 1_786_122_010,
      lockedAtUnixSeconds: 1_786_122_115,
      allocation: "per-row-half-up",
      referenceSubtotalWei: "3157527415150402470814",
    },
    settlement: {
      mode: "scaled-testnet-demo",
      divisor: 1_000,
      allocation: "largest-remainder-half-up",
      subtotalWei: "3157527415150402471",
      network: "Monad Testnet",
    },
  };
  const onchain = {
    subtotalWei: 3_157_527_415_150_402_471n,
    itemAmountsWei: [
      781_243_896_532_058_343n,
      488_277_435_332_536_465n,
      585_932_922_399_043_757n,
      911_451_212_620_734_734n,
      390_621_948_266_029_172n,
    ],
  };

  assert.deepEqual(parseTapTabGbpMetadata(metadata, 5, onchain), {
    currency: "GBP",
    merchant: metadata.merchant,
    subtotalPence: metadata.subtotalPence,
    items: metadata.items,
    quote: {
      gbpPerMon: metadata.quote.gbpPerMon,
      source: metadata.quote.source,
      basis: metadata.quote.basis,
      observedAtUnixSeconds: metadata.quote.observedAtUnixSeconds,
      lockedAtUnixSeconds: metadata.quote.lockedAtUnixSeconds,
      referenceSubtotalWei: metadata.quote.referenceSubtotalWei,
    },
    settlement: metadata.settlement,
  });
});

test("preserves explicit schema-v1 per-row quote parsing for the original bill", () => {
  assert.deepEqual(
    parseTapTabGbpMetadata(
      {
        schema: "taptab-gbp-receipt",
        version: 1,
        currency: "GBP",
        subtotalPence: 2_300,
        items: [
          { name: "Starter", amountPence: 900 },
          { name: "Wine", amountPence: 1_400 },
        ],
        quote: {
          gbpPerMon: "0.025",
          source: "CoinGecko",
          basis: "mainnet MON",
          observedAtUnixSeconds: 1_800_000_000,
          lockedAtUnixSeconds: 1_800_000_030,
          allocation: "per-row-half-up",
          subtotalWei: "920000000000000000000",
        },
      },
      2,
    )?.quote?.subtotalWei,
    "920000000000000000000",
  );
});

test("parses custom tip percentages without floating-point rounding", () => {
  assert.equal(parseTipPercentToBps("0"), 0);
  assert.equal(parseTipPercentToBps("10"), 1_000);
  assert.equal(parseTipPercentToBps("12.5"), 1_250);
  assert.equal(parseTipPercentToBps("17.77"), 1_777);
  assert.equal(parseTipPercentToBps("30"), 3_000);
  for (const value of ["-1", "12.345", "30.01", "31", "ten", ""]) {
    assert.equal(parseTipPercentToBps(value), undefined, value);
  }
  assert.equal(formatTipBps(1_250), "12.5%");
  assert.equal(formatTipBps(1_777), "17.77%");
});

test("produces compact, stage-ready event and phase labels", () => {
  assert.equal(shortTapTabAddress(CONTRACT), "0x1111…1111");
  assert.equal(tapTabPhaseLabel("funding"), "Collecting payments");
  assert.deepEqual(
    presentTapTabChainEvent("ContributionReceived", {
      payer: CONTRACT,
      beneficiary: OTHER_CONTRACT,
    }),
    {
      title: "Payment confirmed",
      detail: "0x1111…1111 paid for 0x2222…2222",
      tone: "positive",
    },
  );
  assert.equal(
    presentTapTabChainEvent("BillExpired", {}).detail,
    "Contributions can now be refunded",
  );
});

test("trusts a personalised payment target only inside the exact bill context", () => {
  const context = {
    origin: "https://taptab.example",
    pathname: "/table",
    contractAddress: CONTRACT,
    billId: 7n,
    participantAddresses: [PARTICIPANT],
  };
  const paymentUrl = buildParticipantPaymentUrl(context, PARTICIPANT);
  assert.deepEqual(resolveParticipantPaymentUrl(paymentUrl, context), {
    status: "trusted",
    participantAddress: PARTICIPANT,
    url: paymentUrl,
  });

  for (const unsafe of [
    paymentUrl.replace(PARTICIPANT, OTHER_CONTRACT),
    paymentUrl.replace("#pay", "&redirect=https%3A%2F%2Fevil.example#pay"),
    paymentUrl.replace(`bill=7`, "bill=8"),
  ]) {
    assert.equal(resolveParticipantPaymentUrl(unsafe, context).status, "rejected");
  }
});

test("fails closed for malformed local names and excludes them from venue JSON by default", () => {
  assert.deepEqual(parsePrivateNameMappings("not-json"), []);
  const input = {
    chainId: 10_143,
    contractAddress: CONTRACT,
    billId: 7n,
    currency: "GBP",
    subtotalPence: 1_001,
    tipPence: 124,
    totalDuePence: 1_125,
    fundedPence: 1_125,
    allocations: [
      {
        walletAddress: PARTICIPANT,
        privateName: "Alex",
        baseDuePence: 1_001,
        tipPence: 124,
        totalDuePence: 1_125,
        fundedPence: 1_125,
        transactionHashes: [HASH],
      },
    ],
    transactionHashes: [HASH],
  };
  const publicJson = serialiseVenueSettlementRecord(input);
  const namedJson = serialiseVenueSettlementRecord(input, { includePrivateNames: true });
  assert.equal(publicJson.includes("Alex"), false);
  assert.equal(publicJson.includes("privateName"), false);
  assert.match(namedJson, /"privateName": "Alex"/);
});

test("wires unanimous split approval, safe leave transfer and privacy gates into the panel", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );
  for (const integration of [
    "buildSplitStatusRead(context)",
    "buildSplitDigestRead(context)",
    "buildSplitApprovalRead(context, address)",
    "buildApproveSplitWrite(",
    "buildRevokeSplitApprovalWrite(trustedContext)",
    "buildLeaveWrite(trustedContext, selectedLeaveRecipient)",
    "resolveParticipantPaymentUrl(locationHref, paymentLinkContext)",
    'pathname: "/pay"',
    "buildParticipantPaymentUrl(paymentShareLinkContext, selectedBeneficiary.address)",
    "window.localStorage.setItem(",
    "createVenueSettlementDownload(venueSettlementInput",
    "checked={includePrivateNames}",
    'id="pay"',
    "Contract and bill checks verify the code context",
    "Open the sample bill",
    'paymentPanel?.scrollIntoView({ behavior: "smooth", block: "start" })',
    "The beneficiary is fixed by this trusted link.",
    "onPaymentLinkState({",
    "Inspect first. Connect only when you are ready to take part.",
    "Switch to Monad Testnet",
    "Open official Monad faucet",
    "Refresh balance",
    "metadataIsImmutableInline",
    "does not contain a valid locked quote",
  ]) {
    assert.ok(source.includes(integration), `missing panel integration: ${integration}`);
  }
  assert.match(source, /useState\(false\);\n\s+const \[venueExportError/);
  assert.match(source, /disabled=\{!unanimousSplitApproval \|\| transactionBusy\}/);
  assert.match(source, /Payment link ignored\./);
  assert.match(source, /The trusted contract and bill remain unchanged/);
  assert.match(source, /Wallet\s+addresses, claims and payments are public onchain/);
  assert.match(source, /Scaled Testnet demo/);
  assert.match(source, /Faucet-funded settlement/);
  assert.match(source, /Testnet MON has no cash value/);
});

test("puts the live task before contextual evidence without broadening permissions", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );

  const taskStart = source.indexOf('className="live-control-card live-current-task"');
  const technicalStart = source.indexOf('className="tool-disclosure live-technical-details"');
  const overviewStart = source.indexOf('className="live-overview-grid"');
  assert.notEqual(taskStart, -1);
  assert.notEqual(technicalStart, -1);
  assert.notEqual(overviewStart, -1);
  assert.ok(taskStart < technicalStart, "the current task must precede technical evidence");
  assert.ok(taskStart < overviewStart, "the current task must precede the full bill breakdown");

  const taskEnd = source.indexOf("</section>", taskStart);
  const taskMarkup = source.slice(taskStart, taskEnd);
  for (const taskFact of [
    "Wallet identity and role",
    "personalAmountLabel",
    "personalAmountWei",
    'data-phase={snapshot.phase}',
    "livePrimaryTask.detail",
    "livePrimaryTask.label",
  ]) {
    assert.ok(taskMarkup.includes(taskFact), `missing task-first fact: ${taskFact}`);
  }
  assert.match(
    taskMarkup,
    /livePrimaryTask\.href \? \([\s\S]*?<a[\s\S]*?<button/,
    "the first view must render exactly one conditional primary link or button",
  );

  const disclosureContains = (className, childMarker) => {
    const classIndex = source.indexOf(className);
    const disclosureStart = source.lastIndexOf("<details", classIndex);
    const disclosureEnd = source.indexOf("</details>", classIndex);
    assert.notEqual(classIndex, -1, `missing disclosure: ${className}`);
    assert.notEqual(disclosureStart, -1, `missing details wrapper: ${className}`);
    assert.notEqual(disclosureEnd, -1, `unclosed details wrapper: ${className}`);
    const disclosure = source.slice(disclosureStart, disclosureEnd);
    assert.match(disclosure, /<summary>/, `missing accessible summary: ${className}`);
    assert.ok(
      disclosure.includes(childMarker),
      `${childMarker} must stay inside ${className}`,
    );
  };

  disclosureContains("live-technical-details", 'className="live-trust-strip"');
  disclosureContains("live-transaction-history-details", "<TransactionStatusList");
  disclosureContains("live-settlement-export-details", "live-venue-export-title");
  disclosureContains("live-activity-details", 'className="live-event-card"');

  const visibleWarning = source.indexOf('className="live-provenance-note" role="note"');
  assert.ok(visibleWarning !== -1 && visibleWarning < technicalStart);
  assert.match(source.slice(visibleWarning, technicalStart), /Testnet MON has no cash\s+value/);

  const primaryLogicStart = source.indexOf("const livePrimaryTask");
  const primaryLogicEnd = source.indexOf("return (", primaryLogicStart);
  const primaryLogic = source.slice(primaryLogicStart, primaryLogicEnd);
  assert.match(
    primaryLogic,
    /if \(isCreator && unanimousSplitApproval\)[\s\S]*?buildOpenFundingWrite\(trustedContext\)/,
  );
  assert.match(
    primaryLogic,
    /snapshot\.phase === "settled" && isPayee && snapshot\.proceedsAvailable > 0n[\s\S]*?buildWithdrawWrite\(trustedContext\)/,
  );
  assert.match(
    primaryLogic,
    /wallet\.status === "error"[\s\S]*?!wallet\.account[\s\S]*?action: "retry-wallet-setup"/,
  );
  assert.match(
    primaryLogic,
    /case "retry-wallet-setup":[\s\S]*?wallet\.retryInitialisation\(\)/,
  );
});

test("keeps the scaled-settlement disclosure beside live Stage Mode totals", async () => {
  const [appSource, cssSource] = await Promise.all([
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /className="stage-money-disclosure" role="note"/);
  assert.match(appSource, /Faucet-funded settlement is scaled/);
  assert.match(appSource, /Testnet MON has no cash value/);
  assert.match(cssSource, /\.stage-money-disclosure/);
});

test("scopes snapshots, events and transactions to the current trusted bill", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );

  for (const guard of [
    "const [snapshotState, setSnapshotState]",
    "sameAddress(context.address, snapshotState.context.address)",
    "context.billId === snapshotState.context.billId",
    "scopedEvents.scope === contextScope",
    "scopedTransactions.scope === transactionScope",
    "metadataScope === contextScope",
    "activeContextScope.current !== contextScope",
    "refreshInFlight.current?.scope === contextScope",
    "setScopedEvents((current)",
    "setScopedTransactions((current)",
    "setMetadataScope(contextScope)",
    'shareUrl: callbackSnapshot ? shareUrl : ""',
    'window.addEventListener("hashchange", update)',
    "const assertCurrentTransactionScope = () =>",
    "The bill or connected wallet changed before submission. Nothing was submitted.",
    'transaction.status === "unverified"',
    "Check status again",
    "transactionInFlight.current",
    "pendingTapTabTransactionScopeKey(pendingTransactionScope)",
    "activeTransactionScope.current !== transactionScope",
  ]) {
    assert.ok(source.includes(guard), `missing live-context guard: ${guard}`);
  }

  assert.doesNotMatch(source, /const \[snapshot, setSnapshot\]/);
  assert.doesNotMatch(source, /setEvents\(|setTransactions\(/);
  assert.ok(
    source.match(/assertCurrentTransactionScope\(\)/g)?.length >= 7,
    "the transaction scope must be rechecked after asynchronous boundaries",
  );
});

test("gates live polling and event watches by workspace activity and page visibility", async () => {
  const [panelSource, appSource] = await Promise.all([
    readFile(new URL("../app/TapTabLivePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TapTabApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(panelSource, /active: boolean;/);
  assert.match(
    appSource,
    /workspaceMode === "live" \? \([\s\S]*?<TapTabLivePanel active onLiveUpdate=/,
    "the conditionally mounted live workspace should mark its panel active",
  );
  assert.match(panelSource, /document\.addEventListener\("visibilitychange", update\)/);
  assert.match(panelSource, /document\.visibilityState !== "hidden"/);
  assert.match(panelSource, /const periodicReadsEnabled = active && documentVisible;/);
  assert.equal(
    panelSource.match(/if \(!context \|\| !periodicReadsEnabled\) return;/g)?.length,
    2,
    "both the periodic refresh scheduler and contract-event watcher must be gated",
  );
  assert.match(
    panelSource,
    /const initial = window\.setTimeout\(\(\) => \{\s+setEventReadError\(undefined\);\s+void refresh\(\);\s+\}, 0\);/,
    "resuming must schedule one immediate snapshot refresh",
  );
  assert.match(
    panelSource,
    /\[context, hasPendingTransaction, periodicReadsEnabled, refresh\]/,
  );
  assert.match(
    panelSource,
    /\[context, contextScope, periodicReadsEnabled, publicClient, refresh\]/,
  );
  assert.match(
    panelSource,
    /const receipt = await publicClient\.waitForTransactionReceipt\(\{[\s\S]*?timeout: TRANSACTION_RECEIPT_TIMEOUT_MS,[\s\S]*?checkReplacement: true,[\s\S]*?await refresh\(true\);/,
    "the submitted-transaction receipt waiter and its reconciliation refresh stay independent of polling gates",
  );
});

test("loads each pinned live snapshot through two fail-closed Multicall3 waves", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /client\.multicall\(\{/);
  assert.match(source, /allowFailure: false/);
  assert.match(source, /batchSize: TAPTAB_MULTICALL_BATCH_SIZE_BYTES/);
  assert.equal(
    source.match(/await readContractsAtBlock</g)?.length,
    2,
    "a snapshot should use one base-data multicall and one dependent-data multicall",
  );
  assert.equal(source.match(/publicClient\.getBlockNumber\(\)/g)?.length, 1);
  assert.equal(
    source.match(/buildCurrentBlockTimestampRead\(\)/g)?.length,
    1,
    "the pinned first wave should read the Multicall3 block timestamp exactly once",
  );
  assert.match(
    source,
    /buildSplitDigestRead\(context\),\s+buildCurrentBlockTimestampRead\(\),\s+\],\s+blockNumber,/,
    "the chain timestamp must be read inside the first pinned Multicall3 wave",
  );
  assert.match(source, /chainTimestamp,\s+phase: deriveTapTabPhase/);
  assert.match(source, /const secondWaveContracts = \[/);
  assert.match(source, /safeCount\(splitStatus\.requiredApprovals\) !== addresses\.length/);
  assert.match(source, /safeCount\(splitStatus\.approvalCount\) !== countedApprovals/);
  assert.equal(
    source.match(/buildSplitDigestRead\(context\)/g)?.length,
    1,
    "the immutable pinned block does not need a redundant digest reread",
  );
  assert.doesNotMatch(source, /confirmedSplitDigest/);
});

test("gates expiry only with the pinned chain timestamp", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );
  const gateStart = source.indexOf("const deadlinePassed =");
  const gateEnd = source.indexOf("const fullyFunded =", gateStart);
  assert.notEqual(gateStart, -1);
  assert.notEqual(gateEnd, -1);

  const deadlineGate = source.slice(gateStart, gateEnd);
  assert.match(
    deadlineGate,
    /snapshot\.chainTimestamp >= snapshot\.bill\.deadline/,
  );
  assert.doesNotMatch(deadlineGate, /fetchedAt|Date\.now|new Date|performance\.now/);
  assert.match(
    source,
    /Last read \{new Date\(snapshot\.fetchedAt\)/,
    "fetchedAt remains presentation-only metadata",
  );
});

test("uses fail-closed batched invitations and selectable atomic share claims", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );

  for (const integration of [
    "buildInviteManyWrite(context, inviteBatch.addresses)",
    "buildClaimManyWrite(context, itemIndexes, shareIndexes)",
    "buildUnclaimWrite(",
    "split(/[\\s,]+/)",
    "MAX_TAPTAB_PARTICIPANTS",
    "MAX_TAPTAB_TOTAL_SHARES",
    "Nothing will be submitted.",
    "All invitations will use one atomic Monad transaction.",
    "Select any free slots, then claim them together in one atomic transaction.",
    "current.scope === claimSelectionScope",
    ".filter((key) => available.has(key))",
  ]) {
    assert.ok(source.includes(integration), `missing batch interaction: ${integration}`);
  }

  assert.equal(source.includes("buildInviteWrite("), false);
  assert.equal(source.includes("buildClaimWrite("), false);
  assert.match(source, /addresses\.length > 0 && inviteBatchError === undefined/);
  assert.match(source, /sameAddress\(context\.address, snapshot\.context\.address\)/);
  assert.match(source, /aria-pressed=\{isFree \? isSelected : undefined\}/);
  assert.match(source, /isMine\) \{\s+void submitTransaction\(\s+"Release item share"/);
  assert.match(source, /disabled=\{selectedClaimKeys\.length === 0 \|\| transactionBusy\}/);
});

test("guides participants to claim before approval and exposes live proof hooks", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /<label htmlFor="live-invite-address">Participant wallets<\/label>[\s\S]*?<textarea[\s\S]*?id="live-invite-address"[\s\S]*?data-testid="participant-wallets-field"/,
  );

  const primaryTaskStart = source.indexOf("const livePrimaryTask");
  const primaryTaskEnd = source.indexOf("return (", primaryTaskStart);
  assert.notEqual(primaryTaskStart, -1);
  assert.notEqual(primaryTaskEnd, -1);
  const primaryTask = source.slice(primaryTaskStart, primaryTaskEnd);
  assert.match(
    primaryTask,
    /activeAccount\?\.participant\.joined[\s\S]*?!activeAccount\.approvedCurrentSplit[\s\S]*?if \(!ownsItemShares && availableClaimKeys\.length > 0\) \{[\s\S]*?title: "Claim items before approval"[\s\S]*?href: "#live-items-title"[\s\S]*?title: "Check and approve your split"[\s\S]*?href: "#live-approval-title"/,
    "a participant with available shares must claim before approval, while a zero-item allocation remains approvable",
  );
  assert.match(
    source,
    /\{ownsItemShares \? \([\s\S]*?<a className="quiet-button" href="#live-approval-title">[\s\S]*?Review and approve my updated split/,
    "the approval route should appear after a participant has claimed a share",
  );

  const activityHookIndex = source.indexOf('data-testid="confirmed-testnet-activity"');
  assert.notEqual(activityHookIndex, -1);
  const activityEnd = source.indexOf("</details>", activityHookIndex);
  assert.notEqual(activityEnd, -1);
  const activityDisclosure = source.slice(activityHookIndex, activityEnd);
  assert.match(activityDisclosure, /Confirmed Monad activity/);
  assert.match(activityDisclosure, /event\.explorerUrl/);
  assert.match(activityDisclosure, /href=\{event\.explorerUrl\}/);
  assert.match(activityDisclosure, /target="_blank" rel="noreferrer"/);
});

test("reports measured Monad confirmation time and polls faster only while pending", async () => {
  const source = await readFile(
    new URL("../app/TapTabLivePanel.tsx", import.meta.url),
    "utf8",
  );

  for (const telemetry of [
    "submittedAt?: number",
    "confirmedAt?: number",
    "confirmationMs?: number",
    "const submittedAt = Date.now()",
    "const confirmedAt = Date.now()",
    "const confirmationMs = Math.max(0, confirmedAt - submittedAt)",
    "latestConfirmation?: TapTabConfirmationMeasurement",
    "...(latestConfirmation ? { latestConfirmation } : {})",
    "Confirmed in ${confirmationDurationLabel(confirmationMs)}",
  ]) {
    assert.ok(source.includes(telemetry), `missing confirmation telemetry: ${telemetry}`);
  }

  assert.match(
    source,
    /hasPendingTransaction \? PENDING_POLL_INTERVAL_MS : POLL_INTERVAL_MS/,
  );
  assert.match(
    source,
    /transaction\.status === "pending"/,
    "only submitted transactions should trigger fast polling",
  );
});

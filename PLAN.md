# TapTab Plan

**Status:** Verified & Polished — local prototype
**Updated:** 8 August 2026

## Completed

- Production web build.
- 223 application tests.
- 63 passing Playwright tests with 27 intentional profile-specific skips across
  one desktop, two tablet and two mobile Chromium profiles.
- ESLint validation.
- Strict application TypeScript validation.
- 89 Hardhat contract tests.
- Desktop visual and interaction audit.
- Responsive design-lead pass with clearer hierarchy, accessible contrast and 44px tablet targets.
- Sample/live workspace separation.
- Honest unconfigured-Testnet recovery state.
- Bill-scoped live snapshots, evidence, metadata and transaction guards.
- Browser-verified sponsorship, navigation, receipt and custom-tip fixes.
- Submitted-transaction reconciliation, bounded read retries and visible recovery paths.
- OCR cancellation, route error boundary and best-effort PWA cache failure handling.
- No-store liveness and Monad Testnet readiness endpoints with bounded probes,
  correlation IDs and safe failure responses.
- Onchain and pre-wallet rejection of a self-payee bill that could make settled
  proceeds permanently unreachable.
- Version-stamped split-digest memoisation, reducing the measured maximum-shape
  32-person approval sequence by 88.84% while retaining canonical verification.
- Exact nested claim indexing that removes delimiter collisions and reuses
  validated per-item claim state.
- Settlement exports reject allocation evidence that is absent from the
  canonical top-level transaction set.
- Inactive workspaces and hidden tabs suspend periodic chain reads; active live
  snapshots use two fail-closed Multicall3 waves pinned to one block.
- Expiry eligibility uses the timestamp returned in that pinned Monad block
  snapshot rather than the browser clock.
- Deterministic property coverage checks 12,000 generated TypeScript bills, and
  differential coverage replays 40 curated or seeded bills against Solidity.
- A replayable ten-seed bounded stateful Solidity campaign covers two runs each
  through settlement, funding cancellation, funding expiry, draft cancellation
  and draft expiry, with an independent allocation/tip oracle. The original
  deterministic invariant scenario remains alongside it.
- TapTab enforces the client-aligned 64,000-byte metadata ceiling using UTF-8
  byte length rather than character count.
- A chain-31337-only multi-account rehearsal covers settlement and proceeds,
  cancellation, expiry and contributor-owned refunds in one command.
- A separate maximum-shape chain-31337 benchmark enforces explicit local gas
  regression ceilings without presenting them as public-network fee or latency
  forecasts.
- The sample workspace exports a distinct local evidence schema with recalculated
  invariants and no chain, wallet, transaction, explorer or price claims.
- Playwright exercises the sample journey, focus restoration, viewport overflow,
  serious automated accessibility findings and degraded-price states across
  desktop, tablet and mobile profiles.
- Controlled EIP-6963 browser tests exercise the production Reown/Ethers adapter,
  connector discovery, rejection, account/network/disconnect events and strict
  suppression of every signing and transaction method.
- Deterministic browser RPC fixtures exercise late Bill A/B reads and prove that
  a wallet change during exact-action simulation cannot reach a signing or
  transaction method, without contacting Monad Testnet.
- Stable largest-remainder GBP ledgers reconcile every grouped receipt row and
  participant base/tip display to the exact bill-wide penny targets while
  retaining the unchanged MON secondary values.
- The live workspace presents one task-first card, while a five-step host
  checklist keeps receipt, quote, creation, invitation and venue trust explicit.
- Public reads support one validated primary-first RPC fallback; wallet writes
  never use or retry through that transport.
- A focused personal-payment route fixes the beneficiary from a trusted link and
  keeps organiser controls out of the diner view.
- Submitted transactions are bounded, replacement-aware and recoverable after a
  refresh within the exact chain, contract, bill and wallet scope.
- Receipt files are checked for type signatures and bounded decoded dimensions
  before OCR, and price failures carry privacy-safe request identifiers.
- Active TapTab wallet APIs are isolated behind canonical names while retained
  CrowdCart exports are explicitly documented compatibility aliases.
- Public metadata uses the validated configured origin rather than request host
  headers, and copied environment templates remain genuinely unconfigured.
- Local judge runbook and feature-freeze policy.
- Project README and architecture documentation.
- Monad Testnet contract deployment, canonical bill creation, Sourcify full
  source match, public readiness, and sealed multi-wallet settlement/refund
  evidence for source checkpoint `27ecdb4`.

## Local Judge Gates

- Freeze the feature surface and run `npm run verify:local` after the final
  accepted source change.
- Record the final verified test totals only from that completed gate.
- Create an intentional clean source-control checkpoint; the current dirty tree
  is not reproducible from the existing commit.
- Record the checkpoint, tool versions, command result and hashes of both ignored
  local JSON reports in a small evidence manifest.
- Capture maintained desktop and mobile screenshots only from that exact tested
  checkpoint; no current screenshot should be presented as final evidence.
- Rehearse and record the bounded three-minute local presentation.
- Complete keyboard, screen-reader, zoom and physical-device testing beyond the
  automated browser checks.

## Deliberately deferred engineering work

- Extend the bounded ten-seed campaign into sustained CI fuzzing.
- Add a controlled browser-wallet lifecycle for submitted, repriced, replaced,
  reverted and refresh-recovered transaction receipts.
- Upgrade Vinext and the Hardhat/plugin toolchain only in isolated compatibility
  branches with the full regression gate retained.
- Split the largest interface components and retire the remaining CrowdCart
  compatibility surface after the judging freeze.
- Design shared cache, monitoring and incident telemetry only after the intended
  hosting and privacy model is chosen.

## External or owner-controlled gates

- Obtain written guidance on Monad Blitz fresh-project eligibility.
- Publish the required organiser fork and test a clean unauthenticated clone.
- Redeploy the current local task-first, RPC-fallback and corrected Reown Ethers-adapter
  revision; the public Worker still represents checkpoint `27ecdb4`.
- Publish the already Sourcify-matched source on Monadscan using an owner API key
  or owner acceptance of the explorer's manual terms.
- Rehearse the current browser build with disposable funded wallets and record
  the live three-minute Testnet path.
- Obtain an independent Solidity review before any non-Testnet value is
  considered.

“Verified & Polished” applies only to the locally testable current revision. It
does not mean production-ready, independently audited or redeployed from the
current working tree.

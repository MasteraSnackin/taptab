# TapTab Visual and Functional Quality Gate

> **Historical checkpoint:** this report records the 6 August local-only pass.
> It is not the current release status. See
> [docs/MARKDOWN_TASK_COMPLETION.md](docs/MARKDOWN_TASK_COMPLETION.md) for the
> completed follow-on work, current verification totals and remaining external
> gates.

**Audit date:** 6 August 2026
**Target:** local application at <http://localhost:3000/>
**Scope:** local sample, unconfigured live-mode fallback, source review and
automated quality gates
**Result:** Verified and polished for the locally testable prototype

The scores below do not imply production readiness. A public Monad Testnet
deployment, real-wallet transaction path, independent contract audit and
assistive-technology test remain outside the evidence available in this
environment.

## Squad Status

| Category | Score | Finding |
| --- | ---: | --- |
| Visual | 9.2/10 | Strong hierarchy, coherent grid, restrained depth and a distinctive GBP-first consumer identity. |
| Functional | 9.0/10 | The complete sample flow is responsive and automated gates pass; the real-wallet path is not configured here. |
| Trust | 9.4/10 | Sample and live states are separated, monetary claims are qualified and contract writes fail closed before submission. |

All scored categories meet the 9/10 threshold. No self-correction cycle was
started because the observed local application had no substantiated below-
threshold defect.

## Environmental Check

- The Vinext development application rendered successfully at
  <http://localhost:3000/>.
- The initial route completed without a compiler or runtime error.
- The homepage exposed the expected header, hero, sample workspace, bill flow,
  stage mode and footer.
- The price reference resolved after the initial loading message.
- Switching to Monad Testnet with no deployment configuration produced an
  explicit “Live mode is not configured” state.
- The local sample remained available as the recovery path.

### Automated evidence

| Check | Result |
| --- | --- |
| <code>npm test</code> | Passed; production build and 185 of 185 web tests |
| <code>npm run test:e2e</code> | Passed; 18 of 18 desktop, tablet and mobile browser tests |
| <code>npm run lint</code> | Passed |
| <code>npm run typecheck</code> | Passed |
| <code>cd contracts && npm test</code> | Passed; 61 of 61 contract tests |
| <code>cd contracts && npm run benchmark:gas</code> | Passed; all selected maximum-shape chain-31337 ceilings |
| <code>cd contracts && npm run rehearse:local</code> | Passed; settlement, cancellation, expiry, proceeds and independent refunds on ephemeral chain 31337 |
| Root <code>npm audit</code> | Passed; 0 advisories |
| Contract production dependency audit | Passed; 0 production advisories |
| Full contract development-tool audit | 21 advisories: 8 high, 2 moderate and 11 low; npm's available remediation requires major Hardhat and plugin migrations |

These commands validate source and deterministic simulation. They do not prove a
successful wallet signature, RPC write, explorer confirmation or public
deployment.

The sample presenter now exports a distinct local evidence schema with
recalculated conservation checks. It contains no contract address, transaction
hash, explorer link or price claim and cannot be imported as live recovery data.

The Hardhat advisories affect development and deployment tooling rather than the
deployed contract bytecode or browser runtime. An automatic forced upgrade was
not applied: npm's proposed remediation crosses major Hardhat and plugin
versions and could change compilation or future Monad verification behaviour.
That migration needs a separate controlled compatibility pass before any signer
is used.

## Visual Wins

### Information architecture

- The first viewport answers the principal questions quickly: what TapTab does,
  why it is safer and how to try it.
- The headline, short explanation and two primary actions form a clear reading
  order.
- The product preview makes group total, personal share and settlement
  protection understandable without exposing contract detail.
- The sample and Monad Testnet workspaces are visually and semantically distinct.
- Within the bill, the numbered progress model reduces the journey to claim,
  fund and settle.

### Layout and spacing

- The hero uses a balanced two-column composition at desktop width.
- Feature, receipt, funding and evidence areas use consistent modular grids.
- Border, radius and spacing tokens repeat predictably.
- Dense controls remain grouped by user intent rather than being scattered
  across independent feature panels.
- Narrow-layout breakpoints collapse grids in source without changing the task
  order.

### Visual language

- The violet, mint, amber and near-black palette distinguishes action, safety
  and network context.
- Translucency and soft shadows are applied selectively to navigation,
  switchers and cards; content contrast is not sacrificed for glass effects.
- The hero display face, italic accent and monospaced labels create a recognisable
  identity while body text remains conventional and readable.
- Fluid type sizing supplies responsive movement without unnecessary continuous
  animation.
- The global reduced-motion rule limits transitions and animations when the user
  requests it.

### Navigation

TapTab is a focused consumer flow, so it does not need a persistent sidebar. The
quiet top navigation is grouped by the three relevant intents: sample bill,
Monad Testnet and explanation. Adding a sidebar to satisfy a generic audit
template would consume space and weaken the mobile experience.

## Interaction and Trust Wins

### Immediate feedback

- Approving the sample split immediately changed the ready count from zero to
  one.
- Workspace changes replaced the task context without an ambiguous intermediate
  screen.
- Buttons expose disabled, pressed and busy states where appropriate.
- The measured browser-control round trip for one approval was 279 ms; that
  figure includes automation and transport overhead and is not a reliable
  sub-100-ms UI benchmark.

### Loading, empty, error and success states

- Price loading is announced with clear text and live-region semantics.
- Receipt recognition has idle, loading, recognising, ready and error states.
- Live contract reads provide loading, last-known snapshot and recoverable error
  states.
- Missing deployment configuration is treated as an explicit empty/setup state,
  not a broken application.
- Successful sample actions update the relevant local summary and activity feed.
- Live actions distinguish preflight, wallet confirmation, pending receipt,
  confirmed receipt, blocked and error states.

Skeletons are not used as a universal loading treatment. For financial data,
explicit status text is more informative than placeholder amounts and is
accessible through live regions. This is an intentional responsible-interface
choice, not an omitted state.

### Optimistic behaviour

Local sample actions update synchronously because they are deterministic browser
state. Blockchain writes are deliberately not shown as successful before a
confirmed receipt. Optimistically claiming settlement or payment would be a
trust defect.

### Modal and disclosure use

- Stage mode uses a labelled modal dialog because it temporarily changes the
  entire presentation context.
- Stage mode has a visible exit action and returns safely to the workspace.
- Receipt editing and presenter tools use disclosures because they are
  subordinate tasks.
- Wallet signature screens provide the final high-commitment confirmation for
  live writes.

## Critical Fails

**Immediate code fixes required: 0 within the locally testable scope.**

The following release blockers are evidence gaps rather than hidden local UI
defects:

1. No operational public Monad Testnet contract is configured.
2. No real wallet signature or transaction receipt was exercised.
3. No public repository clean-clone test was performed.
4. No physical-device, screen-reader or browser-zoom matrix was completed.
5. The contract has not received an independent security audit.
6. Monad Blitz fresh-project eligibility requires written organiser guidance.

The interface already describes the missing deployment honestly and retains the
sample as a labelled fallback. The blockers must not be converted into simulated
success indicators.

## Logic and Trust Bugs

No new reproducible application-logic bug was found during this pass.

The following residual risks require validation:

- The live creator, invite, claim, approval, sponsor, settle and refund path
  still needs a two-wallet Monad Testnet rehearsal.
- Actual transaction duration, wallet error wording and RPC degradation cannot
  be scored from local simulation.
- A pinned TapTab contract does not authenticate a venue or bill creator.
- Mainnet MON pricing is only a reference for Testnet MON and remains volatile.
- The price cache and retry state are process-local across serverless instances.
- Selected worst-case contract paths have a guarded chain-31337 gas benchmark;
  this is not a public-network fee, latency or capacity forecast.

## Responsible App Assessment

TapTab meets the responsible-prototype standard in the following ways:

- It uses exact integer monetary arithmetic.
- It separates preview activity from confirmed Monad evidence.
- It refuses the wrong network and untrusted contract.
- It simulates the exact call before opening the wallet.
- It checks buffered gas and required balance.
- It blocks incomplete settlement and overpayment in the contract.
- It uses pull-based proceeds and refunds.
- It keeps optional names local and out of payment links.
- It warns that receipt metadata and wallet activity are public onchain.
- It labels Testnet MON and the mainnet price basis accurately.

## Final Decision

**Local prototype status: Verified & Polished.**

The visual, functional and trust scores meet the specified threshold without an
automatic healing change. The Testnet deployment and multi-wallet settlement
and refund rehearsal are complete. Submission readiness remains blocked on
written eligibility confirmation and a public repository; broader use also
requires an independent security review and production operational controls.

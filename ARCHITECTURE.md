# System Architecture — TapTab

## Overview

TapTab is a GBP-first shared-bill web application backed by a native-MON smart
contract on Monad Testnet. A host verifies a receipt, diners claim whole or
shared items, the group agrees a tip and each participant funds only their exact
allocation. Contract rules prevent incomplete settlement and preserve pull-based
refunds if an unfinished bill is cancelled or expires.

The system is a server-rendered React application with a small server-side price
route, browser wallet integration and a non-upgradeable Solidity contract. It
does not use an application database, message broker or private user account
service. Public bill state is onchain; optional participant labels and temporary
workflow data remain in the browser.

This document describes the current source tree and the public Monad Testnet
prototype. Contract
[`0xa2fb…A198`](https://testnet.monadscan.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198)
and canonical scaled demo bill `2` are live on chain `10143`; the public
readiness probe passes and MonadVision's Sourcify flow reports a perfect source
match. Bill `1` remains the initial deployment-time seed. This remains unaudited
hackathon software and is not ready for production funds.

The public Worker represents source checkpoint `27ecdb4`. The current local
working tree additionally contains the task-first live layout, host checklist,
the complete Reown Ethers adapter/connector UI, optional read-RPC fallbacks and
expanded browser coverage described here. Those later changes are locally
verified but are not yet part of the public Worker.

## Key Requirements

### Functional requirements

- Import or enter a receipt and require human verification before use.
- Represent receipt amounts as exact integer GBP pence.
- Convert verified amounts into integer native-MON wei using an explicit quote.
- Support whole items and shared item slots.
- Let diners opt into fair remainder and vote on the tip.
- Require unanimous approval of the current split before funding opens.
- Invalidate approvals whenever the split or membership changes.
- Allow participants to fund themselves or sponsor another participant.
- Reject overfunding and prevent settlement until the exact total is funded.
- Pay the venue through a pull-payment withdrawal.
- Make contributions refundable after valid cancellation or expiry.
- Provide sample, live, recovery and projector-friendly demonstration modes.

### Non-functional requirements

- **Correctness:** preserve penny and wei totals without floating-point contract
  arithmetic.
- **Security:** fail closed on the wrong chain, untrusted contract, reverting
  simulation or insufficient wallet balance.
- **Bounded execution:** cap participant, item and share counts so contract loops
  cannot grow without limit.
- **Privacy:** keep optional names local and explain that wallet addresses,
  receipt metadata and transactions are public onchain.
- **Resilience:** retain a labelled local sample and explicit stale/manual quote
  paths without fabricating live-chain evidence.
- **Usability:** present pounds first, expose wallet detail progressively and
  support narrow mobile screens and stage presentation.
- **Portability:** run locally with no wallet or backend database and publish as
  a Cloudflare-compatible Vinext application.
- **Evidence:** keep browser-preview snapshots and ephemeral Hardhat reports
  distinct from deployed transaction evidence, and make no fixed public-network
  performance claim.

No throughput target, availability service-level objective or production user
capacity has been specified. Those remain open requirements.

## High-Level Architecture

TapTab separates presentation and offchain preparation from authoritative
payment state. The browser performs receipt review, local previews, wallet
orchestration and contract reads. Server routes obtain a reference MON price and
report deployment health; the Solidity contract owns participation, allocation,
funding, settlement and refund invariants.

~~~mermaid
flowchart LR
  Person[Diner, host or presenter] --> App[TapTab web application]
  App --> Local[(Browser storage)]
  App --> OCR[Tesseract.js worker]
  App --> Price[MON price route]
  Price --> Sources[CoinGecko primary<br/>Coinbase exchange-rate fallback]
  App --> Health[Health routes]
  Health --> RPC
  App --> Reown[Reown AppKit]
  Reown --> Wallet[User wallet]
  App --> RPC[Monad Testnet RPC]
  Wallet --> RPC
  RPC --> TapTab[TapTab.sol]
  TapTab --> State[(Onchain bill state)]
  App --> Explorer[Monad explorer]
~~~

The diagram shows the trust boundary that matters most: the browser prepares and
displays actions, but the user wallet authorises writes and <code>TapTab.sol</code>
enforces the financial lifecycle. Browser storage is not authoritative for
payments, and the price service supplies presentation and conversion context
rather than blockchain truth.

## Component Details

### Web application shell

**Files:** <code>app/page.tsx</code>, <code>app/layout.tsx</code>,
<code>app/TapTabApp.tsx</code> and <code>app/globals.css</code>.

**Responsibilities**

- Render the marketing introduction and workspace chooser.
- Separate the local sample from configured Monad Testnet state.
- Coordinate receipt, claim, tip, funding, stage and recovery panels.
- Mount contract-backed live work only while the durable live workspace is
  selected; the sample does not retain a hidden polling panel.
- Guide hosts through receipt verification, locked-quote review, Testnet bill
  creation, wallet invitations and the trusted audience view.
- Provide responsive navigation and progressively disclose advanced controls.
- Generate public metadata, icons and installable-web-app declarations.
- Export a separate local judge snapshot whose schema cannot be confused with
  live settlement or recovery evidence.

**Technology**

- Next.js 16 App Router.
- React 19 client and server components.
- TypeScript with strict application checking.
- Tailwind CSS 4 and application-level CSS.

**Data owned**

- Ephemeral component state.
- The local sample model.
- Selected workspace and presentation state.

The shell calls local domain helpers directly and communicates with chain-facing
components through typed props and adapters.

### Receipt import and verification

**Files:** <code>app/ReceiptImportPanel.tsx</code> and
<code>app/taptab-receipt.ts</code>.

**Responsibilities**

- Accept JPEG, PNG and WebP input within configured size limits.
- Run Tesseract.js OCR in the browser.
- Parse merchant, item and total candidates.
- Require the host to review and correct every row.
- Validate item count, positive values, share counts and subtotal consistency.

**Data owned**

- Temporary image and OCR progress state.
- Editable receipt draft.
- Verified merchant, item and share-count values.

Receipt images are not uploaded by an application service. Only confirmed
receipt data can become public metadata or contract input.

### Sample domain model

**Files:** <code>app/taptab-model.ts</code>,
<code>app/taptab-live-helpers.ts</code> and demonstration components.

**Responsibilities**

- Demonstrate the full user journey without a wallet.
- Calculate item-share, remainder and tip allocations deterministically.
- Model lifecycle, sponsorship, settlement and refund outcomes.
- Label preview evidence so it is not confused with a chain receipt.

**Data owned**

- In-memory sample participants, claims, contributions and activity.

This component is educational and recoverable but not authoritative payment
evidence.

### Local judging evidence

**Files:** <code>app/TapTabJudgeGuide.tsx</code>,
<code>app/TapTabLocalEvidencePanel.tsx</code>,
<code>app/taptab-local-evidence.ts</code>,
<code>contracts/scripts/rehearse-taptab-local.cjs</code>,
<code>contracts/scripts/benchmark-taptab-gas.cjs</code> and
<code>docs/judging/LOCAL_RUNBOOK.md</code>.

The browser export is a self-checking snapshot of sample state. Its distinct
schema contains the receipt, claims, approvals, payments, phase, refunds,
recalculated allocations and conservation checks, but deliberately contains no
chain ID, contract address, wallet, transaction hash, explorer link or price
claim. It is not accepted by the live recovery importer.

The contract rehearsal separately deploys to an in-process Hardhat chain and
executes successful settlement and withdrawal plus cancellation, expiry and
contributor-owned refunds. The gas benchmark exercises selected maximum-shape
operations against explicit regression ceilings. Both scripts refuse any
network other than Hardhat chain <code>31337</code>, write reports under the
ignored <code>outputs/</code> directory and label their addresses and hashes as
ephemeral local evidence.

These artefacts establish different things: the browser export records the
visible simulation, the rehearsal executes Solidity, and the benchmark catches
local gas regressions. None establishes public deployment, fees, latency or
transaction inclusion. A permanent evidence manifest and maintained screenshots
must wait for a final clean source-control checkpoint so they identify the same
source revision that passed the complete local gate.

### Live bill interface

**Files:** <code>app/TapTabLivePanel.tsx</code> and
<code>app/TapTabCreateBillPanel.tsx</code>.

**Responsibilities**

- Resolve the configured contract and selected bill.
- Read a block-consistent bill snapshot.
- Build invitation, participation, claim, approval and payment actions.
- Create verified bills from a reviewed receipt and locked quote.
- Display pending, confirmed, rejected and failed transaction states.
- Put the current diner or host task first: bill, role, personal GBP amount,
  phase and one permission-aware primary action precede technical evidence.
- Keep Testnet-value, public-chain and venue-identity warnings visible while
  contract, quote, transaction and activity evidence remains available through
  native disclosures.
- Pause periodic reads and event watches outside the active, visible live
  workspace, then refresh immediately when it resumes.
- Load each live snapshot at one pinned block through two fail-closed
  Multicall3 waves, with polling as the event fallback and that block's timestamp
  as the expiry authority.
- Generate generic and participant-specific links.
- Export settlement evidence.

**Data owned**

- Current read snapshot and refresh status.
- Pending transaction intent and receipt.
- Non-authoritative user-interface selections.

All writes are delegated to the wallet adapter. The panel does not possess a
signing key.

The first snapshot wave reads bill, items, participant addresses, proceeds,
split commitments and the Multicall3 block timestamp. The second reads
participant records, approvals, share owners and optional connected-account
state. The interface compares that pinned chain timestamp with the bill deadline;
the device clock is used only for display and retry timing. At the contract
limits this replaces up to 111 individual refresh requests with approximately
four transport operations when event logs are fetched: one block read, two
Multicall3 calls and one log read. All contract calls remain logically distinct
inside Multicall, and calldata is chunked if it exceeds the configured bound.

### Wallet and chain adapter

**Files:** <code>app/wallet/</code>, <code>app/taptab-chain.ts</code>,
<code>app/taptab-transaction-preflight.ts</code> and
<code>app/wallet-readiness.ts</code>.

**Responsibilities**

- Configure Reown AppKit for externally owned accounts.
- Register Reown's `EthersAdapter` so injected EIP-6963 wallets, WalletConnect
  and configured email/social onboarding resolve to an `eip155` provider.
- Pin Monad Testnet chain ID <code>10143</code>.
- Build a primary-first public read transport with one optional, validated HTTPS
  fallback for browser reads and simulations.
- Validate the trusted contract address and positive bill ID.
- Encode typed contract reads and writes.
- Simulate the exact call with account and payable value.
- Estimate gas, apply a 25% buffer and check the wallet balance.
- Re-simulate immediately before requesting a signature.
- Wait for and validate the transaction receipt.

**Data owned**

- Public wallet configuration.
- Current connected address, chain and connection state.
- Temporary transaction-preflight results.

The connected wallet owns the private key. Public browser variables are
configuration, not secrets. Wallet writes always use the connected EIP-1193
provider; they are never submitted or retried through the public read fallback.
Fallback URLs reject credentials, fragments and non-HTTPS schemes.

### Price reference service

**File:** <code>app/api/mon-price/route.ts</code>.

**Responsibilities**

- Request GBP and USD mainnet MON prices from CoinGecko first, then query
  Coinbase's single MON-base exchange-rate endpoint if the primary request fails.
- Reject absent, non-positive, excessively old or future-dated data.
- Deduplicate concurrent upstream requests within one process.
- Cache a current quote briefly.
- Apply retry backoff after upstream failure or rate limiting.
- Return a labelled stale quote for up to 24 hours when safe to do so.
- Return HTTP <code>503</code> when no acceptable quote exists.

**Data owned**

- Process-local quote, expiry, retry and in-flight request state.

The route communicates with CoinGecko and Coinbase over HTTPS. Its cache is not
shared across Cloudflare Worker instances.

### Operational health service

**Files:** <code>app/api/health/live/route.ts</code>,
<code>app/api/health/ready/route.ts</code> and
<code>lib/server/taptab-readiness.ts</code>.

**Responsibilities**

- Return dependency-free, no-store process liveness.
- Fail closed when the public deployment address or bill ID is absent or invalid.
- Probe Monad Testnet inside one five-second budget, trying the configured
  primary first and an optional validated HTTPS fallback only after an eligible
  availability, network or read failure.
- Require chain ID <code>10143</code>, a current block and deployed bytecode.
- Read and structurally validate the exact configured TapTab bill.
- Return stable readiness reason codes and a request correlation ID without
  exposing RPC URLs, provider diagnostics or secrets.

**Data owned**

- No durable data.
- Per-request timing, check states and correlation identifier only.

Liveness does not imply readiness. Readiness returns HTTP <code>503</code> until
the exact public Testnet deployment is configured and verifiable. A fallback
cannot mask an authoritative wrong-chain, missing-contract or invalid-bill
result.

### Smart contract

**File:** <code>contracts/src/TapTab.sol</code>.

**Responsibilities**

- Create immutable bill definitions and receipt metadata references.
- Manage creator invitations and participant membership.
- Store item share ownership, remainder preferences and tip votes.
- Version and verify unanimous split approval.
- Lock deterministic allocations when funding opens.
- Accept exact participant and sponsored contributions.
- Permit settlement only when the total is exactly funded.
- Expose independent proceeds and refund withdrawal paths.

**Technology**

- Solidity 0.8.24.
- Native MON settlement.
- Hardhat 2, ethers 6, Mocha and Chai for development and tests.

**Data owned**

- Bill lifecycle and roles.
- Items, share counts and share owners.
- Join order, preferences, approval version and approval digest.
- Base due, tip due, total due and funded amount per participant.
- Contribution totals per payer.
- Refund and proceeds withdrawal state.

The contract emits lifecycle events consumed by the interface and explorers. It
has no administrator, proxy upgrade path, oracle or external database.

### Browser persistence and PWA

**Files:** <code>app/buyer-storage.ts</code>,
<code>app/taptab-identity.ts</code>, <code>app/TapTabPwaBridge.tsx</code>,
<code>app/manifest.ts</code> and <code>public/sw.js</code>.

**Responsibilities**

- Store optional names locally by contract, bill and wallet.
- Persist only non-secret user preferences and recovery context.
- Register an installable web manifest in production.
- Cache credential-free same-origin immutable assets.
- Exclude API, RPC, wallet, contract and transaction traffic from caching.

Local data can disappear when browser storage is cleared and does not follow a
participant to another device.

### Deployment and validation tooling

**Files:** <code>worker/index.ts</code>, <code>.openai/hosting.json</code>,
<code>contracts/hardhat.config.cjs</code> and <code>contracts/scripts/</code>.

**Responsibilities**

- Build the Next.js application for the Vinext/Cloudflare runtime.
- Rehearse the contract lifecycle and enforce selected gas regression ceilings
  only on ephemeral Hardhat chain 31337.
- Deploy TapTab only to Monad Testnet.
- Seed the initial deployment bill and the disclosed 1,000:1 faucet-scale
  canonical demonstration bill.
- Validate chain ID, deployed bytecode and configured bill state.
- Submit compiled source for explorer verification.

The deployment scripts read secrets from ignored local environment files. The
configured frontend is available through the
[canonical live-bill link](https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live).
Deployment transaction
[`0xc48a…a488`](https://testnet.monadscan.com/tx/0xc48ab94b9e503d09f52e32dd8b2f97adb9b0ca80ab83a6a544dc72fa338ba488)
was confirmed in block `51718885`; bill-creation transaction
[`0xf9de…ee41`](https://testnet.monadscan.com/tx/0xf9de7427fd11bdee1d0785c965b7258144f9106ece70d9dfac3b0dcdc943ee41)
was confirmed in block `51718888` for initial bill `1`. Canonical scaled bill
`2` was confirmed by transaction
[`0xc089…fd70`](https://testnet.monadscan.com/tx/0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70)
in block `51722744` with status `1` and gas used `1,612,923`.

## Data Flow

### Bill preparation and creation

~~~mermaid
sequenceDiagram
  actor Host
  participant UI as TapTab UI
  participant OCR as Browser OCR
  participant Price as Price route
  participant Wallet
  participant Chain as TapTab.sol

  Host->>UI: Select receipt image
  UI->>OCR: Recognise receipt locally
  OCR-->>UI: Candidate merchant and rows
  Host->>UI: Correct and verify receipt
  UI->>Price: Request MON reference
  Price-->>UI: Current or labelled stale quote
  Host->>UI: Confirm payee, deadline and quote
  UI->>Chain: Simulate createBill
  Chain-->>UI: Simulation result
  UI->>Wallet: Request signature
  Wallet->>Chain: Submit createBill
  Chain-->>UI: BillCreated receipt
~~~

The host, not OCR, decides which receipt data is accepted. A bill is considered
created only after the wallet submission succeeds and the expected
<code>BillCreated</code> event is present in a successful receipt.

### Participation, agreement and settlement

~~~mermaid
sequenceDiagram
  actor Host
  actor Diner
  participant UI as TapTab UI
  participant Wallet
  participant Chain as TapTab.sol
  actor Payee

  Host->>Chain: Invite participant wallets
  Diner->>Chain: Join and claim item shares
  Diner->>Chain: Set remainder choice and tip vote
  Diner->>Chain: Approve current split digest
  Host->>Chain: Open funding after unanimous approval
  Chain-->>UI: Locked dues and group tip
  Diner->>Wallet: Confirm exact contribution
  Wallet->>Chain: contribute or sponsor
  Host->>Chain: Settle after exact funding
  Payee->>Chain: Withdraw proceeds
~~~

Any membership, claim or preference change advances the split version and makes
earlier approvals stale. This prevents the host from opening funding against a
split participants did not approve.

### Cancellation or expiry

1. The creator may cancel an incomplete bill within the contract’s permitted
   lifecycle.
2. Anyone may expire an incomplete bill after its deadline.
3. The contract records the terminal state without pushing funds externally.
4. Each contributor claims their own recorded contribution.
5. A failed outgoing transfer reverts that individual claim, allowing a retry.

A fully funded bill cannot be cancelled or expired and remains permissionlessly
settleable after its deadline.

## Data Model

### Bill

A bill has an integer ID, creator, payee, deadline, metadata URI, lifecycle
phase, items, participant join order, locked tip and aggregate funding values.
The primary phases are Draft, Funding, Settled, Cancelled and Expired.

### Item and share slot

Each item stores a positive wei amount and a bounded share count. A share slot
may be unclaimed or owned by one joined participant. Deterministic slot ordering
assigns indivisible wei dust.

### Participant

A participant is identified by wallet address and stores membership state,
remainder preference, tip vote, split approval version, base due, tip due, total
due and funded value. Join order is retained for deterministic allocation and is
bounded to 32 slots.

### Contribution

Contributions record the payer and beneficiary relationship. Funding increases
the beneficiary’s funded amount and the payer’s refundable contribution ledger.
This distinction ensures a sponsor, rather than the sponsored participant,
receives the refund if the bill fails.

### Split approval

The contract derives a domain-separated digest from the current bill split and
version. A participant’s approval is valid only for that version and digest.
The first successful approval computes and stores the digest with its version;
later approvals in that version use the cached value. Any membership, claim or
preference mutation advances the version and therefore invalidates both earlier
approvals and cache reuse without an unbounded clear operation. The public
digest view still recomputes from canonical state, providing an independent
verification path. At the declared maximum shape, local aggregate approval gas
fell from 23,399,360 to 2,612,286 (88.84%); this is a comparative Hardhat
measurement rather than a Testnet fee forecast.

### Receipt metadata and quote

Verified receipt metadata contains public merchant, currency, subtotal and item
rows. The seeded deployment embeds it as a data URI; the browser treats all
metadata as untrusted input and validates its shape and limits.

The GBP-per-MON quote is used to prepare native-MON amounts and present familiar
values. It is not an onchain oracle and does not make Testnet MON redeemable for
the displayed mainnet value.

Canonical bill `2` records a genuine CoinGecko quote of
`0.01536012 GBP/MON`. Its £48.50 receipt has a
`3157.527415150402471 MON` mainnet-value reference; the bill then applies a
declared `1,000:1` faucet-funded Testnet scale and settles
`3.157527415150402471 Testnet MON`. Metadata preserves the quote, unscaled
reference subtotal, divisor and scaled settlement subtotal so the interface can
reconcile and disclose both. Testnet MON has no monetary value.

### Local identity

Optional diner names are browser records keyed by contract, bill and wallet.
They are deliberately separate from public contract state.

## Infrastructure & Deployment

### Frontend

The application builds with Vinext and Vite for a Cloudflare Worker-compatible
runtime. The Worker serves the App Router output, static assets, image
optimisation, price route and health routes. The checked-in hosting configuration
declares no D1 database or R2 bucket.

Required public live-mode configuration:

- <code>NEXT_PUBLIC_SITE_URL</code>
- <code>NEXT_PUBLIC_REOWN_PROJECT_ID</code>
- <code>NEXT_PUBLIC_TAPTAB_ADDRESS</code>
- <code>NEXT_PUBLIC_TAPTAB_BILL_ID</code>

The configured Cloudflare Workers origin is
<https://taptab.mythicmindlabs.workers.dev>. Its
[readiness endpoint](https://taptab.mythicmindlabs.workers.dev/api/health/ready)
currently validates chain `10143`, deployed bytecode at
`0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198` and bill `2`. The deployment
pipeline is not yet recorded as clean revision-linked evidence.

### Contract

Hardhat deploys <code>TapTab.sol</code> to Monad Testnet chain
<code>10143</code>. Deployment requires a funded signer in
<code>contracts/.env</code>; validation and source-verification commands are
documented in the project README and contract README.

The current non-upgradeable instance is
[`0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`](https://testnet.monadvision.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198).
Initial bill `1` was created with the deployment in block `51718888`. Canonical
bill `2` was created in block `51722744` and expires at
`2026-08-14T17:01:55Z`. MonadVision's Sourcify verification reported a perfect
match. The separate public rehearsal then completed bill `3` with three wallets
through claims, unanimous approval, exact funding, settlement and withdrawal,
and bill `4` with two contributors through cancellation and independent refunds.
The sealed record lists 31 successful contract transactions and one separately
disclosed reverted initial funding attempt before its successful retry.

The contract is non-upgradeable. A changed implementation requires a new
address and an explicit frontend configuration update.

### Environments

| Environment | Application state | Blockchain state | Purpose |
| --- | --- | --- | --- |
| Local development | Vinext dev server; sample available | None for the sample; optional public reads in the separately selected live workspace | Feature development and manual checks |
| Local verification | Production build, Node and Playwright tests, Hardhat tests, guarded rehearsal and gas benchmark | In-process Hardhat network 31337 only | Repeatable automated evidence |
| Public prototype | Configured Cloudflare deployment from checkpoint `27ecdb4`; readiness passes | Contract `0xa2fb…A198`, canonical bill `2` on Monad Testnet | Deployment and read evidence only until the corrected local Reown Ethers adapter/UI, task-first layout and fallbacks are redeployed and a real wallet journey is rehearsed |
| Production | Not defined | Mainnet integration not implemented | Out of current scope |

There is no separately configured staging environment.

## Scalability & Reliability

### Capacity controls

- Contract limits cap bills at 32 items, 32 participants, 32 shares per item and
  128 total shares.
- Bounded loops trade maximum bill size for predictable execution.
- The web application is stateless for public bill data and can scale with its
  serverless runtime.
- Static assets can be cached at the edge without caching transaction traffic.
- Hidden tabs and the local-preview workspace perform no periodic live snapshot
  or contract-event requests; submitted receipt reconciliation remains active.
- Public JSON-RPC batches are capped at 64 requests and Multicall calldata at
  65,536 bytes.

A guarded local benchmark now enforces deliberately generous absolute gas
ceilings for selected maximum-shape operations: bill creation, split digest and
approval, opening funding, transferring all 128 shares and funding a
participant. It writes the measured gas, ceiling, headroom and pass result to an
ignored JSON report. These chain-31337 figures are regression tripwires, not
public-network fee, latency or capacity forecasts. No browser load or
end-to-end concurrency test has been recorded.

The final 7 August 2026 local gate passed all eight configured gas ceilings.

Arithmetic verification includes 12,000 reproducibly generated TypeScript bill
models and 40 curated or seeded fixtures executed against both the TypeScript
preview and an in-process Solidity deployment. The differential fixtures compare
exact share ownership and values, remainder and tip allocation, participant dues,
sponsorship, contributor ledgers, funding status and settlement eligibility. The
1:1 integer-unit mapping tests algorithmic equivalence; it does not test exchange
rates or claim that pence and wei have equal economic value.

A bounded ten-seed stateful Solidity campaign mutates membership, preferences,
claims, approvals and funding before taking two runs through each of settlement,
funding cancellation, funding expiry, draft cancellation and draft expiry. It
uses an independent allocation/tip oracle and rechecks conservation, approval
versions, funding bounds, role/phase rules and terminal-ledger exclusivity after
each relevant transition. Every seed is replayable with
<code>TAPTAB_STATEFUL_SEED</code>. The original deterministic invariant scenario
also remains. This is deterministic regression coverage rather than an
open-ended fuzz campaign.

### Failure handling

- Contract invariants reject invalid phases, stale approvals, overfunding,
  incomplete settlement and a self-payee configuration with no possible
  withdrawal authority.
- Pull payments isolate payee and contributor transfer failures.
- Event-driven refresh falls back to snapshot polling.
- Public contract reads may fail over once from the primary RPC to an explicitly
  configured HTTPS fallback; wallet writes never do.
- Price requests have timeouts, validation, short caching and bounded stale use.
- The local sample remains available when wallet services are not configured.
- Live recovery packs restore verified public context, not private keys or
  payments. The separate local judge export records simulated payments and
  invariants but cannot open a live bill.

### Known reliability boundaries

- Price cache and failure backoff are process-local, so separate Worker
  instances can contact CoinGecko or Coinbase independently.
- RPC, explorer, CoinGecko, Coinbase and Reown availability are outside the
  application’s control.
- Browser-only labels and preferences are neither replicated nor backed up.
- A non-upgradeable deployed defect cannot be patched in place.
- No uptime monitor, disaster-recovery objective or production support rota is
  configured.

## Security & Compliance

### Authentication and authorisation

- Wallet signatures authenticate contract writes.
- Contract role checks distinguish creator, participant, contributor and payee
  actions.
- The browser pins Monad Testnet and a build-trusted TapTab address.
- Personal payment links validate their beneficiary instead of silently changing
  the payment target.

Reown social sign-in improves onboarding but does not create an application
account or change contract authorisation.

### Transaction protection

- The browser validates addresses, bill IDs, chain and contract bytecode.
- Bill creation rejects the zero address and the TapTab contract itself as the
  payee both before wallet submission and onchain.
- Each write is simulated with the exact account and payable value.
- Gas and balance checks use a 25% gas-limit buffer.
- The contract follows checks-effects-interactions and guards withdrawals
  against re-entrancy.
- Settlement, cancellation, expiry, proceeds and refunds are separate explicit
  state transitions.

Client checks improve error messages; only contract checks secure onchain funds.

### Secrets and transport

- Deployer keys belong only in ignored <code>contracts/.env</code> files.
- Values prefixed with <code>NEXT_PUBLIC_</code> are public and must not contain
  secrets.
- Absolute public metadata uses only a validated
  <code>NEXT_PUBLIC_SITE_URL</code>; request Host and forwarding headers cannot
  redefine the published origin. Unconfigured local builds use
  <code>http://localhost:3000</code>.
- Public deployments require HTTPS for wallet origin verification and secure
  browser capabilities.
- The service worker excludes API, RPC, wallet and transaction requests.

### Privacy and data protection

Wallet addresses, receipt metadata, allocations, contributions and lifecycle
events are public and persistent when written onchain. Receipt data should not
contain unnecessary personal information. Optional diner names remain in local
browser storage unless an exporter explicitly includes them.

No formal UK GDPR assessment, retention policy, privacy notice or data-subject
request process is included. Those are required before positioning TapTab as a
production consumer service.

### Residual security risks

- The contract has not received an independent audit, an open-ended stateful
  fuzz campaign or formal verification. Deterministic generated, differential
  and fixed-seed stateful tests reduce, but do not remove, that assurance gap.
- A trusted contract address does not prove the identity of a bill creator or
  venue; anyone can create a bill on the deployed contract.
- MonadVision's Sourcify flow reports a perfect source match for the deployed
  contract. This is not an independent security audit or formal verification.
- Native MON price volatility can change economic value after a bill is created.
- Metadata remains semantically untrusted. The contract enforces a 64,000-byte
  UTF-8 ceiling but does not validate the receipt schema or truth of its content.
  The exact maximum 32-item shape consumes 47,635,377 gas on the guarded local
  Cancun-profile benchmark, so public-network acceptance remains unverified and
  the application must continue to simulate the exact creation before submission.

## Observability

### Available evidence

- The sample exports a distinct local snapshot with recalculated conservation
  and settlement-guard checks and no deployed-chain fields.
- Guarded chain-31337 scripts produce a multi-account lifecycle report and a
  maximum-shape gas-ceiling report under ignored <code>outputs/</code>.
- Replayable stateful, metadata-bound and Playwright suites supplement the pure,
  differential and conventional contract tests.
- Contract events expose invitations, claims, approval changes, contributions,
  settlement, cancellation, expiry, refunds and proceeds.
- The interface shows transaction state, hash, explorer link and measured
  submission-to-receipt timing.
- Stage mode summarises participant and funding progress.
- Deployment checks read chain ID, block height, bytecode and bill state.
- Public evidence records deployment in block `51718885`, initial bill `1`
  creation in block `51718888`, canonical bill `2` creation in block `51722744`
  and a passing readiness probe against that contract and bill `2`.
- The secret-free
  `docs/submission/monad-testnet-multiwallet-evidence.json` record covers the
  complete bills `3` and `4` settlement and refund rehearsal on chain `10143`.
- No-store liveness and readiness routes expose bounded machine-readable checks
  with correlation identifiers.
- The price route writes upstream failures to the server console.
- Settlement JSON supports manual reconciliation.

### Missing observability

- No central structured log aggregation is configured.
- No metrics, alerting, distributed tracing or error-reporting service is
  configured.
- Health correlation identifiers do not yet span browser actions and chain
  transactions.
- No external uptime monitor, SLO dashboard or alert consumes the health routes.

Any production plan should define what is collected, minimise personal data and
document retention before enabling telemetry.

## Trade-offs & Decisions

### Native MON settlement

Native MON produces a direct Monad demonstration and avoids token approvals. It
also exposes users to volatility and means a mainnet quote is only a reference
for Testnet MON. A stable-value token would be more suitable for real venue
settlement but is not implemented.

### Onchain allocation

Putting agreement and payment state onchain makes the settlement rules
inspectable and prevents one participant from controlling the ledger. It costs
gas, makes data public and requires strict size limits.

### No central database

Removing a database simplifies deployment and reduces custody of private user
data. It also removes server-side accounts, cross-device labels, private receipt
storage, analytics and recovery beyond public chain data.

### Human-verified OCR

Browser OCR speeds receipt entry without uploading an image. It is intentionally
advisory because OCR output is not reliable enough to create a financial bill
without review.

### Non-upgradeable contract

Immutable code limits administrator power and makes the active rules easier to
reason about. Defects require a replacement deployment and migration of future
usage to a new address.

### Process-local price cache

An in-memory cache avoids database infrastructure and is sufficient for a small
prototype. It does not coordinate limits or freshness across horizontally scaled
instances.

### Sample and live workspaces

The sample provides a reliable demonstration and onboarding path. Strong labels
and separate navigation are necessary so sample transitions are never presented
as confirmed blockchain activity. Workspace selection is canonicalised in the
URL, and the contract-backed panel is conditionally mounted only in live mode so
sample use does not retain background chain reads.

### Legacy CrowdCart coexistence

Keeping the earlier group-purchase prototype reduced refactoring risk during
development. It increases bundle, audit and maintenance surface and should be
removed or isolated before a public release.

## Future Improvements

1. Resolve hackathon eligibility and establish an honest public repository
   history.
2. Extend the bounded ten-seed stateful suite and local gas ceilings into
   sustained CI fuzzing and performance runs, then obtain an independent
   Solidity review.
3. Add a stable-value settlement option with an explicit decimal and refund
   policy.
4. Introduce signed venue identities or a registry if merchant authenticity is
   claimed.
5. Evaluate a tighter metadata ceiling and a contract-level schema commitment;
   the current boundary limits UTF-8 bytes but does not validate semantics.
6. Add privacy documentation and minimise public receipt detail.
7. Add shared edge caching or a rate-limited price service if traffic warrants
   it.
8. Connect the health routes to opt-in structured logging, metrics and an
   external uptime monitor.
9. Add an indexer only if historic search becomes necessary; keep contract
   state authoritative.
10. Complete keyboard, screen-reader, zoom and physical-device validation.
11. Remove or place legacy CrowdCart code behind an explicit compatibility
   boundary.
12. Define staging, rollback, incident response and release ownership before
   production use.

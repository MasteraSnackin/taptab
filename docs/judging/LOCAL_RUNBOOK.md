# TapTab local judging runbook

**Scope:** deterministic local preview and ephemeral Hardhat contract rehearsal

**Evidence boundary:** this local procedure uses no real wallet, public RPC or
public transaction. Controlled EIP-6963 and JSON-RPC fixtures remain inside the
browser runner. The project now has separately linked Monad Testnet deployment,
bill-creation, MonadVision's Sourcify-match report, public-readiness and
multi-wallet lifecycle evidence; none of it is created or re-proved by
`verify:local`.

## Separate public Testnet evidence

- [Canonical live bill `2`](https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live)
- [Contract `0xa2fb…A198`](https://testnet.monadscan.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198)
- [Deployment transaction, block `51718885`](https://testnet.monadscan.com/tx/0xc48ab94b9e503d09f52e32dd8b2f97adb9b0ca80ab83a6a544dc72fa338ba488)
- [Initial bill `1` creation, block `51718888`](https://testnet.monadscan.com/tx/0xf9de7427fd11bdee1d0785c965b7258144f9106ece70d9dfac3b0dcdc943ee41)
- [Canonical bill `2` creation, block `51722744`](https://testnet.monadscan.com/tx/0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70)
- [MonadVision reports · Sourcify perfect match](https://testnet.monadvision.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198)
- [Exact source-verification status](../submission/SOURCE_VERIFICATION_STATUS.md)
- [Passing public readiness probe](https://taptab.mythicmindlabs.workers.dev/api/health/ready)
- [Sealed multi-wallet rehearsal record](../submission/monad-testnet-multiwallet-evidence.json)

Bill `2` was confirmed with status `1`, used `1,612,923` gas and expires at
`2026-08-14T17:01:55Z`. It locks the genuine CoinGecko quote
`0.01536012 GBP/MON`: the £48.50 receipt's unscaled mainnet-value reference is
`3157.527415150402471 MON`, then the disclosed `1,000:1` faucet-funded scale
produces `3.157527415150402471 Testnet MON`. The separate rehearsal record proves
bill `3` claims, unanimous approval, exact three-wallet funding, settlement and
withdrawal, plus bill `4` two-wallet cancellation and independent refunds. It
enumerates 31 successful contract transactions and one honestly recorded
reverted first funding attempt before a successful bounded-gas retry. Testnet
MON has no monetary value.

The public Worker remains source checkpoint `27ecdb4`. The current local
task-first live card, five-step host checklist, corrected Reown Ethers
adapter/connector UI and optional RPC fallbacks are verified below but are not
yet deployed. Keep that distinction explicit during judging.

For a judged live build, an operator may configure
`MONAD_TESTNET_FALLBACK_RPC_URL` for server readiness and
`NEXT_PUBLIC_MONAD_TESTNET_FALLBACK_RPC_URL` for browser reads. Both must be
credential-free HTTPS URLs. Primary endpoints remain first, and wallet writes
always stay on the connected wallet provider. If both read endpoints fail, use
the clearly labelled sample recovery path; never present it as a confirmed
transaction.

## Install once, then run the one-command gate

From the repository root:

```sh
npm ci
npm --prefix contracts ci
npx playwright install chromium
npm run verify:local
```

`verify:local` builds the application, runs the web and contract suites, checks
lint and TypeScript, exercises the sample in Chromium at one desktop, two
tablet and two mobile sizes, then runs the multi-signer TapTab journey and
maximum-shape gas regression benchmark on Hardhat chain `31337`. It must not call `check:testnet`,
`check:taptab`, any `deploy:*` command, `verify:taptab` or
`/api/health/ready`.

The critical browser journeys stub the price response. Controlled live-workspace
cases also intercept every Monad JSON-RPC request with deterministic bill data;
they cover a delayed Bill A/B replacement and cancellation when the connected
wallet changes during exact-action simulation. A separate configured-build E2E
case confirms that an untrusted contract query cannot replace the build-pinned
address. The contract suite
includes a replayable ten-seed bounded stateful campaign, the original
deterministic invariant scenario and the 64,000-byte metadata boundary. These
are repeatable local checks, not an open-ended fuzz campaign or an independent
audit.

The contract rehearsal creates three bills on a fresh in-process chain:

- a successful bill with three diners, a custom median tip, fair remainder,
  sponsorship, incomplete-settlement rejection, exact funding, settlement and
  payee withdrawal;
- an incomplete bill cancelled by its creator, followed by independent refunds
  to two original contributors; and
- an incomplete bill expired by another account at its deadline, followed by
  independent refunds to two original contributors.

Its generated report is written to
`outputs/taptab-local-rehearsal.json`. That directory is intentionally ignored
by Git. The report contains ephemeral local addresses and transaction hashes;
it is repeatable test evidence, not Monad Testnet proof.

The same gate writes `outputs/taptab-gas-benchmark.json`. It checks selected
maximum-shape operations against deliberately generous regression ceilings,
including ordinary bill creation, a 32-item/128-share creation carrying exactly
64,000 UTF-8 metadata bytes, split digest and approval, opening funding, a
128-share transfer and participant funding. The ephemeral network pins Cancun
rules because Hardhat's newer default rules apply a 16,777,216
per-transaction gas cap below the metadata-boundary transaction's cost. The
figures describe only the ephemeral Hardhat runtime; they neither establish
that a public network accepts that maximum shape nor provide fee or latency
forecasts.

## Start the sample

```sh
npm run dev
```

Open <http://localhost:3000/> and remain in **Sample bill**. The copied
environment templates deliberately leave the contract address and bill ID empty,
so no live chain is contacted by the sample journey.

## Three-minute local presentation

### 0:00–0:25 — the problem

Groups still pass one card around or trust a private calculation. TapTab makes
receipt ownership, group agreement and funding visible.

### 0:25–1:05 — the receipt

Show the £48.50 Table 7 receipt. Point out whole items and indexed shared-item
slots. Keep the **Preview** labels visible and state that no wallet or public
chain is being used.

### 1:05–1:40 — agreement

Claim a shared slot, change a tip vote and show that the group result is the
median. Explain that unclaimed value is divided only between diners who opted
into fair remainder. Open **Organiser & demo controls**, record one other
diner's approval, change the split, and show that every approval is cleared.

### 1:40–2:20 — protected funding

Approve your own reviewed total, then use **Manage diner approvals** to record
the other diners and choose **Open protected payments**. Fund one allocation and
sponsor another. Show that **Confirm settlement** remains unavailable while any
amount is outstanding. State that the Solidity rules are exercised by the
separate local Hardhat rehearsal, not proven by the browser preview.

### 2:20–3:00 — finish and evidence boundary

Finish exact funding and choose **Confirm settlement**. Open Stage mode to show
the terminal view, exit it, then open the presenter disclosure and choose
**Download local evidence**. State clearly that the file records deterministic
preview state and invariant checks; it contains no contract address, wallet,
transaction hash, explorer link or price claim.

For the failure path, reset the sample, approve every diner, open funding and
contribute partially. Choose **Cancel bill** or **Simulate expiry**, then claim
each payer's refund. The Hardhat report records both paths together when a
single file is preferred.

## Local evidence available

The 63-pass browser total below is the latest dirty-working-tree observation.
It does not replace the older revision-linked `311`-test submission manifest;
follow the final evidence checkpoint steps before presenting it as release
evidence.

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Local evidence download | Current receipt, claims, approvals, payments, phase, refunds and recalculated conservation checks | Solidity execution or public-chain activity |
| Hardhat rehearsal report | Multi-account Solidity execution through settlement, cancellation, expiry, proceeds and refunds | Monad RPC, wallet prompts, confirmation time or explorer inclusion |
| Hardhat gas benchmark | All eight selected maximum-shape operations, including exact-limit metadata creation, remain below explicit local regression ceilings | Public-network transaction acceptance, fees, latency or inclusion |
| Deterministic stateful suite | Ten replayable seeds cover two runs each through settlement, funding cancellation, funding expiry, draft cancellation and draft expiry, while preserving accounting, approval versions, funding bounds and terminal-ledger exclusivity | Exhaustive state exploration, sustained fuzzing or formal verification |
| Metadata-bound tests | The contract accepts exactly 64,000 UTF-8 bytes and rejects larger payloads | Public-network transaction acceptance, semantic truth or privacy of receipt metadata |
| Playwright browser checks | 63 passing cases with 27 intentional profile-specific skips cover critical navigation, Reown/Ethers EIP-6963 discovery and rejection, provider events, delayed bill replacement, wallet-context preflight cancellation, personal-payment locking, focus restoration, overflow, serious automated accessibility findings, delayed/degraded price states and touch geometry at 1280×720, 812×900, 768×1024, 430×932 and 390×844 | A real funded wallet, actual submitted/replaced receipt lifecycle, full assistive-technology or physical-device coverage |
| Web and contract tests | Deterministic behaviour and regression coverage | Independent audit or formal verification |
| `/api/health/live` | The local server process responds | Public deployment readiness; use the separately linked public `/api/health/ready` evidence |

## Final evidence checkpoint

Do not create permanent screenshots or describe the current generated reports
as a release bundle while source files are still changing. A screenshot can
otherwise show a different interface from the tested source, and the ignored
reports contain ephemeral addresses that cannot identify a repository revision.

After the final accepted source change:

1. create an intentional source-control checkpoint and require a clean working
   tree;
2. run `npm run verify:local` from that exact revision;
3. record the revision, Node and npm versions, command result and SHA-256 hashes
   of both generated JSON reports in a small evidence manifest;
4. capture maintained desktop and mobile screenshots from that same build; and
5. link the manifest and captures from the README without relabelling local
   addresses or hashes as public evidence.

That final checkpoint has not been created by this runbook update. This is an
explicit evidence gap, not a reason to fabricate assets from the dirty tree.

## Feature freeze

Until the presentation is complete:

- accept only fixes for a broken build, failed test, incorrect money, misleading
  evidence, inaccessible critical control or blocked demonstration journey;
- do not add another product feature, change the receipt fixture or alter the
  settlement policy;
- rerun `npm run verify:local` after every accepted fix; and
- regenerate both Hardhat reports after the final source change.

## Explicitly unfinished

This local pass does not itself prove public-chain behaviour. That proof is in
the separate sealed bills `3` and `4` Testnet record. The remaining gaps are a
compliant public fork and clean-clone proof, written organiser eligibility
confirmation, redeployment of the current local revision, Monadscan source
publication, physical-device/accessibility research and an independent security
review.

The current V5 video is exactly `119.000` seconds and distinguishes the £53.95
local sample, £48.50 live Bill 2 and the separate public bills `3`/`4`
rehearsal. The complete application viewport remains visible for `76.0`
seconds. A genuinely continuous `15.000`-second, 450-frame take demonstrates
the fair-remainder and tip controls, selects 12.5%, reviews and approves the
split, reopens the tip controls, changes the vote to 10%, and shows the consent
reset. It has zero internal cuts, performs no wallet write, is 1,279,802 bytes
and has SHA-256
`74836bee8192056caf8d75c6252f8b830416b68396ad0a593918738d034a237f`.
Purple denotes the local sample, green confirmed Monad Testnet evidence and
amber the protected refund path; sponsorship is labelled as a local-sample
demonstration. The named story shows Amina, Theo and Jules sharing the house red
and You covering Theo's remainder. The retained Bill 3 settlement hash moves to
its genuine Monadscan `Success` receipt under an explicit historical-replay
label; no new transaction is broadcast. The final outcome is **“Bill 3 settled.
Nobody chased. Every contribution accounted for.”**, followed by a QR for the
separate live Bill 2, which is created and publicly readable but not presented
as settled. The 1920 × 1080 H.264/yuv420p master runs at 30 fps with 3,570
frames and 48 kHz stereo AAC.
The natural-speed ElevenLabs Nora/Blackpool narration is unchanged. Its 31st
and final caption ends at `111.740` seconds, leaving a `7.260`-second
speech-free, music-backed QR hold. The decoded 7,941,645-byte MP4 measures
−16.04 LUFS-I and −2.76 dBTP and has SHA-256
`7c8895c78647136ea0bc7317c4a0d4c8b199f4243211b319114202a5429cc8e6`.

# Markdown task completion record

**Date:** 7 August 2026

**Scope:** locally testable TapTab work requested by the nine supplied Markdown
briefs, followed by public Testnet configuration

**Boundary:** deployment, seeded-bill creation, MonadVision's reported
Sourcify match, public readiness and real multi-wallet settlement/refund
rehearsals are established for public source checkpoint `27ecdb4`. The current
local task-first, Reown Ethers-adapter and RPC-resilience changes pass the
complete local gate but have not been redeployed. Organiser eligibility
confirmation, a compliant public fork and external submission are not
established.

The supplied Markdown files are specifications and review reports rather than
executable scripts. Their locally actionable work was audited against the
repository, implemented and checked through `npm run verify:local`.

## Completion by supplied brief

| Brief | Local outcome |
| --- | --- |
| `!)README.md` | Setup, product boundaries, local runbook, evidence language and final verification totals are current. The licence remains explicitly undecided. |
| `£)ARCHITECTURE.md` | Active code, trust, data, URL, payment, polling, evidence and local-chain boundaries are documented. |
| `1)AUDIT.md` | Added the focused `/pay` route, durable workspace URLs, conditional live-panel mounting, task-first live hierarchy, visible payment focus, selectable copy recovery and an explicit creator/venue trust warning. |
| `2)DEBUG.md` | Preserved bill-scoped state, hash navigation and pre-submission guards; added bounded transaction reconciliation, event-watch diagnostics, primary-first RPC fallback, a deterministic delayed Bill A/B race and a wallet-change-during-preflight no-write check. |
| `3)ERRORHANDING.md` | Added OCR cancellation and bounds, transaction timeouts, replacement handling, refresh recovery, request identifiers and persistent manual copy fallbacks. |
| `A)DESIGNLEAD.md` | Added a five-step host journey and improved hierarchy, contrast, desktop typography, tablet touch targets, mobile action docking and projector-mode layout; automated responsive and accessibility checks pass. |
| `B)BUILDER.md` | Health endpoints, local rehearsal, price degradation, focused payment and evidence tooling are integrated and locally verified. |
| `C)NERD.md` | Added a replayable ten-seed stateful contract campaign, a UTF-8 metadata ceiling, selected maximum-shape gas ceilings, dependency-risk boundaries and canonical TapTab wallet naming. |
| `D)RESEARCHER.md` | Retained the evidence-backed digest cache, exact-key claims, block-pinned reads and polling controls; unresolved eligibility and product decisions remain explicit. |

## Final local gate

The results below were observed from a complete run against the current dirty
working tree on 7 August 2026. They are not backed by a retained full log or a
clean revision-linked manifest. The versioned submission manifest still records
the older `311`-test public-deployment checkpoint and is not evidence for these
later local changes.

- Production application build: passed.
- Application tests: 223 passed, 0 failed.
- Playwright browser tests: 63 passed, 0 failed, with 27 intentional
  profile-specific skips across 1280×720 desktop, 812×900 and 768×1024 tablets,
  and 430×932 and 390×844 mobiles.
- Solidity/Hardhat tests: 89 passed, 0 failed.
- Aggregate application, E2E and contract result: 375 passed, 27 intentional
  profile-specific skips, 0 failed.
- Ephemeral Hardhat chain-31337 rehearsal: passed for settlement, proceeds,
  cancellation, expiry and contributor refunds.
- Eight selected maximum-shape local gas ceilings: passed.
- ESLint and strict application TypeScript checks: passed.
- Configured-build E2E rejection of an untrusted contract link: passed.
- Controlled EIP-6963 wallet E2E: Reown/Ethers connector discovery, rejection,
  account/network/disconnect events, delayed bill replacement and
  wallet-change-during-preflight no-write guarantees passed against a
  deterministic intercepted RPC fixture; no Monad Testnet request was made.
- Sponsorship attribution is derived from the confirmed contribution-event
  ledger while preserving each participant's bill-wide GBP penny total.
- Dependency audits: web and contract production graphs reported zero findings;
  the full graphs reported two web build-tool findings and 21 contract
  development-tool findings, documented in [`SECURITY.md`](../SECURITY.md) and
  [`contracts/SECURITY.md`](../contracts/SECURITY.md).

These results establish repeatable local behaviour. The separate public
evidence below establishes deployment, bill creation and complete multi-wallet
settlement and refund journeys. Neither evidence set establishes accessibility
conformance or production security.

## Subsequent Monad Testnet completion

| Field | Evidence |
| --- | --- |
| Canonical application | [Open live bill `2`](https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live) |
| Contract | [`0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`](https://testnet.monadscan.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198) |
| Deployment transaction | [`0xc48a…a488`, block `51718885`](https://testnet.monadscan.com/tx/0xc48ab94b9e503d09f52e32dd8b2f97adb9b0ca80ab83a6a544dc72fa338ba488) |
| Initial bill `1` creation | [`0xf9de…ee41`, block `51718888`](https://testnet.monadscan.com/tx/0xf9de7427fd11bdee1d0785c965b7258144f9106ece70d9dfac3b0dcdc943ee41) |
| Canonical bill `2` creation | [`0xc089…fd70`, block `51722744`, status `1`, gas `1,612,923`](https://testnet.monadscan.com/tx/0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70) |
| Bill `2` deadline | `2026-08-14T17:01:55Z` |
| Source verification | [Monadscan source published; Sourcify full match complete](submission/SOURCE_VERIFICATION_STATUS.md) |
| Runtime readiness | [Public readiness probe passes for bill `2`](https://taptab.mythicmindlabs.workers.dev/api/health/ready) |
| Multi-wallet Testnet rehearsal | [Bills `3` and `4`; 31 successful contract transactions](submission/monad-testnet-multiwallet-evidence.json) |

Canonical bill `2` locks a genuine CoinGecko quote of
`0.01536012 GBP/MON`. The £48.50 receipt's unscaled
`3157.527415150402471 MON` mainnet-value reference is divided by the explicit
`1,000:1` faucet-funded scale, producing a
`3.157527415150402471 Testnet MON` onchain subtotal.
Testnet MON has no monetary value. The interface's GBP and USD values are
labelled mainnet MON references. The current V5 video distinguishes the £53.95
local sample, £48.50 live Bill 2 and sealed bills `3`/`4` evidence, then ends on
a QR for the separate live Bill 2. The complete application viewport remains visible
for `76.0` seconds. A genuinely continuous `15.000`-second, 450-frame take
demonstrates the fair-remainder and tip controls, selects 12.5%, reviews and
approves the split, reopens the tip controls, changes the vote to 10%, and
shows the consent reset. It has zero internal cuts, performs no wallet write,
is 1,279,802 bytes and has SHA-256
`74836bee8192056caf8d75c6252f8b830416b68396ad0a593918738d034a237f`.
Purple denotes the local sample, green confirmed Monad Testnet evidence and
amber the protected refund path; sponsorship is labelled as a local-sample
demonstration. The named story shows Amina, Theo and Jules sharing the house
red and You covering Theo's remainder. The retained Bill 3 settlement hash
transitions to its genuine Monadscan `Success` receipt under an explicit
historical-replay label. The final outcome is **“Bill 3 settled. Nobody chased.
Every contribution accounted for.”** The QR opens the separate live Bill 2,
which is created and publicly readable but not presented as settled. The
`119.000`-second, 7,941,645-byte H.264/yuv420p master is 1920 × 1080 at 30 fps
with 3,570 frames and 48 kHz stereo AAC. The natural-speed ElevenLabs
Nora/Blackpool narration remains unchanged over locally synthesised music and
interface sounds. The unchanged 31st and final cue ends at `111.740` seconds,
leaving a `7.260`-second speech-free, music-backed QR hold. The decoded master
measures −16.04 LUFS-I and −2.76 dBTP. Its SHA-256 is
`7c8895c78647136ea0bc7317c4a0d4c8b199f4243211b319114202a5429cc8e6`.

## Deliberately deferred engineering work

The following work was assessed but is not represented as complete:

1. Extend the bounded ten-seed contract campaign into sustained CI fuzzing.
2. Exercise submitted, repriced, replaced, reverted and refresh-recovered
   transaction receipts through a controlled browser wallet that can return
   deterministic hashes and receipts. The current browser proof stops before a
   wallet write; the receipt state machine is covered below that boundary.
3. Upgrade Vinext and the Hardhat/plugin toolchain only in separate compatibility
   branches. Both proposed automated remediations cross release boundaries and
   require the full gate, not a forced audit rewrite.
4. Split the largest interface components and retire the remaining legacy
   compatibility layer after the judging freeze.
5. Add shared cache, monitoring and incident telemetry only after the production
   hosting, privacy and ownership model is decided.

## Tasks that require authority or evidence outside this workspace

The following are deliberately not marked complete:

1. Obtain written organiser guidance on the fresh-project rule because this
   implementation predates the event; the prepared request is
   [ELIGIBILITY_REQUEST.md](submission/ELIGIBILITY_REQUEST.md).
2. Confirm a team of no more than four people, publish the required public fork
   of the organiser repository, and prove a clean unauthenticated clone.
3. Redeploy the current local working tree and regenerate deployment/browser
   evidence before claiming the corrected injected-wallet connector UI,
   task-first layout or RPC-fallback behaviour is present on the public Worker.
4. Choose a licence and add it only with the project owner's approval.
5. Commission an independent contract review before any non-Testnet value is
   considered.
6. Complete funded-wallet prompt/rejection checks, physical-device wallet
   hand-off, desktop and mobile screen-reader, 200%/400% zoom, PWA-install,
   projector and real-user research sessions.
7. Decide the production settlement asset, venue-identity model, privacy/legal
   position, monitoring and incident ownership. Native MON is retained only for
   the hackathon prototype.
8. Create a final clean revision-linked evidence checkpoint only after the
   owner establishes the compliant public repository and redeploys that exact
   revision.

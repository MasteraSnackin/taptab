# TapTab — Monad Blitz London submission summary

> **Submission status:** public Monad Testnet application plus local, Hardhat and
> public multi-wallet evidence. Contract `0xa2fb…A198` is live and
> Monadscan displays the published source and MonadVision reports a perfect
> Sourcify match; bills `3` and `4` prove the settlement and contributor-refund
> paths. The source is published at
> <https://github.com/MasteraSnackin/taptab>, and written
> organiser confirmation of pre-existing-project eligibility remains required.

The official [rules](https://monad-foundation.notion.site/Rules-Guidelines-IMPORTANT-PLEASE-READ-73b6367594f2833e952901112ad5c959?pvs=25)
require a fresh Blitz project, no more than four team members, a public GitHub
repository and an operational Monad Testnet deployment. The official
[submission process](https://monad-foundation.notion.site/Submission-Process-cc66367594f2837c898701aabd948402?pvs=25)
requires a public fork of the organiser repository. Those repository,
team-evidence and eligibility gates remain owner/organiser actions.

## The one-line pitch

TapTab lets a group claim a shared receipt, agree the tip and fund only their
own share, while contract rules prevent an incomplete bill from settling.

## The problem

Splitting a restaurant bill usually leaves one person paying everything and
chasing the group afterwards. Existing calculators can divide a total, but they
do not make each person's claims, group agreement, funding or refund rights
independently verifiable.

## The product

TapTab keeps the experience familiar to ordinary diners:

- amounts are shown in pounds first, with Testnet MON detail disclosed where it
  matters;
- diners can claim a whole item or selected shares of wine, starters or taxis;
- only people who opt in receive any fair remainder;
- the group chooses the tip by median vote, including a custom percentage;
- every participant approves the current split before payments open;
- anyone can sponsor another person's remaining amount without changing their
  allocation;
- exact funding is required before settlement; and
- cancellation or expiry makes each contributor's payment independently
  refundable.

The interface also includes reviewed receipt import, personal payment links,
workspace recovery, a projector-friendly Stage mode and evidence exports.

## Why Monad

The live path uses a non-upgradeable Solidity contract and native MON on Monad's
EVM-compatible Testnet. Public contract state coordinates claims,
split approval, contributions, settlement, venue proceeds and contributor-owned
refunds without an application database. The browser remains responsible for
receipt review, pound-first presentation and wallet orchestration; the contract
is authoritative for payment state.

TapTab is deployed on Monad Testnet chain ID `10143`. The
[deployment transaction](https://testnet.monadscan.com/tx/0xc48ab94b9e503d09f52e32dd8b2f97adb9b0ca80ab83a6a544dc72fa338ba488)
was confirmed in block `51718885`. Initial bill `1` was created by
[`0xf9de…ee41`](https://testnet.monadscan.com/tx/0xf9de7427fd11bdee1d0785c965b7258144f9106ece70d9dfac3b0dcdc943ee41)
in block `51718888`. The canonical scaled bill `2` was created by
[`0xc089…fd70`](https://testnet.monadscan.com/tx/0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70)
with status `1` in block `51722744`, using `1,612,923` gas. MonadVision reports
a perfect Sourcify match for
[`0xa2fb…A198`](https://testnet.monadvision.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198).
The separate [multi-wallet record](monad-testnet-multiwallet-evidence.json)
documents 31 successful contract transactions: bill `3` completed claims,
unanimous approval, exact three-wallet funding, settlement and withdrawal;
bill `4` completed two-wallet cancellation and independent refunds. It also
records one reverted initial Bob funding attempt before the successful retry.

## What should impress a judge

TapTab is not only a bill calculator. The difficult behaviour is encoded as
state and invariants:

1. any change to a claim, tip, remainder preference or membership invalidates
   previous approvals;
2. funding cannot open until the current split is unanimously approved;
3. overfunding and incomplete settlement are rejected;
4. venue proceeds and failed-bill refunds use separate pull-payment paths; and
5. participant, item, share and metadata limits keep contract loops bounded.

The local sample makes those rules understandable without asking a judge to
connect a wallet. The separate Hardhat rehearsal executes successful settlement,
cancellation, expiry, proceeds and independent refunds on ephemeral chain
`31337`.

## Run the local demonstration

Requirements: Node.js `22.13` or later, npm and a modern browser.

```sh
npm ci
npm --prefix contracts ci
npm run dev
```

Open <http://localhost:3000>. The shipped sample requires no wallet or
environment variables.

The configured application and canonical bill are publicly available through
the [live bill `2` link](https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live).
Its [readiness endpoint](https://taptab.mythicmindlabs.workers.dev/api/health/ready)
passes against the configured Testnet chain, deployed bytecode and bill.

For the complete deterministic local gate:

```sh
npx playwright install chromium
npm run verify:local
```

The gate builds the application; checks lint and TypeScript; runs the web,
multi-viewport browser and Solidity suites; rehearses the contract lifecycle;
and checks selected maximum-shape gas regression ceilings.

## Judge links

| Item | Location or status |
| --- | --- |
| Local demo | <http://localhost:3000> |
| Repository URL | [github.com/MasteraSnackin/taptab](https://github.com/MasteraSnackin/taptab) |
| Public Monad Testnet application | [Open canonical bill `2`](https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live) |
| TapTab contract | [`0xa2fb…A198` on Monadscan](https://testnet.monadscan.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198) |
| Deployment transaction | [`0xc48a…a488`, block `51718885`](https://testnet.monadscan.com/tx/0xc48ab94b9e503d09f52e32dd8b2f97adb9b0ca80ab83a6a544dc72fa338ba488) |
| Initial bill `1` creation | [`0xf9de…ee41`, block `51718888`](https://testnet.monadscan.com/tx/0xf9de7427fd11bdee1d0785c965b7258144f9106ece70d9dfac3b0dcdc943ee41) |
| Canonical bill `2` creation | [`0xc089…fd70`, block `51722744`, status `1`, gas `1,612,923`](https://testnet.monadscan.com/tx/0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70) |
| Canonical bill `2` deadline | `2026-08-14T17:01:55Z` |
| Source verification | [Monadscan source published; Sourcify full match complete](SOURCE_VERIFICATION_STATUS.md) |
| Runtime readiness | [All configured checks pass for bill `2`](https://taptab.mythicmindlabs.workers.dev/api/health/ready) |
| Multi-wallet Testnet rehearsal | [Bills `3` and `4`, 31 successful contract transactions](monad-testnet-multiwallet-evidence.json) |
| Upload-ready subtitle track | [video/2min/taptab-demo-2min.srt](video/2min/taptab-demo-2min.srt) |
| Video production record | [V5 plan, source scripts, captions and retained QA](video/README.md) |
| Desktop, mobile and Stage Mode captures | [screenshots](screenshots) |
| Three-minute script | [PITCH.md](PITCH.md) |
| Architecture diagram | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Evidence manifest | [evidence-manifest.json](evidence-manifest.json) |
| Public-preview check | [public-preview-evidence.json](public-preview-evidence.json) |
| Full local judging runbook | [../judging/LOCAL_RUNBOOK.md](../judging/LOCAL_RUNBOOK.md) |

The current public application is Worker version
`28fa6666-c9cc-4734-b465-1587f82d4946`, fully rolled out from source checkpoint
`27ecdb48ed9fbdd1fa50a8661aa39c1d7379cd4d`. The post-deployment page,
readiness, price, personal-payment, manifest, Open Graph and browser checks are
recorded in [public-preview-evidence.json](public-preview-evidence.json).
The current local task-first live card, five-step host checklist, corrected
Reown Ethers adapter and connector UI, optional RPC fallbacks and expanded browser
suite were added after that checkpoint and have not been redeployed. The public
link must not be cited as evidence for those later changes until the exact
current revision is deployed and re-probed.

The retained V5 production record states that the recording keeps the complete application viewport visible for
`76.0` seconds. It includes a genuinely continuous `15.000`-second, 450-frame
take that demonstrates the fair-remainder and tip controls, selects 12.5%,
reviews and approves the split, reopens the tip controls, changes the vote to
10%, and shows the consent reset. The 1,279,802-byte take has zero internal
cuts, performs no wallet write and has SHA-256
`74836bee8192056caf8d75c6252f8b830416b68396ad0a593918738d034a237f`.
Purple identifies the local sample, green confirmed Monad Testnet evidence and
amber the protected cancellation/refund path; sponsorship is labelled as a
local-sample demonstration. Its named story shows Amina, Theo and Jules sharing
the house red and You covering Theo's remainder. The retained Bill 3 settlement
hash transitions to its genuine Monadscan `Success` receipt and is labelled as
a historical replay, not a fresh transaction. It ends with **“Bill 3 settled.
Nobody chased. Every contribution accounted for.”** Its direct QR opens the
separate live Bill 2, which is created and publicly readable but not presented
as settled. The final card attributes the source-match statement as
**“MonadVision reports · Sourcify perfect match”**. ElevenLabs' synthetic
**Nora — Blackpool Product Guide** narration remains unchanged and plays at
natural speed over locally synthesised music and interface sounds. The
7,941,645-byte master is exactly `119.000` seconds, 1920 × 1080 H.264/yuv420p at
30 fps with 3,570 frames, plus 48 kHz stereo AAC. It decodes at −16.04 LUFS-I
and −2.76 dBTP. The unchanged 31st and final cue ends at `111.740` seconds,
leaving a `7.260`-second speech-free, music-backed QR hold. The verified hashes
are:

- MP4: `7c8895c78647136ea0bc7317c4a0d4c8b199f4243211b319114202a5429cc8e6`;
- SRT: `ff7b6b5b049a29b71e1114e9665237bd89c193a3f9e7a0b38e18742648503ae1`;
- poster: `402a294e2bc16cce3912585b1d0310ab7713691965ebeee9b8a634bd6879ca1a`;
- continuous take: `74836bee8192056caf8d75c6252f8b830416b68396ad0a593918738d034a237f`;
- teaser: `e51f25efe97d41ebaf2b0fb80df7107774aa80a3e015f19f949bd4e58bc2cee1`
  (1,164,603 bytes).

Those hashes are retained historical QA evidence. The large V5 delivery
binaries are not included in this source-only repository.

## Evidence and limits

The latest unarchived working-tree run reported 223 passing application tests,
63 passing browser tests with 27 intentional profile-specific skips across five
viewport profiles, and 89 passing contract tests: 375 passing checks in total.
It is not revision-linked evidence. The retained submission manifest still
records the older 311-test public-deployment checkpoint. The E2E
gate includes a configured-build check that rejects an untrusted contract link
and controlled Reown/Ethers wallet checks for connector discovery, rejection,
provider events, a delayed Bill A/B read race and suppression of every signing
or transaction method when the wallet changes during preflight. Those live
browser checks use a deterministic intercepted RPC fixture and do not contact
Monad Testnet. The contract total includes the replayable ten-seed bounded
stateful campaign. The
local checks also record a successful lifecycle rehearsal and all eight guarded
gas ceilings. Separately, the linked public readiness evidence records a
reachable Monad Testnet RPC on chain 10143. Generated local addresses,
transaction hashes and gas figures belong only to an ephemeral Hardhat chain
and are not Monad evidence. The deployment and bill-creation hashes above are
supplemented by the sealed public multi-wallet record for bills `3` and `4`.

The gas benchmark is a local regression guard. In particular, it does not prove
that a public network will accept the supported maximum metadata shape, and no
public-network gas acceptance is claimed.

This is unaudited hackathon software. Before broader use it still requires an
independent security review and production-grade
privacy and operational controls. Receipt
metadata, wallet addresses and transactions are public onchain, and the
application cannot authenticate a venue merely from its wallet address.
Canonical bill `2` locks the CoinGecko quote `0.01536012 GBP/MON`. Its £48.50
receipt has an unscaled `3157.527415150402471 MON` mainnet-value reference and
an explicit `1,000:1` faucet-funded settlement scale, producing an onchain
subtotal of `3.157527415150402471 Testnet MON`. Testnet MON has no monetary
value; displayed GBP and USD amounts are labelled mainnet MON references only.

The project documentation also records that this implementation existed before
the event date. The ready-to-send request is in
[ELIGIBILITY_REQUEST.md](ELIGIBILITY_REQUEST.md); written organiser guidance is
required before presenting it as eligible event-day work.

Before submission, the owner still needs to obtain that ruling, confirm the
maximum-four-person team, publish the required public fork, verify a clean
unauthenticated clone, and redeploy and re-probe the accepted source revision.
Physical-wallet, screen-reader, zoom, PWA-install and projector checks
and an independent contract review also remain unproven; automated tests do not
substitute for them.

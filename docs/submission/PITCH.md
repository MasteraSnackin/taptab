# TapTab judge pitch

## Required live Testnet proof

The official
[demo guidance](https://monad-foundation.notion.site/Preparing-for-Your-Project-Demo-ea06367594f283cbaf2c81baf61075c0?pvs=25)
requires a three-minute presentation with the live Monad Testnet demo as the
core. The deterministic script below is the recovery rehearsal; it is not a
substitute for that requirement.

For the judged presentation, use an eligible, accepted and redeployed current
build. Pre-stage a small bill with funded disposable wallets, follow the
five-step host checklist, submit one real contribution or sponsorship, wait for
its successful receipt and open the explorer link. Show the protected
incomplete-settlement state before completing exact funding where time permits.
Keep the local sample ready only if the venue network, wallet or RPC fails, say
“local preview” aloud, and do not describe its actions as fresh transactions.

The browser-wallet portion still requires the project owner’s funded wallet,
account consent and an event-day rehearsal. The existing bills `3` and `4`
record proves contract behaviour but is historical evidence rather than a live
wallet demonstration.

## Three-minute deterministic recovery rehearsal

Use the local sample at <http://localhost:3000>. Keep its **Preview** labels
visible. Do not describe a sample action, local Hardhat hash or generated report
as a Monad transaction.

### 0:00–0:25 — the problem

> A group meal still ends with one person fronting the whole bill and chasing
> everyone afterwards. TapTab changes that: each diner claims what they had,
> agrees the split and funds only their own share. Nobody has to become the
> group's bank.

Show the hero and open the Table 7 sample.

### 0:25–1:05 — a familiar receipt

> The experience starts in pounds, not crypto. This is a £48.50 restaurant
> receipt. A diner can claim a whole item or an exact share of something shared,
> such as wine, a starter or a taxi. The organiser can scan a receipt, but every
> row must be reviewed before it is accepted.

Claim one shared slot. Point to the personal pound total.

> Unclaimed value is divided only between diners who actively opt in. That means
> the quiet person at the table is not automatically charged for somebody
> else's food.

### 1:05–1:40 — agreement before money

Change the tip vote and show the group result.

> Everyone votes on the tip and the middle vote becomes the group choice. Once
> the split is reviewed, every diner approves the same version. If a claim, tip,
> remainder choice or participant changes, all previous approvals are cleared.

Record the remaining sample approvals and open protected payments.

### 1:40–2:20 — protected funding

> Each person now funds only their agreed allocation. A friend can sponsor
> somebody's remaining amount, but sponsorship does not rewrite who owed what.
> The contract rejects overpayment and cannot settle while even one amount is
> outstanding.

Fund one allocation, sponsor another and show that settlement remains locked.
Then complete exact funding.

> Once the exact total is funded, settlement becomes permissionless and the
> venue can pull the proceeds.

### 2:20–2:40 — failure is a first-class path

Point to the cancellation and expiry controls; do not spend time replaying the
entire second flow unless a judge asks.

> A payment product also needs a safe failure path. If an incomplete bill is
> cancelled or expires, the venue receives nothing and each contributor claims
> their own refund. The local contract rehearsal tests cancellation, expiry and
> independent refunds with separate accounts.

### 2:40–3:00 — Monad and the evidence boundary

Open Stage mode and show the progress view.

> TapTab's contract and canonical bill 2 are live on Monad Testnet chain 10143.
> The public Worker remains source checkpoint `27ecdb4`; this screen is the
> newer labelled local preview. Bill 2 is confirmed on the explorer, the public
> readiness probe passes and MonadVision reports a perfect Sourcify match. It
> locks a genuine CoinGecko quote, then transparently scales the
> faucet-funded Testnet settlement by 1,000; Testnet MON has no monetary value.
> This screen is still the labelled local preview, not a wallet transaction. The
> separate sealed Testnet record proves bill 3's three-wallet settlement and
> withdrawal and bill 4's two-wallet cancellation and independent refunds across
> 31 successful contract transactions.

End on the Stage mode total, then open the
[live bill `2`](https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live)
or
[canonical bill-creation transaction](https://testnet.monadscan.com/tx/0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70).

## Forty-five-second demo-video narration

> Splitting a bill should not require one person to front the money. TapTab lets
> diners claim whole or shared receipt items in a pounds-first interface. The
> group chooses its tip by median vote, and only volunteers share any unclaimed
> remainder. Every diner approves the current split before protected payments
> open; changing the split clears those approvals. Each person funds only their
> share, or can sponsor a friend. Settlement stays locked until the exact total
> is covered. If an incomplete bill is cancelled or expires, contributors claim
> their own refunds. TapTab's contract and an older public Worker are deployed
> on Monad Testnet. The recording's interaction segment is the newer, clearly
> labelled local preview and has not been redeployed; its closing evidence
> segment switches to the genuine public multi-wallet settlement and refund
> evidence from bills 3 and 4.

Suggested cards: receipt and item claims; tip and approval; protected funding
and sponsorship; settlement lock; cancellation/refunds; Stage mode and evidence
boundary.

The current 1:59 V5 render keeps the complete application window visible for
`76.0` seconds. It includes a genuinely continuous `15.000`-second, 450-frame
take that demonstrates the fair-remainder and tip controls, selects 12.5%,
reviews and approves the split, reopens the tip controls, changes the vote to
10%, and shows the consent reset. The 1,279,802-byte take has zero internal
cuts, performs no wallet write and has SHA-256
`74836bee8192056caf8d75c6252f8b830416b68396ad0a593918738d034a237f`.
Purple denotes the local sample, green confirmed Testnet evidence and amber the
protected refund path; sponsorship is labelled as a local-sample demonstration.
The named story shows Amina, Theo and Jules sharing the house red and You
covering Theo's remainder. The retained Bill 3 settlement hash transitions to
its genuine Monadscan `Success` receipt under an explicit historical-replay
label; it is not a fresh transaction. The edit ends with **“Bill 3 settled.
Nobody chased. Every contribution accounted for.”** Its QR opens the separate
live Bill 2, which is created and publicly readable but not presented as
settled. The final card attributes the source-match statement as **“MonadVision
reports · Sourcify perfect match”**. The unchanged, natural-speed ElevenLabs
Nora/Blackpool narration plays over locally synthesised music and interface
sounds. Its unchanged 31st and final cue ends at `111.740` seconds, leaving a
`7.260`-second speech-free, music-backed QR hold. The 7,941,645-byte,
119.000-second H.264/yuv420p master is 1920 × 1080 at 30 fps with 3,570 frames
and 48 kHz stereo AAC; it measures −16.04 LUFS-I and −2.76 dBTP. Its SHA-256 is
`7c8895c78647136ea0bc7317c4a0d4c8b199f4243211b319114202a5429cc8e6`.

## Judge questions: precise answers

**Is this running on Monad Testnet?**

The contract and canonical bill `2` are live; the current local frontend is not
deployed. The public Worker remains source checkpoint `27ecdb4`. Contract
[`0xa2fb…A198`](https://testnet.monadscan.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198)
and canonical bill `2` are live on chain `10143`. Deployment was confirmed in
block `51718885`, bill `2` creation with status `1` in block `51722744`, and the
[readiness probe](https://taptab.mythicmindlabs.workers.dev/api/health/ready)
passes. [Initial bill `1`](https://testnet.monadscan.com/tx/0xf9de7427fd11bdee1d0785c965b7258144f9106ece70d9dfac3b0dcdc943ee41)
remains evidenced in block `51718888`. The
[sealed rehearsal record](monad-testnet-multiwallet-evidence.json) adds a
complete three-wallet settlement/withdrawal path on bill `3` and a two-wallet
cancellation/refund path on bill `4`.

**What is actually verified?**

The latest unarchived local working-tree gate reported 223 passing application
tests, 63 passing Playwright tests with 27 profile-specific skips, and 89
passing contract tests, including a replayable
ten-seed bounded stateful campaign. It also passed the multi-account contract
rehearsal and all eight local gas ceilings. The browser suite verifies the
corrected Reown Ethers adapter, delayed bill replacement and wallet-context
preflight cancellation with a controlled EIP-6963 wallet and deterministic RPC
fixture; no real wallet or Testnet request was used for those checks, and this frontend has not been
redeployed. A separate public record contains 31 successful Monad Testnet
transactions for bills `3` and `4`, plus one transparently documented reverted
first funding attempt.

The retained submission manifest records the older 311-test public-deployment
checkpoint. It must not be cited as the revision-linked record for the current
375-test working tree.

**Why use a contract rather than Splitwise?**

The contract is the shared source of truth for the approved split, exact funding,
settlement eligibility, venue proceeds and contributor-owned refunds. No
participant has to custody everybody else's payment.

**What remains before public use?**

Organiser eligibility confirmation, the organiser-required fork if applicable,
an independent security review and production privacy and operational controls.
Testnet MON has no monetary value; the GBP/USD display is a mainnet reference
only.

# TapTab contract workspace

`TapTab.sol` is the active shared-bill contract. This workspace also retains a
dependency-free legacy group-purchase escrow. In that prototype, a merchant
publishes ascending buyer thresholds with falling unit prices. Each buyer
deposits the first tier's maximum price. After the deadline (or once sold out),
everyone receives the lowest price unlocked by the final buyer count.

This is hackathon software and has not received a professional security audit.

The current Hardhat 2 development tree has known audit findings even though
the contract package has no production dependencies with reported findings.
The containment policy, safe verification commands and upgrade boundary are
recorded in [SECURITY.md](SECURITY.md). Do not run `npm audit fix --force` on
the judged branch: the available remediation changes Hardhat and its plugins
across major versions and requires a separate compatibility review.

## Lifecycle

1. `createDeal` stores the product metadata, deadline, buyer limits and price tiers.
2. `joinDeal` accepts exactly one maximum-price deposit per wallet.
3. Anyone calls `finaliseDeal` after expiry; sold-out deals can settle early.
4. Successful buyers call `claimRefund` for `maxPrice - clearingPrice`.
5. The merchant calls `withdrawProceeds` for `clearingPrice * buyerCount`.
6. A failed or merchant-cancelled deal gives every buyer a full refund.

The stored state values are `None (0)`, `Active (1)`, `Successful (2)`,
`Cancelled (3)` and `Failed (4)`.

## Safety model

- Settlement makes no external calls. Buyer refunds and merchant proceeds are
  independent pull payments.
- Checks-effects-interactions and a local reentrancy guard protect both payment
  paths.
- Anyone can finalise after expiry, so the merchant cannot strand buyer funds by
  disappearing.
- A failed outgoing payment reverts its claimed/withdrawn flag, allowing retry.
- Tier count is capped at 16 and validated as strictly ascending thresholds with
  strictly falling, non-zero prices.
- A merchant cancellation always preserves full refunds for joined buyers.

## Local verification

Requires Node.js 22 or later.

```sh
npm ci
npm test
```

The test suite covers configuration validation, every deal state, exact deposit
rules, tier transitions, early and expired settlement, common-price accounting,
authorisation, cancellation, full and partial refunds, failed recipients and
reentrancy attempts. It also runs a ten-seed bounded TapTab stateful campaign
with two seeds for each terminal outcome and an independent allocation/tip
oracle. Replay one reported seed with:

```sh
TAPTAB_STATEFUL_SEED=0x10203040 npx hardhat test test/TapTabStatefulCampaign.test.cjs
```

Each campaign seed is deterministic regression evidence; the suite is not an
open-ended fuzzer or formal verification.

The final 7 August 2026 local gate passed all 89 contract tests.

After compilation, the frontend-ready ABI is at
`artifacts/src/TapTab.sol/TapTab.json` in the `abi` property.

## TapTab local multi-account rehearsal

Run the complete TapTab lifecycle without an RPC, wallet extension or Testnet
funds:

```sh
npm run rehearse:local
```

The command is explicitly pinned to Hardhat network `31337` and refuses every
other network before deployment. It creates separate creator, payee, diner,
sponsor and outsider accounts and exercises successful settlement and proceeds,
creator cancellation, permissionless expiry and contributor-owned refunds. It
writes a labelled, ignored report to `../outputs/taptab-local-rehearsal.json`.
The addresses and transaction hashes in that report exist only for the
ephemeral run and are not Monad Testnet evidence.

The final 7 August 2026 local gate passed this rehearsal.

## TapTab Monad Testnet multi-wallet rehearsal

Run the bounded public-network rehearsal with a funded Testnet deployer:

```sh
npm run rehearse:testnet
```

The script refuses every chain except Monad Testnet `10143`, creates or restores
private participant wallets from the ignored, owner-only
`../outputs/taptab-testnet-rehearsal-wallets.json`, and never prints their
private keys. It reuses already completed rehearsal bills on later runs instead
of repeating writes. The public, secret-free record is written to
`../docs/submission/monad-testnet-multiwallet-evidence.json`.

The sealed run completed two independent paths on contract
`0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`: bill `3` used three wallets for
claims, unanimous approval, exact funding, settlement and creator withdrawal;
bill `4` used two contributors for cancellation and independent refunds. The
record contains 31 successful contract transactions and separately records one
reverted first Bob funding attempt before the successful explicit-gas retry.
Testnet MON has no monetary value.

## TapTab local maximum-shape gas benchmark

Run the bounded-loop regression benchmark on ephemeral Hardhat chain `31337`:

```sh
npm run benchmark:gas
```

The script refuses every other network. It constructs bills at the supported
maximum of 32 participants, 32 items and 128 share slots, then measures creation,
including a separate maximum-shape creation with exactly 64,000 UTF-8 metadata
bytes, canonical digest estimation, first and cached split approvals, opening
Funding, an all-share departure and a participant payment. Explicit generous
ceilings make large regressions fail the command. The ephemeral Hardhat network
is pinned to the Cancun rules because Hardhat's newer default rules enforce a
16,777,216 per-transaction gas cap below the boundary transaction's measured
cost. The ignored JSON report is written to
`../outputs/taptab-gas-benchmark.json`; its figures are local regression evidence,
not proof that a public network accepts the maximum shape and not Monad fee or
performance claims.

The final 7 August 2026 local gate passed all eight configured ceilings.

## Monad Testnet deployment

Copy `.env.example` to `.env`, set `MONAD_TESTNET_RPC_URL` and
`DEPLOYER_PRIVATE_KEY`, then run:

```sh
npm run wallet:create:testnet
```

That optional bootstrap command creates a new, dedicated Testnet-only EVM wallet
only when `.env` already exists and its single `DEPLOYER_PRIVATE_KEY` field is
blank. It atomically stores the private key with owner-only `0600` permissions
and prints only the checksum public address. It refuses to replace a configured
key, follow a symbolic-link `.env`, or overwrite a file that changes during the
operation. Back up the ignored `.env` securely: the command never prints a
private key, seed phrase or recovery material, so a lost file cannot be
recovered by TapTab. Fund only the printed public address with Testnet MON.

The supported TapTab deployment command and its configuration are documented
under [One-command Table 7 deployment](#one-command-table-7-deployment) below.

`.env` is ignored. Never commit or share a private key or seed phrase. The
deployment script prints the deployer and new contract addresses.

## TapTab group bills

`TapTab.sol` coordinates a shared native-MON bill without requiring one person
to front the payment. The creator supplies exact item amounts and share-slot
counts. Public metadata is bounded to 64,000 UTF-8 bytes at the contract boundary,
matching the client limit. The creator can approve up to 32 participant invitations atomically with
`inviteMany`, and each diner can claim up to 128 share indexes atomically with
`claimMany`; a successful claim batch advances the split version only once. An
invitation is consumed when that wallet joins in Draft. Joined participants opt
into any fair remainder, vote
for a tip from 0 to 3,000 basis points, and claim item share slots. Every joined
participant must then approve the current domain-separated split digest. Any
claim, preference or participant change advances the split version and makes all
earlier approvals stale in O(1), so the creator cannot open Funding until the
current split is unanimous.

The first successful approval of a split version computes and memoises that
version's digest. Later participants reuse the memoised value instead of
repeating the participant, item and share scan. A version advance invalidates
the cache in O(1). The public `currentSplitDigest` view deliberately remains a
canonical recomputation from source state so clients can independently verify
the commitment.

A participant can leave during Draft by atomically transferring all claimed
shares to another joined participant. Leaving after funding starts is rejected.
Opening Funding locks the claims and the median vote (the floor-average of the
two middle votes for an even participant count).

Unclaimed share value is divided only among participants who opted in. Every
indivisible wei is allocated deterministically: earlier share slots receive item
split dust, and join order resolves fair-remainder and tip dust. This ensures the
sum of participant dues always equals the subtotal plus the Solidity-floored tip.
Each participant ledger exposes the exact base due, tip due, total due and funded
amount for reconciliation.
Any wallet can sponsor any participant, but neither a participant nor the whole
bill can be overfunded. Settlement is rejected until the exact total is funded.

The payee pulls proceeds after settlement. A payee may be an externally owned
account or a contract wallet, but it cannot be the TapTab contract itself because
that address has no external authority capable of calling `withdrawProceeds`.
If the creator cancels before settlement, or anyone expires the bill after its
deadline, each contributor can pull their full contribution as a refund.
Participant, item, per-item share, and total-share counts are capped so all
state-transition loops remain bounded.
A fully funded bill cannot be cancelled or expired and remains permissionlessly
settleable after its deadline; an incomplete bill can be expired for refunds.

The frontend fail-closes each live write before the wallet opens: it checks the
trusted contract and Testnet chain, simulates the exact call and payable value,
and verifies the wallet can cover a 25% buffered gas limit plus any contribution.
It repeats the simulation immediately before sending. These client checks improve
the user experience but do not replace the contract invariants or an independent
security audit.

### One-command Table 7 deployment

`deploy:taptab` deploys TapTab and creates initial bill `1` with the Table 7
receipt: five GBP items totalling £48.50 with the corresponding shared-item slot
counts. It converts each exact receipt amount to native MON wei using a validated
GBP-per-MON quote, then embeds this public metadata shape in the bill:

```json
{
  "currency": "GBP",
  "merchant": "Lina Stores · Shoreditch",
  "subtotalPence": 4850,
  "items": [{ "name": "Wood-fired margherita", "amountPence": 1200 }]
}
```

Set `MONAD_TESTNET_RPC_URL` and `DEPLOYER_PRIVATE_KEY` as described above, then
run the single command:

```sh
npm run deploy:taptab
```

The script refuses every chain except Monad Testnet `10143`, checks the deployer
has sufficient Testnet MON against a buffered fee estimate, validates the payee,
duration and quote, waits for both transactions, and verifies the seeded bill.
It prints the confirmed deployment and `createBill` transaction hashes, block
numbers, and canonical MonadVision and Monadscan links, followed by a sanitised
JSON evidence object containing only public chain data. By default it fetches a
recent MON GBP quote from CoinGecko. For a reproducible demo, provide a positive
decimal quote explicitly:

```sh
TAPTAB_GBP_PER_MON=0.025 npm run deploy:taptab
```

Optional settings are `TAPTAB_PAYEE_ADDRESS` (defaults to the deployer) and
`TAPTAB_DURATION_SECONDS` (defaults to 14,400 seconds and accepts 300–604,800).
The script never prints the private key or RPC configuration. It prints the two
values required by the frontend and the matching audience query. Save its
public evidence output with the exact source revision used for deployment.

The command prints bill `1` as its deployment-time seed. Retain that transaction
as initial evidence, but do not use its suggested bill ID as the current public
configuration. The public application is pinned to the separately created,
explicitly scaled bill `2` below. Shared links may select any positive bill ID
created by the build-trusted contract;
links cannot substitute a different contract.

### Canonical faucet-scale bill 2

`seed:taptab:scaled` operates only on the existing Monad Testnet contract after
bill `1` exists. It obtains a current GBP-per-MON quote from CoinGecko, with
Coinbase's MON-GBP spot endpoint as the seed command's fallback, and prepares
the same £48.50 Table 7 receipt. The unscaled mainnet-value reference is divided
by an explicit `1,000` settlement divisor so the faucet-funded Testnet bill can
be exercised without misrepresenting the market quote.

Run its read-only preflight first:

```sh
npm run seed:taptab:scaled
```

The script prints the quote, reference subtotal, scaled Testnet subtotal and gas
estimate, then refuses to send unless the exact confirmation flag is supplied:

```sh
TAPTAB_CONFIRM_SCALED_TESTNET_DEMO=YES npm run seed:taptab:scaled
```

It verifies chain `10143`, existing bytecode, the exact expected bill count,
metadata, item values, share counts, signer balance and the confirmed receipt.
It will not create bill `3` if bill `2` already exists or does not match the
expected disclosed metadata. The public frontend configuration is:

```text
NEXT_PUBLIC_TAPTAB_ADDRESS=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198
NEXT_PUBLIC_TAPTAB_BILL_ID=2
?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live
```

### Current public Testnet instance

The configured public application uses:

| Field | Confirmed value |
| --- | --- |
| Live bill | [Open canonical bill `2`](https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live) |
| Contract | [`0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`](https://testnet.monadscan.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198) |
| Deployment | [`0xc48ab94b…ba488`](https://testnet.monadscan.com/tx/0xc48ab94b9e503d09f52e32dd8b2f97adb9b0ca80ab83a6a544dc72fa338ba488), block `51718885` |
| Initial bill `1` | [`0xf9de7427…3ee41`](https://testnet.monadscan.com/tx/0xf9de7427fd11bdee1d0785c965b7258144f9106ece70d9dfac3b0dcdc943ee41), block `51718888` |
| Canonical bill `2` | [`0xc089eb04…2effd70`](https://testnet.monadscan.com/tx/0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70), block `51722744`, status `1`, gas `1,612,923` |
| Bill `2` deadline | `2026-08-14T17:01:55Z` |
| Bill `2` quote | `0.01536012 GBP/MON`, CoinGecko; mainnet MON reference |
| Bill `2` settlement | `3.157527415150402471 Testnet MON` for £48.50, after the disclosed `1,000:1` scale |
| Source match | [MonadVision contract page](https://testnet.monadvision.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198); Sourcify reported `perfect` |
| Runtime readiness | [Passing public probe for configured bill `2`](https://taptab.mythicmindlabs.workers.dev/api/health/ready) |

This public Worker represents source checkpoint `27ecdb4`. The current local
frontend, including the corrected Reown Ethers adapter and connector UI, has not
been redeployed.

At the locked quote, the unscaled £48.50 reference is
`3157.527415150402471 MON`; the settlement divisor produces the exact Testnet
subtotal above. Deployment, source matching and both seeded bill creations are
supplemented by the separate
[`monad-testnet-multiwallet-evidence.json`](../docs/submission/monad-testnet-multiwallet-evidence.json)
record for bills `3` and `4`. Testnet MON has no monetary value; any GBP or USD
amount in the interface is a labelled mainnet MON reference.

### Testnet validation and source verification

The read-only health check verifies the public RPC reports chain `10143` and a
current block without requiring a deployer key:

```sh
npm run check:testnet
```

After deployment, set `TAPTAB_CONTRACT_ADDRESS` and `TAPTAB_BILL_ID` in the local
`.env` and run `npm run check:taptab`. It additionally checks deployed bytecode
and reads the specified bill back from Monad Testnet.

To submit the exact compiled source through the configured automated explorer
path, set `ETHERSCAN_API_KEY` and run:

```sh
npm run verify:taptab -- 0xYourTapTabContract
```

The verification configuration follows the Etherscan V2 API for Monad Testnet.
MonadVision also supports Sourcify verification without an Etherscan API key.
For the current deployment that flow reported a perfect match. Check both
explorers after verification because either service can lag the other.

The frontend-ready ABI is generated at
`artifacts/src/TapTab.sol/TapTab.json` after `npm run compile`.

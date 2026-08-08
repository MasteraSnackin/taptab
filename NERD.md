# TapTab Performance and Technical Excellence Report

> **Historical checkpoint:** this report records the 6 August technical pass.
> See [docs/MARKDOWN_TASK_COMPLETION.md](docs/MARKDOWN_TASK_COMPLETION.md) and
> [contracts/SECURITY.md](contracts/SECURITY.md) for the later invariant, gas,
> metadata and dependency-assurance boundary.

**Status:** Complete — highest-priority correctness defect fixed
**Completed:** 6 August 2026
**Scope:** Contract correctness, client preflight, performance profiling and
technical risk ranking

## Outcome

The profiling pass found one fund-safety defect that outranked the measured
performance bottlenecks: TapTab allowed a bill to name the TapTab contract
itself as payee. A fully funded and settled bill in that configuration retained
its proceeds, but no external account could ever satisfy
`msg.sender == bill.payee` to withdraw them.

Bill creation now rejects that configuration onchain and the client rejects it
before opening a wallet. The change does not ban contract payees generally;
smart accounts and venue contracts remain valid. It removes the one address
whose inability to originate the required withdrawal call is provable from the
TapTab design itself.

No layout, styling or user-facing feature was changed.

## Profiling method

The review covered:

- maximum-shape Solidity paths under the declared limits of 32 participants,
  32 items and 128 total shares;
- live snapshot RPC call counts at the normal and pending-transaction polling
  intervals;
- the maximum-shape in-browser split calculation;
- the production build and initial JavaScript/font payload;
- manual ABI casts and source-pattern tests around the live reader; and
- contract authority, lifecycle and pull-payment boundaries.

Measurements used the repository's Solidity optimiser configuration of 200
runs with the Paris EVM target, the local Hardhat network and a production
Vinext build. They are development baselines, not Monad Testnet fee forecasts.

## Top three findings

| Rank | Severity | Finding | Measured evidence | Resolution or target |
| --- | --- | --- | --- | --- |
| 1 | High correctness | TapTab could be its own payee, making settled proceeds unreachable | Reproduction reached `Settled` with 10 wei available and 10 wei held; every external withdrawal reverted `NotPayee` | **Fixed:** reject `address(0)` and `address(this)` onchain; mirror the self-address guard before wallet submission |
| 2 | Medium-high performance | Every participant approval recomputes the full split digest | At 32 participants and 128 shares, one approval used 731,230 gas and all 32 used 23,399,360 gas in aggregate | Cache the digest for a split version after its first verified approval; target later approvals at no more than 90,000 gas and the full set below 3.5 million gas |
| 3 | Medium-high performance/reliability | The live reader has N+1 RPC amplification | A connected-wallet refresh performs `15 + 2P + I` requests: 111 at 32 participants and 32 items, or 111 requests per second while a transaction is pending | Use two block-pinned Multicall3 waves; target no more than four requests per maximum refresh, a 96.4% reduction |

### 1. Unreachable proceeds

Before the fix, `createBill` rejected only the zero payee. The payee was then
stored unchanged, while `withdrawProceeds` required the caller to equal that
stored address. If it was TapTab's own address, there was no externally
reachable caller capable of satisfying the check.

The correction is deliberately narrow:

- Solidity rejects `payee == address(this)` with the existing `InvalidPayee`
  error before creating any state.
- `buildCreateBillWrite` canonicalises the contract and payee addresses, then
  rejects equality before simulation or wallet submission.
- A failed attempt leaves `billCount` unchanged.
- Ordinary externally owned and contract-wallet payees remain supported.

This requires a new contract deployment. A previously deployed non-upgradeable
TapTab bytecode cannot inherit the guard.

### 2. Split-approval gas

`approveSplit` currently recomputes a digest over active participant data and
every share owner. Requiring each participant to repeat that scan makes the
whole unanimous-approval journey `O(P(P + S))`, even though every approval in a
split version verifies the same digest.

Local maximum-shape measurements were:

| Operation | Gas |
| --- | ---: |
| One-participant, one-share approval | 75,516 |
| One approval at 32 participants and 128 shares | 731,230 |
| All 32 maximum-shape approvals | 23,399,360 |
| Maximum-shape `createBill` | 1,707,780 |
| `claimMany` for 128 shares | 3,818,802 |
| Maximum-shape `openFunding` | 1,466,213 |
| `leaveBill` while transferring 128 claims | 1,491,679 |

The bounded follow-up is a digest cache keyed by `splitVersion`. The first
approval still performs the complete calculation; later approvals compare
against the cached value in constant time. Any split mutation already advances
the version, so a version mismatch invalidates the cache without an unbounded
clear operation. Regression tests must prove that every mutation still rejects
a stale digest and that a failed first approval cannot persist a cache value.

### 3. Live snapshot fan-out

One connected-wallet refresh currently performs:

```text
1 block number
+ 6 base contract reads
+ 2 × participant count
+ 1 × item count
+ 6 connected-account reads
+ 1 repeated digest read
+ 1 event-log request
```

At the contract limits this is 111 network requests per refresh. Normal
four-second polling can therefore produce 27.75 requests per second per open
client. Pending-transaction polling can produce 111 requests per second before
the separate 800 ms event watcher and transport retries are counted.

The installed Viem version defines Monad Testnet's Multicall3 deployment, and a
live code-presence probe found 3,808 bytes at the canonical address. A
block-pinned two-wave reader can batch the base reads first and the dependent
participant/item/account reads second, then fetch logs. The target is four
network requests while keeping every value tied to the same block and failing
closed if any subcall fails.

## Paths ruled out as the primary bottleneck

- `calculateTapTabPreview` completed a valid maximum-shape fixture with a median
  of 0.0631 ms per calculation after warm-up. Its bounded work is not a current
  optimisation priority.
- The production build completed successfully in under five seconds locally.
- Production dependency auditing reported no known runtime vulnerabilities at
  the profiling point.

The initial application payload remains material: the root preloaded about
261 KB of compressed JavaScript and 146 KB of fonts in the measured build.
Conditional loading of wallet and live-only tools is a worthwhile later pass,
but it does not outrank the fund-safety defect or the live RPC amplification.

## Implementation

| File | Change |
| --- | --- |
| `contracts/src/TapTab.sol` | Rejects the TapTab contract itself as payee |
| `app/taptab-chain.ts` | Mirrors the invariant before simulation and wallet submission |
| `contracts/test/TapTab.test.cjs` | Proves self-payee creation reverts and creates no bill |
| `tests/taptab-chain.test.mjs` | Proves client-side rejection before a wallet request is built |
| `contracts/README.md` | Documents the precise payee boundary |
| `README.md`, `ARCHITECTURE.md`, `PLAN.md` | Updates verification, architecture and completion records |

The compiled TapTab runtime is 18,567 bytes, leaving 6,009 bytes below the
24,576-byte EIP-170 runtime limit after this fix.

## Verification

| Check | Result |
| --- | --- |
| Focused self-payee contract and client regressions | Passed |
| Production Vinext build | Passed |
| Web and server tests | 185 passed, 0 failed after local release follow-ups |
| Playwright browser tests | 24 passed, 0 failed across desktop, tablet and mobile |
| Solidity/Hardhat tests | 61 passed, 0 failed after invariant and metadata-bound coverage |
| Deterministic generated model fixtures | 12,000 passed across three seeds |
| Solidity-versus-TypeScript fixtures | 40 passed: 8 curated and 32 seeded |
| ESLint | Passed |
| TypeScript `--noEmit` | Passed |
| `git diff --check` | Passed after documentation updates |

## Remaining technical work

1. Decide whether the 32-participant cap means active or lifetime participants.
   The current append-only history prevents a replacement after 32 wallets have
   joined and one leaves.
2. Broaden the six fixed-seed stateful onchain sequences into a sustained fuzz
   campaign and obtain an independent Solidity review.

The split-digest cache described above was completed in `RESEARCHER.md`: the
measured 32-person sequence fell to 2,612,286 gas, and a relative gas regression
plus cache-invalidation tests are now part of the Hardhat suite.

The same research follow-up replaced the N+1 reader with two block-pinned,
fail-closed Multicall3 waves and pauses timers and event watches outside the
active visible live workspace. Expiry eligibility now comes from the timestamp
returned in the first pinned Multicall wave, so a device-clock error cannot open
the expiry action early. The remaining manual ABI boundary cast should be removed
when the reader is extracted behind an injected, behaviourally tested client.

The deterministic property suite now exercises 12,000 generated TypeScript bill
models, while the differential suite replays 8 curated and 32 seeded fixtures
through both the model and Solidity. The comparisons cover exact share slots,
rounding dust, remainder allocation, sponsorship, funding ledgers and settlement
eligibility. This is repeatable differential evidence, not a substitute for a
stateful fuzzer or an independent review.

The highest-priority Nerd task is complete. The remaining items are explicit,
measured follow-ups rather than claims of completed optimisation.

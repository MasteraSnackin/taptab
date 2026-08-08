# TapTab Algorithmic Research Report

> **Historical checkpoint:** this report records the 6 August research pass.
> See [docs/MARKDOWN_TASK_COMPLETION.md](docs/MARKDOWN_TASK_COMPLETION.md) for
> the current implementation/evidence boundary and owner-dependent decisions.

**Status:** Complete — researched improvements implemented and verified
**Date:** 6 August 2026
**Scope:** Solidity and TypeScript algorithms, data structures, correctness and
measurable runtime behaviour

## Decision record before implementation

The highest-value low-risk change is to memoise the split digest for the current
`splitVersion` after the first successful approval. This decision was recorded
before changing the production contract.

`approveSplit` currently recomputes the same digest for every diner. The digest
walks participant history, active preferences, every item and every share owner.
For `P` approvers, `H` historical participants, `I` items and `S` share slots,
unanimous approval therefore costs `O(P × (H + I + S))` digest work even though
all successful approvals in one version compare the same immutable value.

The current baseline was captured before implementation. The completed contract,
compiled with the repository's Solidity settings (optimizer 200 runs, Paris EVM
target) and measured on local Hardhat, gave the following maximum-shape result
at 32 participants, 32 items and 128 share slots:

| Approval path | Current contract | Version-stamped cache | Change |
| --- | ---: | ---: | ---: |
| First approval | 731,230 gas | 756,874 gas | +3.51% |
| Each later approval | 731,230 gas | 59,852 gas | -91.81% |
| All 32 approvals | 23,399,360 gas | 2,612,286 gas | **-88.84%** |

The small first-approval premium buys a constant-time path for the other 31
approvers. It materially exceeds the measured gains of the next client-side
candidate and directly improves the onchain group journey.

### Chosen design

- Store a cached digest together with the `splitVersion` for which it was
  computed.
- On the first valid approval for a version, calculate the canonical digest and
  cache it. On later approvals for that version, reuse it.
- Let every existing split mutation advance `splitVersion`; a version mismatch
  invalidates the old cache in `O(1)` without clearing participant approvals or
  walking share state.
- Keep `currentSplitDigest` as an independent canonical calculation so external
  readers can still verify the stored approval commitment from source state.
- Preserve revert ordering: compare the supplied digest first, then reject a
  duplicate approval. Persist a cache miss only after both checks pass, so a
  failed call cannot seed cache state.

This is memoisation with explicit version-based invalidation. The pattern is
appropriate because every input to the function is already committed by the
same monotonically advancing version. It does not weaken unanimity or change the
digest format.

## Baseline algorithm and data-structure map

| Area | Current approach | Assessment |
| --- | --- | --- |
| Split commitment | Iterated `keccak256` over bounded participant, item and share storage | Canonical and deterministic; repeated computation in every approval is wasteful |
| Approval invalidation | Per-wallet version stamp plus aggregate approval count | Strong choice: mutations invalidate all approvals in constant time |
| Item and remainder allocation | Integer division with deterministic earlier-slot/join-order dust | Strong choice: exact conservation without floating point or stranded wei |
| Tip consensus | Sort at most 32 votes and select the median; average the middle pair for an even count | Bounded, transparent and fast enough; selection algorithms add complexity without a demonstrated benefit |
| Payment safety | Exact participant ledgers and pull-based refunds/proceeds | Strong choice: bounded settlement and checks-effects-interactions |
| Browser split preview | Arrays, `Map`/`Set`, full sort and exact integer arithmetic | Correct on valid identifiers, but the composite claim key admits a delimiter collision |
| GBP-to-MON allocation | Largest-remainder integer allocation | Strong choice: output totals match the exact converted receipt amount |
| Live chain snapshot | Concurrent, block-pinned reads followed by consistency checks | Correct snapshot boundary, but transport fan-out reaches 111 requests per maximum refresh |
| Evidence export | Sorted hash arrays and canonical JSON serialisation | Deterministic, but allocation hashes are not checked for membership in the top-level evidence set |

The existing arithmetic was retained after 20,000 generated valid bill models
passed subtotal, participant-due, tip and funding conservation invariants. A
further 50,000 generated GBP-to-wei allocation cases passed exact total and
positive-output invariants. Replacing these algorithms for novelty would add
risk without evidence of a problem.

The table records the implementation at the start of the research pass. The
claim index, evidence validation and live reader findings were subsequently
implemented as described below.

## Ranked findings

### Quick Wins

1. **Version-stamped split-digest memoisation — implemented.**
   Target: full maximum-shape unanimity below 3.5 million gas, later approvals
   below 90,000 gas, canonical digest unchanged, and stale versions rejected.
2. **Replace delimiter-based claim-pair keys with nested exact-key maps —
   implemented.**
   `assertIdentifier` permits NUL, while the former key joined two identifiers
   with NUL. Distinct participant/item pairs could therefore collide and raise
   a false duplicate. A nested exact-key map removes the ambiguity and reduced
   maximum-fixture preprocessing from 22,526 ns to 5,335 ns in an isolated
   benchmark (4.22× faster). The collision is now a regression fixture.
3. **Pause snapshot and event polling when the live workspace or page is not
   visible — implemented.** A hidden configured panel previously performed
   approximately 6.75 requests/second for a four-person, five-item bill and up
   to 29 requests/second at the contract limits. It now makes zero periodic
   calls while inactive and performs one immediate refresh on return.
4. **Require allocation evidence hashes to belong to the record's top-level
   evidence set — implemented.** The serialiser now validates the canonical
   top-level set first, requires every allocation hash to be a member and still
   permits one transaction to fund multiple beneficiaries.

### Medium Efforts

1. **Two block-pinned Multicall3 waves — implemented without the separate
   reader extraction.** The maximum refresh path moved from 111 individual
   requests to approximately four transport operations, subject to bounded
   calldata chunking and provider limits. Extracting the reader behind an
   injected client remains useful for deeper behavioural tests.
2. Add capped exponential backoff with full jitter to degraded snapshot and
   event polling, then return to the normal cadence after recovery.
3. Collapse the two `leaveBill` share scans into one bounded transfer/count
   pass, and hoist per-item quotient/remainder calculations out of participant
   loops. Benchmark both before retaining them.
4. Define explicit included-versus-finalised transaction semantics using Monad
   block tags or a confirmation policy before presenting settlement evidence as
   final.
5. Replace append-only participant-history scans with stable indices or packed
   active-participant structures only if churn benchmarks justify the added
   storage and migration complexity.

### Research Bets

1. Prototype typed EIP-712 offchain split approvals, with ERC-1271 contract
   signature support and an EIP-4337-compatible submission path. This could
   collapse 32 approval transactions into one submission, but changes the
   signature, replay and relayer threat model and requires a fresh audit.
2. Compare a Merkle or incremental split commitment with the present canonical
   full-state digest. Proof calldata, mutation cost and recovery ergonomics must
   all beat the bounded current model before adoption.
3. Prototype an event-sourced local reducer fed by WebSocket or an indexer and
   periodically reconcile it against a finalised block-pinned snapshot. Do not
   make speculative events authoritative for payments.
4. Test proportional largest-remainder assignment for tip dust as a fairness
   policy. The current join-order policy is exact and deterministic; changing it
   is a product/economic decision, not merely an optimisation.

## Implementation acceptance criteria

- The first valid approval computes and stores the digest for its exact
  `splitVersion`.
- A later approval in the same version avoids the participant/item/share digest
  walk.
- Every existing split mutation invalidates reuse through its version advance.
- A stale supplied digest still reverts with `SplitDigestMismatch`.
- A duplicate current-version approval still reverts with
  `SplitAlreadyApproved` after digest validation.
- A failed first approval cannot persist a digest.
- `currentSplitDigest` and `getSplitStatus().currentDigest` remain canonical
  recomputations.
- Existing contract behaviour and all repository checks continue to pass.

## Implemented changes

`Bill` now stores `cachedSplitDigestVersion` in the partially occupied slot that
already contains its small lifecycle fields, plus one `bytes32` digest slot.
`approveSplit` selects the cache only when its version exactly matches the
current split. A cache miss computes the canonical digest, validates the caller's
expected digest, checks for a duplicate approval and only then persists the new
cache value.

Three focused contract regressions cover same-version gas reduction,
version-based invalidation after a claim mutation and a rejected first approval
that must not poison an empty cache. The complete Hardhat suite now passes 56
tests, including the later differential fixture runner.

The deployed runtime is 18,682 bytes, 115 bytes larger than the previous build
and 5,894 bytes below the EIP-170 limit. This contract is non-upgradeable, so a
Monad Testnet deployment must use the newly compiled bytecode and a new address.

The follow-on correctness and runtime pass also:

- replaced composite claim strings with a nested item/participant map and
  reused the validation-built claim arrays and claimed-share sets;
- added the exact former collision as a regression while preserving duplicate
  pair and duplicate share rejection;
- made allocation transaction evidence referentially consistent with the
  settlement record's canonical transaction set;
- suspended snapshot timers and event watches while the live workspace or page
  is not visible, with one immediate refresh on return;
- retained submitted-transaction receipt waiting outside that visibility gate;
- replaced individual snapshot reads with two `allowFailure: false` Multicall3
  waves at one pinned block;
- derived the client expiry decision from the timestamp returned by the first
  pinned Multicall wave rather than the device clock;
- added 12,000 reproducibly generated TypeScript invariant fixtures and 40
  curated or seeded Solidity-versus-TypeScript differential fixtures; and
- bounded HTTP JSON-RPC batches to 64 requests with a 10 ms collection window
  and Multicall calldata to 65,536 bytes.

The differential suite maps each integer pence unit to one abstract contract
unit solely to compare algorithms. It checks exact share ownership and value,
remainder and tip dust, participant dues, sponsorship, payer contributions,
funding state and settlement eligibility. It does not test live FX conversion or
assert economic equivalence between pence and wei.

## Verification

| Check | Result |
| --- | --- |
| Maximum-shape 32-approval benchmark | 23,399,360 → 2,612,286 gas; 88.84% reduction |
| Later maximum-shape approval | 731,230 → 59,852 gas; 91.81% reduction |
| Canonical public digest after cache population | Unchanged |
| Mutation, stale-input and failed-first-approval regressions | Passed |
| Full Hardhat suite | 61 passed, 0 failed |
| Full web/server suite after follow-on changes | 185 passed, 0 failed |
| Multi-viewport Playwright suite | 24 passed, 0 failed |
| Deterministic generated model fixtures | 12,000 passed across three seeds |
| Solidity-versus-TypeScript differential fixtures | 40 passed: 8 curated and 32 seeded |
| Exact claim-key and evidence-membership regressions | Passed |
| Inactive polling, two-wave snapshot and chain-time expiry regressions | Passed |
| Live Monad Testnet pinned Multicall3 timestamp smoke test | Snapshot and block timestamps matched |
| Runtime bytecode | 18,682 bytes; 5,894 below EIP-170 |

## Evidence base

- Michie's original [memo-functions paper](https://www.nature.com/articles/218019a0.pdf)
  describes retaining function results for reuse; TapTab adds an explicit split
  version because invalidation is the critical part of applying that technique
  to mutable contract state.
- [Solidity storage layout](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html)
  explains slot packing and the need to treat layout changes deliberately.
- [Solidity security guidance](https://docs.soliditylang.org/en/latest/security-considerations.html)
  supports bounded loops and checks-effects-interactions for value transfers.
- [EIP-2929](https://eips.ethereum.org/EIPS/eip-2929) and
  [EIP-2200](https://eips.ethereum.org/EIPS/eip-2200) define the storage access
  and write costs behind the measured cache trade-off.
- [ECMAScript keyed collections](https://tc39.es/ecma262/2023/multipage/keyed-collections.html)
  specify exact `Map` keys and require average sublinear access.
- Hoare's [selection algorithm](https://doi.org/10.1145/366622.366647) offers a
  linear-time route to a median, but the contract's limit of 32 votes makes the
  existing full sort easier to audit and already inexpensive.
- Balinski and Young's [apportionment analysis](https://doi.org/10.1287/moor.4.1.31)
  provides the formal backdrop for quota and remainder methods. TapTab retains
  its bounded largest-remainder conversion because generated tests conserve the
  exact total and no better project-specific fairness result was demonstrated.
- [Viem Multicall](https://viem.sh/docs/contract/multicall) and
  [Viem public-client batching](https://viem.sh/docs/clients/public) document the
  two distinct batching options considered for the live reader.
- [Monad application guidance](https://docs.monad.xyz/developer-essentials/best-practices)
  recommends concurrent calls, JSON-RPC batches, Multicall3 and indexers.
- [Monad real-time data guidance](https://docs.monad.xyz/monad-arch/realtime-data/data-sources)
  distinguishes WebSocket subscriptions from repeated polling and supports the
  longer-term event-reader recommendation.
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712),
  [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) and
  [EIP-4337](https://eips.ethereum.org/EIPS/eip-4337) define the standards behind
  the offchain-approval research bet.
- [OpenZeppelin cryptography utilities](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography)
  provide reviewed EIP-712, signature-checking and Merkle-proof primitives for
  a future prototype.

The benchmark figures in this report are local comparative measurements, not
Monad Testnet fee forecasts. Items explicitly labelled implemented are complete;
the remaining tier entries are researched follow-ups, not implementation claims.

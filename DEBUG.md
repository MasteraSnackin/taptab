# TapTab Debug Report

> **Historical checkpoint:** this report records the 6 August defect pass. See
> [docs/MARKDOWN_TASK_COMPLETION.md](docs/MARKDOWN_TASK_COMPLETION.md) for the
> current locally verified state and the explicit public-deployment boundary.

**Date:** 6 August 2026
**Target:** local TapTab prototype at `http://localhost:3000/`
**Outcome:** seven confirmed defects fixed; automated and browser checks pass

## 1. Problem intake

No error message, stack trace or single failing journey was supplied with the
debugging specification. The task therefore began as defect discovery rather
than as confirmation of a reported incident.

The expected behaviour was derived from the product itself:

- a visible bill, its amounts and every enabled write must belong to the same
  trusted contract-and-bill context;
- a sample user must be able to sponsor successive diners;
- sample and live workspace controls must not contradict their selected mode;
- invalid receipt edits must be rejected before they reach split calculation;
- quote provenance must agree with its exact GBP/MON arithmetic;
- valid custom tips must agree with native browser validation; and
- Stage mode must remain inside compact viewports.

The investigation covered the sample split, receipt import, navigation, live
state reads, transaction preparation, GBP metadata, Stage mode, responsive CSS,
recent Git history and relevant automated tests.

## 2. Environment and scope

| Area | Evidence |
| --- | --- |
| Application | Next.js/React client built through Vinext |
| Browser | Integrated browser against `localhost:3000` |
| Chain target | Monad Testnet, chain ID 10143 |
| Local live configuration | Absent |
| Wallet-connected live run | Not available |
| Reproduction scope | Sample defects were consistent; the cross-bill race was environment-specific but statically confirmed |

Recent history was inspected:

- `ad27ef8` — initial group-purchase prototype;
- `699c2d4` — GBP/USD price estimates; and
- `776bd3a` — documentation and local quality audit.

Most TapTab implementation files are currently uncommitted, so the defects
cannot be responsibly attributed to one historical commit.

## 3. Ranked hypotheses

### Hypothesis 1 — live state was not scoped to a bill

**Probability before investigation:** high
**Impact:** critical
**Result:** confirmed

`TapTabLivePanel` retained a single snapshot, event list and transaction list
while the trusted URL context could change independently. An older asynchronous
read could also finish after a newer bill was selected.

The unsafe execution path was:

1. Bill A loaded and populated its participant and remaining-due snapshot.
2. Navigation changed the trusted context to bill B.
3. The trust strip immediately displayed bill B, while controls could still
   read bill A's snapshot.
4. A funding write could therefore be constructed with bill B's context and
   bill A's beneficiary or amount.
5. An already-started bill A submission could continue towards the wallet after
   the UI had moved to bill B.
6. Bill A events, confirmation proof or receipt metadata could also appear in
   bill B's presentation.

This was not caught by the existing source-oriented tests.

### Hypothesis 2 — derived controls retained stale selections or accepted invalid boundaries

**Probability before investigation:** high
**Impact:** high to medium
**Result:** confirmed in four places

- After one sponsorship, the filtered dropdown visually selected the next
  diner while its controlled value still referenced the paid diner. The visible
  `Cover share` button was therefore disabled.
- A £0.01 receipt row could be assigned two shares. The editor accepted it, but
  the split model correctly threw because it cannot allocate a non-zero penny
  to both shares.
- The custom-tip input declared `step="0.25"`, while application logic accepted
  hundredth-of-a-percent values such as 12.34%. The browser marked the accepted
  value invalid.
- Quote metadata was syntax-checked but its declared GBP/MON rate was not
  reconciled to its declared subtotal in wei.

### Hypothesis 3 — hash navigation and compact Stage layout conflicted with UI state

**Probability before investigation:** medium
**Impact:** medium to low
**Result:** confirmed

- The header set live mode, then its `#bill` navigation triggered a location
  synchroniser that derived preview mode from the query string and reverted the
  choice.
- Live sharing silently fell back to the sample URL when no validated live bill
  URL existed.
- Stage mode could prefer a hidden live snapshot even while the sample workspace
  was selected.
- At 320 CSS pixels, the Stage grid calculated a 323.297-pixel track and clipped
  the excess.

## 4. Root causes and fixes

### 4.1 Bill-context isolation

Changed `app/TapTabLivePanel.tsx`:

- snapshots are usable only when both contract address and bill ID match the
  current trusted context;
- events and wallet transactions are stored and selected by a canonical
  contract-and-bill scope;
- receipt metadata has the same scope;
- every refresh has a scoped sequence ID, so an obsolete read cannot commit;
- a new bill may refresh even while the previous bill's read is still pending;
- the transaction pipeline rechecks its bill scope after asynchronous
  boundaries and immediately before `writeContract`;
- parent callbacks receive no stale snapshot, proof, metadata or share URL; and
- hash-only changes are observed by the live payment-link focus logic.

The transaction guard fails closed with: `The bill changed before submission.
Nothing was submitted.`

### 4.2 Successive sponsorship

Changed `app/TapTabApp.tsx`:

- the active sponsor is derived from the still-unpaid participant list;
- if the stored selection is no longer eligible, the first eligible diner is
  selected in state and behaviour, not only by the browser's visual fallback;
- the button uses that same derived ID; and
- the terminal state explicitly says `Everyone else is covered`.

This is a derived-state correction rather than a refactor of payment logic.

### 4.3 Receipt boundary

Changed `app/ReceiptImportPanel.tsx`:

- a row is rejected when `shareSlots > pricePence`;
- the Apply action remains disabled; and
- the editor explains that a row cannot have more equal shares than pennies in
  its price.

The invalid draft no longer reaches `calculateTapTabPreview`.

### 4.4 Workspace, sharing and Stage mode

Changed `app/TapTabApp.tsx` and `app/globals.css`:

- workspace links prevent the native fragment transition from overwriting their
  state, update the fragment without firing a conflicting navigation event and
  scroll to the workspace;
- reset removes a personalised preview `pay` parameter;
- a live Share action stays disabled until a validated live snapshot produces a
  trusted live URL;
- Stage mode uses live data only while the live workspace is selected;
- Stage uses a `minmax(0, 1fr)` column with shrinkable children and wrapping
  status content; and
- preview custom tips now use a 0.01% step, matching the accepted basis-point
  precision and the live control.

### 4.5 Quote provenance

Changed `app/taptab-live-helpers.ts`:

- a parsed GBP/MON quote is recomputed with the same exact integer conversion
  used to create a bill; and
- contradictory quote provenance is ignored rather than labelled as a locked
  rate.

The public receipt subtotal remains creator-supplied metadata. The fix prevents
an internally contradictory rate from being presented as evidence; it does not
claim an onchain oracle.

### 4.6 Bill-wide GBP penny conservation

Changed `app/taptab-live-helpers.ts`, `app/TapTabLivePanel.tsx` and
`app/TapTabApp.tsx` in the 7 August follow-up:

- one shared largest-remainder allocator now resolves equal remainders in stable
  bill-row order and rejects duplicate keys, negative values and unsafe targets;
- grouped live receipt rows allocate against the exact metadata subtotal;
- participant base and tip pennies are allocated as separate bill-wide ledgers,
  then combined for grouped participant due displays and venue exports; and
- each allocated GBP primary keeps the unchanged native MON amount as its
  secondary value.

This resolves the previously recorded independent-rounding risk. Funded and
remaining values were not added to the conservation ledger because preserving
both their bill-wide and per-participant identities requires a joint bounded
allocation, not an independent rounding claim.

## 5. Browser evidence

The integrated browser captured screenshots and semantic DOM/runtime evidence.
The captures were returned in the debugging session; they were not written into
the repository.

### Before

- Funding was 16% complete after Theo was sponsored.
- The sponsor dropdown visibly showed `Amina · £14.18`.
- `Cover share` was disabled because component state still referenced Theo.
- Clicking the header's `Monad Testnet` link ended at `#bill` with `Sample bill`
  still selected.

### After

- Sponsoring Theo advanced to Amina with `Cover share` enabled.
- Sponsoring Amina advanced to Jules with the button still enabled.
- After every other diner was covered, the control displayed `Everyone else is
  covered`; paying the current user's remainder enabled exact settlement.
- The settlement completed and `Bill settled together` appeared.
- Header navigation selected the live workspace, exposed the honest unconfigured
  Testnet panel and disabled live sharing.
- A £0.01/two-share row produced an inline validation message, disabled Apply
  and caused no runtime error.
- A 12.34% custom tip reported native input validity `true`, no step mismatch and
  no validation message.
- Responsive inspection found no root overflow at 1440×900, 375×812, 320×568 or
  812×375 after the Stage constraint was corrected.
- No application-origin console errors were present in the verified journeys.

No video artifact was produced. The integrated run supplied screenshots, DOM
snapshots and console evidence; a recording interface was not used.

## 6. Verification

| Command/check | Result |
| --- | --- |
| `git diff --check` | Passed |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm test` | Production build passed; 185/185 web and server tests passed |
| `npm run test:e2e` | 18/18 desktop, tablet and mobile browser tests passed |
| `npm test --prefix contracts` | 61/61 contract tests passed |
| Browser sponsorship journey | Passed through repeated sponsorship and exact settlement |
| Browser workspace journey | Passed in both directions |
| Browser invalid-receipt journey | Rejected before render; no console error |
| Browser custom-tip validity | 12.34% valid with 0.01% step |
| Dedicated GBP allocation tests | 8/8 passed, including 12,000 deterministic generated ledgers and sponsorship edge cases |

New regression assertions cover sponsor selection, workspace/share/Stage mode,
the receipt boundary, compact Stage constraints, quote arithmetic, bill-scoped
live state and transaction-scope rechecks.

## 7. Remaining risks

These are not represented as fixed or verified:

- A deterministic two-bill browser fixture now proves that a delayed Bill A
  snapshot cannot replace Bill B, and a controlled EIP-6963 wallet proves that
  an account change during exact-action preflight cannot reach any signing or
  transaction method. This remains controlled local evidence, not a funded
  wallet run of the current frontend on Monad Testnet.
- No physical-device, screen-reader or real wallet-provider matrix was run.
- Passing tests do not make the contracts audited or production-ready.

## 8. Preventive measures

1. Completed 7 August: the browser fixture delays bill A, selects bill B, then
   resolves A and proves only B remains exposed.
2. Completed 7 August: the controlled wallet changes account during preflight
   and proves that no signing or transaction method is called.
3. Completed: browser coverage exercises repeated sponsorship, canonical
   workspace links and receipt-editor rejection boundaries.
4. Retain deterministic conservation tests whenever grouped live GBP ledgers or
   their ordering rules change.
5. Bills `3` and `4` provide sealed separate-wallet Testnet settlement and
   refund evidence for public source checkpoint `27ecdb4`; repeat the funded
   wallet rehearsal after the current frontend is redeployed.

## 9. Final assessment

The locally reproducible defects are fixed and the available test suite is
green. The most serious class of issue—mixing data or actions between two live
bills—now fails closed at display, refresh, evidence and pre-submission
boundaries. Live Monad verification remains a release gate, not an inferred
success.

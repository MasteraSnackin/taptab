# TapTab error-handling review

> **Historical checkpoint:** this report records the 6 August error-handling
> pass. See [docs/MARKDOWN_TASK_COMPLETION.md](docs/MARKDOWN_TASK_COMPLETION.md)
> for the later transaction, OCR, sharing, RPC and browser-assurance work.

Status: completed on 6 August 2026
Scope: TapTab web application, Monad Testnet reads and writes, receipt OCR, MON pricing, wallet onboarding and PWA behaviour
Source task: `3)ERRORHANDING.md`
Note: this filename retains the spelling used by the supplied task.

## Outcome

TapTab now treats errors according to whether an action is recoverable, optional, rejected before submission, submitted with an unknown result, or confirmed as failed. The most important change is that a transaction with a hash is no longer presented as an ordinary retryable error when receipt confirmation is temporarily unavailable.

The implementation follows four rules:

1. Validate and simulate before opening the wallet.
2. Never claim that nothing happened after a transaction hash exists.
3. Keep verified onchain state visible when an optional service fails.
4. Give the user one concrete recovery action and keep diagnostic detail out of the interface.

## Error taxonomy

| Category | Examples | User-facing behaviour | Retry policy |
| --- | --- | --- | --- |
| Input or configuration error | Invalid address, stale quote, unsupported receipt, missing deployment | Block early with a specific correction | Retry only after the input changes |
| Expected user cancellation | Wallet request rejected with provider code `4001`; share sheet cancelled | Explain that nothing was submitted, or return to the idle share state | Immediate manual retry is safe |
| Pre-submission chain rejection | Failed exact simulation, wrong chain, insufficient buffered balance | State that nothing was submitted | Retry after the stated cause is corrected |
| Transient read failure | RPC timeout, price endpoint failure, event-log failure, metadata timeout | Preserve the last verified state or fall back to native MON/manual entry | Bounded automatic retry with backoff; manual retry where useful |
| Submitted, status unknown | Wallet returned a transaction hash but receipt confirmation failed | Preserve the hash, block duplicate actions and offer status reconciliation | Do not resubmit until MonadVision or a receipt check establishes the result |
| Confirmed revert | Monad receipt has reverted status | State that no TapTab state changed | A new attempt is safe after correcting the cause |
| Optional capability failure | Clipboard, native share, install prompt, service-worker cache | Keep the core bill usable and show a visible fallback | Manual retry or browser fallback |
| Unexpected render failure | React route subtree throws | Show the TapTab recovery boundary, Retry and sample-mode escape | Retry the route; check wallet and explorer before repeating a write |

## Boundary decisions

TapTab uses discriminated state unions for recoverable UI outcomes and exceptions at library boundaries. This keeps ordinary states such as `unverified`, `reverted`, `invalid` and `error` explicit without building a large custom exception hierarchy.

| Boundary | Required success evidence | Failure state | Fallback or recovery |
| --- | --- | --- | --- |
| Create bill | Successful receipt plus the exact trusted `BillCreated` event | Preflight blocked, wallet failed, unverified or reverted | Recheck the retained hash; reset only after MonadVision shows failure |
| Live contract action | Successful receipt for the retained hash | Blocked, wallet failed, unverified or reverted | Recheck status; all state-changing controls stay locked while unknown |
| Public Monad RPC | Correct chain and validated contract reads | Read error | 10-second transport timeout and two read retries |
| Event history | Decodable logs for the exact trusted bill | Feed delayed | Keep the current snapshot live and retry logs after 15 seconds |
| GBP receipt metadata | HTTPS or bounded data URI that passes schema and bill arithmetic validation | Absent, invalid or temporarily unreachable | Keep native MON visible; retry only a temporary network failure |
| MON reference price | Valid, current CoinGecko USD and GBP response | Stale or unavailable | Retain the last good quote as stale; manual acknowledged quote remains available for bill creation |
| Receipt OCR | Current request generation completes inside 60 seconds | Cancelled, timed out or unreadable | Terminate safely; preserve existing rows; allow sample or manual entry |
| Reown wallet | AppKit initialises and exposes an EIP-1193 provider | Unconfigured, invalid or runtime error | Show the actual setup message and retry initialisation |
| Share or clipboard | Native share or clipboard confirms success | Cancelled, failed or unavailable | Show a visible instruction to copy from the address bar |
| Static asset cache | Cache hit or successful network response | Cache storage/read/write failure | Return the network response; caching remains best-effort |
| React route | Client subtree renders | Unexpected exception | Route Retry and `/#bill` sample-mode link |

## Implemented changes

### Transaction safety

- Added typed messages for preflight failure, wallet rejection and post-submission uncertainty in `app/taptab-transaction-preflight.ts`.
- Added synchronous submission locks so two same-tick interactions cannot open duplicate wallet requests.
- Recheck the bill scope, account and provider after asynchronous boundaries and immediately before a write.
- Repeat `wallet_switchEthereumChain` after adding Monad Testnet and validate `eth_chainId` as an exact hexadecimal value.
- Keep the transaction hash and submitted intent when confirmation is unknown.
- Added `Check status again` recovery for bill creation and live actions.
- Treat a confirmed revert separately from a receipt timeout. Only a confirmed revert becomes safely retryable automatically.
- Keep every live state-changing control disabled while any transaction is pending or unverified.
- Deduplicate synthetic confirmation entries once the canonical chain log is available.
- Let the wallet provide the gas quote when optional gas, fee or balance estimates are unavailable; exact contract simulation remains mandatory.

### Read resilience and graceful degradation

- Configured public Monad reads with a 10-second HTTP timeout and two retries. Wallet writes use a separate transport and are never automatically retried.
- Coalesced live refreshes into one in-flight request per bill.
- Separated event-log failure from snapshot failure. A log error delays the activity feed but does not relabel a valid bill snapshot as unavailable.
- Added a 15-second event-log backoff and retained manual refresh.
- Added a 10-second browser timeout, full response validation, exponential backoff and up to five seconds of jitter to MON price polling.
- Retained the last good browser quote as stale instead of discarding it after a later failure.
- Added `Retry-After` to a price API `503`; the existing server route already had an eight-second upstream timeout, request de-duplication, bounded rate-limit backoff and a last-good stale cache.
- External receipt metadata now omits credentials and referrer data, rejects oversized `Content-Length` values and stops streaming after 64 KiB.
- Metadata states distinguish no metadata, invalid metadata and a temporary fetch failure. Only the temporary failure offers a retry.

### Asynchronous cleanup

- Receipt OCR has a monotonically increasing request generation. Results and logger callbacks from obsolete scans are ignored.
- Reset, sample load, cancellation, a new scan and component unmount invalidate the active request.
- A 60-second watchdog terminates a stalled worker and provides a manual-entry recovery message.
- Worker termination is best-effort cleanup and cannot replace a successful or failed scan result with an unhandled rejection.
- Receipt editing and applying are disabled while OCR owns the draft; the user can cancel, load the sample or reset safely.
- Object URLs, timers, subscriptions and abort controllers are cleaned up by their owning effects.

### Wallet, sharing and PWA failures

- Reown initialisation failure no longer masquerades as missing environment configuration.
- The actual wallet setup message is shown in an alert with `Retry wallet setup` when runtime initialisation fails.
- Disconnect rejection is caught; the existing account is preserved and the user receives a clear recovery message.
- Clipboard failures in preview and live mode are visible rather than silently clearing a success badge.
- Native sharing falls back to clipboard; if both fail, TapTab tells the user to copy from the address bar.
- Install-prompt and service-worker failures are surfaced without blocking online bill use.
- Static cache open, read, write and cleanup failures are best-effort. A successful network asset response is returned even when it cannot be cached.
- The cache generation advanced to `taptab-static-v2`; activation removes older TapTab cache generations without touching other applications.

### Unexpected application errors

- Added `app/error.tsx` as an accessible route-level recovery boundary.
- It renders a stable TapTab message, Retry and sample-mode link without exposing the thrown error in the page.
- It warns users to check MonadVision and their wallet before repeating a submitted transaction.
- Developer logging is limited to the error message and framework digest; the stack and arbitrary error object are not logged by the boundary.

## Retry and fallback policy

| Operation | Timeout | Automatic retry | Backoff | Last-known-good behaviour |
| --- | ---: | ---: | ---: | --- |
| CoinGecko server request | 8 seconds | Next route request after gate | At least 15 seconds; upstream `Retry-After` capped at 5 minutes | Serve a usable quote as stale |
| Browser MON price poll | 10 seconds | Yes | 30–120 seconds plus 0–5 seconds jitter | Mark the retained quote stale |
| Public Monad RPC transport | 10 seconds per attempt | Two retries | viem transport policy | Existing UI snapshot stays visible |
| Live event history | RPC transport bound | Yes | 15 seconds | Snapshot remains live; feed marked delayed |
| Receipt metadata | 5 seconds | Manual | Retry button | Native MON remains authoritative |
| Receipt OCR | 60 seconds | No | Manual retry | Existing receipt rows remain editable |
| Wallet transaction | Wallet-controlled | Never after hash | Explicit reconciliation | Hash and explorer link remain visible |
| Static asset cache | Browser-controlled | Next request or activation | None | Use successful network response |

Automatic retry is restricted to idempotent reads and cache work. TapTab does not automatically retry a wallet write.

## Messages and diagnostics

User-facing messages answer three questions:

- What happened?
- Was anything submitted?
- What is the safe next action?

Raw RPC payloads, stack traces, wallet internals and arbitrary upstream response bodies are not rendered. Expected user actions such as cancelling a share sheet do not create noisy error alerts. Unexpected route failures emit one concise console record.

## Verification

Completed gates:

- Production Vinext build: passed.
- Web and server tests: 185 passed, 0 failed.
- Playwright browser tests: 24 passed, 0 failed across desktop, tablet and mobile.
- Solidity/Hardhat tests: 61 passed, 0 failed.
- Combined automated tests: 256 passed, 0 failed.
- ESLint: passed.
- TypeScript `tsc --noEmit`: passed.
- `git diff --check`: passed.
- Browser smoke check at `http://localhost:3000/?preview=table-7#bill`: TapTab rendered, the receipt editor and sample fallback operated, and the browser reported no warning- or error-level console entries.

Focused error-path coverage includes:

- submitted-but-unverified transaction locks and reconciliation;
- exact wallet/account/bill intent guards;
- OCR cancellation, timeout and stale-result prevention;
- route error-boundary accessibility and diagnostic privacy;
- public RPC timeout/retry configuration;
- price `503` and stale-quote behaviour;
- metadata size/privacy guards and retry state;
- wallet retry and disconnect handling;
- share/copy/install visibility;
- service-worker cache open, read, write and old-cache deletion failures.

## Known limits

The following points are stated rather than hidden:

1. No deployed TapTab contract address, bill ID, Reown project ID or funded test wallet is configured in this workspace. A real wallet submission and live Monad Testnet receipt-reconciliation run could not be completed here.
2. Pending transaction intent is stored locally only after a wallet returns a hash, scoped to the exact chain, contract, bill and wallet. It is rechecked once after refresh and deliberately does not authorise an automatic resubmission.
3. The explicit reset for an unverified bill-creation transaction relies on the user first confirming failure in MonadVision. The safer in-app action is `Check status again`.
4. Tesseract worker, WebAssembly core and English language data still use the library's first-use delivery defaults. Manual entry and the bundled sample are available if venue networking blocks those assets; fully self-hosting the OCR assets remains future work.
5. `app/error.tsx` covers the route subtree. A failure in the root layout itself would require a separate `global-error.tsx` boundary.
6. Testnet MON is not redeemable cash. GBP and USD values remain labelled mainnet MON references and are not presented as a Testnet exchange rate.

## Recommended live-test checklist

Before the hackathon demo:

1. Configure the deployed TapTab address, bill ID, public HTTPS site URL and Reown project ID.
2. Connect two funded Monad Testnet wallets and confirm the exact chain ID `10143`.
3. Submit one action, interrupt receipt polling after the wallet returns its hash, and confirm that all writes remain locked.
4. Restore RPC access, use `Check status again`, and verify that the original receipt resolves without a second write.
5. Test a confirmed revert and verify that the interface states no TapTab change occurred.
6. Deny clipboard permission and confirm that the address-bar fallback is visible.
7. Throttle or block receipt metadata and OCR asset requests and confirm that native MON/manual entry remain usable.
8. Run the same flow on the venue network and one mobile wallet before the pitch.

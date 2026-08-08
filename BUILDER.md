# TapTab Builder Report

> **Historical checkpoint:** this report records the 6 August operational pass.
> See [docs/MARKDOWN_TASK_COMPLETION.md](docs/MARKDOWN_TASK_COMPLETION.md) for
> current deployment evidence, RPC fallback behaviour and verification totals.

**Status:** Complete — operational readiness delivered
**Completed:** 6 August 2026
**Scope:** API routes, server-side health logic and Worker configuration

## Outcome

TapTab now exposes two no-store operational endpoints: a dependency-free
liveness check and a bounded readiness check for its configured Monad Testnet
bill. The readiness path verifies configuration, RPC access, chain identity,
deployed contract bytecode and the configured bill before reporting the service
as ready.

This work does not claim that the current local prototype is Testnet-ready. With
no deployed contract address and bill ID configured, the local readiness route
correctly returns HTTP 503 with `configuration_missing`. It will return HTTP 200
only when every required check passes.

## Scope decision

The plan did not name a separate next product feature. Its next operational gate
was a reviewer-accessible deployment backed by a real Monad Testnet contract, so
the Builder task addressed the missing deployment-health capability rather than
inventing storage, indexing or receipt-processing infrastructure.

No Modal service was added. The repository has no selected Modal workload,
credentials or configuration, and moving receipt OCR to a server would reverse
the documented local-only privacy model without decisions on consent,
authentication, retention and rate limiting.

## Endpoints

### `GET /api/health/live`

- Returns HTTP 200 when the Worker can execute the route.
- Does not call Monad or depend on deployment configuration.
- Returns `status`, `service`, `checkedAt` and a request correlation ID.
- Sets `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

### `GET /api/health/ready`

- Resolves and validates the configured contract address and bill ID.
- Accepts only a credential-free HTTPS RPC URL; the default is Monad's canonical
  Testnet RPC endpoint.
- Uses one five-second budget with provider retries disabled.
- Confirms chain ID 10143 and obtains the current block number.
- Requires non-empty bytecode at the configured contract address.
- Reads the exact configured bill and validates its identity, creator, payee,
  timestamps and positive subtotal.
- Returns HTTP 200 only after all checks pass.
- Returns HTTP 503, `Retry-After: 10` and a stable reason code when a check fails.
- Does not expose the RPC URL, credentials or raw provider errors.

The failure reasons are deliberately machine-readable:

- `configuration_missing`
- `configuration_invalid`
- `rpc_url_invalid`
- `rpc_unavailable`
- `probe_timeout`
- `wrong_network`
- `contract_unavailable`
- `contract_not_deployed`
- `bill_unavailable`
- `bill_invalid`

## Engine design

The reusable readiness engine lives outside the route handler and receives an
injected probe. This keeps network behaviour deterministic in tests and lets the
route remain a thin HTTP adapter.

Checks fail closed and later checks are skipped after a prerequisite fails. A
single time budget covers the whole probe, so several individually valid calls
cannot extend readiness indefinitely. The configured bill is checked rather
than accepting any responding contract, which prevents a healthy RPC or
unrelated deployment from producing a false-ready result.

## Files changed

- `lib/server/taptab-readiness.ts` — shared readiness policy and bounded probe.
- `app/api/health/live/route.ts` — liveness endpoint.
- `app/api/health/ready/route.ts` — Monad Testnet readiness endpoint.
- `tests/health-routes.test.mjs` — endpoint, failure-mode and production-Worker
  coverage.
- `worker/index.ts` — removed a stale database binding declaration; no D1
  binding exists in the hosting configuration.
- `.env.example` — documented the optional server-only RPC override.
- `README.md` and `ARCHITECTURE.md` — documented the endpoint contracts and
  operational boundary.
- `PLAN.md` — records the completed capability and current test total.

## Verification

| Check | Result |
| --- | --- |
| Production Vinext build | Passed; all three API routes and the application route were emitted |
| Web and server tests | 185 passed, including the health-route coverage |
| Playwright browser tests | 24 passed across desktop, tablet and mobile |
| Contract tests | 61 passed |
| ESLint | Passed |
| TypeScript `--noEmit` | Passed |
| Local liveness request | HTTP 200 with matching body/header request ID |
| Local readiness request | HTTP 503 `configuration_missing`, as expected without deployment settings |
| Production Worker liveness test | Passed |

The canonical Monad Testnet endpoint independently reported chain ID 10143 on
6 August 2026. Monad's official references document the Testnet network and
JSON-RPC surface: [network changelog](https://docs.monad.xyz/developer-essentials/changelog)
and [JSON-RPC API](https://docs.monad.xyz/reference/json-rpc/api).

## Deferred work

- Connect the health endpoints to an external uptime monitor and define an SLO.
- Configure the public origin, wallet project, deployed contract and bill before
  treating readiness as a release signal.
- If live bill reads create unacceptable browser RPC fan-out, add a
  block-consistent snapshot endpoint with explicit caching and rate limits.
- Consider server-side OCR only after its privacy, consent, authentication,
  retention and abuse-control contract is approved.

The Builder lane is complete. No CSS, layout or presentation behaviour was
changed by this task.

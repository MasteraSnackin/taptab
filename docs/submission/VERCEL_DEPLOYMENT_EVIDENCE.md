# Vercel deployment and Monad Testnet evidence

## Current public deployment

- Stable application: <https://taptab-eosin.vercel.app/>
- Canonical Bill 2: <https://taptab-eosin.vercel.app/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live>
- Readiness: <https://taptab-eosin.vercel.app/api/health/ready>
- Vercel deployment: `dpl_oPsQP2xuZNZnYPoYVpZ59JCttate`
- Immutable deployment URL: <https://taptab-ev5yn58i0-mythicmindlabs.vercel.app>
- Vercel status at inspection: `Ready`
- Deployment created: 8 August 2026 at 14:15:47 BST

The Vercel deployment was built from the local working tree and the application
source, Vercel configuration and video release were subsequently preserved in
public Git commit `bcac3ecb2250112c0f20b9b8925d34120987269e`. The Vercel
deployment ID above remains the exact hosting-release identifier.

## Public readiness result

After the final manifest repair was deployed, the public readiness route
returned HTTP `200` at `2026-08-08T13:16:34.674Z`:

```json
{
  "status": "ready",
  "checks": {
    "configuration": "pass",
    "rpc": "pass",
    "network": "pass",
    "contract": "pass",
    "bill": "pass"
  },
  "network": {
    "chainId": 10143,
    "blockNumber": "51961837"
  },
  "service": "taptab",
  "checkedAt": "2026-08-08T13:16:34.674Z",
  "durationMs": 193
}
```

This proves that the deployed application could reach Monad Testnet, confirm
chain `10143`, find bytecode at the trusted TapTab address and read canonical
Bill `2` at that time. It is read-path evidence, not a new wallet transaction.

## Independent contract read

The repository's read-only deployment check also passed against the public
Monad Testnet RPC:

```text
Monad Testnet RPC is reachable.
Chain ID: 10143
Latest block: 51960326
TapTab contract: 0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198
Bill ID: 2
Bill subtotal: 3.157527415150402471 MON
Live deployment validation passed.
```

## Historical write evidence

The video uses Bill `3`'s retained settlement transaction as public write
evidence:

- Transaction: <https://testnet.monadscan.com/tx/0xc232584b63ad27e7aa53b2526a2bcf8ebb6765bd8657cc804b7e76ec48e6d885>
- RPC receipt status: `0x1` (`Success`)
- Contract: `0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`
- Bill: `3`

It is explicitly labelled as a historical receipt. No fresh Testnet write was
broadcast for the deployment or video check.

## Local verification

On 8 August 2026 the application build and Node test suite completed with
`223/223` tests passing. The Hardhat contract suite completed with `89/89`
tests passing.

The installed-app manifest was also checked after deployment. It now advertises
only `/favicon.svg`, and both the manifest and that icon return HTTP `200`.

## Remaining browser boundary

The automated browser controller was blocked by an administrator policy, so a
fresh signed-wallet journey on the Vercel hostname was not recorded. The video
therefore proves the deployed read connection and shows genuine historical
write receipts without claiming a new wallet signature.

# TapTab legacy boundary

TapTab is the active product in this repository. The root route renders
`app/TapTabApp.tsx`; the focused payment route renders
`app/TapTabPaymentRoute.tsx`; and both routes use the TapTab-named wallet
provider, hook and types exported through `app/wallet/TapTabWalletProvider.tsx`.
The active contract is `contracts/src/TapTab.sol`.

## Retained compatibility surface

Several files belong to an earlier group-purchase prototype and are not
imported by either active route. They are limited to the archived application,
its chain and storage helpers, a historical wallet-provider filename, a legacy
Solidity contract, its deployment scripts and focused tests.

Their focused tests remain in the repository as regression evidence for that
retained code. Legacy deployment scripts must not be used as TapTab deployment
evidence.

The retained wallet provider keeps its historical filename so existing imports
and source-level regression tests do not break. Its canonical API is now
`TapTabWalletProvider`, `useTapTabWallet`, `TapTabWallet` and
`TapTabWalletStatus`. Legacy-named exports are compatibility aliases used only
by the archived application. New TapTab code must import the TapTab names
through `app/wallet/TapTabWalletProvider.tsx` or `app/wallet/index.ts`.

## Why the legacy files remain

Removing the old application and contract is a separate destructive migration:
it changes historical tests, package scripts and potentially deployment
workflows. Keeping it behind an explicit boundary avoids mixing that deletion
with the TapTab hackathon implementation. It does not make the legacy prototype
part of the TapTab judging claim or the supported user journey.

Before a public production release, remove the legacy files and scripts in a
dedicated change, update package metadata and contract documentation, then prove
that a clean install still passes the TapTab-only test and build gates.

## Evidence boundary

This boundary is local code organisation only. It does not claim a Monad Testnet
deployment, source verification, public hosting, wallet rehearsal, independent
security audit or hackathon eligibility ruling.

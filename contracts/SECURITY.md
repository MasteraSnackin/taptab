# Contract development-tool security boundary

**Reviewed:** 7 August 2026

TapTab's Solidity source has no runtime npm dependency. The packages in this
directory are development tools used to compile, test, rehearse and deploy the
contract; they are not shipped to a browser or executed by the deployed
contract.

## Current audit result

- `npm audit --omit=dev`: zero reported findings.
- Full `npm audit`: 21 development-tool findings — 11 low, 2 moderate and 8
  high.
- The reported automatic remediations move Hardhat and its plugins across
  major versions. They have not been applied to the judged branch because a
  forced upgrade could change compilation, deployment, verification and gas
  behaviour without adequate review.

The 7 August 2026 audit specifically proposed Hardhat `3.12.0`,
`@nomicfoundation/hardhat-ethers` `4.0.15`,
`@nomicfoundation/hardhat-chai-matchers` `3.0.0` and
`@nomicfoundation/hardhat-verify` `3.0.22`. All four cross direct dependency
major versions, and Hardhat 3 is published as an ES module while this workspace
uses a CommonJS Hardhat configuration and CommonJS deployment/rehearsal scripts.
An `npm audit fix --force --dry-run` reported a zero-finding target graph, but a
dry run does not establish that the migrated toolchain compiles, tests,
deploys or verifies the same bytecode. The release branch therefore remains a
documented no-go for the migration until the upgrade gate below is completed in
isolation.

This boundary reduces exposure; it does not make the findings disappear and it
is not a security audit of `TapTab.sol`.

## Containment rules

1. Install only from the committed lockfile with `npm ci` on a trusted build
   machine running the documented Node.js version.
2. Do not compile untrusted Solidity, JavaScript, archives or third-party
   Hardhat tasks in this workspace.
3. Keep deployment keys in the ignored, owner-only `.env` file. Never expose a
   key through a `NEXT_PUBLIC_` variable, command output, evidence file or
   browser.
4. Use the guarded local rehearsal and benchmark only on ephemeral Hardhat
   chain `31337`; both scripts refuse other networks.
5. Run `npm audit --omit=dev` and the full `npm audit` before a release. Record
   the two results separately so development-tool findings are not presented as
   deployed-contract dependencies.
6. Treat source verification, tests, invariants and gas ceilings as assurance
   evidence, not as an independent audit.

## Upgrade gate

Evaluate Hardhat 3 and compatible plugin releases in a dedicated branch. The
upgrade is acceptable only when all of the following remain true:

- a clean `npm ci` succeeds without forced audit remediation;
- compilation produces the intended Solidity `0.8.24` build;
- all contract tests, stateful invariants and differential tests pass;
- the local multi-account rehearsal passes;
- all maximum-shape gas ceilings pass or any deliberate ceiling change is
  reviewed and explained;
- Monad Testnet deployment, read-back and source-verification scripts are
  checked against disposable credentials before replacing the judged toolchain;
- the full audit result is materially improved and any remaining findings are
  recorded with their actual development/runtime scope.

Before any non-Testnet value is considered, publish the exact reviewed commit
and obtain an independent smart-contract security review. A toolchain upgrade
does not satisfy that requirement.

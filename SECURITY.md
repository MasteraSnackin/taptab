# Web dependency security boundary

**Reviewed:** 8 August 2026

TapTab is unaudited hackathon software for Monad Testnet. Dependency reports,
tests and source matching are useful assurance evidence, but none is an
independent security review.

## Current dependency result

- `npm audit --omit=dev`: zero reported findings.
- Full `npm audit`: two high-severity development-tool findings.
- Both full-audit entries are the same transitive risk path: direct development
  dependency `vinext@0.0.50` pins `image-size@2.0.2`, whose ICNS, JXL and HEIF
  parsers have reported infinite-loop denial-of-service issues.
- `image-size@2.0.2` is also the latest registry release observed during this
  review. npm's offered automatic remediation downgrades Vinext to `0.0.45`,
  which npm classifies as a major change for a `0.x` package.

The affected package is in the build toolchain, not the browser production
dependency set reported by `npm audit --omit=dev`. Receipt OCR and image-bound
validation use TapTab's browser code and Tesseract rather than Vinext's
`image-size` dependency. This scope reduces exposure; it does not erase the
reported findings.

## Containment

1. Install the committed lockfile with `npm ci` on a trusted build machine.
2. Do not add untrusted repository images or run the build over unreviewed
   assets.
3. Keep receipt uploads in the existing runtime validation path; do not route
   them through build-time image tooling.
4. Run both production-only and full audits before a release and report their
   scopes separately.
5. Do not apply `npm audit fix --force` or downgrade Vinext on the judged branch
   without running the complete compatibility gate.

## Upgrade gate

Evaluate a fixed `image-size` release or a compatible Vinext release in an
isolated branch. Accept it only when all of the following pass from a clean
install:

- production build, ESLint and strict TypeScript checks;
- all Node and five-profile Playwright tests;
- all contract tests, the local multi-account rehearsal and gas ceilings;
- Cloudflare Worker local start and deployment packaging; and
- a fresh production-only and full dependency audit.

The Solidity development-tool findings and their separate Hardhat migration
gate are documented in [contracts/SECURITY.md](contracts/SECURITY.md).

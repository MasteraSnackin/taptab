# TapTab V4 production plan

## Editorial objective

V4 answers the full-window readability concern without losing the causal demo
story. The default product composition presents the complete captured
application viewport inside a visible browser shell. A magnified detail may
appear only as a short inset while the full window remains visible beneath it.

## Composition rules

- The complete application viewport occupies the primary frame for 64.1
  seconds.
- Eight action details occupy 6.9 seconds in total; each lasts less than one
  second and never replaces the full-window context.
- Stage Mode, success, refund and comparison views remain full-screen because
  they are intentionally room-readable product surfaces rather than digital
  zooms.
- The Testnet section first shows the whole canonical Bill 2 viewport, then
  uses dedicated evidence cards for transactions and rehearsal proof.
- Captions begin at y=842 and never cover the browser viewport.

## Story and evidence

The £53.95 local sample continues to demonstrate claiming, shared items, fair
remainder, tip voting, approval, self-payment, sponsorship, protected
settlement and refunds. It remains distinct from live Testnet evidence.

The final evidence section now includes:

- canonical live Bill 2 and its creation transaction;
- Bill 3, completed by Creator, Alice and Bob with exact funding, settlement
  and payee withdrawal;
- Bill 4 cancellation and two contributor-owned refunds;
- a decoded historical `eth_call` proving `BillNotFullyFunded` before exact
  funding;
- chain `10143`, the deployed contract, 31 contract transactions and the
  Testnet-MON no-cash-value boundary.

The evidence source is
`docs/submission/monad-testnet-multiwallet-evidence.json`. V4 does not present
the 30-second data visualisation as uninterrupted wallet screen recording.

## Audio and captions

The verified V3 voice, script, timing and 31 captions are retained unchanged:
Nora — Blackpool Product Guide, Eleven Multilingual v2, natural speed. The
locally synthesised music and interface effects are also retained. The main
master remains at −16.04 LUFS-I and −2.76 dBTP.

## Additional cuts

- A 15-second social teaser uses the opening narration, full-window product
  frames, protected-outcome comparison and direct Bill 2 QR.
- A 30-second multi-wallet evidence cut visualises the sealed RPC record for
  Bills 3 and 4. It uses music only and is accompanied by a written evidence
  boundary and full transaction hashes.

## Rebuild

Run from the repository root:

```text
node docs/submission/video/2min/v4/build-v4.mjs
```

The build recreates the master, sidecar subtitles, poster, teaser, evidence
cut, probes, loudness reports, review sheets and release checksums.

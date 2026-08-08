# TapTab 2:30 delivered narration

## Release status

This file records the soundtrack in the delivered
`taptab-demo-2min30.mp4`. It supersedes the unrecorded thirteen-cue proposal
in [NARRATION.md](NARRATION.md).

The release reuses the established ElevenLabs **Nora – Blackpool Product
Guide** voice at natural speed. A replacement Nora recording was not
available. No substitute voice or time-stretching was used. Public evidence
after `01:56.210` is deliberately speech-free so judges can read it.

## Voice provenance

- Provider: ElevenLabs.
- Voice: Nora – Blackpool Product Guide.
- Model: Eleven Multilingual v2.
- Source settings: speed `1.0`, stability `0.50`, similarity `0.75`, style
  exaggeration `0`, speaker boost on.
- Seven approved source clips are retained under `audio/source/` and hashed in
  `PROVENANCE.json`.

## Final spoken cue sheet

| Time | Delivered narration | Matching picture |
| --- | --- | --- |
| `00:00.520–00:03.730` | TapTab on Monad splits restaurant bills, so nobody fronts the money. | TapTab opening card. |
| `00:07.520–00:11.570` | This £53.95 table is a clearly labelled local sample. | Complete sample desktop viewport and purple no-wallet-write label. |
| `00:11.820–00:15.850` | Diners claim whole items or selected shares of wine and starters. | Complete claim viewport, then selected-share view. |
| `00:15.850–00:17.690` | Each pound total updates instantly. | Selected-share view and current pound total. |
| `00:31.540–00:33.650` | Only volunteers share the fair remainder. | Opt-in and opt-out remainder cards. |
| `00:33.910–00:37.820` | The table votes on the tip, then every diner approves the same split. | Group tip vote. |
| `00:38.280–00:39.710` | Any change clears consent. | Approval-reset state. |
| `00:45.530–00:47.720` | Payment opens only after approval. | Four-of-four review state. |
| `00:48.140–00:50.800` | Each diner funds exactly what they owe, | Protected-funding state. |
| `00:50.800–00:54.220` | or sponsors somebody else without changing the underlying obligation. | Sponsor-a-friend state. |
| `00:54.660–00:56.850` | If £18.91 is still missing, | Incomplete funding progress. |
| `00:56.850–00:58.730` | settlement stays locked. | Locked settlement state. |
| `00:59.070–01:01.480` | Once the full £53.95 arrives, | Exactly funded sponsor state. |
| `01:01.480–01:02.990` | the venue can be paid. | Exactly funded hold. |
| `01:13.530–01:15.700` | Stage Mode turns the same live table state | Complete Stage Mode viewport. |
| `01:15.700–01:17.830` | into a room-readable progress board. | Complete Stage Mode viewport. |
| `01:23.120–01:25.250` | The contract protects both outcomes. | Exact-funded state. |
| `01:25.250–01:27.850` | Exact funding unlocks settlement. | Exact-funded state. |
| `01:28.220–01:30.850` | Cancellation or expiry pays the venue nothing, | Amber failure path with venue receipt of £0. |
| `01:30.850–01:33.500` | and opens refunds to each original contributor, | Contributor-owned refund state. |
| `01:33.500–01:35.590` | including a sponsor. | Sponsor refund disclosure. |
| `01:36.540–01:40.000` | Now switch from the £53.95 local sample | Explicit purple-to-green boundary and live Vercel card. |
| `01:40.000–01:41.460` | to live evidence. | Live Vercel card. |
| `01:41.970–01:45.800` | Bill 2 represents £48.50 on Monad Testnet, | Verified Bill 2 RPC read. |
| `01:45.800–01:47.950` | with a confirmed creation transaction. | Bill 2 creation hash and successful historical creation record. |
| `01:48.440–01:52.510` | Monad turns claims, approvals, sponsored payments and refunds | Verified Bill 2 contract-state panel. |
| `01:52.510–01:55.050` | into shared state for the whole table, | Verified Bill 2 contract-state panel. |
| `01:55.050–01:56.210` | without a central bill keeper. | Verified Bill 2 contract-state panel. |

## Speech-free evidence hold

From `01:56.210` to `02:30.000`, only the original music bed and restrained
interface sounds continue. The film displays, in sequence:

- the genuine Vercel readiness response: HTTP `200`, chain `10143`, all five
  checks passing;
- Monadscan's published source and Exact Match response;
- the retained statement `MonadVision reports · Sourcify full match`, with the
  non-audit boundary;
- Bill `3`'s genuine historical settlement receipt with status `0x1` /
  `Success`, explicitly labelled as no new write;
- the live Vercel URL, canonical Bill `2` QR, complete contract address and
  `Testnet MON has no cash value` disclosure.

The speech-free hold is intentional: it lets the public evidence remain
legible and avoids substituting a different synthetic voice.

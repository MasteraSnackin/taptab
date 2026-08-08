# TapTab two-minute demo V3 production plan

## Outcome

Produce a 1920 × 1080, 30 fps, exactly **117.000-second** H.264/AAC demo.
The V3 cut opens with TapTab and Monad, moves quickly through one coherent
£53.95 local sample, then switches explicitly to the live £48.50 Bill 2 and its
confirmed Monad Testnet evidence. The closing QR must resolve to live Bill 2,
not the site root.

The edit may show the deployed contract, the confirmed Bill 2 creation
transaction, Sourcify perfect-match verification and public readiness. It must
not imply that a real multi-wallet write, settlement or refund rehearsal has
been completed.

## Fixed 117-second editorial contract

The eight scene durations total exactly 117 seconds:

`5 + 16 + 14 + 22 + 8 + 18 + 22 + 12 = 117`.

| Final time | Duration | Scene | Required visual story |
| --- | ---: | --- | --- |
| 00:00–00:05 | 5 s | Hook | Name TapTab and Monad immediately. Show the product, one bill and the “nobody fronts the money” promise. |
| 00:05–00:21 | 16 s | £53.95 local sample | Label the state **LOCAL SAMPLE · £53.95**. Show a whole-item claim, one shared-item claim and the updated pound total. |
| 00:21–00:35 | 14 s | Agree | Compress fair remainder, tip vote and current-split approval into three clear beats. Keep named opt-in and consent visible. |
| 00:35–00:57 | 22 s | Protected funding | Show self-payment, sponsor action, £35.04 funded, £18.91 missing, settlement locked and the full £53.95 success condition. |
| 00:57–01:05 | 8 s | Stage bridge | Limit Stage Mode itself to 00:57–01:02. Use 01:02–01:05 as the transition into the successful outcome while the final Stage phrase resolves. |
| 01:05–01:23 | 18 s | Protected outcomes | Show full-screen settlement, then cancellation/expiry and contributor refund. Do not call the sample activity an onchain Testnet rehearsal. |
| 01:23–01:45 | 22 s | Live Bill 2 and Why Monad | Change the label to **LIVE MONAD TESTNET · BILL 2 · £48.50**. Show the public app reading the contract, the confirmed creation transaction and product-specific Why Monad evidence. |
| 01:45–01:57 | 12 s | Verification and CTA | Show contract address, chain 10143, Sourcify perfect match, readiness 200 OK and the canonical Bill 2 QR. End the spoken track with “Scan to open live Bill 2.” |

## Narration

Voice: **Nora – Blackpool Product Guide**, the existing ElevenLabs Voice Design
voice targeting a light Blackpool/North-West England accent. Model: **Eleven
Multilingual v2**. Speed: **1.0**. Stability: **0.50**. Similarity: **0.75**.
Style exaggeration: **0**. Speaker boost: **on**. Source exports remain at
44.1 kHz mono MP3, 128 kbps. No `atempo`, pitch shift or time stretch is used.

The clips are placed 200 ms after each editorial scene start. The 117-second
master is 48 kHz stereo, 24-bit PCM and measures −16.0 LUFS-I with a −2.7 dBFS
true peak.

| Scene | Editorial time | Measured clip | Exact narration |
| --- | --- | ---: | --- |
| 01 | 00:00–00:05 | 3.604875 s | TapTab on Monad splits restaurant bills, so nobody fronts the money. |
| 02 | 00:05–00:21 | 10.527313 s | This fifty-three pound ninety-five table is a clearly labelled local sample. Diners claim whole items or selected shares of wine and starters. Each pound total updates instantly. |
| 03 | 00:21–00:35 | 8.594250 s | Only volunteers share the fair remainder. The table votes on the tip, then every diner approves the same split. Any change clears consent. |
| 04 | 00:35–00:57 | 17.920000 s | Payment opens only after approval. Each diner funds exactly what they owe, or sponsors somebody else without changing the underlying obligation. If eighteen pounds ninety-one is still missing, settlement stays locked. Once the full fifty-three pounds ninety-five arrives, the venue can be paid. |
| 05 | 00:57–01:05 | 4.728125 s | Stage Mode turns the same live table state into a room-readable progress board. |
| 06 | 01:05–01:23 | 12.852188 s | The contract protects both outcomes. Exact funding unlocks settlement. Cancellation or expiry pays the venue nothing, and opens refunds to each original contributor, including a sponsor. |
| 07 | 01:23–01:45 | 20.088125 s | Now switch from the fifty-three pound ninety-five local sample to live evidence. Bill 2 represents forty-eight pounds fifty on Monad Testnet, with a confirmed creation transaction. Monad turns claims, approvals, sponsored payments and refunds into fast shared state for the whole table, without a central bill keeper. |
| 08 | 01:45–01:57 | 6.765688 s | The contract source has a Sourcify perfect match, and the public app is ready. Scan to open live Bill 2. |

## Why Monad treatment

Do not use a generic throughput card. Synchronise the product-specific statement
at 01:35.29–01:43.06 with a compact visual mapping:

- claims → shared table state;
- approvals → shared consent state;
- sponsored payments → attributable funding state;
- refunds → original-contributor recovery state.

The visual conclusion is: **fast shared state for the whole table, without a
central bill keeper**.

## Sample and live evidence distinction

Use persistent scope labels, not a one-frame disclaimer:

- 00:05–01:23: `LOCAL SAMPLE · £53.95 · NO WALLET WRITE`;
- 01:23–01:57: `LIVE MONAD TESTNET · BILL 2 · £48.50`.

The £53.95 sample demonstrates the interaction design and the two protected
outcomes. Bill 2 represents a separate £48.50 reference bill and supplies the
live contract-read and confirmed creation-transaction evidence. Never cut
between those values without the label changing on screen.

## Final evidence card

The final card must show:

- contract `0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`;
- chain ID `10143`;
- Bill 2 creation transaction
  `0xc089eb042dc78fb64a0ddf60ea35c5ecbe7f01ff5371b37be9a72bc872effd70`;
- Sourcify perfect match;
- public readiness `200 OK`;
- CTA: **Scan to open live Bill 2**;
- QR destination:
  `https://taptab.mythicmindlabs.workers.dev/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live`.

Place this small, persistent footnote below the evidence rather than in the
narration:

> Production boundary: sample interactions shown; a real multi-wallet Monad
> write, settlement and refund rehearsal remains to be recorded.

## Audio and subtitle deliverables

All audio and cue assets live in `2min/v3/audio/`:

- `scene-01.mp3` to `scene-08.mp3`: natural-speed ElevenLabs exports;
- `narration-master.wav`: exactly 117 seconds, with clips at absolute scene
  positions and silence elsewhere;
- `music-bed.wav`: exactly 117 seconds of locally synthesised, licence-safe
  ambience at −34.0 LUFS-I;
- `ui-sfx.wav`: exactly 117 seconds with quiet causal clicks and outcome tones
  aligned to the V3 interactions;
- `captions.json`: absolute-time cue array consumed by the V3 renderer;
- `narration-v3.srt`: UTF-8 sidecar generated from the same cue array;
- `cue-manifest.json`: scene placement, source and measured clip metadata;
- `PROVENANCE.md`: voice, settings and boundary record;
- `AUDIO_QA.md`: duration, format and loudness verification.

Every spoken word appears in `captions.json` and the SRT. Keep captions above
the player-control safe area, with no more than two lines and no overlapping
cues. The final spoken cue ends at 01:51.740, leaving 5.26 seconds for the QR,
evidence and footnote to hold over music.

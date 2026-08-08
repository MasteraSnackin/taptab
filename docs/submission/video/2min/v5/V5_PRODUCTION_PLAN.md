# TapTab V5 production record

## Release intent

V5 improves the judge-facing visual story without changing the approved Nora
narration or its 31 caption cues. It keeps the complete application window in
view, adds one genuinely continuous interaction, makes local and public-chain
evidence visually distinct, and lengthens the final QR hold. No 60-second cut
was created.

## Locked audio and caption sources

- Narration: `v3/audio/narration-master.wav`, SHA-256
  `39284fb8cc18679bda0b4188eabf3a60e583074f6fee2e05961a70d73305edf1`.
- Captions: `v3/audio/captions.json`, SHA-256
  `c97ab770dff96180e8b2431320d1749c38aa4ca3bb5dfffbc92e3e733c896a30`.
- The last spoken cue ends at `111.740`; the master ends at `119.000`, giving
  a `7.260`-second speech-free final hold.
- The existing music bed is repeated and faded only from 117–119 seconds so
  the extended hold does not end in abrupt silence.

## Visual timeline

The fractional cut points below are exact 30 fps frame boundaries; the decimal
values in parentheses are rounded to the nearest millisecond.

| Time (seconds) | Visual |
| --- | --- |
| 0–5 | Hook plus `Live on Monad Testnet · 31 confirmed contract transactions` |
| 5–10 | Full-window receipt orientation |
| 10–15 | Full-window named claim: Amina, Theo and Jules share the house red |
| 15–20 | Full-window `£26.14` review and approval story |
| 20–35 | One uncut browser take: fair-remainder/tip controls, 12.5%, review, approval, reopened tip, 10% and consent reset |
| 35–40 | Protected payments open in the labelled local sample |
| 40–44 | The user's own local-sample payment is shown |
| 44–49 | Labelled local-sample sponsorship: You cover Theo's remainder |
| 49–52 | Exact local-sample funding |
| 52–57 | Local-sample settled view |
| 57–65 | Full-screen Stage Mode settled outcome |
| 65–70 | Local two-outcome comparison; no Testnet evidence is introduced yet |
| 70–75 + 21/30 (75.700) | Explicit local cancelled state with contributor refunds open |
| 75 + 21/30–83 + 12/30 (83.400) | Explicit local failure outcome with contributors refunded |
| 83 + 12/30–92 + 20/30 (92.667) | Narration-aligned switch to the separate live Bill 2, created and publicly readable |
| 92 + 20/30–95 | Confirmed Bill 2 creation transaction |
| 95–99 + 11/30 (99.367) | Shared-state lifecycle; sponsorship explicitly scoped to the local sample |
| 99 + 11/30–103 + 2/30 (103.067) | Sealed Bills 3 and 4 RPC summary, retained through narration cue 28 |
| 103 + 2/30–104 | Retained Bill 3 settlement hash, explicitly labelled as a historical replay with no new write |
| 104–105 + 9/30 (105.300) | Genuine Monadscan `Success` receipt for that retained Bill 3 hash |
| 105 + 9/30–119 | `Bill 3 settled` outcome and QR for the separate live Bill 2, which is not presented as settled |

## Visual scope

- Purple: local public sample.
- Green: confirmed Monad Testnet evidence.
- Amber: protected cancellation and refund path.
- Large callouts sit beside the application with gentle dimming. No part of the
  V5 master uses crop magnification.
- The complete application viewport is visible for 76.0 seconds.
- Sponsorship is demonstrated only in the labelled local sample.
- Named story: Amina, Theo and Jules share the house red; You cover Theo's
  remainder.
- Final outcome: `Bill 3 settled. Nobody chased. Every contribution accounted
  for.`
- The final QR opens the separate live Bill 2, which is created and publicly
  readable but is not presented as settled.
- Source statement: `MonadVision reports · Sourcify perfect match`.

## Continuous capture

The source is `capture/continuous-public-sample-15s.mp4`:

- exactly `15.000` seconds and 450 frames at 30 fps;
- 1856 × 1000 source viewport;
- one Playwright browser stream, zero internal cuts and endpoint trimming only;
- begins on the fair-remainder and tip controls, selects 12.5%, reviews and
  approves the split, reopens the tip controls, changes the vote to 10%, and
  shows the consent reset;
- no wallet write;
- 1,279,802 bytes;
- SHA-256
  `74836bee8192056caf8d75c6252f8b830416b68396ad0a593918738d034a237f`.

The detailed action timings and original-stream provenance are in
`capture/continuous-capture-manifest.json`.

## Honest settlement replay

The video does not pretend to submit a fresh transaction. It replays the
retained Bill 3 `BillSettled` hash
`0xc232584b63ad27e7aa53b2526a2bcf8ebb6765bd8657cc804b7e76ec48e6d885`
and then shows its genuine read-only Monadscan `Success` receipt. The screenshot
and capture metadata are in `explorer/`.

## Release checks

- Master: `119.000` seconds, 3,570 frames, 1920 × 1080 H.264/yuv420p at 30 fps.
- Master size: 7,941,645 bytes.
- Audio: 48 kHz stereo AAC, `-16.04` LUFS-I, `-2.76` dBTP.
- Master SHA-256:
  `7c8895c78647136ea0bc7317c4a0d4c8b199f4243211b319114202a5429cc8e6`.
- Full-window display: 75.967 seconds (76.0 seconds when rounded in prose).
- Release generated at `2026-08-07T20:29:54.286Z`.
- The compressed master QR was decoded successfully at 118.5 seconds.
- The 15-second teaser is 1,164,603 bytes and has SHA-256
  `e51f25efe97d41ebaf2b0fb80df7107774aa80a3e015f19f949bd4e58bc2cee1`.
- The 15-second teaser and 30-second evidence cut were rebuilt under `v5/`; no
  60-second cut was produced.

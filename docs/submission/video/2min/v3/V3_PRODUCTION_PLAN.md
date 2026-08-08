# TapTab demo V3 production plan

## Delivery contract

- Duration: exactly 117.000 seconds.
- Picture: 1920×1080, progressive, 30 fps, H.264, yuv420p.
- Sound: AAC stereo, 48 kHz, mastered near −16 LUFS with peaks below −1.5 dBTP.
- Mix: Nora narration remains dominant over a subtle original tonal bed; causal click/result accents precede or coincide with the corresponding visible state change.
- Captions: burnt into the picture and delivered as a matching SRT file.
- Caption safe area: the caption band begins at y=842, 88 pixels above V2's y=930 band, so common player controls do not obscure it.
- Primary output: `docs/submission/video/2min/taptab-demo-2min.mp4`.

## Story and timing

| Time | Purpose | Visual rule |
| --- | --- | --- |
| 00:00–00:05 | Product hook | Name TapTab and Monad immediately; state the everyday problem in one sentence. |
| 00:05–00:21 | Claims journey | Close crops of the receipt and shared-item claim flow. A pointer reaches and clicks a control before the next state appears. |
| 00:21–00:35 | Group consent | Fair remainder, tip voting and approval in a compact sequence. |
| 00:35–00:57 | Protected funding | Exact personal payment, sponsorship, the incomplete lock, final contribution and settlement action. |
| 00:57–01:02 | Stage Mode | Five seconds total: incomplete state, final contribution, then settled. The transition is shown honestly, not described as the same unchanged state. |
| 01:02–01:05 | Settled bridge | The settled state remains full size while the Stage Mode narration resolves. |
| 01:05–01:10 | Successful outcome | Full-screen successful settlement; no split screen or small UI. |
| 01:10–01:15 | Protected failure | Full-screen cancellation/refund path; no split screen or small UI. |
| 01:15–01:23 | Outcome comparison | A deliberately simplified text-led comparison after both outcomes have been readable at full size. |
| 01:23–01:35 | Live Monad evidence | Direct Bill 2 page followed by the confirmed Bill 2 transaction/explorer evidence. |
| 01:35–01:45 | Why Monad and integrity | Chain 10143, deployed contract, verified source and readiness evidence. |
| 01:45–01:57 | Final call to action | Direct Bill 2 QR and URL dominate. The remaining multi-wallet rehearsal boundary is secondary, concise and visually subordinate. |

## Motion rules

- Every segment is rendered from the same full-frame composition. There is no per-caption zoom restart.
- Feature close-ups use fixed, deliberate crop boxes with subtle continuous movement only within the segment.
- Pointer motion takes at least 0.45 seconds. The click ring and sound precede the state change by at least 0.12 seconds.
- State changes use a short four-frame dissolve; no action result appears before the pointer click.
- Stage Mode is capped at five seconds and contains all three required states.
- The final CTA remains fully readable for twelve seconds and the direct Bill 2 QR is not replaced by a site-root QR.

## Evidence boundary

The video may show confirmed, public read evidence for the deployment contract and Bill 2 creation transaction. It must not imply that a live multi-wallet settlement and refund rehearsal has been completed unless such evidence is supplied before the render.

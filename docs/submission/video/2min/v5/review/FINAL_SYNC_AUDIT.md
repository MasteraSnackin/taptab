# TapTab V5 final narration-to-screen audit

## Audited release

- Master: `docs/submission/video/2min/taptab-demo-2min.mp4`
- SHA-256: `7c8895c78647136ea0bc7317c4a0d4c8b199f4243211b319114202a5429cc8e6`
- Duration: `119.000` seconds
- Frame rate and count: `30 fps`, `3,570` frames
- Narration and all 31 caption cues remain unchanged.

## Result

An independent read-only review inspected every cue midpoint and the relevant
frame boundaries. All 31 cues pass with no substantive factual or timing
mismatch.

- Cancellation/expiry now shows the cancelled, refunds-open state and `£0` to
  the venue throughout cue 19.
- Refunds remain visibly open throughout cue 20; completed refunds appear as
  cue 21 begins, including the sponsor-owned refund evidence.
- No live Testnet evidence appears before the spoken transition. Live Bill 2
  begins on the first rendered subtitle frame at `83.400` seconds.
- The three-wallet contract evidence remains visible throughout cue 28; the
  historical transaction replay begins only after that cue ends.
- The end card distinguishes settled Bill 3 from the separate live Bill 2,
  which is created and publicly readable but is not presented as settled.
- The source-match statement is explicitly attributed to MonadVision, and the
  final Bill 2 QR remains unobscured.

Minor inherited lead-ins around cues 3, 10 and 13 are below a meaningful
story or factual threshold and do not create a mismatch.

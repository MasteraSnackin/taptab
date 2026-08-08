# V3 audio provenance

- Narration was generated on 7 August 2026 through the existing signed-in
  ElevenLabs workflow.
- Voice: `Nora - Blackpool Product Guide`, the project's synthetic Voice Design
  voice targeting a light Blackpool/North-West England accent.
- Model: `Eleven Multilingual v2`.
- Settings: speed `1.0`, stability `0.50`, similarity `0.75`, style
  exaggeration `0`, speaker boost on.
- Source format: MP3, 44.1 kHz, mono, 128 kbps.
- Eight independent scene exports are used at natural speed. No time stretch,
  pitch shift, voice substitution or third-party stock voice is used.
- The source clips are placed 200 ms after their editorial scene starts. The
  117-second PCM master contains silence between clips; it does not alter their
  timing or delivery.
- `music-bed.wav` is generated locally from 73.42 Hz, 110 Hz and 146.83 Hz sine
  oscillators plus deterministic seeded pink noise. The noise is filtered to
  100–850 Hz, the tones are gently stereo-panned, and the bed has two-second
  opening and closing fades. No stock music, sample library or third-party
  recording is used.
- `ui-sfx.wav` uses only the project's locally synthesised V2 sine-tone click,
  confirm, refund and settlement designs. The source tones were created by
  `build-v2.mjs`; V3 places quieter copies at causal pointer and result events.
  No downloaded sound effects are used.
- Clicks occur at 9.22, 23.18, 28.18, 33.00, 37.65, 44.65, 51.65 and 54.65
  seconds. Outcome cues occur at 60.20 (Stage confirmation), 65.00
  (settlement), 70.00 (refunds open), 72.50 (refund returned), 89.00 (live
  evidence) and 105.00 seconds (final CTA).
- The bed measures −34.0 LUFS-I with a −26.8 dBFS true peak. The sparse SFX
  stem measures −40.2 LUFS-I with a −27.9 dBFS true peak. A direct three-stem
  test mix preserves the narration result at −16.0 LUFS-I and −2.8 dBFS true
  peak, so narration remains dominant.
- `captions.json` is the canonical cue source. `narration-v3.srt` is generated
  mechanically from the same 31 cues.
- Pound values are written as words in the speech input to make pronunciation
  unambiguous. Captions use familiar GBP notation.
- The local product walkthrough is explicitly a £53.95 sample. The later live
  evidence section explicitly switches to the separate £48.50 Bill 2 on Monad
  Testnet.
- The final spoken words are: `Scan to open live Bill 2.`
- The closing visual must retain this boundary: sample interactions are shown;
  a real multi-wallet Monad write, settlement and refund rehearsal remains to
  be recorded.

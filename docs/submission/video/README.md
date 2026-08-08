# TapTab demo videos

## Current 2 minute 30 second Vercel and Monad Testnet demo

[![Watch the current TapTab demo](2min30/taptab-demo-2min30-poster.png)](2min30/taptab-demo-2min30.mp4)

The current fallback demonstration is exactly `150.000` seconds, 1920 × 1080
at 30 fps, with H.264 video and 48 kHz stereo AAC sound. It uses the approved
ElevenLabs **Nora – Blackpool Product Guide** recordings at natural speed,
burnt-in captions, original locally synthesised music and a final speech-free
evidence hold.

The first section is explicitly labelled as a deterministic local sample with
no wallet write. The public-evidence section then shows the live Vercel URL,
canonical Bill `2`, a genuine HTTP `200` readiness result with every check
passing on chain `10143`, the full deployed contract address, source-publication
records and Bill `3`'s genuine historical `Success` settlement receipt. It does
not claim a fresh transaction. The final disclosure states that Testnet MON has
no cash value.

The master is `9,001,355` bytes with SHA-256
`3e695982f21396e8a2ac6f4235d54f8f8828e96e84848e0a53aeb7091acd3591`.

Release files:

- [MP4 master](2min30/taptab-demo-2min30.mp4)
- [poster and canonical Bill 2 QR](2min30/taptab-demo-2min30-poster.png)
- [delivered narration and picture map](2min30/FINAL_NARRATION.md)
- [subtitle sidecar](2min30/taptab-demo-2min30.srt)
- [verification snapshot](2min30/evidence/verification-snapshot.json)
- [QA summary](2min30/QA_SUMMARY.md)
- [build and provenance record](2min30/build-video.mjs)

## Historical two-minute narrated walkthrough: V5 production record

The retained record describes the definitive V5 product walkthrough. V5 is
exactly `119.000` seconds, leaving a one-second submission-platform safety
margin below two minutes. The large MP4, poster, teaser, evidence cut and raw
capture are delivery assets and are not included in this source-only
repository. The production plan, build and capture scripts, exact subtitle
track, manifests and source-provenance notes are retained.

### What the video shows

- **Full-window local sample · £53.95 · no wallet write:** whole and shared-item
  claims, fair-remainder choice, median-tip voting, versioned approval,
  self-payment, sponsorship, an incomplete-settlement lock, exact funding,
  settlement, cancellation or expiry, contributor-owned refunds and Stage
  Mode. The complete application viewport is visible for `76.0` seconds.
  Sponsorship is explicitly labelled as a local-sample demonstration. One
  `15.000`-second, 450-frame sequence is genuinely continuous: it begins on the
  fair-remainder and tip controls, selects 12.5%, reviews and approves the
  split, reopens the tip controls, changes the vote to 10%, and shows the
  consent reset. It has zero internal cuts and performs no wallet write.
- **Live Monad Testnet · Bill 2 · £48.50:** the public application genuinely
  reads canonical Bill 2, followed by its confirmed creation-transaction
  evidence and direct public route. Bill 2 is created and publicly readable; it
  is not presented as settled.
- **Live multi-wallet rehearsal:** Bill 3 reaches `Settled` after three distinct
  wallets claim, approve and fund exactly; Bill 4 reaches `Cancelled` and both
  original contributors claim refunds. The sealed record contains 31 contract
  transactions plus a historical incomplete-settlement refusal.
- **Direct call to action:** the final QR and written URL open canonical Bill 2,
  not the site root, as a separate live record from the settled Bill 3 story.
- **Named outcome:** Amina, Theo and Jules share the house red, You cover Theo's
  remainder, and the final card states, **“Bill 3 settled. Nobody chased. Every
  contribution accounted for.”**

Purple denotes the local public sample, green confirmed Monad Testnet evidence
and amber the protected cancellation/refund path. Sample settlement and refund
interactions are never presented as Testnet writes. The genuine Bills 3 and 4
evidence is sourced from
`docs/submission/monad-testnet-multiwallet-evidence.json`. The retained Bill 3
settlement hash transitions to a genuine Monadscan `Success` receipt and is
explicitly labelled as a historical replay; no fresh wallet transaction was
broadcast for the edit. Testnet MON has no cash value, private keys are
excluded, and the 30-second evidence visualisation is not described as
uninterrupted wallet-interface footage. The final card attributes its source
statement as **“MonadVision reports · Sourcify perfect match”**.

The continuous take is 1,279,802 bytes and has SHA-256
`74836bee8192056caf8d75c6252f8b830416b68396ad0a593918738d034a237f`.

### Recorded delivery verification

| Check | V5 result |
| --- | --- |
| Container | MP4 with H.264 video and AAC audio |
| Picture | 1920 × 1080, yuv420p, 30 fps, 3,570 frames |
| Sound | 48 kHz stereo AAC |
| Exact duration | `119.000` seconds |
| File size | 7,941,645 bytes |
| Decoded integrated loudness | −16.04 LUFS-I |
| Decoded true peak | −2.76 dBTP |
| Subtitle cues | 31 ordered, non-overlapping cues |
| Last spoken cue | `111.740` seconds |
| Final hold | `7.260` seconds, speech-free with music |

[`2min/taptab-demo-2min.srt`](2min/taptab-demo-2min.srt) is the matching UTF-8
sidecar. The same 31-cue source drives the captions burnt into the picture. The
final speech-free hold keeps the Bill 2 QR, URL and evidence boundary readable.

### Recorded release hashes

- MP4: `7c8895c78647136ea0bc7317c4a0d4c8b199f4243211b319114202a5429cc8e6`;
- SRT: `ff7b6b5b049a29b71e1114e9665237bd89c193a3f9e7a0b38e18742648503ae1`;
- poster: `402a294e2bc16cce3912585b1d0310ab7713691965ebeee9b8a634bd6879ca1a`.

The retained V5 sources are under `2min/v5/`. Generated ffprobe, loudness,
contact-sheet and checksum outputs are not versioned in this source-only clone.
The human-reviewed
[final synchronisation audit](2min/v5/review/FINAL_SYNC_AUDIT.md) is retained.

### Auxiliary V5 cuts

- `2min/v5/teaser/taptab-teaser-15s.mp4` is the recorded 15-second social
  teaser delivery path. It is 1920×1080, 30 fps, H.264/AAC and
  −16.22 LUFS-I. Its closing QR opens canonical Bill 2. The file is 1,164,603
  bytes and has SHA-256
  `e51f25efe97d41ebaf2b0fb80df7107774aa80a3e015f19f949bd4e58bc2cee1`.
- `2min/v5/evidence/taptab-multiwallet-evidence-30s.mp4` is the recorded
  30-second Bills 3 and 4 evidence visualisation path. The accompanying
  [sealed evidence record](../monad-testnet-multiwallet-evidence.json) contains
  the full key transaction hashes and evidence boundary.

No 60-second cut was created, as requested.

### Narration, music and effects

The unchanged eight scene clips use the synthetic ElevenLabs Voice Design voice
**Nora — Blackpool Product Guide**, targeting a light Blackpool/North-West
England style through Eleven Multilingual v2. Each clip is used at natural
speed; there is no time stretch, pitch shift or voice substitution.

The music bed and interface sounds were synthesised locally from deterministic
tones and filtered noise. No stock music, downloaded effects or third-party
recording is used. The current provenance and audio checks are in
[`2min/v3/audio/PROVENANCE.md`](2min/v3/audio/PROVENANCE.md) and
[`2min/v3/audio/AUDIO_QA.md`](2min/v3/audio/AUDIO_QA.md).

The build pipeline is retained at
`docs/submission/video/2min/v5/build-v5.mjs`. Rebuilding the cut also requires
the archived raw narration, music, screen captures and explorer replay inputs,
which are not included in this source-only repository.

## Superseded V1, V2, V3 and V4 material

The V1 master, V1 script, V2 script, V2 production plan, V2 filter, V2
narration, V2 review files and V3/V4 production records remain only as production history. They do not
describe or verify the current primary MP4, SRT or poster. In particular, old
V1/V2 hashes, cue counts, file sizes, final-hold timings and root-URL QR
descriptions must not be quoted as current release facts.

The superseded V1 and V2 delivery masters are not included. V2 source material
is under `2min/v2/`; V3 and V4 production history is under `2min/v3/` and
`2min/v4/` respectively.

## Twenty-four-second silent cut

The delivery path `taptab-demo-24s.mp4` describes a separate silent, captioned
24-second overview made from the maintained local screenshots in
`../screenshots`. The binary is not included in this source-only repository.

The editable caption layouts are in `slides`. The composited frames in
`rendered` are the direct inputs to the short MP4, and `demo-filter.txt` records
its timing and fade filters.

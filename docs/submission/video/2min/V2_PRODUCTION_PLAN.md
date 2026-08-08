# TapTab two-minute demo V2 production plan

> **Superseded production record:** V2 is retained for edit history only. It no
> longer describes or verifies the primary MP4, subtitle file or poster. Use
> [`v3/V3_PRODUCTION_PLAN.md`](v3/V3_PRODUCTION_PLAN.md) and
> [`../README.md`](../README.md) for current V3 facts.

## Outcome

Produce a 1920 × 1080, 30 fps, exactly 117.000-second H.264/AAC demo that
feels like a continuous product walkthrough rather than a narrated slide deck.
Use real browser captures for every product state, restrained camera movement,
a visible cursor for meaningful actions, complete burned-in subtitles, an
unambiguous success/refund fork, scene-timed narration, and quiet original
sound design.

The final cut must continue to identify the demonstrated bill interactions as
sample activity. It may show the verified Monad Testnet deployment, Sourcify
perfect match and public-app readiness, but must not imply that a real
multi-wallet write, settlement or refund rehearsal has been completed.

## Implementation result

Completed on 7 August 2026, then superseded by V3. The following records the
historical V2 cut and must not be read as the current release specification.
The one-bill capture gate passed with the same £48.50 subtotal, £5.45 tip and
£53.95 total across the settlement and refund branches. Eight independent
ElevenLabs clips are used at natural speed, every spoken line has a burned-in
subtitle cue aligned from the clip's measured pauses, and all music and
interface sounds are project-generated. Validation records 3,510 frames,
117.000 seconds, 1920 × 1080 H.264, 48 kHz stereo AAC and no decode errors.
The final polish adds travelling cursors, larger outcome holds, explicit £35.04
/ £18.91 protection callouts and the verified public-preview URL. The refreshed
evidence cards now show the live Monad Testnet contract
`0xa2fb0B3b…46FAA198`, shortened deployment transaction
`0xc48ab94b…38ba488`, Sourcify perfect match and public readiness at 200 OK.
They also state that a real multi-wallet write, settlement and refund rehearsal
remains. The obsolete final voice lines are muted without synthesising new
narration, leaving a silent/music-backed evidence hold and a 25-cue UTF-8 SRT.

## Findings that affect the edit

- The superseded master was 1920 × 1080, 30 fps and exactly 120 seconds,
  but `video-filter.txt` only holds 19 static frames with fades before
  concatenating them.
- The maintained browser captures in `screens/` are 1248 × 720 JPEGs. The
  1920 × 1080 files in `rendered/frames/` have the old captions and layout
  baked in, so V2 should animate the browser captures, not those composites.
- The current narration is 104.90775 seconds and is slowed with
  `atempo=0.892831915`. V2 narration should be generated in timed scene clips
  and used at its native speed.
- The installed FFmpeg 8.1.2 has `overlay`, `zoompan`, `xfade`, `amix`,
  `sidechaincompress`, `fade` and `loudnorm`, but it has neither `drawtext` nor
  `subtitles`. All visible text added in post must therefore be authored in SVG,
  converted to transparent RGBA PNG, and composited with `overlay`.
- The V1 states were not one consistent bill. The hero and successful
  branch show **£53.95**, while the failed branch contains a **£48.50 subtotal**
  and a **£53.35** locked total. V2 therefore uses the newly captured £53.95
  states and does not reuse those conflicting failed-branch frames.

## Mandatory capture gate: one £53.95 bill

Before editing, recapture the complete flow from one deterministic £53.95
sample bill. Duplicate the saved state immediately after the incomplete
sponsorship state and use those two copies for the success and failure
outcomes. The receipt, diner allocations, tip, remainder choice, split version,
bill identifier and participant set must match on both sides of the fork.

Capture each state at the same 1248 × 720 browser viewport and at the same page
zoom. Preserve the visible `SAMPLE PREVIEW` or local-preview labelling. Capture
before and after an action at the same scroll position so a short dissolve reads
as a real interaction rather than a jump to an unrelated screen.

Suggested V2 capture set:

| File | Required state |
| --- | --- |
| `01-hero-5395.png` | Hero, Table 7, four diners, £53.95 |
| `02-claim-start-5395.png` | Unclaimed receipt at the first whole-item control |
| `03-whole-claimed-5395.png` | Same position immediately after the whole-item claim |
| `04-shared-start-5395.png` | Shared item before the diner's share is chosen |
| `05-shared-claimed-5395.png` | Same position after the share is chosen and total updates |
| `06-tip-remainder-start-5395.png` | Tip choices and fair-remainder control visible |
| `07-tip-voted-5395.png` | Vote recorded and group result visible |
| `08-remainder-opted-5395.png` | Opt-in state and named non-volunteers visible |
| `09-review-unapproved-5395.png` | Current split, version and 0/4 approval status |
| `10-self-approved-5395.png` | Same split after the current diner approves |
| `11-all-approved-5395.png` | Same version at 4/4 approval |
| `12-funding-open-5395.png` | Protected funding open at 0% |
| `13-self-paid-5395.png` | Current diner covered; settlement still locked |
| `14-sponsored-incomplete-5395.png` | Sponsor contribution made; bill still incomplete |
| `15-exact-funded-5395.png` | Successful copy at exactly £53.95 funded |
| `16-settled-5395.png` | Successful copy settled, with “Paid together. Nobody chased.” |
| `17-refunds-open-5395.png` | Failed copy cancelled or expired, venue paid £0 |
| `18-refund-claimed-5395.png` | Original payer's refund claimed |
| `19-stage-funded-5395.png` | Stage Mode showing participants and exact funding |
| `20-stage-settled-5395.png` | Stage Mode after settlement |

Do not crop away amounts to conceal inconsistent source data. If any required
£53.95 state cannot be reproduced, stop the V2 render and fix the sample/capture
flow first.

## Exact 117-second editorial timeline

The scene timecodes below are final-output timecodes. A transition centred on a
scene boundary uses handles outside that scene's editorial interval; it must not
shorten the interval. The durations total exactly 117 seconds:

`5 + 16 + 13 + 11.2 + 21.8 + 13 + 19 + 18 = 117`.

| Final time | Duration | Scene | Browser states and treatment |
| --- | ---: | --- | --- |
| 00:00–00:05 | 5 s | Hook | Open on the Table 7 hero, travel the cursor to the primary action and align the click ring and sound at 00:04.2. |
| 00:05–00:21 | 16 s | Receipt and claims | Move through the familiar receipt and shared-item claim, then hold on the immediately updated pound total. |
| 00:21–00:34 | 13 s | Fair remainder | Compare opt-out and opt-in states and keep the people who declined visible. |
| 00:34–00:45.2 | 11.2 s | Tip and approval | Record the tip vote, review the same split and finish at 4/4 approval; this section is deliberately shorter than the first V2 cut. |
| 00:45.2–01:07 | 21.8 s | Pay and sponsor | Show self-payment and sponsorship, then emphasise **£35.04 funded**, **£18.91 outstanding** and **settlement locked**. |
| 01:07–01:20 | 13 s | Stage Mode | Present the same table state across the room with participants, approvals, funding and activity visible. |
| 01:20–01:39 | 19 s | Success/refund outcomes | Use full-screen success, cancellation and refund beats around a larger labelled comparison of the same £53.95 bill. Hold **£35.04 returned to the original contributor** clearly. |
| 01:39–01:57 | 18 s | Result and boundary | Resolve on “Paid together. Nobody chased.”, show chain ID 10143, the live contract, shortened deployment transaction, Sourcify perfect match and 200 OK public readiness, then hold the verified public-sample QR for 8.8 seconds. Keep the outstanding real multi-wallet write, settlement and refund rehearsal boundary visible. |

No genuine builder-camera source exists in this release. A future edit may
replace exactly 1:41.2–1:44.1 with the 2.9-second insert specified in
`../DEMO_2MIN_V2_SCRIPT.md`; the Why Monad graphic would still retain 4.1
seconds and the QR would retain its full 8.8 seconds. Do not synthesise or imply
human footage.

## Complete subtitle and narration cue sheet

Generate eight separate ElevenLabs narration clips, one per scene, with the
approved female Blackpool/North-West voice. Leave approximately 200 ms of room
at each clip head and 300 ms at each tail. Fit the read through phrasing and
pauses in ElevenLabs; do not use `atempo`, pitch shifting or time stretching.

Every spoken word must appear in the burned-in subtitle track. These are the
target timings and exact V2 lines:

| Time | Burned-in text |
| --- | --- |
| 00:00–00:01.12 | Four diners. One restaurant bill. |
| 00:01.12–00:05 | Nobody has to front the money. |
| 00:05.19–00:07.7 | Start with the familiar GBP receipt. |
| 00:07.7–00:10.9 | Claim a whole item, or choose a share of something shared. |
| 00:10.9–00:14.3 | Wine, starters and extras stay visible to the table. |
| 00:14.3–00:17.2 | Your own pound total updates immediately. |
| 00:17.2–00:21 | No subtitle. |
| 00:21–00:23.7 | Unclaimed value is never forced onto everyone. |
| 00:23.7–00:26.4 | Only diners who opt in share the fair remainder. |
| 00:26.4–00:29 | Silence cannot become consent to pay. |
| 00:29–00:34 | No subtitle. |
| 00:34–00:38 | Everyone votes on the tip; the median becomes the group choice. |
| 00:38–00:41.3 | Then every participant reviews the same exact split. |
| 00:41.3–00:45.2 | Any change clears approval, so consent matches the current version. |
| 00:45.2–00:49 | No subtitle. |
| 00:49.12–00:52.8 | Funding is exact: each diner pays only the agreed amount. |
| 00:52.8–00:56 | A friend can sponsor another diner's remaining balance. |
| 00:56–00:58.28 | The original obligation does not change. |
| 00:58.28–01:02.3 | Settlement stays locked while £18.91 remains. |
| 01:02.3–01:07 | No subtitle. |
| 01:07.17–01:10.5 | Stage Mode makes the same table state projector-ready. |
| 01:10.5–01:15.8 | Participants, approvals, funding and activity stay visible across the room. |
| 01:15.8–01:20 | It is the same data, simply arranged for everyone to follow. |
| 01:20–01:25.2 | From the same approved £53.95 bill, there are two outcomes. |
| 01:25.2–01:28.2 | Exact funding unlocks settlement for the venue. |
| 01:28.2–01:31.7 | Cancellation or expiry pays the venue nothing. |
| 01:31.7–01:35.7 | Every refund returns to the account that paid, including a sponsor. |
| 01:35.7–01:39 | No subtitle. |
| 01:39.17–01:41.2 | Paid together. Nobody chased. |
| 01:41.2–01:44.1 | No subtitle; hold the verified Why Monad evidence. |
| 01:44.1–01:50.75 | Rehearsed on Hardhat 31337 and targeting Monad Testnet. |
| 01:50.75–01:57 | No subtitle; hold the verified live evidence card over music. |

If the natural spoken onset differs after generation, move the corresponding
subtitle onset to within 100 ms of the spoken onset while preserving the eight
scene boundaries and the exact 117-second runtime. Never display two cues at
once.

## Subtitle and graphic workflow without FFmpeg text filters

This FFmpeg build cannot burn SRT or ASS files directly. Generate the separate
UTF-8 SRT from the same cue array, then use the following portable asset
workflow for the captions burned into the picture:

1. Author one 1920 × 1080 SVG per cue. Use a dark `#11141d` bar from y=942 to
   y=1080, white text at 42 px with a 52 px line height, and no more than two
   manually broken lines. Keep text between x=232 and x=1840. A small scene
   badge may occupy x=60 to x=200.
2. Render SVG to an alpha-preserving PNG with the macOS tool already available:

   ```sh
   sips -s format png cue-001.svg --out cue-001.png
   ```

   This route preserves a 1920 × 1080 RGBA canvas and does not depend on
   `drawtext` or `subtitles`.
3. Create an `ffconcat` manifest containing each PNG and its exact cue duration,
   repeating the final file once as required by the concat demuxer. Convert the
   manifest to a 30 fps RGBA caption stream or feed it directly into the final
   filter graph.
4. Composite the caption stream after all screenshot motion, split-screen work
   and cursor animation. This keeps subtitles sharp and stationary. The final
   H.264 video contains the words in the picture itself and has no subtitle
   stream.

Use the same SVG-to-PNG method for the split-screen labels, scene badges, click
ring, end card and any verified link or QR treatment. Do not rasterise text at a
smaller size and upscale it.

## Motion and cursor rules

Build the screenshot window at x=142, y=12. Preserve the 1248 × 720 aspect ratio
by scaling each capture to 1612 × 930 and centring it at x=154, y=12 inside the
existing dark 1636 × 930 frame. This avoids the slight stretching present in
the old composite.

- Keep camera scale between 1.00× and 1.04×. Use 1.025× for a general hold and
  no more than 1.04× for a control or amount that needs emphasis.
- Ease all movement with a cosine ease. A suitable `zoompan` expression is
  `1+0.035*(0.5-0.5*cos(PI*on/(N-1)))`, with `N` replaced by the shot's output
  frame count. Use a clipped centre-point expression for x/y so no frame edge
  is exposed.
- Let a move run for at least 2 seconds. Stop camera movement 300 ms before a
  click and keep it still through the before/after match cut.
- Use 0.18–0.25-second match dissolves for interface state changes and no more
  than a 0.30-second scene dissolve. Avoid repeated dips to black.
- Create a 56 × 76 white cursor PNG with its arrow tip at pixel 0,0. Move it only
  for meaningful actions, over 0.6–1.0 seconds, then let it settle.
- Create a transparent purple click-ring PNG and expand it from 32 to 128 pixels
  over 0.36 seconds while fading its alpha. One ring per listed click is enough.
- When the camera is at 1.00×, convert a capture target `(x, y)` to output space
  with `X = 154 + 1.291667x` and `Y = 12 + 1.291667y`. Verify the pointer tip
  visually after compositing. Do not guess target coordinates before the V2
  captures exist.
- For cursor travel, FFmpeg can use a cosine interpolation such as
  `x0+(x1-x0)*(0.5-0.5*cos(PI*clip((t-t0)/(t1-t0),0,1)))`, with the equivalent
  expression for y.

The split screen should use two equal 880 × 508 full-capture panels on the dark
canvas, left at x=60 and right at x=980, with labels above. Add a subtle 2 px
stroke and a clear green success accent on the left and amber refund-protection
accent on the right. If key UI text is too small at that size, use a matched
1.20× crop inside both panels rather than enlarging only the successful outcome.

## Original ambient bed and UI sounds

Use only project-created audio. Keep a short provenance note with the render
assets; do not introduce a stock track whose licence cannot be demonstrated.

### Ambient bed

Create a 117-second, 48 kHz stereo WAV with an unobtrusive open-fifth pad and a
very low filtered-noise texture. A practical FFmpeg-only source is a blend of
low-level 73.42 Hz, 110 Hz and 146.83 Hz sine layers, slow tremolo below 0.06 Hz,
and pink noise high-passed near 100 Hz and low-passed below 900 Hz. Pan the
harmonic layers slightly apart, fade the first and last 2 seconds, and avoid
percussion or a lead melody. Render this once as `ambient-bed-v2.wav`; do not
generate it afresh inside every master command.

Target the bed at **−34 LUFS-I while narration is present** and allow it to rise
to no more than **−30 LUFS-I** in intentional speech gaps. Use the narration as
the sidechain key with approximately a 20 ms attack, 350 ms release and 5–6 dB
of gain reduction. Fade the bed down by a further 3 dB under the final evidence
card.

### UI sound palette and events

Synthesize the effects as short WAVs so they are original and repeatable:

- `ui-click.wav`: 35–45 ms soft 900 Hz tick, peak **−24 dBFS**;
- `ui-confirm.wav`: 160–200 ms two-note rise, peak **−20 dBFS**;
- `ui-branch.wav`: 250–300 ms filtered-noise sweep, peak **−26 dBFS**;
- `ui-refund.wav`: 180–240 ms muted downward tone, peak **−22 dBFS**;
- `ui-settle.wav`: 450–550 ms three-note resolve, peak **−17 dBFS**.

Place sounds only at these events:

| Time | Sound |
| --- | --- |
| 00:04.20 | Soft click on “Claim my items” |
| 00:10.50 | Soft click on shared-item claim |
| 00:25.50 | Soft click on fair-remainder opt-in |
| 00:35.50 | Soft click on tip vote |
| 00:41.00 | Soft click on split approval |
| 00:43.50 | Quiet confirmation at 4/4 ready |
| 00:52.40 | Soft click on self-payment |
| 00:55.60 | Soft click on sponsorship |
| 01:24.50 | Confirmation tone on exact funding |
| 01:31.00 | Muted refund-protection tone on cancellation/expiry |
| 01:36.40 | Soft click on refund claim |
| 01:39.00 | Settlement resolve into the closing line |

Do not add a sound to every visual change. The narration remains the dominant
audio element.

### Mix targets

- Regenerated narration bus: **−18 LUFS-I**, with short-term speech generally
  between −20 and −16 LUFS and peaks no higher than **−3 dBFS** before the final
  limiter.
- Ambient bed under speech: **−34 LUFS-I**, ducked 5–6 dB by the narration.
- UI effects: event peaks as listed above; no stacked event may exceed
  **−17 dBFS** before mastering.
- Final stereo master: **−16 LUFS-I**, LRA at or below **7 LU**, and true peak at
  or below **−1.5 dBTP**.

Use `adelay` to place effects, `sidechaincompress` for the bed, and
`amix=normalize=0` for the buses. Apply a measured two-pass `loudnorm` only to
the completed mix. Do not normalise every effect independently after setting
its event level.

## FFmpeg assembly shape

The V2 filter graph should follow this order:

1. loop each browser capture at 30 fps;
2. scale it without distortion and apply `zoompan`/crop movement;
3. make short before/after interface transitions;
4. assemble each fixed-duration scene and the global 117-second picture;
5. composite split-screen labels, cursor and click ripples;
6. composite the 1920 × 1080 RGBA subtitle stream last;
7. mix native-speed narration clips, ducked ambient bed and delayed UI effects;
8. trim picture and audio to 117.000 seconds and set timestamps from zero.

Give each scene three-frame handles and centre a six-frame dissolve on its
editorial boundary. The table timecodes describe the visible output after the
overlap. Do not simply concatenate eight nominal-duration files and then apply
seven overlapping `xfade` transitions, which would shorten the programme.

Recommended delivery encoding:

```text
video: libx264, High profile, CRF 20, yuv420p, 1920x1080, CFR 30
audio: AAC-LC, 48 kHz, stereo, 192 kb/s
container: MP4 with +faststart
duration: 117.000 seconds
```

## Acceptance checks

- `ffprobe` reports 1920 × 1080, 30/1 fps, 48 kHz stereo audio, 3,510 video
  frames and exactly 117.000 seconds; there is no subtitle stream because
  subtitles are burned in.
- Every browser state is a real capture from the £53.95 sample and every amount
  visible before and after the fork is consistent.
- The failed branch visibly pays the venue nothing; the successful branch alone
  settles; the refund goes to the contributing account, including sponsorship.
- All narration is native speed and every spoken phrase has a matching subtitle
  within 100 ms. Subtitles remain readable when the video is viewed muted at
  720p and on a projector.
- Cursor tips land on the intended controls and click sounds align within one
  30 fps frame.
- Two-pass loudness measurement meets −16 LUFS-I and −1.5 dBTP without audible
  pumping, clipping or narration being masked by the bed.
- The end card remains fully static and readable for 8.8 seconds. It contains
  the verified contract, deployment transaction, source-match status,
  public-readiness result and remaining multi-wallet rehearsal boundary. Its QR
  decodes to the exact HTTPS URL from the compressed master at 100%, 50% and
  25% scale.
- The separate UTF-8 SRT contains 25 ordered, non-overlapping cues. Its final
  cue ends at 1:50.75 because the remaining evidence hold has no audible speech.
  It matches the burned-in text exactly.
- Review a new contact sheet at every major state and watch the complete master
  once with sound and once muted before replacing the existing primary video.

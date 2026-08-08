# V3 narration audio QA

Verified on 7 August 2026 with FFprobe and FFmpeg EBU R128 analysis.

## Source clips

All eight source clips decode without error and use the requested Nora voice at
natural speed. Each file is MP3, 44.1 kHz, mono and 128 kbps.

| File | Duration | LUFS-I | True peak |
| --- | ---: | ---: | ---: |
| `scene-01.mp3` | 3.604875 s | −16.1 | −2.4 dBFS |
| `scene-02.mp3` | 10.527313 s | −17.9 | −1.4 dBFS |
| `scene-03.mp3` | 8.594250 s | −16.7 | −1.3 dBFS |
| `scene-04.mp3` | 17.920000 s | −18.0 | −1.7 dBFS |
| `scene-05.mp3` | 4.728125 s | −16.4 | −1.9 dBFS |
| `scene-06.mp3` | 12.852188 s | −17.6 | −1.5 dBFS |
| `scene-07.mp3` | 20.088125 s | −17.7 | −1.8 dBFS |
| `scene-08.mp3` | 6.765688 s | −18.6 | −1.8 dBFS |

## Narration master

| Check | Result |
| --- | --- |
| File | `narration-master.wav` |
| Codec | PCM signed 24-bit little-endian |
| Sample rate | 48,000 Hz |
| Channels | Stereo |
| Sample count per channel | 5,616,000 |
| Exact duration | **117.000000 seconds** |
| Integrated loudness | **−16.0 LUFS-I** |
| Loudness range | 6.2 LU |
| True peak | **−2.7 dBFS** |
| Decode errors | None |

The source clips are not stretched. The master places each clip 200 ms after
its editorial scene start, adds silence between scenes and applies one uniform
1.6 dB gain to reach the delivery target.

## Music and interface stems

| Check | `music-bed.wav` | `ui-sfx.wav` |
| --- | ---: | ---: |
| Codec | PCM 16-bit LE | PCM 16-bit LE |
| Sample rate | 48,000 Hz | 48,000 Hz |
| Channels | Stereo | Stereo |
| Sample count per channel | 5,616,000 | 5,616,000 |
| Exact duration | 117.000000 s | 117.000000 s |
| Integrated loudness | −34.0 LUFS-I | −40.2 LUFS-I |
| Loudness range | 0.0 LU | 8.7 LU |
| True peak | −26.8 dBFS | −27.9 dBFS |
| Decode errors | None | None |

The bed is locally synthesised and contains no stock material. Its level is 18
LU below the narration master. The SFX stem contains eight pointer clicks and
six causal result cues. Source placements are sample-exact at 9.22, 23.18,
28.18, 33.00, 37.65, 44.65, 51.65, 54.65, 60.20, 65.00, 70.00, 72.50, 89.00
and 105.00 seconds. Threshold-detected audible onsets remain within 0.25 ms of
those placements; the difference is the short sine fade and filter response.

A direct unity-gain test mix of narration, bed and SFX measures −16.0 LUFS-I
with a −2.8 dBFS true peak. The added stems therefore retain the narration's
delivery level and headroom.

## Timing and caption checks

- Eight scene intervals total exactly 117 seconds.
- Every clip ends before its editorial scene boundary.
- Tightest timing margin: scene 01, with 1.195125 seconds remaining. Scene 07,
  the longest and most timing-sensitive evidence read, retains 1.711875 seconds.
- Timing overflow: **none**.
- `captions.json` contains 31 monotonically ordered, non-overlapping cues.
- First spoken cue begins at 00:00.370, aligned to the measured speech onset
  after the source clip's inherent head silence.
- Final spoken cue ends at 01:51.740.
- Final speech-free, music-backed evidence and QR hold after the spoken CTA:
  5.260 seconds.
- The SRT is UTF-8 and is generated from the same canonical cue array.

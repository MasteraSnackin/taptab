# TapTab 2:30 release QA

## Release identity

| Item | Result |
| --- | --- |
| Master | `taptab-demo-2min30.mp4` |
| SHA-256 | `3e695982f21396e8a2ac6f4235d54f8f8828e96e84848e0a53aeb7091acd3591` |
| Bytes | `9,001,355` |
| Poster | `taptab-demo-2min30-poster.png` |
| Poster SHA-256 | `1accc28aa2418acd7bfbefc02d4493fc5097fdb0f28fc8f519bcbbccfcd55db5` |
| Final verification capture | `2026-08-08T13:18:21.047Z` |

## Technical acceptance

The final release was probed after the last timing and caption correction.

| Check | Required | Observed | Result |
| --- | ---: | ---: | --- |
| Container duration | `150.000` s | `150.000000` s | Pass |
| Video frames | `4,500` | `4,500` | Pass |
| Raster | `1920 × 1080` | `1920 × 1080` | Pass |
| Frame rate | `30 fps` | `30/1` | Pass |
| Video | H.264, broadly compatible | H.264 High, `yuv420p` | Pass |
| Audio | AAC, 48 kHz stereo | AAC-LC, 48 kHz, 2 channels | Pass |
| Full decode | no decoder errors | clean audio/video decode | Pass |
| Integrated loudness | around `−16 LUFS-I` | `−16.2 LUFS-I` | Pass |
| Loudness range | controlled | `5.6 LU` | Pass |
| True peak | at or below `−1.5 dBTP` | `−2.0 dBTP` | Pass |

## Evidence acceptance

- The stable Vercel origin is `https://taptab-eosin.vercel.app/` and returned
  HTTP `200` during the retained verification.
- The genuine readiness response returned `ready`, chain `10143`, block
  `51962184`, and `pass` for `configuration`, `rpc`, `network`, `contract` and
  `bill`.
- A direct RPC call returned chain ID `0x279f`, which is decimal `10143`.
- A direct `getBill(2)` read returned contract state `1`, which the Solidity
  `BillState` enum defines as `Draft`. Its receipt metadata contains
  `subtotalPence: 4850` (`£48.50`).
- The complete deployed contract address remains visible:
  `0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`.
- The retained Monadscan HTML response contains `Source Code Verified` and
  `Exact Match`.
- The separate source card says exactly `MonadVision reports · Sourcify full
  match` and says source matching is not an audit.
- A direct RPC receipt read for Bill `3` settlement transaction
  `0xc232584b63ad27e7aa53b2526a2bcf8ebb6765bd8657cc804b7e76ec48e6d885`
  returned status `0x1` at block `51,739,005`. The video labels it historical
  and states that no new write was made for the recording.
- The final QR was independently decoded to the exact canonical Vercel Bill
  `2` URL.
- The final card states `Testnet MON has no cash value`.

The full machine-readable evidence record is
[`evidence/verification-snapshot.json`](evidence/verification-snapshot.json).

## Picture, voice and caption sync

The last edit was retimed around the unchanged Nora recordings. The principal
sync points are:

| Time | Voice or silence | Picture |
| --- | --- | --- |
| `00:07.520` | local-sample disclosure | complete sample desktop viewport |
| `00:11.820` | whole/shared item claim | complete claim viewport |
| `00:31.540` | fair remainder | opt-in and opt-out cards |
| `00:33.910` | table tip vote | tip-vote state |
| `00:38.280` | change clears consent | approval-reset state |
| `00:45.530` | payment opens after approval | four-of-four review |
| `00:48.140` | each diner funds their allocation | protected-funding state |
| `00:50.800` | sponsor another diner | sponsor state |
| `00:54.660` | £18.91 remains | locked funding state |
| `00:59.070` | exactly funded | exactly funded sponsor state |
| `01:13.530` | Stage Mode | complete Stage Mode viewport |
| `01:23.120` | both protected outcomes | exact-funded state |
| `01:25.250` | exact funding unlocks settlement | exact-funded state |
| `01:28.220` | venue receives nothing | amber venue-£0 card |
| `01:30.850` | refunds open | contributor-owned refund card |
| `01:36.540` | explicit switch to live evidence | green live Vercel card |
| `01:41.970` | Bill 2 on Testnet | verified Bill 2 RPC card |
| `01:48.440–01:56.210` | Monad shared state | verified Bill 2 contract-state panel |
| `01:56.210–02:30.000` | intentional speech-free hold | readiness, source, settlement and QR evidence |

The release SRT and ASS timestamps were derived from the retained, already
approved Nora clips. Captions are also burned into the picture as pre-rendered
overlays because the installed ffmpeg build does not include the `subtitles`
filter. No caption text is generated at playback time.

## Accuracy and production boundary

- Purple scenes are a deterministic local sample and claim no wallet write.
- Green scenes are direct public deployment, RPC or retained explorer
  evidence.
- Amber scenes illustrate the local protected failure/refund branch.
- Bill `2` is the separate live `£48.50` Draft bill. Bill `3` is the genuine
  historical settled bill.
- The readiness response proves public read connectivity. It does not claim a
  newly submitted contribution or settlement.
- Browser control was unavailable under the enforced local policy. It was not
  bypassed. Evidence pages are therefore explicitly labelled verified response
  panels rather than represented as newly recorded browser interaction.
- Source publication or bytecode matching is not a security audit.

The exact delivered voice script is recorded in
[FINAL_NARRATION.md](FINAL_NARRATION.md). Audio, caption and evidence hashes are
recorded in [PROVENANCE.json](PROVENANCE.json).

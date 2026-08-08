# TapTab 2:30 full-window storyboard

> **Planning document:** final picture timings were tightened to match the
> available Nora recordings exactly. The delivered timing and sync record is
> in [FINAL_NARRATION.md](FINAL_NARRATION.md) and [QA_SUMMARY.md](QA_SUMMARY.md).

## Release intent

Produce an evidence-accurate fallback demonstration lasting exactly **2 minutes
30 seconds**. The film first demonstrates the GBP-first product journey in a
clearly labelled local sample, then switches explicitly to genuine public
Monad Testnet evidence. It must prove that the Vercel deployment can read chain
`10143` without presenting a sample action or historical receipt as a fresh
wallet transaction.

## Delivery and framing rules

- Master: `1920 × 1080`, progressive, `30 fps`, exactly `4,500` frames and
  `150.000` seconds.
- Keep the **entire application or browser window visible**. Do not digitally
  zoom, magnify, pan across a crop or cut off navigation, status labels, totals
  or the browser address bar during evidence shots.
- Capture the app in a viewport that fits inside the 1920 × 1080 master. Add
  callouts only in unused margins or as restrained lower thirds; never cover
  the control or state being discussed.
- Use one full-screen source at a time. Do not use split screens, phone mock-ups
  or picture-in-picture for the principal journey.
- Keep a persistent purple pill, **`LOCAL SAMPLE · NO WALLET WRITE`**, visible
  from `00:07.000` through `01:36.000`.
- At `01:36.000`, replace it with a green pill, **`LIVE MONAD TESTNET EVIDENCE ·
  CHAIN 10143`**. No green “confirmed” styling may appear before this cut.
- Use amber only for the cancellation/refund branch.
- Burn in readable captions above the player-control safe area. Leave the final
  URL and disclosure unobscured.
- The voice direction and spoken slots are fixed in [NARRATION.md](NARRATION.md).

## Exact 150-second timeline

The thirteen scene durations are `7 + 10 + 14 + 14 + 14 + 14 + 11 + 12 + 12
+ 13 + 13 + 9 + 7 = 150` seconds.

| Time | Duration | Full-window picture | Required on-screen evidence or label |
| --- | ---: | --- | --- |
| `00:00–00:07` | 7 s | Open on the complete TapTab landing page. Move directly into the app workspace without a logo-only pre-roll. | `TapTab · Nobody fronts the bill` and `Built on Monad` may appear as restrained title text. |
| `00:07–00:17` | 10 s | Show the whole local sample receipt workspace and its `£53.95` total. Keep page navigation and sample-state label visible. | Purple: `LOCAL SAMPLE · £53.95 · NO WALLET WRITE`. Do not display a transaction hash. |
| `00:17–00:31` | 14 s | In one continuous take, select a whole item, then a share of the house red for Amina, Theo and Jules. Let each pound allocation visibly update after the action. | Retain the purple sample label. Optional small callout: `Whole items + selected shares`. |
| `00:31–00:45` | 14 s | Scroll within the full app window to fair remainder and tip controls. Opt one diner in, leave another out, then select a tip vote and show the group result. | `Fair remainder is opt-in` and `Tip chosen together`. Keep all control results visible before moving on. |
| `00:45–00:59` | 14 s | Review and approve the split, reopen one preference, change it and show that prior consent clears. Do not cut between the click and resulting state. | `Any split change clears approvals`. This is still the local sample. |
| `00:59–01:13` | 14 s | Open protected payments, fund the current user's sample allocation and use the sample sponsor action to cover Theo's remainder. Pause on the incomplete amount before the final contribution. | `SAMPLE PAYMENT` and `You cover Theo's remainder`. Show `Settlement locked` while any amount remains. |
| `01:13–01:24` | 11 s | Complete exact sample funding, show the settled state, then open full-screen Stage Mode and hold its room-readable settled progress board. | `Exact funding unlocks settlement`. Do not call this a Testnet transaction. |
| `01:24–01:36` | 12 s | Switch to the separate sample failure branch. Show cancellation or expiry, `£0` to venue, refunds open and an original contributor claiming their own refund. | Amber: `PROTECTED FAILURE PATH · LOCAL SAMPLE`; `Venue receives £0`; `Refund belongs to contributor`. |
| `01:36–01:48` | 12 s | Make an explicit colour and title transition to the actual Vercel deployment. Show the browser address bar, load the canonical Bill 2 URL and hold the full live bill screen long enough to read `Draft`. | Green: `LIVE VERCEL APP · MONAD TESTNET 10143`; show `Bill 2 · Draft`; show the exact canonical URL listed below. |
| `01:48–02:01` | 13 s | In the same full browser, open the Vercel readiness endpoint. Record the genuine response rather than recreating it as a graphic. Hold the JSON after it loads. | Highlight without cropping: HTTP `200`, chain ID `10143`, and `configuration`, `rpc`, `network`, `contract`, `bill` all `pass`. The observed block may change and must be left as captured. |
| `02:01–02:14` | 13 s | Open the deployed contract on Monadscan with the address and source tab visible, then open the MonadVision/Sourcify match page. Use full-page browser shots and hard cuts, not zooms. | Full contract address; `Monad Testnet`; `Published source`; `MonadVision reports · Sourcify full match`; small footer: `Source match is not an audit`. |
| `02:14–02:23` | 9 s | Open the genuine Monadscan receipt for Bill 3's settlement transaction and hold the full browser page on `Success`. | `BILL 3 SETTLEMENT · HISTORICAL REPLAY · NO NEW WRITE`; show hash `0xc232584b…e6d885`. |
| `02:23–02:30` | 7 s | Return to a full-window TapTab live screen, then settle on a clean end card derived from that screen. Keep the Vercel URL, network, contract and disclosure readable until the final frame. | `taptab-eosin.vercel.app`; `Monad Testnet · chain 10143`; `0xa2fb0B3b…46FAA198`; `GBP values are interface references · Testnet MON has no cash value`. |

## Public URLs and immutable identifiers

Use these exact destinations; do not substitute the older Cloudflare URL in
this 2:30 Vercel film.

- Live Vercel application:
  <https://taptab-eosin.vercel.app/>
- Canonical live Bill `2`:
  <https://taptab-eosin.vercel.app/?contract=0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198&bill=2#live>
- Vercel readiness proof:
  <https://taptab-eosin.vercel.app/api/health/ready>
- Monad Testnet chain ID: `10143`.
- TapTab contract:
  `0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`
- Contract and published source on Monadscan:
  <https://testnet.monadscan.com/address/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198#code>
- MonadVision/Sourcify full-match record:
  <https://monadvision.com/contracts/full_match/10143/0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198/>
- Historical Bill `3` settlement transaction:
  <https://testnet.monadscan.com/tx/0xc232584b63ad27e7aa53b2526a2bcf8ebb6765bd8657cc804b7e76ec48e6d885>
- Settlement hash:
  `0xc232584b63ad27e7aa53b2526a2bcf8ebb6765bd8657cc804b7e76ec48e6d885`

## Capture instructions for Monad proof

1. Begin the evidence section only after the explicit transition at
   `01:36.000`.
2. Reload the canonical Bill `2` URL on camera. Show the Vercel hostname in the
   address bar and the full page's Monad Testnet and `Draft` state.
3. Open `/api/health/ready` on camera. Use the response actually returned on
   capture day. The acceptable proof is HTTP `200`, chain ID `10143` and passing
   `configuration`, `rpc`, `network`, `contract` and `bill` checks.
4. If readiness does not meet every condition, stop the recording and repair
   the deployment. Do not replace a failing response with a mock card.
5. Record Monadscan's published-source view and the separate MonadVision page
   reporting the Sourcify full match.
6. Record the retained Bill `3` settlement receipt with `Success` visible. Keep
   the historical-replay label on screen for its entire appearance.

Together, the Vercel hostname, readiness response, live Draft bill, deployed
contract and explorer receipt demonstrate the real integration. None of them
should be described as a newly broadcast wallet action.

## Claim boundaries

- The receipt, claims, fair remainder, tip, approval reset, sponsorship,
  funding, settlement and refund interactions before `01:36` are a **local
  sample**.
- The sample's `£53.95` receipt is distinct from live Bill `2`, which represents
  `£48.50` and remains `Draft`.
- Sponsorship is a demonstrated product capability, not a claim that the
  historical Testnet settlement used sponsorship.
- Bill `3` is the genuine historical settled path. The explorer receipt proves
  its successful settlement transaction; it is not a fresh write made during
  this video.
- The readiness endpoint proves public read connectivity at the recorded time,
  not a fresh contribution or settlement.
- Monadscan's published source and MonadVision's reported Sourcify full match
  prove source publication/matching, not contract safety or an audit.
- Testnet MON has **no cash value**. GBP and USD amounts are familiar interface
  and mainnet-reference values, not an oracle, redemption guarantee or promise
  that Testnet MON can be exchanged at the displayed value.

## Final acceptance checklist

- [ ] Container duration is exactly `150.000` seconds and the frame count is
      exactly `4,500` at 30 fps.
- [ ] The whole application/browser window remains visible; no magnified crop
      appears anywhere.
- [ ] The purple local-sample label remains visible from `00:07` to `01:36`.
- [ ] The switch to green live evidence occurs exactly at `01:36`.
- [ ] The Vercel hostname and canonical Bill `2` Draft state are readable.
- [ ] The captured readiness response is genuine and shows chain `10143` plus
      all five required passing checks.
- [ ] The complete contract address appears on screen.
- [ ] The contract's published-source view and MonadVision's Sourcify report are
      both shown and are not called an audit.
- [ ] The Bill `3` settlement receipt shows `Success` and retains the historical
      replay/no-new-write label.
- [ ] The final disclosure says exactly: `Testnet MON has no cash value`.
- [ ] Nora's Blackpool voice remains natural-speed and narration matches the
      visible state throughout.
- [ ] Captions, music and image all end at `02:30.000`; no narration is cut off.

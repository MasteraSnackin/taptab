# TapTab 2:30 narration plan

> **Superseded proposal:** the delivered master reuses the established Nora
> recordings and has a speech-free public-evidence hold. See
> [FINAL_NARRATION.md](FINAL_NARRATION.md) for the exact release cue sheet.

## Delivery target

- Exact programme length: **150.000 seconds** (`00:02:30.000`).
- The narration slots below sit inside thirteen editorial scenes whose durations
  add to exactly 150 seconds. The recorded voice may end early inside a slot;
  it must never be time-stretched to fill it.
- Read at a calm, assured product-demo pace. Leave the written gaps so the
  interface state and evidence can be read.
- Captions should use `£53.95`, `£48.50`, `10143` and the shortened hashes even
  where the speech input spells a value out for reliable pronunciation.

## Voice direction

Retain the established female Blackpool voice:

- Voice: **Nora - Blackpool Product Guide**.
- Character: light Blackpool/North-West England accent; clear, warm and direct,
  without exaggerated dialect or sales-style excitement.
- ElevenLabs model: **Eleven Multilingual v2**.
- Speed `1.0`, stability `0.50`, similarity `0.75`, style exaggeration `0`,
  speaker boost on.
- Use natural-speed scene exports. Do not pitch-shift, substitute the voice or
  compress pauses to force the duration.
- Pronounce `TapTab` as “Tap Tab”, `Monad` as “Mon-ad”, `GBP` as “pounds”, and
  chain `10143` as “ten thousand, one hundred and forty-three”.

## Timed narration

| Cue | Spoken slot | Editorial scene | Narration |
| --- | --- | --- | --- |
| 01 | `00:00.350–00:06.500` | `00:00–00:07` | **TapTab on Monad lets a table split one bill without one person fronting the money.** |
| 02 | `00:07.350–00:15.800` | `00:07–00:17` | **We begin in pounds, with a clearly labelled local sample. Its actions demonstrate the experience; they are not Testnet transactions.** |
| 03 | `00:17.350–00:29.700` | `00:17–00:31` | **Diners claim whole items or selected shares of wine, starters or a taxi. Each person's pound total updates immediately, while MON stays behind the familiar interface.** |
| 04 | `00:31.350–00:43.500` | `00:31–00:45` | **Only diners who opt in share any unclaimed remainder. The table votes on the tip, so silence never becomes consent to pay.** |
| 05 | `00:45.350–00:57.400` | `00:45–00:59` | **Everyone approves the same split before payment opens. Change a claim, tip, remainder choice or participant, and TapTab clears the old approvals.** |
| 06 | `00:59.350–01:11.300` | `00:59–01:13` | **Each diner funds only their agreed allocation, or sponsors a friend without rewriting who owed it. If a penny remains, settlement stays locked.** |
| 07 | `01:13.350–01:22.800` | `01:13–01:24` | **Once the exact total arrives, settlement unlocks. Stage Mode turns that same table state into a room-readable progress board.** |
| 08 | `01:24.350–01:34.800` | `01:24–01:36` | **Failure is protected too. If an incomplete bill is cancelled or expires, the venue receives nothing, and each contributor claims their own refund.** |
| 09 | `01:36.350–01:46.800` | `01:36–01:48` | **Now we leave the sample and open the live Vercel application. Bill 2 is a publicly readable Draft on Monad Testnet, chain 10143.** |
| 10 | `01:48.350–01:59.800` | `01:48–02:01` | **The readiness endpoint returns HTTP 200. Configuration, RPC, network, contract and canonical bill checks all pass, proving the deployed app can read Monad Testnet.** |
| 11 | `02:01.350–02:12.800` | `02:01–02:14` | **Here is the deployed TapTab contract. Its full address stays on screen. Monadscan publishes the source, and MonadVision reports a Sourcify full match.** |
| 12 | `02:14.350–02:21.800` | `02:14–02:23` | **Bill 3's settlement transaction is confirmed: a historical success receipt, not a fresh write for this recording.** |
| 13 | `02:23.350–02:28.800` | `02:23–02:30` | **TapTab is live on Monad Testnet. Testnet MON has no cash value.** |

The final spoken cue ends no later than `02:28.800`, leaving at least 1.2
seconds of speech-free end-card hold. The music may continue under that hold and
must fade fully by `02:30.000`.

## Caption wording for evidence cues

Use these exact caption forms so numbers and product boundaries are easy to
read:

- Cue 09: `Bill 2 is a publicly readable Draft on Monad Testnet · chain 10143.`
- Cue 10: `HTTP 200 · configuration, RPC, network, contract and bill: pass.`
- Cue 11: `Monadscan: published source · MonadVision: Sourcify full match.`
- Cue 12: `Bill 3 settlement · Success · historical replay, no new write.`
- Cue 13: `GBP values are interface references · Testnet MON has no cash value.`

## Accuracy boundary

- Cues 02–08 describe a deterministic local sample. They must not be described
  or visually styled as wallet writes or live Testnet transactions.
- Sponsorship is demonstrated only in that labelled sample.
- Bill `2` is live and publicly readable, but remains `Draft`; it is not the
  settled bill.
- Bill `3` supplies the historical settled outcome. Its recorded settlement
  transaction is genuine, but the video does not broadcast a new transaction.
- A successful readiness response proves the deployed frontend can read the
  configured Monad Testnet network, contract and bill at capture time. It does
  not prove every wallet journey.
- Published or source-matched code is not an audit.
- Testnet MON has no cash value. The GBP-first display is a familiar interface
  and mainnet-reference presentation, not a redemption promise or claim that
  Testnet MON is worth the displayed amount.

# TapTab 30-second multi-wallet evidence cut

This cut summarises the sealed public Monad Testnet rehearsal in
`docs/submission/monad-testnet-multiwallet-evidence.json`. It is generated from
RPC receipts and historical-call evidence, not recreated wallet footage.
Testnet MON has no cash value and no private key is included.

## Bill 3: successful three-wallet path

- CreateBill:
  `0xf0639e3be7b651272f1e0934ef8097c6fc68a839dc8dafd5079bb2c0a16e4a82`
- Alice contribution:
  `0xa541250066d37439241b43591badcac560cc4048d0dac386740fd4cd1a81e035`
- Bob contribution:
  `0xc5c7709a918bbdfefc0c36660f3538f804ebb9ddc5e6825bb6d8a6749c2df2b9`
- BillSettled:
  `0xc232584b63ad27e7aa53b2526a2bcf8ebb6765bd8657cc804b7e76ec48e6d885`
- ProceedsWithdrawn:
  `0xd5c6d4794fd7a19a5af3bee8f65eaeb3cce8988778c64f3ab4fe3f591178774a`

Three distinct wallets joined, claimed deterministic item shares, approved one
split digest and funded exactly `0.001125` Testnet MON each. Before final
funding, a historical `eth_call` at block `51738556` decoded
`BillNotFullyFunded` with `0.001125` MON funded and `0.003375` MON due.

## Bill 4: protected cancellation and refunds

- BillCancelled:
  `0x8f1b52276c4aa701d7db70589af003e1040cd3ad618f37f5c506cf38cf76ab52`
- Alice RefundClaimed:
  `0x396144f991a81f1950c8603269d502e912483eb62e10107df7e5d033afdec450`
- Bob RefundClaimed:
  `0xf6ed1a75337cf215077aeba890dfd3a6e9e5f8d85aaa991060c02fffbfca9384`

The cancelled bill paid the venue nothing. Both original contributors claimed
their own refunds.

## Evidence boundary

- Network: Monad Testnet, chain ID `10143`.
- Contract: `0xa2fb0B3bf41B0B50687f4807e8a1ccc346FAA198`.
- Sealed transaction record: 31 contract transactions.
- The video is a concise visualisation of the sealed JSON record. It does not
  claim to be an uninterrupted screen recording of the three wallets.

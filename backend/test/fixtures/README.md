# Live-node fixtures

`live-node-2026-07-16.json` is a snapshot of a local midgard-node
(`tx-validation`) deployment, captured 2026-07-16 through the backend's own
code paths (`decodeTransaction`, `computeBalance`, `getAddressUtxos`,
`findOutRef`). It exists so codec and balance tests run against real
Midgard-native CBOR without a running node.

## What each section pins

- `transaction`: a committed L2 transfer (`immutable` row) and its decoded
  view. The view was verified byte-correct against the live node: the decoded
  `txId` matches `immutable.tx_id`, and the output addresses and amounts match
  the ledger rows the node produced.
- `mempoolLedger`: all 9 ledger rows at capture time. Two output encodings
  appear: Midgard-native map-form (`a2…`) and CML array-form (`82…`) written
  by the node's genesis seeder. The codec decodes map-form and throws
  `output must be a map` on array-form.
- `depositsUtxos`: one `projected` and one `consumed` deposit, for the
  spendable predicate (`source_event_id IS NULL OR projected_header_hash IS
NOT NULL`). The projected-inclusion branch is live-verified; an
  `awaiting`-status exclusion row does not appear here because none existed at
  capture time.
- `expectedBalances`: per-address spendable balance and `undecodedOutputs`
  count. Three of the four addresses were independently cross-checked against
  the transfer amounts and the deposit value; the pure-genesis address
  (balance 0, all 3 outputs undecodable) is pinned from implementation
  behavior only.
- `findOutRef`: one outref present in `mempool_ledger` (resolves) and the
  transfer's own spent input (resolves to `null`, the documented best-effort
  case).
- `block`: the single committed block header row.

## Epistemic status

Balances for addresses holding array-form outputs are undercounts by design:
the decoder skips what it cannot decode and reports the count in
`undecodedOutputs`. These fixtures pin that behavior; they do not assert the
undercounted values are the addresses' true holdings.

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

The pinned codec (Midgard `f4cf28ca1`) rejects this snapshot's transaction,
which predates fixed-width out-refs and the current field preimages. The
balance cases still read it; the transaction cases read the capture below.

# `live-node-2026-10-19.json`

The live Preprod node's only committed transaction (`immutable`) and its only
UTxO (`confirmed_ledger`), read on 2026-10-19 from the deployment with manifest
`c3d841f2e75d61e90a394f36789ea79d67bfac7801aed325ca552dfb5b8fbfbb`. That
node's consensus profile equals Midgard `f4cf28ca1`'s. `txId` is the id the
node stored, so a decoder that recomputes it is checked against the node, not
against itself.

It holds no deposit, forced transaction, script, redeemer or mint: the
deployment had none. Those shapes come from `shape-corpus.json` and from
transactions the tests build with Midgard's own encoders.

# `manifest-v1-*-preprod-testing.json.gz`

Deployment manifests written by Midgard's own test helper,
`finalizedManifest()` (`demo/midgard-core/tests/deployment-manifest-identity.finalized-manifest.ts`),
at the commit in the name, with the `preprod-testing` profile. The
`f4cf28ca1` one is the manifest the pinned packages accept. The `b9511834c`
one carries the later consensus profile and is the case they refuse. Gzipped
because each is about 490 KB of compiled scripts and neither is edited.

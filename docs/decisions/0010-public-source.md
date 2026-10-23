# 10. A public source: the explorer's archive and the node's public API

Accepted 2026-10-20. Amends ADR 0007 by adding a source; replaces nothing.
Verified against fixtures only: no live libp2p fetch has run yet, and none
under Node 24 (`backend/vendor/PROVENANCE.md`).

## Decision

The backend has a second L2 source, selected with `L2_SOURCE=public`. It reads
no database. Block and transaction pages come from the explorer's own archive
of DA payloads, and live state comes from the Midgard node's public HTTP API.
`replica`, the default, is unchanged.

The archive is written by `pnpm ingest`, a separate command. It fetches each
block's payload from a data availability peer over libp2p, verifies it with
Midgard's own header verifier, and publishes it with everything a page needs:
the verified header, record pages of at most 50 records and 1 MB, and ordered
block and transaction lists. The API server never loads the ingester, libp2p
or a payload decoder; a test holds it to that.

Every archive key starts with the deployment's manifest id, so the server only
ever reads the deployment its manifest names.

## What each route does

`backend/src/public/catalogue.ts` decides every catalogue route for this
source, and a test fails when a route has no decision. Routes this source
cannot answer return 501 with `unavailable: unsupported_by_source` and the
reason. A route that needs the node and does not get an answer returns 503
with `upstream` and the node's `Retry-After`.

## What the decision costs

- **No heights.** Blocks are ordered by their headers' end times and by the
  `prevHeaderHash` links between archived blocks. Two branches stay two
  branches; no rollback is inferred from them.
- **Settlement is not observed.** The source reads no state queue, so being on
  Cardano, data availability, maturity, merges and payouts are each shown as
  unknown, with the reason. A merge or removal appears only when an outcome is
  recorded.
- **Address pages, metrics, asset holders and bridge lists are unavailable**
  until the archive holds what they need, or the address contract can state
  that a balance is incomplete.
- **Its own start command.** `pnpm dev` and `pnpm readiness` check the node
  database, so public mode starts with `pnpm dev:server` or `pnpm start`.
  `pnpm ingest` runs through `ts-node`, a development dependency.
- **Readiness depends on the node.** `/readyz` fails when the node does not
  answer for the same deployment. Archived pages keep serving regardless,
  because serving never consults readiness.

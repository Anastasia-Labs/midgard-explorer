# 9. Settlement is what the node reports

Accepted 2026-09-17, carried out 2026-09-18. Narrows ADR 0006 and ADR 0007 on one
point, and defers ADR 0008.

## Decision

The explorer does not check Cardano settlement for itself. A block's settlement
transaction is the hash the Midgard node recorded, shown as the node's record
and never as a confirmation. The explorer-owned Cardano index remains in the
repository and stops being a settlement source.

`L1_CONFIRMATION_SOURCE` selects which of the two a deployment is. It defaults
to `none`. It is transitional: it exists so this can be reversed while it is
reviewed, and it goes away with the index lane once that is settled.

> **As carried out, 2026-09-18.** The two paragraphs above describe the first
> step and are kept because the decision was taken in that form. The flag did
> what it says and is gone: the index lane went with it, the setting is written
> by nothing and read by nothing, and there is one source rather than a choice
> between two. The database, its schema, its migrations and its volume are
> retained, stopped, so the decision is still reversible by a person. What that
> reversal now costs is code, not configuration. See "Carried out" below.

## What the decision costs, stated plainly

**Independent confirmation is unavailable within this explorer.** Three things
follow, and none of them is small:

1. A hash the node recorded but never confirmed on Cardano cannot be detected
   here. The page will show it.
2. A commitment the node never recorded cannot be discovered here. Following
   node-reported hashes can only check hashes the node names; the index found
   its rows by scanning Midgard's script addresses and policy assets, which is
   the only mechanism that reaches what the node's journal omits. Another
   operator's block, or anything lost to a node database reset, is invisible.
3. The response carries one observation where it carried two.

**It is not unknowable.** Every settlement hash is shown in full and can be
copied, and a reader can check it in any Cardano explorer. The capability is
also restorable: the index, its schema, its data and its ingest code are
untouched, and `L1_CONFIRMATION_SOURCE=index` restores the second observation.
What changes is that this explorer no longer performs the check for the reader.

## What the response loses

This is a removal, not a relabelling.

| Gone where no source is read | What it was |
|---|---|
| `cardano_l1_index` evidence row | The second observation of the same block |
| `l1ObservedAsOf` | When Cardano was last observed |
| `matched` | The two sources named the same transaction |
| `mismatch` | They named different ones, both fresh and identified |
| `index_only` | Observed on chain with no node record |
| `stale` | They differed, and the index was too far behind to say more |

Three verdicts remain reachable, and the disagreement states are not deleted
from the vocabulary: they stay in the contract and in the resolver, reachable in
`index` mode.

| Verdict | When |
|---|---|
| `node_reported` | The node recorded a settlement transaction. Requires a hash; a record without one is not this |
| `none` | The node recorded none, and the node's own data is current enough for that absence to mean something |
| `unavailable` | The node recorded none and its data is a copy of unestablished currency, so nothing is established |

`comparability` carries `no_independent_source`, which says a comparison was
never attempted rather than that one was attempted and failed.

## Why

**The index had stopped, and nothing said so.** Checked 2026-09-17: all three
sync cursors last advanced on 2026-09-02 at 19:07 UTC, 14 days and 22 hours
earlier, holding 281 transactions in 13 MB. The freshness rules did their job,
so every block was rendering `stale` rather than a false `matched`. The
capability was already absent in practice; what was missing was a deployment
that said so on purpose.

**The node supplies the identifiers.** Also checked 2026-09-17: all 9 finalized
blocks carry `submitted_tx_hash`, all 13 deposits carry an L1 hash, and the one
withdrawal carries one. Node-sourced mapping works. It is not proof of
settlement, and no surface may present it as one.

**The cost of the alternative is a poller, not a table.** Keeping independent
confirmation means keeping a Koios dependency with no service level, a 15-day
backfill, leadership election, deployment binding, reorg handling, a readiness
scope and the obligation to notice when it stops. The staleness above is
evidence that the obligation was not being met.

## Deployment order

**The compatible interface goes out first, then the backend configuration.**

The interface does not validate responses at runtime: `lib/api.ts` returns
`res.json()`, and the contracts are used by tests rather than by the running
page. A bundle built before this change has no wording for `node_reported`, so
a backend emitting it to that bundle rendered an undefined verdict and threw
during render, taking the page down rather than the panel.

This release adds a fallback for a verdict a bundle does not know, which
protects **this bundle and later ones**. It cannot reach a bundle already
deployed, which is the one at risk during the switch. So:

1. Deploy the frontend build that contains this change.
2. Then start the backend with `L1_CONFIRMATION_SOURCE=none`.

Reversing runs the other way: set the backend back to `index` and restart it
before rolling the interface back.

Nothing in this repository coordinates the two. `docker-compose.yml` provisions
the response cache and PostgreSQL only; the backend is a Node process and the
interface is a Next server, started separately. The order above is therefore an
operator instruction, not something a deployment tool enforces.

**The setting is read once, at boot.** `parseConfig(process.env)` runs at import,
so changing the variable requires restarting or redeploying the backend. There
is no dynamic reload.

## What the first step did not do

No route was retired, no page was removed, no link was redirected, the indexing
loop still runs where it is enabled, and no schema, migration or row changed.
`/api/l1/*` and the Cardano pages answer exactly as before. The block page's
Cardano evidence tab still renders the index and now names it as the source.

## Carried out, 2026-09-18

The index is decommissioned. What that meant, in the order it was done:

**The Cardano pages read the node.** `/l1` lists what the node recorded: the
commitment transaction it submitted for each block, and the deposits,
withdrawals and forced-transaction orders it read, from four columns of the
node's own tables. `/l1/transaction/:hash` says what Midgard records about one
transaction and links out for the transaction itself. `/l1/validator/:hash`
describes what the manifest declares and links its address out.
`/l1/commitments` listed headers the index had observed and now redirects to
`/blocks`, which answers the same question from the node's records.

**Four surfaces that still read explorer-owned storage were fixed**, each
verified against a stopped index on 2026-09-17:

| Surface | What it did | What it does |
|---|---|---|
| `/api/search` | One of six lookups read the index inside a `Promise.all`, so a hex query of six or more characters returned 500 with the other five | Reads the node only. A settlement hash resolves through the finalization journal to its block |
| `SourceBanner` | Read the index's summary, so every page announced "the backend could not be reached" | Reads `/api/source`, which is the node's own answer |
| Deployment identity | `checkBinding` read `index_binding`, so every response said `degraded` | `configured` or `unconfigured`, from the manifest |
| Block page's Cardano tab | Rendered the index | Removed with it |

**Identity says what it is.** `identityState` was `verified` or `degraded`,
where `verified` meant the index confirmed a binding. It is now `configured` or
`unconfigured`: a manifest that parses says what an operator intended, and
nothing checks that claim. No surface may present it as verified, and the
validator label's "manifest" badge, whose tooltip said "verified against", went
with the pages that used it.

**The indexer is gone, and its data is not.** `backend/src/indexer/` and its
scripts, tests, configuration (`INDEXER_POSTGRES_URL`, `KOIOS_BASE_URL`,
`L1_SYNC_*`, `L1_CONFIRMATION_SOURCE`) and readiness scopes (`/readyz/l1`,
`/readyz/full`) are removed. `prisma-indexer/` keeps the schema and its
migrations, and the `explorer-postgres` service keeps its volume, both stopped
and unread, so reverting this commit and starting them restores the lane. No
migration was run, no table dropped and no row deleted.

**What the explorer gave up is unchanged from what this record said before it
was carried out**, and is the reason to read the section above: a hash the node
never recorded cannot be found here, and a hash it recorded that never confirmed
cannot be detected here.

## Consequences

- The strongest settlement claim on a page names its source. The journey
  headline reads "Final on Cardano, as the node records it", the finalization
  status tooltips attribute to the node, and the settlement panel states that
  nothing corroborated the hash.
- A reader who needs independent confirmation must check Cardano themselves.
  Making that a link out of the explorer is the next step and is not decided
  here.
- **The setting does not stop the indexer.** `L1_CONFIRMATION_SOURCE=none`
  decides what a settlement verdict may rest on. `L1_SYNC_ENABLED` decides
  whether this process runs the indexing loop, still defaults to true, and is
  unchanged. A deployment with both defaults keeps polling Koios, keeps writing
  to the index database and keeps its readiness scope, while no page reads any
  of it for settlement. The operational saving arrives when the loop is turned
  off, which is a later step.
- ADR 0008 is deferred. Nothing in it was built, and no durable L2 store may be
  built without a stated requirement.

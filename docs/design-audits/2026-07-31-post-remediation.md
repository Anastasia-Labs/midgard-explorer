# Design Audit · 2026-07-31 (post-remediation)

Second run on the same day as the baseline, after the P0 and P1 remediation.
Same rubric, same seven pages, same fixture dataset, so the scores are
comparable. Capture conditions match the baseline with one correction: the dev
server now runs with `NEXT_PUBLIC_NETWORK_LABEL=Fixture`, so the amber "Network
not configured" badge in the baseline shots is gone. That badge was an
environment artifact, not a product change.

The overview commit was still uncommitted at capture time; everything else in
this audit is committed.

## Verdict

The information problem is fixed. Every page now says what a reader needs to
choose what to open, and the transaction page answers the question that
distinguishes this product: where the transaction is and whether it is final on
Cardano L1. The remaining weakness is no longer information, it is
responsiveness: mobile is the lowest-scoring criterion on every page, and the
transaction detail page got taller as it got better.

## Scorecard

| # | Criterion | Overview | Blocks | Txs | Deposits | Block | Tx | Address | Site |
|---|---|---|---|---|---|---|---|---|---|
| 1 | First-impression clarity | 7.5 | 7.5 | 7.5 | 7.5 | 8.0 | 8.5 | 7.5 | **7.7** (+0.7) |
| 2 | Visual hierarchy | 6.5 | 7.5 | 7.5 | 7.0 | 7.5 | 8.0 | 7.0 | **7.3** (+1.4) |
| 3 | Spacing, alignment, grid | 7.5 | 8.0 | 8.0 | 7.0 | 8.0 | 8.0 | 8.0 | **7.8** (+0.9) |
| 4 | Typography | 8.0 | 7.5 | 7.5 | 7.5 | 8.0 | 8.0 | 6.5 | **7.6** (0.0) |
| 5 | Color semantics and contrast | 8.0 | 8.0 | 8.0 | 8.0 | 7.5 | 8.0 | 7.5 | **7.9** (+1.4) |
| 6 | Rhythm and content density | 7.5 | 7.5 | 7.5 | 8.0 | 7.5 | 7.5 | 7.5 | **7.6** (+1.6) |
| 7 | Navigation and wayfinding | 8.0 | 7.5 | 8.0 | 7.5 | 8.0 | 8.5 | 8.0 | **7.9** (+0.6) |
| 8 | Responsive integrity | 7.0 | 7.0 | 7.0 | 6.5 | 6.5 | 6.5 | 6.5 | **6.7** (+0.5) |
| 9 | Motion quality and fallbacks | 7.0 | 7.0 | 7.0 | 7.0 | 7.5 | 7.5 | 7.0 | **7.1** (0.0) |
| 10 | Brand consistency | 8.0 | 8.0 | 8.0 | 8.0 | 8.0 | 8.0 | 7.5 | **7.9** (+0.3) |
| | **Page** | **7.5** | **7.6** | **7.6** | **7.4** | **7.7** | **7.9** | **7.3** | **7.6** |

Site **6.8 → 7.6**. Per page: Overview +0.7, Blocks +1.2, Transactions +0.6,
Deposits +0.2, Block +0.5, Transaction +0.8, Address +1.1.

The same caveat as the baseline applies: this number is an ordinal for tracking
movement between audits, not a measurement. It averages pages equally and has no
user data behind it. The per-criterion rows carry the meaning.

## What moved, and why

**Content density +1.6 and hierarchy +1.4** are the largest gains, and they came
from the same work: every list row now carries state. `/blocks` went from two
columns to five, `/transactions` from four to six, the address history from two
to six, and the overview panels from hash-and-age to height, settlement stage and
transaction count. The transaction page leads with lifecycle, inclusion and
settlement instead of a fee counter.

**Color semantics +1.4** came from the status registry migration plus encoding
state class in shape and weight. On `/deposits`, Awaiting, Projected, Consumed
and Finalized were four near-identical pills in the baseline; they are now
distinguishable in monochrome by ring, dot and check glyphs.

**Spacing +0.9** is almost entirely the `SummaryBand` fix. Block and address went
from 5.0 to 8.0 on that criterion by removing painted empty cells.

**Typography and motion did not move.** Nothing was done to either. Typography is
held down by the address page, where native assets are still raw policy hex,
undecoded asset names, and a `4500000000` quantity printed without grouping while
every ada amount beside it is grouped.

## Findings

### P1 — clearly hurting quality

**1. Mobile is now the binding constraint on every page.** Responsive integrity
is the lowest criterion sitewide (6.7) and no page scores above 7.0.

Measured on the transaction page at 390x844 rather than estimated:

| Region | Top | Height |
|---|---:|---:|
| Lifecycle chips | 354 | 26 |
| Admission timeline | 396 | 343 |
| Inclusion and settlement band | 755 | 197 |
| **Status region total** | **354** | **598** |
| Summary band | 967 | 156 |
| Tab list (start of the body) | 1143 | 41 |
| Document | | 1947 |

Three consequences. Finality is not visible in the first viewport: the
settlement band ends at 952, past 844. The transaction body starts 1.35 screens
down. And the three regions restate the same sequence three times, because the
chips, the timeline and the band each re-render the lifecycle from a different
angle.
*Fix:* one journey component fed by `{ executionStatus, admission, inclusion,
finalization }`, with per-stage timestamps, attempt count and submit source
behind a disclosure. Compressing 598px to roughly 140px puts the tab list near
685px and finality above the fold.

**2. The overview's two panels no longer balance.** Recent blocks rows are
shorter than recent transactions rows, so the blocks panel ends about 120px above
its neighbour (`home-d-L-fold.png`).
*Fix:* equalise row height, or let the panels size independently rather than
sharing a grid row.

### P2 — polish

**3. Native assets remain raw.** Policy IDs and asset names undecoded, quantity
ungrouped (`address-ADDR-d-L.png`). Carried from the baseline as finding 13.
Printable name decoding and grouping are cheap and local; CIP-14 fingerprints
still need a hashing dependency and a semantics check.

**4. Detail pages still end with dead space and no next action.** The rejected
transaction page has roughly 150px of empty area before the footer
(`transaction-TXREJ-d-L-fold.png`). Carried from the baseline as finding 16.

**5. UTxO flow is still two lists.** No totals, no balance line, no label on the
change output, no disclosure of unresolved inputs. Carried as finding 17, and now
inconsistent with the address page, which does state its exactness rules.

**6. Bridge tables still jitter.** Rows carrying a `+3 assets` chip wrap the ada
symbol and grow taller. Carried as finding 14.

**7. The lifecycle chip row scrolls horizontally on mobile with no affordance.**
It is a deliberate `overflow-x-auto` container (`components/ui/lifecycle.tsx:19`),
not a layout break, but the last chip is clipped mid-word with nothing indicating
more content.

### P3 — ideas

**8.** Still no visual signature: the design is high-quality neutral developer
product, and the tree motif from the website brand does not appear.

**9.** Still no operational metrics or activity chart. The overview's largest
type remains two cumulative totals, which is why hierarchy scored 6.5 there,
the lowest cell on the board.

## Gap to 10

**Responsive integrity (6.7)** is now the single highest-value criterion to work
on, and it is the one the remediation barely touched. Every other criterion is
within 0.6 of the sitewide average; this one is 0.9 below it.

**Hierarchy (7.3)** is held back almost entirely by the overview. The detail
pages now rank correctly. Replacing the two cumulative totals with operational
metrics is the specific fix, and it is the only remaining item from the reviews
that needs new backend aggregates.

**Typography (7.6)** moves when asset display does. It is one page and one
component.

**Motion (7.1)** was scored in both audits without examination beyond confirming
that `prefers-reduced-motion` exists. A pass over `app/globals.css` after review
found two things that a 9 would not have:

- `main > *` carries a blanket 0.24s fade (`globals.css:88-89`). Every direct
  child of every page animates on every navigation, whether or not anything
  meaningful changed. Motion should mark events, not page loads.
- `.mg-pulse` runs `infinite` (`globals.css:111`) and is applied to the current
  lifecycle stage (`components/ui/lifecycle.tsx:80`). A transaction sitting at
  "pending commit" pulses forever on an otherwise static page. Reduced motion
  clamps the iteration count, so the fallback is correct; the default is not.

The motion score stands at 7.1 because neither is a defect a visitor would call
broken, but neither is deliberate either. A real motion pass animates state
changes: a journey stage advancing, a row arriving in a live feed, pending
becoming committed, a copy action confirming.

## Comparison with the baseline

Every P0 and P1 finding from the baseline is closed. Specifically: the painted
grey cells, the blocks list with no height, the two-column address history, the
look-alike bridge badges, the contradicting status maps, the inconsistent
currency symbol, the inverted hierarchy, the duplicate search, the mobile
overview length, and the two rejection timestamps. The skip-link finding was
withdrawn as false during review.

Two things the baseline predicted correctly: fixing `SummaryBand` moved block and
address from 5.0 to 8.0 on spacing, and the row contracts were the gate on
density. One thing it got wrong: it treated mobile as a compression problem that
the row work would help. The row work made mobile denser per row and left the
page-length problem untouched, so responsive integrity gained only 0.5.

One defect surfaced during remediation that neither this audit nor the earlier
reviews caught by inspection: the overview health indicator failed hydration when
its client-only query resolved before hydration, discarding the server-rendered
subtree. It was found by reading the dev server log after a capture, not by
looking at pixels. Worth adding to the audit procedure: check the dev log for
uncaught errors during capture.

## A limit of this audit's method

Both runs scored components: a band, a table, a badge, a page. That is why the
findings read as a list of fixes and why the remediation moved eight criteria a
little rather than a few criteria a lot. The rubric cannot see that the
transaction page tells its story three times, because each telling is
individually well made.

The next stage of work is not another pass down this findings list. It is a
redesign around journeys: one component for a transaction's path from admission
to L1 finality, reused as a block's settlement path, a bridge event's path, and
a compact stage indicator inside list rows. That single change is what moves
responsive integrity, hierarchy, motion and brand at the same time, because they
are all downstream of the same duplication.

Audits after that one should score journeys, not sections.

## Next audit

1. Re-score responsive integrity after any mobile work; it is the stated target.
2. Re-check the overview panel balance and hierarchy after operational metrics land.
3. Re-check typography on the address page after asset-name decoding.
4. Run a real motion pass rather than confirming the media query exists.
5. Capture against preprod data to retire the synthetic-value caveat.
6. Read the dev server log during capture and treat uncaught errors as findings.

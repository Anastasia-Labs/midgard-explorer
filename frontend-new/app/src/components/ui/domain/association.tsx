import type { Association, DeploymentContext } from "@midgard-explorer/contracts";
import { Callout, Card } from "../base/layout";
import { Identifier } from "./identifier";
import { L1TxLink } from "./l1link";
import { Timestamp } from "../base/timestamp";
import { formatDuration } from "../../../lib/format";

/**
 * What Cardano says about this record, and how sure the explorer is.
 *
 * One component for every page that has an association, because the alternative
 * is the same relationship phrased slightly differently on the block page, the
 * transaction page and each bridge listing, which is the state this whole area
 * started in: six spellings of one idea and nothing saying they were the same.
 *
 * Two rules it exists to keep. Both hashes survive a disagreement, because the
 * disagreement is the finding and showing one would hide it. And an index that
 * is behind is described as behind, never as a denial: the explorer once printed
 * "not attributed" for blocks the index had attributed perfectly, and a defect
 * read as index lag for as long as it existed.
 */

type Tone = "neutral" | "success" | "warning" | "danger";

/** What each verdict means in words, kept beside the tone so a reader is never
 * shown a colour without a sentence. */
/**
 * Relationships that record where something CAME FROM, rather than whether a
 * block settled.
 *
 * A deposit's L1 hash is the transaction that funded it, and the node is the
 * only source that has one; the Cardano index is never consulted for a second
 * opinion. Telling a reader that such a row is "waiting for index coverage"
 * describes a comparison that was never attempted, which is the same class of
 * false absence as the block page's old "not observed" message.
 */
const PROVENANCE_KINDS: ReadonlySet<string> = new Set([
  "deposit_origin",
  "withdrawal_request",
  "forced_transaction_order",
]);

/** What `node_only` means for a provenance relationship: everything there is,
 * not something still pending. */
const PROVENANCE_NODE_ONLY = {
  tone: "neutral",
  title: "Recorded by the node",
  detail:
    "This is where the record came from on Cardano, as the node observed it. No second source is compared for this relationship.",
} as const;

/**
 * What a verdict says where this deployment reads no independent source.
 *
 * Keyed separately from `VERDICT` rather than replacing entries in it, so the
 * two-source wording is untouched for a deployment that still compares. Only
 * three verdicts are reachable here, and each has to carry the same sentence:
 * the node is the source, and nothing checked it.
 */
const NO_INDEPENDENT_SOURCE: Partial<
  Record<Association["reconciliation"], { tone: Tone; title: string; detail: string }>
> = {
  node_reported: {
    tone: "neutral",
    title: "Settlement transaction reported by the node",
    detail:
      // No "open it in a Cardano explorer" here. The hash beside this panel
      // still links to this explorer's own page for it, so promising an
      // outward link describes a page that does not exist yet. The copy
      // button is what a reader can act on today.
      "This is the Cardano transaction the Midgard node recorded for this record. This explorer does not check Cardano itself, so the hash is the node's own report and not a confirmation. Copy it to check it on Cardano.",
  },
  none: {
    tone: "neutral",
    title: "No settlement transaction recorded",
    detail:
      "The node has recorded no Cardano transaction for this record. Nothing else is consulted here, so this is what the node reports rather than a search of the chain.",
  },
  unavailable: {
    tone: "warning",
    title: "Settlement could not be established",
    detail:
      "The Midgard data being read is a copy that is not known to be current, and it holds no settlement transaction for this record. A newer record may exist. This says nothing about whether settlement happened.",
  },
};

const VERDICT: Record<
  Association["reconciliation"],
  { tone: Tone; title: string; detail: string }
> = {
  // Reached only by a backend that sent the state without saying why, which no
  // current one does. The wording holds for both.
  node_reported: {
    tone: "neutral",
    title: "Settlement transaction reported by the node",
    detail:
      "This is the Cardano transaction the Midgard node recorded. Nothing shown here corroborates it.",
  },
  matched: {
    tone: "success",
    title: "Node and index records agree",
    detail: "The node's record and the explorer's own Cardano index name the same transaction.",
  },
  node_only: {
    tone: "neutral",
    title: "Recorded by the node, absent from a current index",
    // Settlement only. Deposit, withdrawal and forced-transaction rows carry
    // PROVENANCE, where the node's hash is the whole answer and no second
    // source was ever consulted; telling a reader those are "waiting for index
    // coverage" describes a comparison that was never attempted.
    //
    // The wording stops short of naming a cause. Lag is the likely explanation
    // and not the only one, and `NODE_ONLY_CURRENT` below says so when the
    // index is current enough for lag to be the wrong story.
    // Reached only when the index was current and identified, so lag is not an
    // available explanation and is not offered as one.
    detail:
      "The explorer's chain index is current and holds no record of this transaction. That is not evidence that settlement did not happen; this index has not observed it.",
  },
  index_only: {
    tone: "neutral",
    title: "Seen on Cardano, with no node record",
    detail: "The explorer observed this on chain and the node has no finalization record for it.",
  },
  mismatch: {
    tone: "danger",
    title: "The two sources disagree",
    detail:
      "The node and the chain index name different transactions, and both are shown below. No single hash is presented as the answer.",
  },
  // Overridden by NOT_COMPARABLE below whenever the backend said WHY, which is
  // every backend that carries `comparability`. This remains for one that does
  // not, and for that case lag really is the most likely explanation.
  stale: {
    tone: "warning",
    title: "The chain index is too far behind to compare",
    detail:
      "The two sources differ, but the index has not caught up, so this is lag rather than a disagreement worth acting on.",
  },
  unavailable: {
    tone: "warning",
    title: "The Cardano index could not be read",
    detail: "This says nothing about whether settlement happened.",
  },
  none: {
    tone: "neutral",
    title: "No Cardano settlement yet",
    detail: "Nothing has been submitted for this record.",
  },
};

/** Plain names for the five relationships. "Settlement" and "provenance" are
 * different claims: a deposit's hash is where funds came from, and a
 * withdrawal's is where the request was made, not where a payout landed. */
const RELATIONSHIP: Record<Association["kind"], string> = {
  block_settlement: "Block settlement",
  l2_transaction_settlement: "Settled through its block",
  deposit_origin: "Deposit origin",
  withdrawal_request: "Withdrawal request",
  forced_transaction_order: "Forced transaction order",
};

const SOURCE_LABEL: Record<string, string> = {
  midgard_finalization_journal: "Midgard node",
  midgard_bridge_record: "Midgard bridge record",
  cardano_l1_index: "Explorer's Cardano index",
  deployment_manifest: "Deployment manifest",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // `dt` and `dd`, not two spans. A `dl` may hold only dt/dd groups, script,
    // template or div, and a div inside it must itself hold the dt/dd pair, so
    // the span version failed axe's definition-list rule on every page that
    // rendered this panel.
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <dt className="text-sm text-text-3">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/**
 * `stale` covers four situations, and they do not read the same to anyone.
 *
 * The single message said "the index is too far behind to compare", which is
 * true only of the first. An index that has never completed a pass is not
 * behind; a deployment whose identity is unverified is not behind; and the
 * fourth is not about the index at all, it is Midgard data read from a copy.
 * Each of those calls for something different from whoever is reading, so each
 * says its own thing.
 */
const NOT_COMPARABLE: Partial<Record<string, { title: string; detail: string }>> = {
  index_lagging: {
    title: "Too far behind to compare",
    detail:
      "The explorer's chain index is far enough behind that a difference between the two records would not mean anything yet. Both are shown below.",
  },
  index_freshness_unknown: {
    title: "The index has not completed a pass",
    detail:
      "The explorer's chain index has never reported a completed reconciliation, so there is no coverage to compare against. Both records are shown below.",
  },
  identity_unverified: {
    title: "The two sources are not known to describe one deployment",
    detail:
      "This index is not confirmed to belong to the deployment the node is running. Two sources reading two deployments are supposed to name different transactions, so nothing here is evidence of a problem.",
  },
  // One reason, three sources: a snapshot, a standby that is behind, and a
  // standby whose currency could not be established. "A fixed copy" was true of
  // the first and false of the other two, so the wording says only what holds
  // for all three and the source row below names which one is being read.
  l2_source_not_current: {
    title: "Midgard data is not known to be current",
    detail:
      "These Midgard figures come from a copy rather than the live node: a snapshot, or a standby that is behind or of unestablished currency. An absence in them is a fact about that copy and not about Midgard. Both records are shown below.",
  },
};

/**
 * Whether a settlement transaction is recorded and nothing is in dispute about
 * it.
 *
 * Pages use this to decide placement rather than testing for `matched`, which
 * was the same question while comparison was the only way to answer it. A
 * deployment that reads one source reaches `node_reported` instead, and the
 * pages that tested the old value put a full-width notice above every settled
 * transaction and dropped the evidence panel that used to sit in its tab.
 *
 * It says nothing about corroboration. The panel's own wording carries that,
 * and a caller that needs the distinction reads `reconciliation` directly.
 */
export function hasRecordedSettlement(
  association: Association | null | undefined,
): association is Association {
  return (
    association?.reconciliation === "matched" || association?.reconciliation === "node_reported"
  );
}

/** A state this build has no wording for. Never a verdict: it says only that
 * the panel cannot speak for it, which is the one honest thing left. */
const UNRECOGNIZED = {
  tone: "warning" as Tone,
  title: "This explorer does not recognise the state of this record",
  detail:
    "The backend reported a settlement state this page has no wording for, so nothing is stated about it here. The source records below are shown as they were returned.",
};

export function CardanoAssociation({
  association,
  context,
  compact = false,
}: {
  compact?: boolean;
  association: Association | null | undefined;
  context: DeploymentContext | null | undefined;
}) {
  if (!association) return null;
  // Provenance says something different from settlement when only the node has
  // spoken, so the wording branches rather than one message covering both.
  // No freshness test here, deliberately.
  //
  // This briefly decided the wording from `context.freshness`, which is the L2
  // SOURCE's freshness: a live node made the panel announce that the Cardano
  // index was current, whatever the index was doing. The only freshness that
  // answers this question belongs to the index, the backend is the only place
  // that has it, and `reconcile` now uses it: `node_only` already means the
  // index was current, identified, and held nothing.
  const notComparable =
    association.reconciliation === "stale" && association.comparability !== undefined
      ? NOT_COMPARABLE[association.comparability]
      : undefined;

  // First, because it is the strongest claim in the panel. Where no second
  // source exists, every verdict has to say so, and the two-source wording
  // below would otherwise describe an index this deployment never reads.
  const declared =
    association.comparability === "no_independent_source"
      ? NO_INDEPENDENT_SOURCE[association.reconciliation]
      : undefined;

  const verdict =
    declared ??
    (association.reconciliation === "node_only" && PROVENANCE_KINDS.has(association.kind)
      ? PROVENANCE_NODE_ONLY
      : notComparable !== undefined
        ? { tone: VERDICT.stale.tone, ...notComparable }
        : // A verdict this build does not know is a backend newer than this
          // bundle, which a rollout produces for as long as the two differ.
          // Indexing the table blind rendered `undefined.tone` and took the
          // whole page down; an unknown state is now shown as unknown.
          (VERDICT[association.reconciliation] ?? UNRECOGNIZED));
  const settled = "l1TxHash" in association ? association.l1TxHash : null;

  // The strip is for a record whose settlement needs no explanation. What that
  // means depends on the deployment: two sources agreeing, or one source
  // reporting. The label says which, because "Cardano settlement" over a hash
  // nothing checked is the claim this step exists to stop making.
  if (compact && hasRecordedSettlement(association) && settled) {
    const corroborated = association.reconciliation === "matched";
    return (
      <div
        data-region="association"
        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/25 bg-info/5 px-4 py-3"
      >
        <span className="text-sm font-medium text-info">
          {corroborated ? "Cardano settlement" : "Settlement reported by the node"}
        </span>
        <L1TxLink hash={settled} destination="midgard" />
      </div>
    );
  }

  return (
    <Card className="mb-4" region="association">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border p-4">
        <h2 className="text-body font-semibold text-text">Cardano</h2>
        <span className="mg-caption text-text-3">{RELATIONSHIP[association.kind]}</span>
      </div>

      <div className="p-4">
        <Callout tone={verdict.tone} title={verdict.title}>
          {verdict.detail}
        </Callout>
      </div>

      <dl className="flex flex-col gap-3 border-t border-border p-4">
        {settled === null ? null : (
          <Row label="Settlement transaction">
            <L1TxLink hash={settled} destination="midgard" />
          </Row>
        )}

        {/* Every observation, always. On a mismatch this is the only place the
            second hash appears, and dropping it would hide the finding. */}
        {association.evidence.map((item, i) => (
          <Row key={`${item.source}-${i}`} label={SOURCE_LABEL[item.source] ?? item.source}>
            {item.transactionHash === null ? (
              <span className="text-text-3">no transaction recorded</span>
            ) : (
              <Identifier value={item.transactionHash} head={10} tail={6} />
            )}
            {item.rawState === null ? null : (
              <span className="ml-2 font-mono mg-micro text-text-3">{item.rawState}</span>
            )}
          </Row>
        ))}

        {/* Two timestamps because the two databases can never share a snapshot.
            A single "observed at" would imply a consistency that does not exist. */}
        {association.l2ObservedAsOf === null ? null : (
          <Row label="Midgard data as of">
            <Timestamp iso={association.l2ObservedAsOf} />
          </Row>
        )}
        {association.l1ObservedAsOf === null ? null : (
          <Row label="Cardano data as of">
            <Timestamp iso={association.l1ObservedAsOf} />
          </Row>
        )}

        {context ? (
          <Row label="Source">
            <span className="mg-caption text-text-2">
              {context.sourceKind} on {context.network}
              {/* The state ALWAYS, the duration only when one was measured.
                  A replica reports no duration: everything a standby can see
                  measures it against itself, and true lag needs a comparison
                  against the primary. Printing the state only when a number
                  came with it hid "lagging" and "unknown" entirely.

                  `formatDuration` takes milliseconds and is what every other
                  duration on the site goes through. This printed the raw
                  seconds, so a replica an hour behind read as "3600s". */}
              {context.freshness.lagSeconds === null
                ? `, ${context.freshness.state}`
                : `, ${context.freshness.state} by ${formatDuration(context.freshness.lagSeconds * 1000)}`}
            </span>
          </Row>
        ) : null}
      </dl>
    </Card>
  );
}

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

const VERDICT: Record<
  Association["reconciliation"],
  { tone: Tone; title: string; detail: string }
> = {
  matched: {
    tone: "success",
    title: "Confirmed by two independent sources",
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

export function CardanoAssociation({
  association,
  context,
}: {
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

  const verdict =
    association.reconciliation === "node_only" && PROVENANCE_KINDS.has(association.kind)
      ? PROVENANCE_NODE_ONLY
      : notComparable !== undefined
        ? { tone: VERDICT.stale.tone, ...notComparable }
        : VERDICT[association.reconciliation];
  const settled = "l1TxHash" in association ? association.l1TxHash : null;

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

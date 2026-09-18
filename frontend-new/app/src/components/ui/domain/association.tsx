import type { Association, DeploymentContext } from "@midgard-explorer/contracts";
import { Callout, Card } from "../base/layout";
import { Identifier } from "./identifier";
import { L1TxLink } from "./l1link";
import { Timestamp } from "../base/timestamp";
import { formatDuration } from "../../../lib/format";

/**
 * What the Midgard node recorded about a record's Cardano side, and whose word
 * that is.
 *
 * One component for every page that has an association, because the alternative
 * is the same relationship phrased slightly differently on the block page, the
 * transaction page and each bridge listing, which is the state this whole area
 * started in: six spellings of one idea and nothing saying they were the same.
 *
 * The rule it exists to keep: nothing here is presented as confirmed. The
 * explorer reads one source, the Midgard node, and every verdict says so. It
 * used to also read an explorer-owned Cardano index and arbitrate between the
 * two; that index is decommissioned, and the four verdicts that described the
 * comparison went with it.
 */

type Tone = "neutral" | "success" | "warning" | "danger";
type Wording = { tone: Tone; title: string; detail: string };

/**
 * What each verdict means in words, kept beside the tone so a reader is never
 * shown a colour without a sentence.
 */
const VERDICT: Record<Association["reconciliation"], Wording> = {
  node_reported: {
    tone: "neutral",
    title: "Settlement transaction reported by the node",
    detail:
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

/**
 * Relationships that record where something CAME FROM, rather than whether a
 * block settled.
 *
 * A deposit's L1 hash is the transaction that funded it. Calling it a
 * "settlement transaction" would describe a different relationship, so these
 * keep their own wording while carrying the same verdict.
 */
const PROVENANCE_KINDS: ReadonlySet<Association["kind"]> = new Set([
  "deposit_origin",
  "withdrawal_request",
  "forced_transaction_order",
]);

const PROVENANCE: Wording = {
  tone: "neutral",
  title: "Recorded by the node",
  detail:
    "This is where the record came from on Cardano, as the Midgard node recorded it. This explorer does not check Cardano itself.",
};

/** A state this build has no wording for. Never a verdict: it says only that
 * the panel cannot speak for it, which is the one honest thing left.
 *
 * A backend newer than this bundle produces one for as long as a rollout
 * leaves the two out of step. Indexing the table blind rendered
 * `undefined.tone` and took the whole page down. */
const UNRECOGNIZED: Wording = {
  tone: "warning",
  title: "This explorer does not recognise the state of this record",
  detail:
    "The backend reported a settlement state this page has no wording for, so nothing is stated about it here. The source records below are shown as they were returned.",
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
 * Whether the node recorded a settlement transaction for this record.
 *
 * Pages use this to decide placement: a settled record gets the quiet strip, and
 * anything else gets the full notice. It says nothing about corroboration,
 * because nothing corroborates anything here.
 */
export function hasRecordedSettlement(
  association: Association | null | undefined,
): association is Association {
  return association?.reconciliation === "node_reported";
}

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

  const known = VERDICT[association.reconciliation] as Wording | undefined;
  const verdict =
    known === undefined
      ? UNRECOGNIZED
      : association.reconciliation === "node_reported" && PROVENANCE_KINDS.has(association.kind)
        ? PROVENANCE
        : known;
  const settled = "l1TxHash" in association ? association.l1TxHash : null;

  // The strip is for a record whose settlement needs no explanation. Its label
  // names the node, because "Cardano settlement" over a hash nothing checked
  // is the claim this panel exists to avoid making.
  if (compact && hasRecordedSettlement(association) && settled) {
    return (
      <div
        data-region="association"
        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/25 bg-info/5 px-4 py-3"
      >
        <span className="text-sm font-medium text-info">Settlement reported by the node</span>
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

        {/* The node's own record, with its raw state, so a reader sees the
            source's word rather than only this page's reading of it. */}
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

        {association.l2ObservedAsOf === null ? null : (
          <Row label="Midgard data as of">
            <Timestamp iso={association.l2ObservedAsOf} />
          </Row>
        )}

        {context ? (
          <Row label="Source">
            <span className="mg-caption text-text-2">
              {context.sourceKind} on {context.network}
              {/* The state ALWAYS, the duration only when one was measured.
                  A replica reports no duration: everything a standby can see
                  measures it against itself, and true lag needs a comparison
                  against the primary. */}
              {context.freshness.lagSeconds === null
                ? `, ${context.freshness.state}`
                : `, ${context.freshness.state} by ${formatDuration(context.freshness.lagSeconds * 1000)}`}
              {/* Configured, not verified: the deployment is named by a file
                  this process reads, and nothing checks it against Cardano. */}
              {context.identityState === "configured" ? ", deployment as configured" : ""}
            </span>
          </Row>
        ) : null}
      </dl>
    </Card>
  );
}

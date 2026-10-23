import type { Association, DeploymentContext } from "@midgard-explorer/contracts";
import { L1TxLink } from "./l1link";
import { StatusBadge } from "./status";
import { Timestamp } from "../base/timestamp";
import { sourceText } from "./association";
import { formatTimestamp } from "../../../lib/format";
import type { JourneyModel } from "../../../lib/journey";
import { FactRow } from "../base/facts";

/** Settlement as a flat list: the Cardano transaction once, where the block
 * stands, where that came from, and every stage in order.
 *
 * It replaces a journey card and a Cardano card nested inside a disclosure,
 * which showed the same hash twice and explained the source in a paragraph. */
export function SettlementDetails({
  association,
  context,
  journey,
}: {
  association: Association | null | undefined;
  context: DeploymentContext | null | undefined;
  journey: JourneyModel;
}) {
  const hash = association && "l1TxHash" in association ? (association.l1TxHash ?? null) : null;
  // The settlement's state, not the journal's word: for an applied block it is
  // read from the follower's tables, which the journal does not write.
  const state = association && "state" in association ? association.state : null;
  return (
    <>
      <FactRow label="Cardano transaction">
        {hash === null ? (
          <span className="text-text-3">None recorded</span>
        ) : (
          <L1TxLink hash={hash} destination="cardano" />
        )}
      </FactRow>
      {state !== null && state !== "unknown" ? (
        <FactRow label="State">
          <StatusBadge status={state} variant="text" explain={false} />
        </FactRow>
      ) : null}
      {association?.l2ObservedAsOf ? (
        <FactRow label="Midgard data as of">
          <Timestamp iso={association.l2ObservedAsOf} exact />
        </FactRow>
      ) : null}
      {context ? <FactRow label="Source">{sourceText(context)}</FactRow> : null}
      <FactRow label="Stages">
        {/* Label and time side by side, not at opposite edges of the page. */}
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_max-content]">
          {journey.stages.map((stage) => (
            <li key={stage.key} className="sm:col-span-2 sm:grid sm:grid-cols-subgrid">
              <span>{stage.label}</span>
              <span className="block text-text-3 tabular-nums">
                {stage.timestampKind === "recorded" && stage.occurredAt !== null
                  ? formatTimestamp(stage.occurredAt)
                  : stage.timestampKind === "not_applicable"
                    ? "Not applicable yet"
                    : "Not recorded"}
              </span>
            </li>
          ))}
        </ol>
      </FactRow>
    </>
  );
}

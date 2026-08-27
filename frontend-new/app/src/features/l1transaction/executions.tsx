import type { L1Redeemer, L1TransactionResponse } from "../../lib/api";
import { Panel } from "../../components/ui/primitives";
import { InfoTip } from "../../components/ui/infotip";
import { Identifier } from "../../components/ui/identifier";
import { formatQuantity } from "../../lib/asset";

type Limits = { epochNo: number; maxTxExMem: string; maxTxExSteps: string };

/** Basis points rather than a float, so a share is computed on the integers
 * the ledger reported. These values exceed what a double holds exactly. */
function shareBps(used: string, limit: string): number | null {
  const cap = BigInt(limit);
  if (cap <= 0n) return null;
  return Number((BigInt(used) * 10_000n) / cap) / 100;
}

/** One budget line: what was spent, and how much of the transaction's allowance
 * that was.
 *
 * The bar is drawn only when a limit for this transaction's epoch is on record.
 * Without one the figure still renders, because the units are a fact the chain
 * reported; only the share disappears, since a share needs a denominator that
 * is true and the nearest epoch's is not this epoch's.
 */
function Budget({
  label,
  used,
  limit,
  term,
}: {
  label: string;
  used: string;
  limit: string | null;
  term: "executionUnits";
}) {
  const share = limit === null ? null : shareBps(used, limit);
  return (
    <div className="min-w-0">
      <p className="mg-overline flex items-center gap-1.5">
        {label}
        <InfoTip term={term} subject={label} />
      </p>
      <p className="mt-0.5 font-mono text-sm tabular-nums text-text">
        {formatQuantity(used)}
        {share === null ? null : (
          <span className="ml-2 font-sans text-text-2">{share.toFixed(share < 1 ? 2 : 1)}%</span>
        )}
      </p>
      {share === null ? (
        <p className="mt-1 mg-micro text-text-3">No limit on record for this epoch</p>
      ) : (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="img"
          aria-label={`${label}: ${share.toFixed(2)} percent of the per-transaction limit`}
        >
          <div
            className="h-full rounded-full bg-accent"
            /* Floored at 2% so a real but tiny execution still draws something.
               A zero-width bar and an absent bar look identical, and they mean
               different things. */
            style={{ width: `${Math.max(2, Math.min(100, share))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Execution({ redeemer, limits }: { redeemer: L1Redeemer; limits: Limits | null }) {
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2 text-body text-text">
          <span className="font-medium capitalize">{redeemer.purpose}</span>
          <Identifier value={redeemer.scriptHash} head={8} tail={6} />
        </span>
        <span
          className={redeemer.validContract ? "mg-caption text-text-2" : "mg-caption text-danger"}
        >
          {redeemer.validContract ? "Validated" : "Failed"}
        </span>
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Budget
          label="Memory"
          used={redeemer.memUnits}
          limit={limits?.maxTxExMem ?? null}
          term="executionUnits"
        />
        <Budget
          label="CPU steps"
          used={redeemer.stepUnits}
          limit={limits?.maxTxExSteps ?? null}
          term="executionUnits"
        />
      </div>
    </li>
  );
}

/** Script executions in this Cardano transaction, with their budget.
 *
 * The response has carried `redeemers` since the indexer first wrote them and
 * no page read them, so a reader could see that a Midgard contract ran but not
 * what it cost. The limits are Cardano's, for this transaction's own epoch,
 * and they apply to the whole transaction rather than to any one redeemer:
 * the shares below are each execution's part of one shared allowance.
 */
export function ScriptExecutions({ tx }: { tx: L1TransactionResponse }) {
  if (tx.redeemers.length === 0) return null;
  const limits = tx.protocolParams ?? null;
  return (
    <Panel
      title="Script executions"
      subtitle={
        limits === null
          ? "Execution units this transaction spent. No Cardano limits are on record for its epoch, so no share is shown."
          : `Each execution's share of the per-transaction limit Cardano set for epoch ${limits.epochNo}.`
      }
    >
      <ul className="divide-y divide-border">
        {tx.redeemers.map((redeemer, index) => (
          <Execution
            key={`${redeemer.scriptHash}-${redeemer.purpose}-${index}`}
            redeemer={redeemer}
            limits={limits}
          />
        ))}
      </ul>
    </Panel>
  );
}

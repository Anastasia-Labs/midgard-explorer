import type { TransactionView } from "@midgard-explorer/contracts";
import { addressDeltas } from "../../../lib/ledger";
import { cn, formatAda, truncateId } from "../../../lib/format";
import { AssetName } from "./asset";
import { AddressLink } from "./address";
import { Card } from "../base/layout";

/** Exact address deltas, retaining unknown spend sides and native assets. */
function Amount({ lovelace, tone }: { lovelace: bigint; tone?: "positive" | "negative" }) {
  const negative = lovelace < 0n;
  const magnitude = negative ? -lovelace : lovelace;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        tone === "positive" && "text-success",
        tone === "negative" && "text-danger",
      )}
    >
      {negative ? "−" : tone === "positive" ? "+" : ""}
      <span className="text-text-3">₳</span> {formatAda(magnitude.toString())}
    </span>
  );
}

/** One address's net change: what it received minus what it spent. */
type Delta = ReturnType<typeof addressDeltas>[number];

function DeltaRow({ d }: { d: Delta }) {
  const net = d.received - d.spent;
  const assets = d.assets;
  return (
    <li
      key={d.address}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
    >
      <AddressLink address={d.address} head={12} tail={8} />
      {d.exact ? (
        <Amount lovelace={net} tone={net >= 0n ? "positive" : "negative"} />
      ) : (
        <span className="text-right mg-caption">
          <Amount lovelace={d.received} tone="positive" />{" "}
          <span className="text-text-3">received</span>
        </span>
      )}
      {assets.length > 0 ? (
        <ul className="w-full space-y-0.5 pl-0.5">
          {assets.map((a) => {
            const assetNet = a.received - a.spent;
            return (
              <li
                key={`${a.policyId}.${a.assetName}`}
                className="flex items-center justify-between gap-3 mg-micro"
              >
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <AssetName nameHex={a.assetName} />
                  <span className="shrink-0 font-mono text-micro text-text-3">
                    {truncateId(a.policyId, 6, 4)}
                  </span>
                </span>
                {d.exact ? (
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      assetNet > 0n && "text-success",
                      assetNet < 0n && "text-danger",
                      assetNet === 0n && "text-text-3",
                    )}
                  >
                    {assetNet > 0n ? "+" : ""}
                    {assetNet.toString()}
                  </span>
                ) : (
                  <span className="font-mono tabular-nums text-text-3">
                    +{a.received.toString()} received
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

/** Each address's balance change: one view of the same inputs and outputs.
 *
 * Exact where every input resolved. Where one did not, the address shows only
 * what it received, and one notice above says why, instead of a sentence under
 * every row. `proposed` marks a transaction the ledger has not applied yet. */
export function BalanceChanges({
  tx,
  proposed = false,
}: {
  tx: TransactionView;
  proposed?: boolean;
}) {
  const deltas = addressDeltas(tx);
  const unknown = deltas.filter((d) => !d.exact).length;
  return (
    <Card region="balance-changes">
      {proposed || unknown > 0 ? (
        <div className="space-y-1 border-b border-border px-4 py-3 mg-caption text-text-2">
          {proposed ? (
            <p>Proposed: this transaction is not in a block yet, so nothing has changed.</p>
          ) : null}
          {unknown > 0 ? (
            <p>
              {unknown} address{unknown === 1 ? "" : "es"} spent an input the ledger no longer
              holds, so {unknown === 1 ? "its" : "their"} spent amount is unknown. Only what{" "}
              {unknown === 1 ? "it" : "they"} received is shown.
            </p>
          ) : null}
        </div>
      ) : null}
      {deltas.length === 0 ? (
        <p className="px-4 py-5 text-sm text-text-3">No balance changes.</p>
      ) : (
        <ul className="divide-y divide-border">
          {deltas.map((d) => (
            <DeltaRow key={d.address} d={d} />
          ))}
        </ul>
      )}
    </Card>
  );
}

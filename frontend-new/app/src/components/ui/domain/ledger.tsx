import type { TransactionView } from "@midgard-explorer/contracts";
import { addressDeltas } from "../../../lib/ledger";
import { cn, formatAda, truncateId } from "../../../lib/format";
import { AssetName } from "./asset";
import { AddressLink } from "./address";

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

export function NetMovement({ tx }: { tx: TransactionView }) {
  const deltas = addressDeltas(tx);
  return (
    <>
      {deltas.length > 0 ? (
        <div className="border-t border-border">
          {/* Ada alone said nothing about a transaction that moved a token and
              no lovelace, which is a whole class of Midgard activity. */}
          <ul className="divide-y divide-border">
            {deltas.map((d) => {
              const net = d.received - d.spent;
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
                      <Amount lovelace={d.received} tone="positive" />
                      <span className="block text-text-3">received; spend side unknown</span>
                    </span>
                  )}
                  {d.assets.length > 0 ? (
                    <ul className="w-full space-y-0.5 pl-0.5">
                      {d.assets.map((a) => {
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
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}

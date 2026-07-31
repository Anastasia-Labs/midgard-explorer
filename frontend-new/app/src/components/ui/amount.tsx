import type { AssetMap, ValueView } from "@midgard-explorer/contracts";
import { assetCount, formatAda } from "../../lib/format";

/** The ada symbol leads the amount everywhere, the way a currency symbol does.
 * Summary bands used to render it leading and tables trailing. */
export function AdaAmount({ lovelace }: { lovelace: string }) {
  return (
    <span className="font-mono tabular-nums" title={`${lovelace} lovelace`}>
      <span className="text-text-3">₳</span> {formatAda(lovelace)}
    </span>
  );
}

export function ValueCell({ value }: { value: ValueView }) {
  const count = assetCount(value.assets);
  return (
    <span className="inline-flex items-center gap-2">
      <AdaAmount lovelace={value.lovelace} />
      {count > 0 ? (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-2">
          +{count} asset{count === 1 ? "" : "s"}
        </span>
      ) : null}
    </span>
  );
}

export function AssetHierarchy({ assets }: { assets: AssetMap }) {
  const policies = Object.entries(assets);
  if (policies.length === 0) return null;
  return (
    <ul className="space-y-2">
      {policies.map(([policyId, names]) => (
        <li key={policyId}>
          <p className="mg-overline">Policy ID</p>
          <p className="font-mono text-xs text-text-2 break-all">{policyId}</p>
          <ul className="mt-1.5 space-y-1 border-l border-border pl-3">
            {Object.entries(names).map(([nameHex, qty]) => (
              <li key={nameHex} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0">
                  <span className="mg-overline">Asset name (hex)</span>
                  <span className="block font-mono text-sm break-all">
                    {nameHex === "" ? "(no name)" : nameHex}
                  </span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-sm">{qty}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

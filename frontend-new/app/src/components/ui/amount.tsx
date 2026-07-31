import type { ValueView } from "@midgard-explorer/contracts";
import { assetLabel } from "../../lib/asset";
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

/** Names the assets a value carries rather than only counting them, because
 * "+3 assets" tells a reader scanning a list nothing about what moved. The
 * names are decoded under the same rule as everywhere else: only shown when
 * they round-trip to their own bytes and carry nothing that can reorder text. */
function assetSummary(value: ValueView): string {
  const names: string[] = [];
  for (const entries of Object.values(value.assets)) {
    for (const nameHex of Object.keys(entries)) names.push(assetLabel(nameHex).label);
  }
  if (names.length === 0) return "";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export function ValueCell({ value }: { value: ValueView }) {
  const count = assetCount(value.assets);
  return (
    <span className="inline-flex items-center gap-2">
      <AdaAmount lovelace={value.lovelace} />
      {count > 0 ? (
        <span
          className="max-w-[16ch] truncate rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-2"
          title={`${count} native asset${count === 1 ? "" : "s"}`}
        >
          {assetSummary(value)}
        </span>
      ) : null}
    </span>
  );
}

/** Asset rendering moved to ./asset, where the name-decoding and fingerprint
 * rules live. Re-exported here so the many call sites that reach for it
 * alongside `ValueCell` keep working. */
export { AssetHierarchy } from "./asset";

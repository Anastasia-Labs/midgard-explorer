import type { AssetCoverage, AssetMap } from "@midgard-explorer/contracts";
import Link from "next/link";
import { assetFingerprint, assetLabel, assetUnit, formatQuantity } from "../../lib/asset";
import { cn, truncateId } from "../../lib/format";
import { Identifier } from "./identifier";
import { Callout } from "./primitives";

/** Rendering a native asset.
 *
 * The whole design follows from one fact: an asset name is attacker-controlled
 * bytes. A token can be named to read as another token, or as a label the
 * explorer wrote. So the decoded name is presented as a claim rather than as
 * identity, the hex it decoded from is always within reach, and the CIP-14
 * fingerprint is offered as the thing to actually compare, because it is the
 * only one of the three that is unique.
 */

export function AssetName({ nameHex, className }: { nameHex: string; className?: string }) {
  const { label, canonical } = assetLabel(nameHex);
  return (
    <span className={cn("min-w-0", className)}>
      <span
        className={cn("break-all", canonical ? "font-mono text-[13px]" : "text-sm font-medium")}
        // A decoded name is not the asset's identity, so it is marked as text
        // the ledger supplied rather than styled like the explorer's own copy.
        {...(canonical ? {} : { title: `Decoded from ${nameHex}` })}
      >
        {label}
      </span>
      {canonical ? null : (
        <span className="ml-1.5 font-mono text-[11px] text-text-3">{truncateId(nameHex, 8, 4)}</span>
      )}
    </span>
  );
}

/** The identifier worth comparing. Two assets can share a display name and
 * differ only in policy; the fingerprint is what tells them apart in one
 * glance, so it is shown wherever an asset is the subject of the page. */
export function AssetFingerprint({ policyId, nameHex }: { policyId: string; nameHex: string }) {
  const fingerprint = assetFingerprint(policyId, nameHex);
  if (fingerprint === null) {
    return <span className="font-mono text-[12px] text-text-3">Not computable</span>;
  }
  return <Identifier value={fingerprint} head={14} tail={8} />;
}

export function AssetQuantity({ quantity }: { quantity: string }) {
  return (
    <span className="font-mono tabular-nums" title={`${quantity} (raw)`}>
      {formatQuantity(quantity)}
    </span>
  );
}

/** Policy-grouped holdings, with each asset linking to its own page. */
export function AssetHierarchy({ assets }: { assets: AssetMap }) {
  const policies = Object.entries(assets);
  if (policies.length === 0) return null;
  return (
    <ul className="space-y-3">
      {policies.map(([policyId, names]) => (
        <li key={policyId}>
          <p className="mg-overline">Policy</p>
          <Identifier value={policyId} head={12} tail={8} />
          <ul className="mt-1.5 space-y-1.5 border-l border-border pl-3">
            {Object.entries(names).map(([nameHex, qty]) => (
              <li key={nameHex} className="flex items-baseline justify-between gap-4">
                <Link
                  href={`/asset/${assetUnit(policyId, nameHex)}`}
                  className="min-w-0 text-accent hover:underline"
                >
                  <AssetName nameHex={nameHex} />
                </Link>
                <span className="shrink-0 text-sm">
                  <AssetQuantity quantity={qty} />
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** How much of the ledger an asset answer covers.
 *
 * Every figure derived from a bounded scan needs this beside it. "12 holders"
 * from a complete scan and "12 holders" from a partial one are different
 * claims, and a reader cannot tell them apart without being told. */
export function CoverageNote({ coverage, subject }: { coverage: AssetCoverage; subject: string }) {
  const complete = !coverage.truncated && coverage.undecoded === 0;
  if (complete) {
    return (
      <p className="text-[12px] text-text-3">
        Complete over the current ledger: all {coverage.total.toLocaleString()} spendable UTxOs were
        read. Assets that were minted and fully spent leave no trace here, because this describes
        the ledger now rather than its history.
      </p>
    );
  }
  return (
    <Callout tone="warning" title={`${subject} is a lower bound.`}>
      <p>
        {coverage.truncated
          ? `Only ${coverage.scanned.toLocaleString()} of ${coverage.total.toLocaleString()} spendable UTxOs were read, so holdings beyond that point are not counted.`
          : null}
        {coverage.undecoded > 0
          ? ` ${coverage.undecoded.toLocaleString()} UTxO${coverage.undecoded === 1 ? "" : "s"} could not be decoded and contribute nothing to these figures.`
          : null}
      </p>
    </Callout>
  );
}

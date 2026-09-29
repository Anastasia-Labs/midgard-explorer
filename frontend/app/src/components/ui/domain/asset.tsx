import type { AssetCoverage, AssetMap } from "@midgard-explorer/contracts";
import Link from "next/link";
import { assetFingerprint, assetLabel, assetUnit, formatQuantity } from "../../../lib/asset";
import { cn, truncateId } from "../../../lib/format";
import { Identicon } from "../base/identicon";
import { Identifier } from "./identifier";
import { Callout } from "../base/layout";

/** Rendering a native asset.
 *
 * The whole design follows from one fact: an asset name is attacker-controlled
 * bytes. A token can be named to read as another token, or as a label the
 * explorer wrote. So the decoded name is presented as a claim rather than as
 * identity, the hex it decoded from is always within reach, and the CIP-14
 * fingerprint is offered as the thing to actually compare, because it is the
 * only one of the three that is unique.
 */

/**
 * The generated mark for an asset (4.3.4).
 *
 * Seeded on the unit, which is the asset's identity: two assets can share a
 * display name and differ only in policy, and the mark has to differ with them.
 * Circular, where an address mark is a rounded square, so the shape says which
 * kind of thing is being looked at before the text is read.
 *
 * No registry logo. There is no offline token registry available here, and
 * fetching artwork from a third party at render time would put an external
 * dependency in front of every asset row. When a registry is available this is
 * where its image goes, with this mark as the fallback it already is.
 */
export function AssetMark({
  policyId,
  nameHex,
  size = 20,
}: {
  policyId: string;
  nameHex: string;
  size?: number;
}) {
  return <Identicon seed={assetUnit(policyId, nameHex)} size={size} className="rounded-full" />;
}

export function AssetName({ nameHex, className }: { nameHex: string; className?: string }) {
  const { label, canonical } = assetLabel(nameHex);
  return (
    <span className={cn("min-w-0", className)}>
      <span className={cn("break-all", canonical ? "font-mono mg-caption" : "text-sm font-medium")}>
        {label}
      </span>
      {/* A decoded name is not the asset's identity. The bytes it came from are
          rendered beside it below, so a hover-only "Decoded from …" said
          nothing extra and said it only to a mouse. */}
      {canonical ? null : <span className="sr-only"> decoded from {nameHex},</span>}
      {canonical ? null : (
        <span className="ml-1.5 font-mono text-micro text-text-3">{truncateId(nameHex, 8, 4)}</span>
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
    return <span className="font-mono mg-micro text-text-3">Not computable</span>;
  }
  return <Identifier value={fingerprint} head={14} tail={8} />;
}

export function AssetQuantity({ quantity }: { quantity: string }) {
  return <span className="font-mono tabular-nums">{formatQuantity(quantity)}</span>;
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
                  className="min-w-0 text-link hover:text-link-hover hover:underline"
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
      <p className="mg-micro text-page-copy">
        Current ledger · {coverage.total.toLocaleString("en-US")} spendable UTxOs scanned
      </p>
    );
  }
  return (
    <Callout tone="warning" title={`${subject} is a lower bound.`}>
      <p>
        {coverage.truncated
          ? `${coverage.scanned.toLocaleString("en-US")} of ${coverage.total.toLocaleString("en-US")} UTxOs scanned.`
          : null}
        {coverage.undecoded > 0
          ? ` ${coverage.undecoded.toLocaleString("en-US")} unreadable.`
          : null}
      </p>
    </Callout>
  );
}

import Link from "next/link";
import type { MintView } from "@midgard-explorer/contracts";
import { AssetName, AssetQuantity } from "../../components/ui/domain/asset";
import { Identifier } from "../../components/ui/domain/identifier";
import { Card, Chip } from "../../components/ui/base/layout";
import { SemanticLabel } from "../../components/ui/base/semantic";
import { assetUnit } from "../../lib/asset";

/** Supply change, with the sign that says which direction.
 *
 * The quantities were indexed, carried in the payload, and then reduced to a
 * list of policy IDs under a caption promising the numbers appeared on the
 * outputs in the flow. They do not. A burn removes supply and reaches no
 * output at all, and for a mint an output carries the resulting total rather
 * than the change, so a reader following that caption found a different number.
 */
export function MintPanel({ mint }: { mint: MintView }) {
  const assets = [...mint.assets].sort(
    (a, b) => a.policyId.localeCompare(b.policyId) || a.assetName.localeCompare(b.assetName),
  );
  const burns = assets.filter((asset) => BigInt(asset.quantity) < 0n).length;
  const mints = assets.filter((asset) => BigInt(asset.quantity) > 0n).length;

  return (
    <Card className="mb-5">
      <h2 className="px-4 pt-4 text-lg font-semibold tracking-tight">
        <SemanticLabel
          kind="mintBurn"
          label={
            assets.length === 0
              ? "Asset mint / burn"
              : mints === 0 && burns === 0
                ? "No asset supply change"
                : burns === 0
                  ? `Minted (${mints})`
                  : mints === 0
                    ? `Burned (${burns})`
                    : `Minted and burned (${assets.length})`
          }
        />
      </h2>
      {assets.length === 0 ? (
        <div className="p-4">
          <p className="mg-caption text-text-3">
            Quantities could not be decoded. The policies below are what the transaction declared.
          </p>
          <ul className="mt-2 space-y-1">
            {mint.policyIds.map((policyId) => (
              <li key={policyId}>
                <Identifier value={policyId} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {assets.map((asset) => {
            const quantity = BigInt(asset.quantity);
            const burned = quantity < 0n;
            return (
              <li
                key={`${asset.policyId}-${asset.assetName}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/asset/${assetUnit(asset.policyId, asset.assetName)}`}
                    className="min-w-0 text-link hover:text-link-hover hover:underline"
                  >
                    <AssetName nameHex={asset.assetName} />
                  </Link>
                  <div className="mt-1">
                    <Identifier value={asset.policyId} head={12} tail={8} />
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-2 text-sm">
                  <Chip on="surface-2" emphasis="strong">
                    {burned ? "Burn" : quantity > 0n ? "Mint" : "Unchanged"}
                  </Chip>
                  {/* The sign is the fact. A burn written as an unsigned number
                      reads as new supply. */}
                  <AssetQuantity quantity={quantity > 0n ? `+${asset.quantity}` : asset.quantity} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

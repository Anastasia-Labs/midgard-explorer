import type { DecimalString, TransactionView, ValueView } from "@midgard-explorer/contracts";
import { AddressLink } from "../../components/ui/address";
import { ValueCell } from "../../components/ui/amount";
import { Card } from "../../components/ui/primitives";
import { addressDeltas } from "../../lib/ledger";

function addAsset(
  assets: Record<string, Record<string, DecimalString>>,
  policyId: string,
  assetName: string,
  quantity: bigint,
) {
  if (quantity === 0n) return;
  const policy = assets[policyId] ?? {};
  policy[assetName] = quantity.toString() as DecimalString;
  assets[policyId] = policy;
}

const decimal = (value: bigint): DecimalString => value.toString() as DecimalString;

function positiveNet(tx: TransactionView) {
  const deltas = addressDeltas(tx);
  if (!deltas.every((delta) => delta.exact)) return null;
  const recipients = deltas.flatMap((delta) => {
    const lovelace = delta.received - delta.spent;
    const assets: Record<string, Record<string, DecimalString>> = {};
    let hasNegativeAsset = false;
    for (const asset of delta.assets) {
      const quantity = asset.received - asset.spent;
      if (quantity < 0n) hasNegativeAsset = true;
      addAsset(assets, asset.policyId, asset.assetName, quantity);
    }
    const hasPositiveAsset = Object.values(assets).some((names) =>
      Object.values(names).some((quantity) => BigInt(quantity) > 0n),
    );
    return lovelace >= 0n && !hasNegativeAsset && (lovelace > 0n || hasPositiveAsset)
      ? [{ address: delta.address, value: { lovelace: decimal(lovelace), assets } }]
      : [];
  });
  return recipients.length === 1 ? recipients[0]! : null;
}

/** What the transaction did, when that can be said in one line.
 *
 * Nothing when it cannot. The fallback used to read "Applied 2 inputs and
 * created 2 outputs", which is the input and output count the State tab already
 * carries on its own tab badge, spending a whole band above the fold to repeat
 * a number the reader can see. A summary that cannot summarise is not a
 * summary. */
export function ActionSummary({ tx }: { tx: TransactionView }) {
  const recipient = positiveNet(tx);
  if (!recipient) return null;
  return (
    <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-body font-medium text-text">
        Transferred value to <AddressLink address={recipient.address} />
      </p>
      <ValueCell value={recipient.value} />
    </Card>
  );
}

export function totalOutputValue(tx: TransactionView): ValueView {
  let lovelace = 0n;
  const assets = new Map<string, bigint>();
  for (const output of tx.outputs) {
    lovelace += BigInt(output.value.lovelace);
    for (const [policyId, names] of Object.entries(output.value.assets)) {
      for (const [assetName, quantity] of Object.entries(names)) {
        const key = `${policyId}.${assetName}`;
        assets.set(key, (assets.get(key) ?? 0n) + BigInt(quantity));
      }
    }
  }
  const mutableAssets: Record<string, Record<string, DecimalString>> = {};
  for (const [key, quantity] of assets) {
    const separator = key.indexOf(".");
    addAsset(mutableAssets, key.slice(0, separator), key.slice(separator + 1), quantity);
  }
  return { lovelace: decimal(lovelace), assets: mutableAssets };
}

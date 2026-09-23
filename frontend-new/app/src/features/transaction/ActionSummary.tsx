import type { DecimalString, TransactionView, ValueView } from "@midgard-explorer/contracts";

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

import type { TransactionView, ValueView } from "@midgard-explorer/contracts";

/** The ledger equation behind a transaction: inputs = outputs + fee.
 *
 * This is the one arithmetic statement a UTxO transaction always satisfies, and
 * showing it is what turns two lists of addresses into an account of what
 * happened. Two rules keep it honest:
 *
 *   1. It is only stated when every input resolved. A transaction's inputs
 *      leave the ledger once it is applied, so historical inputs are commonly
 *      unresolvable, and summing the ones that survived would produce a figure
 *      that looks like a total and is not one.
 *   2. Where it cannot be stated, the count of unresolved inputs is, so a
 *      reader knows the difference between "does not balance" and "cannot be
 *      checked from here".
 *
 * What is deliberately absent: any claim about which input funded which output.
 * A UTxO transaction does not record that, so a flow diagram drawing those
 * edges would be inventing them.
 */

export type LedgerEquation =
  | {
      kind: "balanced";
      inputs: bigint;
      outputs: bigint;
      fee: bigint;
      inputCount: number;
      outputCount: number;
    }
  | {
      kind: "unbalanced";
      inputs: bigint;
      outputs: bigint;
      fee: bigint;
      /** outputs + fee - inputs. Non-zero means the decoded values do not add
       * up, which is a decoding problem worth surfacing rather than hiding. */
      difference: bigint;
      inputCount: number;
      outputCount: number;
    }
  | {
      kind: "incomplete";
      /** What the resolved inputs came to, which is a lower bound, not a total. */
      resolvedInputs: bigint;
      outputs: bigint;
      fee: bigint;
      resolvedCount: number;
      unresolvedCount: number;
      outputCount: number;
    };

export function ledgerEquation(tx: TransactionView): LedgerEquation {
  const fee = BigInt(tx.fee);
  const outputs = tx.outputs.reduce((sum, o) => sum + BigInt(o.value.lovelace), 0n);
  const outputCount = tx.outputs.length;

  const resolved = tx.inputs.filter((i) => i.resolved !== null);
  const unresolvedCount = tx.inputs.length - resolved.length;
  const resolvedInputs = resolved.reduce((sum, i) => sum + BigInt(i.resolved!.value.lovelace), 0n);

  if (unresolvedCount > 0) {
    return {
      kind: "incomplete",
      resolvedInputs,
      outputs,
      fee,
      resolvedCount: resolved.length,
      unresolvedCount,
      outputCount,
    };
  }

  const difference = outputs + fee - resolvedInputs;
  if (difference === 0n) {
    return {
      kind: "balanced",
      inputs: resolvedInputs,
      outputs,
      fee,
      inputCount: resolved.length,
      outputCount,
    };
  }
  return {
    kind: "unbalanced",
    inputs: resolvedInputs,
    outputs,
    fee,
    difference,
    inputCount: resolved.length,
    outputCount,
  };
}

/** Net movement per address across a transaction, for the addresses whose side
 * of it is fully known.
 *
 * An address appears with a net figure only when every input it could have
 * contributed to resolved. Otherwise it is listed as received-only, because a
 * "net +5 ada" for an address that may also have spent 100 is not a smaller
 * truth, it is a wrong one. */
export type AddressDelta = {
  address: string;
  received: bigint;
  spent: bigint;
  /** False when some input of the transaction did not resolve, so `spent` is a
   * lower bound and `net` must not be shown. */
  exact: boolean;
  /** Movement of each native asset this address touched. Ada alone answered
   * nothing for a transaction that moved a token and no lovelace, which is a
   * whole class of Midgard activity. Empty when only ada moved. */
  assets: AssetDelta[];
};

export type AssetDelta = {
  policyId: string;
  assetName: string;
  received: bigint;
  spent: bigint;
};

type Side = "received" | "spent";

export function addressDeltas(tx: TransactionView): AddressDelta[] {
  const exact = tx.inputs.every((i) => i.resolved !== null);
  type Acc = {
    received: bigint;
    spent: bigint;
    assets: Map<string, { policyId: string; assetName: string; received: bigint; spent: bigint }>;
  };
  const byAddress = new Map<string, Acc>();
  const entry = (address: string): Acc => {
    const found = byAddress.get(address) ?? { received: 0n, spent: 0n, assets: new Map() };
    byAddress.set(address, found);
    return found;
  };

  const addValue = (address: string, value: ValueView, side: Side) => {
    const acc = entry(address);
    acc[side] += BigInt(value.lovelace);
    for (const [policyId, names] of Object.entries(value.assets)) {
      for (const [assetName, quantity] of Object.entries(names)) {
        const key = `${policyId}.${assetName}`;
        const asset = acc.assets.get(key) ?? { policyId, assetName, received: 0n, spent: 0n };
        asset[side] += BigInt(quantity);
        acc.assets.set(key, asset);
      }
    }
  };

  for (const output of tx.outputs) addValue(output.address, output.value, "received");
  for (const input of tx.inputs) {
    if (input.resolved === null) continue;
    addValue(input.resolved.address, input.resolved.value, "spent");
  }

  return [...byAddress.entries()]
    .map(([address, v]) => ({
      address,
      received: v.received,
      spent: v.spent,
      exact,
      // Sorted so two renders of the same transaction agree, and so a reader
      // comparing two addresses sees the same asset in the same place.
      assets: [...v.assets.values()].sort(
        (a, b) => a.policyId.localeCompare(b.policyId) || a.assetName.localeCompare(b.assetName),
      ),
    }))
    .sort((a, b) => {
      const an = a.received - a.spent;
      const bn = b.received - b.spent;
      return bn > an ? 1 : bn < an ? -1 : 0;
    });
}

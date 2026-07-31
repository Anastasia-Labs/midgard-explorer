import type { TransactionView } from "@midgard-explorer/contracts";

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
};

export function addressDeltas(tx: TransactionView): AddressDelta[] {
  const exact = tx.inputs.every((i) => i.resolved !== null);
  const byAddress = new Map<string, { received: bigint; spent: bigint }>();
  const entry = (address: string) => {
    const found = byAddress.get(address) ?? { received: 0n, spent: 0n };
    byAddress.set(address, found);
    return found;
  };

  for (const output of tx.outputs) {
    entry(output.address).received += BigInt(output.value.lovelace);
  }
  for (const input of tx.inputs) {
    if (input.resolved === null) continue;
    entry(input.resolved.address).spent += BigInt(input.resolved.value.lovelace);
  }

  return [...byAddress.entries()]
    .map(([address, v]) => ({ address, received: v.received, spent: v.spent, exact }))
    .sort((a, b) => {
      const an = a.received - a.spent;
      const bn = b.received - b.spent;
      return bn > an ? 1 : bn < an ? -1 : 0;
    });
}

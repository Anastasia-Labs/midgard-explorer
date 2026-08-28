import type { RedeemerView, TransactionView } from "@midgard-explorer/contracts";

export type InvocationEmitter = {
  kind: "script" | "policy" | "observer" | "unresolved";
  hash: string | null;
  address: string | null;
  source: string;
};

export type ScriptInvocation = {
  id: string;
  ordinal: number;
  operation: string;
  pointer: string;
  emitter: InvocationEmitter;
  redeemer: RedeemerView;
};

const compareOutRefs = (
  a: TransactionView["inputs"][number],
  b: TransactionView["inputs"][number],
) => a.txId.localeCompare(b.txId) || a.index - b.index;

const unresolved = (source: string): InvocationEmitter => ({
  kind: "unresolved",
  hash: null,
  address: null,
  source,
});

/** Resolve the script selected by a redeemer pointer using the same canonical
 * collections as Midgard phase B. We do not correlate scripts by witness-array
 * position: the witness set does not assert that relationship. */
export function invocationEmitter(tx: TransactionView, redeemer: RedeemerView): InvocationEmitter {
  if (redeemer.index === null || redeemer.purpose === null) {
    return unresolved("Redeemer pointer did not decode.");
  }

  const index = redeemer.index;
  if (redeemer.purpose === "spend") {
    const input = [...tx.inputs].sort(compareOutRefs)[index];
    if (input === undefined) return unresolved(`Spend pointer ${index} is outside the input set.`);
    if (input.resolved === null) {
      return unresolved(`Spend input ${input.txId}#${input.index} is no longer resolvable.`);
    }
    const payment = input.resolved.identity.payment;
    if (payment.kind !== "Script") {
      return unresolved(`Spend input ${input.txId}#${input.index} resolves to a key credential.`);
    }
    return {
      kind: "script",
      hash: payment.hash,
      address: input.resolved.address,
      source: `Spend input ${input.txId}#${input.index}`,
    };
  }

  if (redeemer.purpose === "mint") {
    const policy = [...(tx.mint?.policyIds ?? [])].sort()[index];
    return policy === undefined
      ? unresolved(`Mint pointer ${index} is outside the policy set.`)
      : { kind: "policy", hash: policy, address: null, source: `Mint policy ${index}` };
  }

  if (redeemer.purpose === "reward") {
    const observer = [...tx.requiredObservers].sort()[index];
    return observer === undefined
      ? unresolved(`Reward pointer ${index} is outside the observer set.`)
      : { kind: "observer", hash: observer, address: null, source: `Required observer ${index}` };
  }

  if (redeemer.purpose === "receive") {
    const hashes = [
      ...new Set(
        tx.outputs
          .filter(
            (output) => output.identity.protected && output.identity.payment.kind === "Script",
          )
          .map((output) => output.identity.payment.hash),
      ),
    ].sort();
    const hash = hashes[index];
    const output = tx.outputs.find(
      (candidate) => candidate.identity.protected && candidate.identity.payment.hash === hash,
    );
    return hash === undefined
      ? unresolved(`Receive pointer ${index} is outside the protected-script set.`)
      : {
          kind: "script",
          hash,
          address: output?.address ?? null,
          source: `Protected receiving script ${index}`,
        };
  }

  return unresolved(
    `${redeemer.purpose} pointers have no target collection in Midgard native transaction v1.`,
  );
}

export function scriptInvocations(tx: TransactionView): ScriptInvocation[] {
  return tx.witnesses.redeemers.map((redeemer, ordinal) => ({
    id: `${redeemer.tag ?? "unknown"}:${redeemer.index ?? ordinal}:${ordinal}`,
    ordinal,
    operation:
      redeemer.purpose === null
        ? "Unclassified script invocation"
        : `${redeemer.purpose[0]?.toUpperCase() ?? ""}${redeemer.purpose.slice(1)}`,
    pointer:
      redeemer.purpose === null || redeemer.index === null
        ? "Pointer unavailable"
        : `${redeemer.purpose} #${redeemer.index}`,
    emitter: invocationEmitter(tx, redeemer),
    redeemer,
  }));
}

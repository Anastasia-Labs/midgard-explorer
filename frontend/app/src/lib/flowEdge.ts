export type FlowEdgeFacts = {
  lovelace: bigint;
  resolved: boolean;
  addressKind: string | null;
};

export type FlowEdgeVisual = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
};

/** Converts ledger facts into a deliberately small visual vocabulary. Width
 * is relative within this transaction and uses a square root so one large UTxO
 * does not make every other edge disappear. */
export function flowEdgeVisual(facts: FlowEdgeFacts, maxLovelace: bigint): FlowEdgeVisual {
  const denominator = maxLovelace > 0n ? maxLovelace : 1n;
  const bounded = facts.lovelace > denominator ? denominator : facts.lovelace;
  const ratio = Number((bounded * 10_000n) / denominator) / 10_000;
  const strokeWidth = 1.25 + Math.sqrt(Math.max(0, ratio)) * 3;
  const stroke = !facts.resolved
    ? "var(--mg-warning)"
    : facts.addressKind === "Script"
      ? "var(--mg-graph-script)"
      : facts.addressKind === "PubKey"
        ? "var(--mg-graph-key)"
        : "var(--mg-border-strong)";
  return {
    stroke,
    strokeWidth,
    ...(!facts.resolved ? { strokeDasharray: "6 5" } : {}),
  };
}

export function maxEdgeLovelace(facts: readonly FlowEdgeFacts[]): bigint {
  return facts.reduce((largest, edge) => (edge.lovelace > largest ? edge.lovelace : largest), 0n);
}

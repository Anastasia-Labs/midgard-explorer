import type { GlossaryEntry } from "./glossary";
import { STATUS_REGISTRY, type StatusKind } from "./status-registry";

/** What a status belongs to, so two statuses sharing a label stay distinct. */
const CONTEXT: Record<StatusKind, string> = {
  tx_lifecycle: "transaction",
  tx_validity: "transaction",
  finalization: "settlement",
  bridge_status: "bridge",
  withdrawal_validity: "withdrawal",
  forced_validity: "forced transaction",
};

const labelCounts = Object.values(STATUS_REGISTRY).reduce<Record<string, number>>(
  (counts, s) => ({ ...counts, [s.label]: (counts[s.label] ?? 0) + 1 }),
  {},
);

/** Every status the explorer shows, as glossary entries. The registry stays the
 * one owner of each explanation; this only reshapes it for the index. */
export const STATUS_GLOSSARY: Array<{ term: string; entry: GlossaryEntry }> = Object.entries(
  STATUS_REGISTRY,
).map(([code, s]) => ({
  term: `status-${code}`,
  entry: {
    label: (labelCounts[s.label] ?? 0) > 1 ? `${s.label} (${CONTEXT[s.kind]})` : s.label,
    category: "Status",
    meaning: s.explain,
    consequence: "",
  },
}));

/**
 * One transaction's status, derived once.
 *
 * Three routes derived this separately and could drift: the address route
 * produced four outcomes keyed on the ledger tier and the header hash, the
 * transaction detail route produced three keyed on the tier alone, and the
 * transactions list produced two keyed on a `committed` column that the query
 * wrote as the literal `true`. That column's false branch was unreachable and
 * its name suggested a variability the query does not have, because the list
 * reads the finalization journal and nothing else.
 *
 * No contradictory label was ever demonstrated between them. The defect was a
 * dead branch plus three places to change when the vocabulary changes, which is
 * how derivations that agree today stop agreeing.
 */

/** The node's ledger tiers, in the order `getTransaction` checks them. */
export type LedgerTier = "immutable" | "processed_mempool" | "mempool" | "journal";

export type TransactionStatus = "committed" | "pending_commit" | "accepted" | "unknown";

/**
 * `hasHeaderHash` says a block includes the transaction, whatever tier its
 * payload was found in. The address route reads it from the journal. The
 * detail route reads it from the mempool row itself, which a block marks in
 * `included_by` and leaves in place until the block's fold is final.
 */
export function transactionStatus({
  source,
  hasHeaderHash = false,
}: {
  source: string;
  hasHeaderHash?: boolean;
}): TransactionStatus {
  if (hasHeaderHash) return "committed";
  if (source === "immutable" || source === "journal") return "committed";
  if (source === "processed_mempool") return "pending_commit";
  if (source === "mempool") return "accepted";
  // Unreachable while the tiers above are the only ones the node has. It is
  // `unknown` rather than a guess at the friendliest neighbour, because a tier
  // this build has never heard of is exactly what a wrong label would hide.
  return "unknown";
}

import { truncateId } from "../../lib/format";
import { type Candidate } from "../../lib/search";

/**
 * What the backend's prefix search can answer with, and how each answer becomes
 * something the overlay can offer.
 *
 * A model, not a component: the shapes here are the API's, and turning one into
 * a candidate is the only decision, so it can be read and tested without
 * rendering a dialog.
 */

/** A partial-identifier match from the backend's prefix search. */
export type PrefixHit =
  | { kind: "transaction"; txId: string; height: number | null; headerHash: string | null }
  | { kind: "block"; headerHash: string; height: number | null }
  | { kind: "l1Transaction"; txHash: string; blockHeight: number }
  | { kind: "validator"; scriptHash: string; family: string }
  | { kind: "address"; address: string }
  | { kind: "deposit"; eventId: string; txHash: string }
  | { kind: "withdrawal"; eventId: string; txHash: string }
  | { kind: "forcedTransaction"; orderId: string; txHash: string };

/** One array, so "no suggestions" is referentially stable across renders. */
export const EMPTY_HITS: PrefixHit[] = [];

export const hitCandidate = (hit: PrefixHit): Candidate => {
  switch (hit.kind) {
    case "block":
      return {
        kind: "block",
        label: hit.height === null ? "Midgard header" : `Block #${hit.height}`,
        detail: truncateId(hit.headerHash, 12, 8),
        href: `/block/${hit.headerHash}`,
      };
    case "transaction":
      return {
        kind: "transaction",
        label: "Transaction",
        detail:
          hit.height === null
            ? truncateId(hit.txId, 12, 8)
            : `${truncateId(hit.txId, 12, 8)} in block #${hit.height}`,
        href: `/transaction/${hit.txId}`,
      };
    case "l1Transaction":
      return {
        kind: "l1Transaction",
        label: "Cardano transaction",
        detail: `${truncateId(hit.txHash, 12, 8)} in Cardano block #${hit.blockHeight}`,
        href: `/l1/transaction/${hit.txHash}`,
      };
    case "validator":
      return {
        kind: "validator",
        label: `${hit.family} validator`,
        detail: truncateId(hit.scriptHash, 12, 8),
        href: `/l1/validator/${hit.scriptHash}`,
      };
    case "address":
      return {
        kind: "address",
        label: "Address",
        detail: truncateId(hit.address, 16, 10),
        href: `/address/${hit.address}`,
      };
    case "deposit":
      return {
        kind: "deposit",
        label: "Deposit",
        detail: truncateId(hit.eventId, 12, 8),
        href: `/deposits?id=${hit.eventId}`,
      };
    case "withdrawal":
      return {
        kind: "withdrawal",
        label: "Withdrawal",
        detail: truncateId(hit.eventId, 12, 8),
        href: `/withdrawals?id=${hit.eventId}`,
      };
    case "forcedTransaction":
      return {
        kind: "forcedTransaction",
        label: "Forced transaction",
        detail: truncateId(hit.orderId, 12, 8),
        href: `/forced-transactions?id=${hit.orderId}`,
      };
  }
};

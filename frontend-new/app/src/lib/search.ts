import { bech32ChecksumValid } from "./classify";
import { l1TxUrl } from "./network";

/** Universal search, as candidates rather than a guess.
 *
 * The old classifier answered every input with exactly one destination, which
 * required deciding things it could not know. 56 hex is a block header hash and
 * it is equally a minting policy. 64 hex is a transaction hash and it is
 * equally an asset unit with an eight-character name, and it is equally a
 * Cardano L1 transaction. Picking one silently sends a reader to a 404 and
 * leaves them believing the record does not exist.
 *
 * So an ambiguous input produces several candidates, ranked by likelihood, and
 * the reader chooses. Enter still takes the first, so nothing got slower for
 * the unambiguous cases, which are most of them.
 */

export type CandidateKind =
  "transaction" | "block" | "blockHeight" | "address" | "asset" | "policy" | "l1Transaction";

export type Candidate = {
  kind: CandidateKind;
  /** Short type name for the row, e.g. "Transaction". */
  label: string;
  /** Why this candidate is being offered, in one line. */
  detail: string;
  href: string;
  /** True when the destination leaves this explorer. */
  external?: boolean;
};

export type SearchResult =
  { ok: true; candidates: Candidate[]; ambiguous: boolean } | { ok: false; reason: string };

const ADDRESS_PREFIXES = ["addr1", "addr_test1", "stake1", "stake_test1"];
const BECH32_CHARSET = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
const HEIGHT = /^#?\d{1,3}(?:,\d{3})*$|^#?\d+$/;

/** The shortest prefix worth querying. Below this a prefix matches too much of
 * the chain to be a search; it is a scan. Mirrors backend/src/db/search.ts. */
export const MIN_PREFIX = 6;

const isHex = (s: string) => /^[0-9a-fA-F]+$/.test(s);

export function searchCandidates(raw: string): SearchResult {
  const input = raw.trim();
  if (input.length === 0) return { ok: false, reason: "Enter a search term." };

  // Asset fingerprints are unambiguous by construction, which is the whole
  // point of CIP-14. Resolution needs a lookup, so the href is a resolver route
  // rather than a final destination.
  if (input.toLowerCase().startsWith("asset1")) {
    if (!bech32ChecksumValid(input.toLowerCase())) {
      return {
        ok: false,
        reason: "That asset fingerprint has an invalid checksum. Check it for a typo.",
      };
    }
    return {
      ok: true,
      ambiguous: false,
      candidates: [
        {
          kind: "asset",
          label: "Native asset",
          detail: "CIP-14 fingerprint",
          href: `/asset/by-fingerprint/${input.toLowerCase()}`,
        },
      ],
    };
  }

  const prefix = ADDRESS_PREFIXES.find((p) => input.startsWith(p));
  if (prefix) {
    const data = input.slice(prefix.length);
    if (data.length >= 6 && BECH32_CHARSET.test(data.toLowerCase())) {
      if (!bech32ChecksumValid(input)) {
        return {
          ok: false,
          reason:
            "That address has an invalid checksum. Check it for a typo or a missing character.",
        };
      }
      return {
        ok: true,
        ambiguous: false,
        candidates: [
          {
            kind: "address",
            label: "Address",
            detail: "L2 ledger address",
            href: `/address/${input}`,
          },
        ],
      };
    }
    return { ok: false, reason: "Looks like an address but contains invalid characters." };
  }

  if (HEIGHT.test(input)) {
    const digits = input.replace(/[#,]/g, "");
    // A 56- or 64-digit run is a hash typed without letters, not a height.
    if (digits.length <= 15) {
      return {
        ok: true,
        ambiguous: false,
        candidates: [
          {
            kind: "blockHeight",
            label: "Block",
            detail: `Height ${Number(digits)}`,
            href: `/block/height/${Number(digits)}`,
          },
        ],
      };
    }
  }

  if (!isHex(input)) {
    return {
      ok: false,
      reason:
        "Not a recognized identifier. Expected a transaction or block hash, a block height, a bech32 address, or an asset fingerprint (asset1…).",
    };
  }

  const hex = input.toLowerCase();
  const candidates: Candidate[] = [];

  if (hex.length === 64) {
    candidates.push({
      kind: "transaction",
      label: "Transaction",
      detail: "L2 transaction hash",
      href: `/transaction/${hex}`,
    });
    // Only offered when an L1 explorer is configured; a dead link is worse
    // than an absent option.
    const l1 = l1TxUrl(hex);
    if (l1 !== null) {
      candidates.push({
        kind: "l1Transaction",
        label: "Cardano L1 transaction",
        detail: "Opens the configured L1 explorer",
        href: l1,
        external: true,
      });
    }
    // A 64-hex string is also a policy plus an 8-character asset name.
    candidates.push({
      kind: "asset",
      label: "Native asset",
      detail: "Policy plus a 4-byte name",
      href: `/asset/${hex}`,
    });
  } else if (hex.length === 56) {
    candidates.push({
      kind: "block",
      label: "Block",
      detail: "L2 block header hash",
      href: `/block/${hex}`,
    });
    candidates.push({
      kind: "policy",
      label: "Minting policy",
      detail: "Asset with no name under this policy",
      href: `/asset/${hex}`,
    });
  } else if (hex.length > 56 && hex.length % 2 === 0) {
    candidates.push({
      kind: "asset",
      label: "Native asset",
      detail: "Policy plus asset name",
      href: `/asset/${hex}`,
    });
  }

  if (candidates.length > 0) {
    return { ok: true, ambiguous: candidates.length > 1, candidates };
  }

  if (hex.length >= MIN_PREFIX) {
    // Not a whole identifier, but long enough to look up as a prefix. The
    // overlay queries for matches; this is not itself a destination.
    return { ok: true, ambiguous: false, candidates: [] };
  }

  return {
    ok: false,
    reason: `Hex of length ${hex.length}. A transaction hash is 64 characters and a block header hash is 56; at least ${MIN_PREFIX} are needed to search by prefix.`,
  };
}

/** True when the input is a partial identifier worth asking the backend about. */
export const isPrefixQuery = (raw: string): boolean => {
  const s = raw.trim().toLowerCase();
  return isHex(s) && s.length >= MIN_PREFIX && s.length !== 56 && s.length !== 64;
};

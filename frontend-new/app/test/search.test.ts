import { describe, expect, it } from "vitest";
import { isPrefixQuery, searchCandidates } from "../src/lib/search";

const TX = "a".repeat(64);
const BLOCK = "b".repeat(56);
const VALID_TESTNET = "addr_test1yg5nqde7g4x9xknpdphhvlvy3wffng98466mes7268vdlesutwrnm";

const kinds = (raw: string): string[] => {
  const r = searchCandidates(raw);
  return r.ok ? r.candidates.map((c) => c.kind) : [`invalid:${r.reason}`];
};

describe("unambiguous inputs still resolve in one step", () => {
  it("routes an address", () => {
    expect(kinds(VALID_TESTNET)).toEqual(["address"]);
  });

  it("routes a block height, including the displayed #40 form", () => {
    for (const input of ["40", "#40", "1,234"]) {
      const r = searchCandidates(input);
      expect(r.ok && r.candidates[0]!.kind).toBe("blockHeight");
    }
  });

  it("routes an asset fingerprint through the resolver", () => {
    const r = searchCandidates("asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidates[0]!.href).toBe(
      "/asset/by-fingerprint/asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlc3",
    );
    expect(r.ambiguous).toBe(false);
  });
});

describe("ambiguous inputs are offered, never guessed", () => {
  it("offers both readings of 56 hex", () => {
    // A block header hash and a minting policy are both 28 bytes. Picking one
    // silently sends a reader to a 404 for a record that does exist.
    expect(kinds(BLOCK)).toEqual(["block", "policy"]);
    const r = searchCandidates(BLOCK);
    expect(r.ok && r.ambiguous).toBe(true);
  });

  it("offers every reading of 64 hex", () => {
    // A Midgard transaction, the same hash looked up in the Cardano index, or a
    // policy plus a four-byte asset name.
    expect(kinds(TX)).toEqual(["transaction", "l1Transaction", "asset"]);
  });

  /* An L2 transaction id and a Cardano transaction hash are both 32 bytes and
   * cannot be told apart by shape, so the Cardano reading is offered as the
   * INTERNAL page, which holds the answer, rather than as a link straight out to
   * a block explorer. Sending an unproven hash to CExplorer produced live links
   * to transactions that do not exist on Cardano. */
  it("never sends a bare 64-hex value straight to an external explorer", () => {
    const hits = searchCandidates(TX);
    expect(hits.ok).toBe(true);
    if (!hits.ok) return;
    for (const candidate of hits.candidates) {
      expect(candidate.external ?? false).toBe(false);
      expect(candidate.href.startsWith("/")).toBe(true);
    }
  });

  it("ranks the likelier reading first, so Enter still works", () => {
    expect(kinds(BLOCK)[0]).toBe("block");
    expect(kinds(TX)[0]).toBe("transaction");
  });

  it("reads hex longer than a policy as an asset unit", () => {
    expect(kinds("c".repeat(70))).toEqual(["asset"]);
  });
});

describe("partial identifiers", () => {
  it("treats a long-enough hex prefix as a prefix query, not an error", () => {
    const r = searchCandidates("abc123");
    expect(r.ok).toBe(true);
    expect(r.ok && r.candidates).toEqual([]);
    expect(isPrefixQuery("abc123")).toBe(true);
  });

  it("does not query for a prefix that would match most of the chain", () => {
    expect(isPrefixQuery("ab")).toBe(false);
    const r = searchCandidates("ab");
    expect(r.ok).toBe(false);
  });

  it("does not treat a complete identifier as a prefix", () => {
    expect(isPrefixQuery(TX)).toBe(false);
    expect(isPrefixQuery(BLOCK)).toBe(false);
  });
});

describe("bad input is explained rather than silently dropped", () => {
  it("names a checksum failure in an address", () => {
    const broken = VALID_TESTNET.slice(0, -1) + (VALID_TESTNET.endsWith("m") ? "n" : "m");
    const r = searchCandidates(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/checksum/i);
  });

  it("names a checksum failure in an asset fingerprint", () => {
    const r = searchCandidates("asset1rjklcrnsdzqp65wjgrg55sy9723kw09mlgvlcx");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/checksum/i);
  });

  it("rejects an empty search", () => {
    expect(searchCandidates("   ").ok).toBe(false);
  });

  it("explains what was expected for unrecognized text", () => {
    const r = searchCandidates("hello world");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/fingerprint/);
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(kinds(`  ${TX}\n`)[0]).toBe("transaction");
  });
});

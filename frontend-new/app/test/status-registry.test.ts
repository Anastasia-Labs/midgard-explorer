import { describe, expect, it } from "vitest";
import { STATUS_REGISTRY, legendFor, statusOf, type StatusKind } from "../src/lib/status-registry";

/** Codes the node can emit, per its CHECK constraints. If the node adds one,
 * this list and the registry must move together. */
const NODE_CODES = {
  tx_lifecycle: ["queued", "validating", "accepted", "pending_commit", "committed", "rejected"],
  bridge_status: ["awaiting", "projected", "consumed"],
  finalization: [
    "pending_submission",
    "submitted_local_finalization_pending",
    "submitted_unconfirmed",
    "observed_waiting_stability",
    "finalized",
    "abandoned",
  ],
  tx_validity: ["TxIsValid", "TxIsInvalid"],
  withdrawal_validity: [
    "WithdrawalIsValid",
    "NonExistentWithdrawalUtxo",
    "SpentWithdrawalUtxo",
    "IncorrectWithdrawalOwner",
    "IncorrectWithdrawalValue",
    "IncorrectWithdrawalSignature",
    "TooManyTokensInWithdrawal",
    "UnpayableWithdrawalValue",
  ],
  forced_validity: [
    "NonExistentInputUtxo",
    "InvalidSignature",
    "FailedScript",
    "FeeTooLow",
    "UnbalancedTx",
  ],
} satisfies Record<StatusKind, string[]>;

describe("registry coverage", () => {
  for (const [kind, codes] of Object.entries(NODE_CODES)) {
    it(`covers every ${kind} code the node can emit`, () => {
      for (const code of codes) {
        expect(STATUS_REGISTRY[code], `missing registry entry: ${code}`).toBeDefined();
        expect(STATUS_REGISTRY[code]?.kind).toBe(kind);
      }
    });
  }

  it("has no entry that is not a documented node code", () => {
    const known = new Set(Object.values(NODE_CODES).flat());
    for (const code of Object.keys(STATUS_REGISTRY)) {
      expect(known.has(code), `registry has undocumented code: ${code}`).toBe(true);
    }
  });

  it("gives every entry a non-empty label and explanation", () => {
    for (const [code, entry] of Object.entries(STATUS_REGISTRY)) {
      expect(entry.label.length, code).toBeGreaterThan(0);
      expect(entry.explain.length, code).toBeGreaterThan(0);
    }
  });

  it("states both meaning and consequence for every status", () => {
    for (const [code, entry] of Object.entries(STATUS_REGISTRY)) {
      expect(
        entry.explain.split(/[.!?]+/).filter((sentence) => sentence.trim().length > 0).length,
        code,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("tone semantics", () => {
  it("uses success only for settled states", () => {
    const success = Object.entries(STATUS_REGISTRY)
      .filter(([, v]) => v.tone === "success")
      .map(([k]) => k);
    expect(success).toEqual(
      expect.arrayContaining(["committed", "consumed", "finalized", "TxIsValid"]),
    );
    expect(success).not.toContain("pending_commit");
    expect(success).not.toContain("observed_waiting_stability");
  });

  it("uses danger only for terminal failures", () => {
    for (const [code, entry] of Object.entries(STATUS_REGISTRY)) {
      if (entry.tone !== "danger") continue;
      expect(
        ["rejected", "abandoned"].includes(code) ||
          /^(?!TxIsValid|WithdrawalIsValid).*$/.test(code),
      ).toBe(true);
    }
    expect(STATUS_REGISTRY["rejected"]?.tone).toBe("danger");
    expect(STATUS_REGISTRY["abandoned"]?.tone).toBe("danger");
  });

  it("marks genuinely-waiting states as warning, not success or info", () => {
    // Corrected 2026-07-28 against redesign-prompt.md:111-128.
    expect(STATUS_REGISTRY["pending_commit"]?.tone).toBe("warning");
    expect(STATUS_REGISTRY["observed_waiting_stability"]?.tone).toBe("warning");
    expect(STATUS_REGISTRY["awaiting"]?.tone).toBe("warning");
  });

  it("marks in-progress states as info", () => {
    expect(STATUS_REGISTRY["validating"]?.tone).toBe("info");
    expect(STATUS_REGISTRY["accepted"]?.tone).toBe("info");
    expect(STATUS_REGISTRY["projected"]?.tone).toBe("info");
  });
});

describe("statusOf", () => {
  it("resolves a known status and flags it as known", () => {
    const r = statusOf("committed");
    expect(r.known).toBe(true);
    expect(r.label).toBe("Committed");
    expect(r.tone).toBe("success");
  });

  it("renders an unknown status verbatim with a neutral tone", () => {
    const r = statusOf("some_future_status");
    expect(r.known).toBe(false);
    expect(r.label).toBe("some_future_status");
    expect(r.tone).toBe("neutral");
  });

  it("never throws on empty input", () => {
    expect(() => statusOf("")).not.toThrow();
    expect(statusOf("").known).toBe(false);
  });
});

describe("legendFor", () => {
  it("returns every entry of a kind", () => {
    const codes = legendFor("tx_lifecycle").map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(NODE_CODES.tx_lifecycle));
  });

  it("includes TxIsValid under forced validity via the alias table", () => {
    expect(legendFor("forced_validity").map((e) => e.code)).toContain("TxIsValid");
  });

  it("includes finalized under bridge status via the alias table", () => {
    expect(legendFor("bridge_status").map((e) => e.code)).toContain("finalized");
  });

  it("produces unique code/kind pairs so React keys do not collide", () => {
    for (const kind of Object.keys(NODE_CODES) as StatusKind[]) {
      const keys = legendFor(kind).map((e) => `${e.kind}-${e.code}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

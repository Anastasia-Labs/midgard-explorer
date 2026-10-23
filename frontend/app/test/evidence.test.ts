import { describe, expect, it } from "vitest";
import { IsoTimestamp, type BlockEvidence, type EvidenceLine } from "@midgard-explorer/contracts";
import {
  EVIDENCE_ORDER,
  archiveBadge,
  archiveStateCopy,
  evidenceCopy,
  observationLabel,
} from "../src/lib/evidence";

const AT = IsoTimestamp.make("2026-10-20T09:00:00.000Z");

const line = (
  state: EvidenceLine["state"],
  reason: string | null = null,
  value: string | null = null,
): EvidenceLine => ({
  state,
  value,
  reason,
  observation: null,
});

/** The evidence a public-source block carries today, as the backend sends it. */
const archived: BlockEvidence = {
  payloadIntegrity: line("pass"),
  headerBinding: line("pass"),
  roots: line("not_run", "no_authenticated_l1_header_observation"),
  l1Observation: line("unknown", "no_queue_observation"),
  daStatus: line("unknown", "no_queue_observation"),
  maturity: line("unknown", "no_queue_observation"),
  localApplication: line("unknown", "not_read_by_public_source"),
  merge: line("unknown", "no_queue_observation"),
  withdrawalPayment: line("not_applicable", "no_withdrawals_in_block"),
};

describe("block evidence copy", () => {
  it("gives each of the nine lines its own label and its own explanation", () => {
    const copies = EVIDENCE_ORDER.map((key) => evidenceCopy(key, archived[key]));
    expect(new Set(copies.map((c) => c.label)).size).toBe(9);
    expect(new Set(copies.map((c) => c.detail)).size).toBe(9);
  });

  it("never states an unknown or unchecked fact as a number", () => {
    for (const key of EVIDENCE_ORDER) {
      const copy = evidenceCopy(key, archived[key]);
      expect(`${copy.value} ${copy.detail}`, key).not.toMatch(/\b0\b/);
    }
    expect(evidenceCopy("l1Observation", archived.l1Observation).value).toBe("Unknown");
    expect(evidenceCopy("roots", archived.roots).value).toBe("Not checked");
  });

  it("says Removed only for a recorded removal", () => {
    expect(evidenceCopy("merge", line("recorded", "queue_terminal", "removed")).value).toBe(
      "Removed",
    );
    expect(evidenceCopy("merge", archived.merge).value).not.toMatch(/removed/i);
    expect(archiveBadge(null).label).toBe("Archived");
    expect(
      archiveBadge({
        outcome: "removed",
        evidence: "queue_terminal",
        anchor: null,
        view: null,
        observation: { source: "x", chainPoint: null, at: AT },
      }).label,
    ).toBe("Removed");
  });

  it("labels an operator's observation as that operator's report, not a proof", () => {
    expect(observationLabel({ source: "operator:alice", chainPoint: "slot-9", at: AT })).toMatch(
      /^Reported by operator alice/,
    );
    expect(observationLabel({ source: "fixture:outcomes", chainPoint: null, at: AT })).toMatch(
      /^From the fixture outcomes/,
    );
  });

  it("explains every archive state a missing block can be in, with its own reason", () => {
    const states = [
      archiveStateCopy({ state: "awaiting", at: null, reason: null }),
      archiveStateCopy({ state: "archiving", at: AT, reason: null }),
      archiveStateCopy({ state: "failed", at: AT, reason: "unavailable" }),
      archiveStateCopy({ state: "failed", at: AT, reason: "invalid_payload" }),
    ];
    expect(new Set(states.map((s) => s.detail)).size).toBe(4);
    expect(states[2]!.title).toMatch(/could not be archived/i);
  });
});

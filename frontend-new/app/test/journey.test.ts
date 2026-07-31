import { describe, expect, it } from "vitest";
import type { BlockFinalization, TxAdmission, TxInclusion } from "@midgard-explorer/contracts";
import {
  blockJourney,
  journeyProgress,
  transactionJourney,
  type JourneyModel,
} from "../src/lib/journey";
import { STATUS_REGISTRY } from "../src/lib/status-registry";

/** Contract types are branded; fixtures build the shapes without decoding. */
const admission = (over: Partial<TxAdmission> = {}): TxAdmission =>
  ({
    status: "accepted",
    firstSeenAt: "2026-07-28T11:59:36.000Z",
    validationStartedAt: "2026-07-28T11:59:37.700Z",
    terminalAt: "2026-07-28T11:59:41.900Z",
    updatedAt: "2026-07-28T11:59:41.900Z",
    attemptCount: 1,
    requestCount: 1,
    submitSource: "native",
    ...over,
  }) as unknown as TxAdmission;

const inclusion = (): TxInclusion =>
  ({
    height: 40,
    header_hash: "736cf77eaee1b8c518c0d360f6d1ef3fc7923392a8a9bdc9f74cac94",
    time_stamp_tz: "2026-07-28T12:00:00.000Z",
  }) as unknown as TxInclusion;

const finalization = (over: Partial<BlockFinalization> = {}): BlockFinalization =>
  ({
    status: "finalized",
    submitted_tx_hash: "bb".repeat(32),
    blockEndTime: "2026-07-28T12:00:00.000Z",
    createdAt: "2026-07-28T12:00:01.400Z",
    updatedAt: "2026-07-28T12:00:43.400Z",
    observedConfirmedAt: "2026-07-28T12:00:19.400Z",
    ...over,
  }) as unknown as BlockFinalization;

const stageBy = (m: JourneyModel, key: string) => m.stages.find((s) => s.key === key);

describe("no timestamp is invented", () => {
  /** Derived values such as "+1.7s" are fine because they are computed from two
   * recorded timestamps. What is banned is a stage claiming a moment the node
   * never recorded. */
  it("never carries a timestamp without a recorded source field", () => {
    const cases: JourneyModel[] = [
      transactionJourney({ status: "queued", admission: admission({ validationStartedAt: null, terminalAt: null }), inclusion: null, finalization: null }),
      transactionJourney({ status: "committed", admission: admission(), inclusion: inclusion(), finalization: finalization({ observedConfirmedAt: null, status: "submitted_unconfirmed" }) }),
      transactionJourney({ status: "accepted", admission: null, inclusion: null, finalization: null }),
    ];
    for (const m of cases) {
      for (const s of m.stages) {
        if (s.timestampKind === "recorded") expect(s.occurredAt).not.toBeNull();
        else expect(s.occurredAt, `${s.key} invented a timestamp`).toBeNull();
      }
    }
  });

  it("marks settlement timestamps not applicable when nothing was included", () => {
    const m = transactionJourney({ status: "accepted", admission: admission(), inclusion: null, finalization: null });
    expect(stageBy(m, "final")!.timestampKind).toBe("not_applicable");
  });
});

describe("failure never renders as success", () => {
  it("marks a rejected transaction failed and stops the journey", () => {
    const m = transactionJourney({ status: "rejected", admission: admission({ status: "rejected" }), inclusion: null, finalization: null });
    expect(m.outcome).toBe("failed");
    expect(stageBy(m, "validated")!.state).toBe("failed");
    // A rejected transaction was never in a block, so no settlement stage may
    // appear at all, reached or otherwise.
    expect(stageBy(m, "included")).toBeUndefined();
    expect(stageBy(m, "final")).toBeUndefined();
    expect(m.stages.some((s) => s.state === "reached" && s.key !== "received")).toBe(false);
  });

  it("marks an abandoned finalization failed, not final", () => {
    const m = transactionJourney({ status: "committed", admission: admission(), inclusion: inclusion(), finalization: finalization({ status: "abandoned" }) });
    expect(m.outcome).toBe("failed");
    expect(stageBy(m, "final")!.state).toBe("failed");
    expect(stageBy(m, "final")!.label).toBe("Abandoned");
  });
});

describe("settlement never precedes inclusion", () => {
  it("orders inclusion before every settlement stage", () => {
    const m = transactionJourney({ status: "committed", admission: admission(), inclusion: inclusion(), finalization: finalization() });
    const keys = m.stages.map((s) => s.key);
    const included = keys.indexOf("included");
    for (const settlementKey of ["seen_on_l1", "final"]) {
      const i = keys.indexOf(settlementKey);
      if (i !== -1) expect(i).toBeGreaterThan(included);
    }
  });

  it("never reaches a settlement stage without an inclusion", () => {
    const m = transactionJourney({ status: "pending_commit", admission: admission(), inclusion: null, finalization: null });
    expect(stageBy(m, "included")!.state).not.toBe("reached");
    expect(stageBy(m, "final")!.state).not.toBe("reached");
  });
});

describe("final means the protocol's terminal success state", () => {
  it("reaches the final stage only when finalization says finalized", () => {
    const nonFinal = ["pending_submission", "submitted_unconfirmed", "observed_waiting_stability"];
    for (const status of nonFinal) {
      const m = transactionJourney({ status: "committed", admission: admission(), inclusion: inclusion(), finalization: finalization({ status }) });
      expect(stageBy(m, "final")!.state, `${status} must not reach final`).not.toBe("reached");
      expect(m.outcome).toBe("active");
    }
    const settled = transactionJourney({ status: "committed", admission: admission(), inclusion: inclusion(), finalization: finalization() });
    expect(stageBy(settled, "final")!.state).toBe("reached");
    expect(settled.outcome).toBe("complete");
  });
});

describe("unknown statuses stay visible", () => {
  it("appends an unrecognized settlement stage verbatim", () => {
    const m = transactionJourney({ status: "committed", admission: admission(), inclusion: inclusion(), finalization: finalization({ status: "some_future_finalization_stage" }) });
    const unknown = stageBy(m, "unknown_settlement");
    expect(unknown).toBeDefined();
    expect(unknown!.label).toBe("some_future_finalization_stage");
    expect(unknown!.state).toBe("unknown");
    // It must not be mapped onto a known stage.
    expect(stageBy(m, "final")).toBeUndefined();
    expect(m.outcome).toBe("unknown");
  });

  it("reports an unrecognized lifecycle status as an unknown outcome", () => {
    const m = transactionJourney({ status: "some_future_status", admission: admission(), inclusion: null, finalization: null });
    expect(m.outcome).toBe("unknown");
    expect(m.rawStatus).toBe("some_future_status");
  });

  it("keeps the raw status on every model", () => {
    for (const status of ["committed", "rejected", "some_future_status"]) {
      const m = transactionJourney({ status, admission: admission(), inclusion: null, finalization: null });
      expect(m.rawStatus).toBe(status);
    }
  });
});

describe("the list-row indicator cannot outrun the record", () => {
  it("never reports complete for a status that is not terminal success", () => {
    const nonTerminal = [
      "queued",
      "validating",
      "accepted",
      "pending_commit",
      "pending_submission",
      "submitted_unconfirmed",
      "submitted_local_finalization_pending",
      "observed_waiting_stability",
      "awaiting",
      "projected",
    ];
    for (const status of nonTerminal) {
      expect(journeyProgress(status).state, `${status} claimed completion`).toBe("active");
    }
    for (const status of ["committed", "finalized", "consumed"]) {
      const p = journeyProgress(status);
      expect(p.state).toBe("complete");
      expect(p.step).toBe(p.total);
    }
  });

  it("gives a failure no progress at all", () => {
    for (const status of ["rejected", "abandoned"]) {
      const p = journeyProgress(status);
      expect(p.state).toBe("failed");
      expect(p.step).toBe(0);
    }
  });

  it("refuses to place an unrecognized status in the ordering", () => {
    const p = journeyProgress("some_future_status");
    expect(p.state).toBe("unknown");
    expect(p.step).toBe(0);
    expect(p.label).toBe("some_future_status");
  });

  it("orders each lifecycle so a later status never sits earlier", () => {
    const orderings = [
      ["queued", "validating", "accepted", "committed"],
      ["pending_submission", "submitted_unconfirmed", "observed_waiting_stability", "finalized"],
      ["awaiting", "projected", "consumed"],
    ];
    for (const chain of orderings) {
      const steps = chain.map((s) => journeyProgress(s).step);
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i], `${chain[i]} is not after ${chain[i - 1]}`).toBeGreaterThan(steps[i - 1]!);
      }
    }
  });

  it("agrees with the full journey about whether a transaction is settled", () => {
    // A row and the record it links to must not disagree: if the indicator
    // shows complete, the journey must call the outcome complete too.
    for (const status of ["committed", "pending_commit", "rejected"]) {
      const rowComplete = journeyProgress(status).state === "complete";
      const journeyComplete =
        transactionJourney({ status, admission: admission(), inclusion: inclusion(), finalization: finalization() })
          .outcome === "complete";
      if (rowComplete) expect(journeyComplete).toBe(true);
    }
  });
});

describe("every known status is handled", () => {
  it("produces a journey for every lifecycle code in the registry", () => {
    const lifecycle = Object.entries(STATUS_REGISTRY)
      .filter(([, v]) => v.kind === "tx_lifecycle")
      .map(([code]) => code);
    expect(lifecycle.length).toBeGreaterThan(0);
    for (const status of lifecycle) {
      const m = transactionJourney({ status, admission: admission(), inclusion: null, finalization: null });
      expect(m.stages.length, `${status} produced no stages`).toBeGreaterThan(0);
      expect(m.headline.length).toBeGreaterThan(0);
    }
  });

  it("produces a block journey for every finalization code in the registry", () => {
    const codes = Object.entries(STATUS_REGISTRY)
      .filter(([, v]) => v.kind === "finalization")
      .map(([code]) => code);
    for (const status of codes) {
      const m = blockJourney(finalization({ status }), 40);
      expect(m.stages.length, `${status} produced no stages`).toBeGreaterThan(0);
      expect(m.rawStatus).toBe(status);
    }
  });

  it("handles a block with no finalization record", () => {
    const m = blockJourney(null, 40);
    expect(m.outcome).toBe("unknown");
    expect(m.stages.every((s) => s.state !== "reached" || s.key === "closed")).toBe(true);
  });
});

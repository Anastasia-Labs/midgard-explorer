import { describe, expect, it } from "vitest";
import { classifyOutput } from "../src/indexer/eventClassification.js";

/** The seam the ingest loop and `scripts/redecode-l1-events.ts` share.
 *
 * It exists so a backfill cannot classify a datum differently from live
 * ingestion. These assert the contract that makes the backfill safe to run:
 * a datum that decodes gets the same answer either way, and one that does not
 * stays `unknown` with its raw payload intact rather than being guessed at. */

/** Ground truth, from the scheduler validator's output in preprod transaction
 * c934b1a42154db5a40e75158527aef2ef3f82a7e86b65103de3228c629346e10. */
const realScheduler = {
  constructor: 1,
  fields: [
    { bytes: "2de3134c86f4b08bcf27b621d9e552c735a21e2c0dedca43435b09d5" },
    { int: 1786642920000 },
  ],
};

describe("classifyOutput", () => {
  it("names a scheduler datum and carries its fields as JSON-safe values", () => {
    expect(classifyOutput("scheduler", realScheduler)).toEqual({
      eventType: "scheduler",
      decoded: {
        state: "activeOperator",
        operator: "2de3134c86f4b08bcf27b621d9e552c735a21e2c0dedca43435b09d5",
        startTime: "1786642920000",
      },
      header: null,
    });
  });

  it("reports noDatum for an output that carries no inline datum", () => {
    expect(classifyOutput("scheduler", null)).toEqual({
      eventType: "noDatum",
      decoded: null,
      header: null,
    });
  });

  it("leaves a family with no decoder unknown rather than guessing", () => {
    // activeOperators, registeredOperators, hubOracle and the rest have no
    // decoder yet. They must stay unknown so the raw datum survives for one.
    expect(classifyOutput("activeOperators", realScheduler)).toEqual({
      eventType: "unknown",
      decoded: null,
      header: null,
    });
  });

  it("leaves an undecodable state-queue datum unknown instead of a header", () => {
    const result = classifyOutput("stateQueue", { constructor: 9, fields: [] });
    expect(result.header).toBeNull();
    expect(result.eventType).toBe("unknown");
  });
});

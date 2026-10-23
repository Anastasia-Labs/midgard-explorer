import { describe, expect, it } from "vitest";
import { pullSequence, sagFor, SLACK_PX } from "../src/lib/queuePhysics";

/** A merge drawn as physics: the merged block is drawn in, and each block
 * behind it is pulled by a rope only once the one ahead takes up the slack. */

const firstMove = (series: number[]) => series.findIndex((r) => r < series[0]! - 1e-6);

describe("the pull", () => {
  const seq = pullSequence({ leadDistance: 200, movers: [206, 206, 206] });

  it("draws the merged block in faster and faster", () => {
    const end = Math.round(seq.arrivalMs / seq.sampleMs);
    const steps = seq.lead.slice(10, end).map((d, i, a) => (i === 0 ? 0 : d - a[i - 1]!));
    // Accelerating: each step is at least as long as the one before.
    for (let i = 2; i < steps.length; i++)
      expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]! - 1e-9);
    expect(seq.lead.at(-1)).toBeCloseTo(200);
  });

  it("pulls each block only after the one ahead has taken up its slack", () => {
    const starts = seq.movers.map(firstMove);
    expect(starts[0]).toBeGreaterThan(0);
    expect(starts[1]).toBeGreaterThan(starts[0]!);
    expect(starts[2]).toBeGreaterThan(starts[1]!);
    // When the second block starts, the first has moved about the slack.
    const first = seq.movers[0]!;
    expect(206 - first[starts[1]!]!).toBeGreaterThanOrEqual(SLACK_PX - 1);
  });

  it("hits the boundary then sends a small backward kick down the line", () => {
    const impacts = seq.movers.map((series) => series.findIndex((x) => x === 0));
    expect(impacts[0]).toBeGreaterThan(0);
    seq.movers.forEach((series, i) => {
      expect(Math.min(...series)).toBeGreaterThanOrEqual(0);
      const kick = Math.max(...series.slice(impacts[i]!));
      expect(kick).toBeGreaterThan(0);
      expect(kick).toBeLessThanOrEqual(5);
      if (i) {
        const previous = Math.max(...seq.movers[i - 1]!.slice(impacts[i - 1]!));
        expect(kick).toBeLessThan(previous * 0.75);
      }
      expect(series.at(-1)).toBe(0);
      if (i) expect(impacts[i]).toBeGreaterThan(impacts[i - 1]!);
    });
  });

  it("passes the pull on through a block that does not move", () => {
    const through = pullSequence({ leadDistance: 200, movers: [206, 0, 206] });
    expect(firstMove(through.movers[2]!)).toBeGreaterThan(0);
  });

  it("keeps followers behind the moving leader until absorption", () => {
    const coupled = pullSequence({ leadDistance: 224, movers: [224, 224, 224] });
    for (let t = 0; t * coupled.sampleMs < coupled.arrivalMs; t++) {
      let ahead = coupled.lead[t]!;
      for (const follower of coupled.movers) {
        const travelled = 224 - follower[t]!;
        expect(travelled).toBeLessThanOrEqual(ahead + 0.1);
        ahead = travelled;
      }
    }
  });

  it("never stretches a chain beyond its available slack", () => {
    const coupled = pullSequence({ leadDistance: 224, movers: [224, 224, 224] });
    for (let t = 0; t < coupled.lead.length; t++) {
      let ahead = coupled.lead[t]!;
      for (const follower of coupled.movers) {
        const travelled = 224 - follower[t]!;
        expect(ahead - travelled).toBeLessThanOrEqual(SLACK_PX + 0.1);
        ahead = travelled;
      }
    }
  });
});

describe("a chain link's sag", () => {
  it("is taut when its cards pull apart and slack when they close up", () => {
    expect(sagFor(32, 32)).toBe(1);
    expect(sagFor(60, 32)).toBeLessThan(0.1);
    expect(sagFor(26, 32)).toBeGreaterThan(1);
  });
});

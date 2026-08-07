import type { MetricsResponse } from "@midgard-explorer/contracts";
import { describe, expect, it } from "vitest";
import { networkHealth } from "../src/lib/health";

/** The verdict is the first thing a reader sees on the overview, so the thing
 * that matters most about it is that it is never wrong in the reassuring
 * direction. Most of these tests exist to pin that: a stalled chain must not
 * read healthy, and an unmeasurable one must not read either. */

const base = (over: Partial<MetricsResponse> = {}): MetricsResponse =>
  ({
    window: {
      hours: 24,
      start: "2026-07-30T00:00:00.000Z",
      end: "2026-07-31T00:00:00.000Z",
      observedFrom: null,
      partial: false,
    },
    tip: { height: 40, at: "2026-07-31T00:00:00.000Z", ageSeconds: 12, source: "blocks.height" },
    throughput: {
      transactions: 88,
      blocks: 40,
      transactionsPerBlock: 2.2,
      blockIntervalSeconds: { p50: 21, p95: 40, sampleCount: 40 },
      source: "blocks",
    },
    admission: {
      latency: { p50Ms: 5900, p95Ms: 5900, sampleCount: 43, source: "tx_admissions" },
      accepted: 40,
      rejected: 3,
      rejectionRate: 3 / 43,
      queueDepth: 17,
      source: "tx_admissions",
    },
    finality: {
      settlementLatency: { p50Ms: 43000, p95Ms: 61000, sampleCount: 10, source: "finalizations" },
      finalized: 10,
      pending: 24,
      abandoned: 0,
      oldestUnsettled: null,
      source: "finalizations",
    },
    statusBreakdown: { finalization: [], admission: [] },
    series: [],
    ...over,
  }) as MetricsResponse;

describe("networkHealth", () => {
  it("calls a chain producing and settling normally healthy", () => {
    const h = networkHealth(base());
    expect(h.state).toBe("healthy");
    expect(h.headline).toMatch(/producing blocks/i);
  });

  it("never reports healthy when the tip is far past the observed cadence", () => {
    const h = networkHealth(
      base({
        tip: { height: 40, at: null, ageSeconds: 21 * 12, source: "blocks.height" },
      } as Partial<MetricsResponse>),
    );
    expect(h.state).toBe("stalled");
    expect(h.headline).toMatch(/stopped/i);
  });

  it("judges lateness against this node's own interval, not a constant", () => {
    // 60s since the last block is healthy on a 40s chain and stalled on a 5s
    // one. A fixed threshold cannot express that, and would be wrong on one of
    // them whichever number it picked.
    const slowChain = networkHealth(
      base({
        tip: { height: 40, at: null, ageSeconds: 60, source: "b" },
        throughput: {
          transactions: 88,
          blocks: 40,
          transactionsPerBlock: 2.2,
          blockIntervalSeconds: { p50: 40, p95: 80, sampleCount: 40 },
          source: "blocks",
        },
      } as Partial<MetricsResponse>),
    );
    const fastChain = networkHealth(
      base({
        tip: { height: 40, at: null, ageSeconds: 60, source: "b" },
        throughput: {
          transactions: 88,
          blocks: 40,
          transactionsPerBlock: 2.2,
          blockIntervalSeconds: { p50: 5, p95: 9, sampleCount: 40 },
          source: "blocks",
        },
      } as Partial<MetricsResponse>),
    );
    expect(slowChain.state).toBe("healthy");
    expect(fastChain.state).toBe("stalled");
  });

  it("reports degraded, not healthy, when settlements are being abandoned", () => {
    const h = networkHealth(
      base({
        finality: {
          settlementLatency: {
            p50Ms: 43000,
            p95Ms: 61000,
            sampleCount: 10,
            source: "finalizations",
          },
          finalized: 10,
          pending: 24,
          abandoned: 5,
          oldestUnsettled: null,
          source: "finalizations",
        },
      } as Partial<MetricsResponse>),
    );
    expect(h.state).toBe("degraded");
    expect(h.reasons.join(" ")).toMatch(/abandoned/i);
  });

  it("reports degraded when a large share of transactions are rejected", () => {
    const h = networkHealth(
      base({
        admission: {
          latency: { p50Ms: 5900, p95Ms: 5900, sampleCount: 43, source: "tx_admissions" },
          accepted: 20,
          rejected: 23,
          rejectionRate: 23 / 43,
          queueDepth: 17,
          source: "tx_admissions",
        },
      } as Partial<MetricsResponse>),
    );
    expect(h.state).toBe("degraded");
    expect(h.reasons.join(" ")).toMatch(/rejected/i);
  });

  it("says it cannot judge rather than guessing when there is no interval", () => {
    const h = networkHealth(
      base({
        throughput: {
          transactions: 0,
          blocks: 1,
          transactionsPerBlock: null,
          blockIntervalSeconds: { p50: null, p95: null, sampleCount: 0 },
          source: "blocks",
        },
      } as Partial<MetricsResponse>),
    );
    expect(h.state).toBe("unknown");
    expect(h.headline).toMatch(/not enough history/i);
  });

  it("says it cannot judge when metrics are missing entirely", () => {
    const h = networkHealth(null);
    expect(h.state).toBe("unknown");
    expect(h.reasons.join(" ")).toMatch(/unavailable/i);
  });

  it("gives every reason a figure a reader can check", () => {
    // A verdict a reader cannot audit is worth less than the number it
    // replaced, so every reason must cite something countable.
    for (const metrics of [
      base({ finality: { ...base().finality, abandoned: 5 } } as Partial<MetricsResponse>),
      base({
        tip: { height: 1, at: null, ageSeconds: 300, source: "b" },
      } as Partial<MetricsResponse>),
      base(),
    ]) {
      for (const reason of networkHealth(metrics).reasons) {
        expect(reason, `"${reason}" cites no figure`).toMatch(/\d/);
      }
    }
  });
});

/** A node that produced blocks and then stopped is the state this explorer was
 * actually in: tip #20 from three days earlier, nothing in the window. It
 * reported "not enough history to judge the network yet" directly above a panel
 * reading "All time: 6 blocks", telling the reader the chain was too young when
 * really it had gone quiet. */
describe("networkHealth when no interval can be measured", () => {
  const noInterval = (over: Partial<MetricsResponse["throughput"]> = {}) =>
    base({
      tip: {
        height: 20,
        at: "2026-08-04T12:28:29.120Z",
        ageSeconds: 284112,
        source: "blocks.height",
      },
      throughput: {
        transactions: 0,
        blocks: 0,
        transactionsPerBlock: null,
        blockIntervalSeconds: { p50: null, p95: null, sampleCount: 0 },
        source: "blocks",
        ...over,
      },
    });

  it("calls a node that produced blocks and then went quiet stalled, not unjudgeable", () => {
    const h = networkHealth(noInterval());
    expect(h.state).toBe("stalled");
    expect(h.headline).toContain("stopped producing blocks");
  });

  it("names the last block and how long ago it was, so the claim is checkable", () => {
    const h = networkHealth(noInterval());
    expect(h.reasons[0]).toContain("#20");
    expect(h.reasons[0]).toContain("78.9h");
    expect(h.reasons[0]).toContain("24 hours");
  });

  it("says the figures below cover the ledger only, not Midgard's L1 activity", () => {
    const h = networkHealth(noInterval());
    expect(h.reasons.join(" ")).toContain("indexed separately");
  });

  // The discriminating case against the fix over-reaching: a chain that has
  // genuinely never produced a block still has no history to judge, and must
  // not be reported as having stopped.
  it("still reports a chain with no blocks at all as unjudgeable", () => {
    const h = networkHealth(
      base({
        tip: { height: 0, at: null, ageSeconds: 0, source: "blocks.height" },
        throughput: {
          transactions: 0,
          blocks: 0,
          transactionsPerBlock: null,
          blockIntervalSeconds: { p50: null, p95: null, sampleCount: 0 },
          source: "blocks",
        },
      }),
    );
    expect(h.state).toBe("unknown");
    expect(h.headline).toContain("not enough history");
  });

  // And a chain that IS producing, but has only one block in the window, is
  // unmeasurable rather than stalled.
  it("reports a single block in the window as unmeasurable pace, not stopped", () => {
    const h = networkHealth(noInterval({ blocks: 1 }));
    expect(h.state).toBe("unknown");
    expect(h.headline).toContain("pace");
    expect(h.reasons[0]).toContain("1 block has");
  });
});

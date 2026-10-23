import { IsoTimestamp } from "@midgard-explorer/contracts";
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
    tip: {
      headerHash: "ab".repeat(28),
      height: 40,
      at: "2026-07-31T00:00:00.000Z",
      ageSeconds: 12,
      source: "blocks.height",
    },
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
    waiting: {
      transactions: 0,
      deposits: 0,
      withdrawals: 0,
      forcedTransactions: 0,
      since: null,
      source: "mempool",
    },
    statusBreakdown: { finalization: [], admission: [] },
    series: [],
    ...over,
  }) as MetricsResponse;

/** Work waiting for a block since `seconds` before the window's end. */
const waitingFor = (seconds: number, over: Partial<MetricsResponse["waiting"]> = {}) => ({
  transactions: 0,
  deposits: 0,
  withdrawals: 1,
  forcedTransactions: 0,
  since: IsoTimestamp.make(
    new Date(Date.parse("2026-07-31T00:00:00.000Z") - seconds * 1000).toISOString(),
  ),
  source: "mempool",
  ...over,
});

describe("networkHealth", () => {
  it("calls a chain producing and settling normally healthy", () => {
    const h = networkHealth(base());
    expect(h.state).toBe("healthy");
    expect(h.headline).toBe("Nothing awaiting a block");
  });

  it("never reports healthy when work has waited far past the observed cadence", () => {
    const h = networkHealth(
      base({
        tip: {
          headerHash: "ab".repeat(28),
          height: 40,
          at: null,
          ageSeconds: 21 * 12,
          source: "blocks.height",
        },
        waiting: waitingFor(21 * 12),
      } as Partial<MetricsResponse>),
    );
    expect(h.state).toBe("stalled");
    // Late is claimed, not stopped: the figures show a wait, not a halt.
    expect(h.headline).toBe("Overdue · 1 withdrawal awaiting a block · 4m 12s");
    // The chain tip figure beside the verdict already gives the last block's age.
    expect(h.reasons).toEqual([]);
  });

  /** The node makes a block only when something waits for one, so an old tip
   * with nothing waiting is a quiet chain. Calling it stalled put a red tip on
   * a node that had simply had no transactions for a day. */
  it("calls an old tip with nothing waiting idle, not stalled", () => {
    const h = networkHealth(
      base({
        tip: { headerHash: "ab".repeat(28), height: 40, at: null, ageSeconds: 77_679, source: "b" },
      } as Partial<MetricsResponse>),
    );
    expect(h.state).toBe("idle");
    expect(h.headline).toBe("Nothing awaiting a block");
    expect(h.reasons).toEqual([]);
  });

  it("names everything that is waiting", () => {
    const h = networkHealth(
      base({
        tip: { headerHash: "ab".repeat(28), height: 40, at: null, ageSeconds: 3_600, source: "b" },
        waiting: waitingFor(3_600, { transactions: 2, deposits: 1 }),
      } as Partial<MetricsResponse>),
    );
    // The duration is the oldest wait, so it says so, and mixed kinds are
    // named once as items with the breakdown on its own line.
    expect(h.headline).toBe("Overdue · 4 items awaiting a block · oldest 1h 0m");
    expect(h.reasons[0]).toBe("2 transactions · 1 deposit · 1 withdrawal");
  });

  it("judges lateness against this node's own interval, not a constant", () => {
    // Work that has waited 60s is on time on a 40s chain and stalled on a 5s
    // one. A fixed threshold cannot express that, and would be wrong on one of
    // them whichever number it picked.
    const slowChain = networkHealth(
      base({
        tip: { headerHash: "ab".repeat(28), height: 40, at: null, ageSeconds: 60, source: "b" },
        throughput: {
          transactions: 88,
          blocks: 40,
          transactionsPerBlock: 2.2,
          blockIntervalSeconds: { p50: 40, p95: 80, sampleCount: 40 },
          source: "blocks",
        },
        waiting: waitingFor(60),
      } as Partial<MetricsResponse>),
    );
    const fastChain = networkHealth(
      base({
        tip: { headerHash: "ab".repeat(28), height: 40, at: null, ageSeconds: 60, source: "b" },
        throughput: {
          transactions: 88,
          blocks: 40,
          transactionsPerBlock: 2.2,
          blockIntervalSeconds: { p50: 5, p95: 9, sampleCount: 40 },
          source: "blocks",
        },
        waiting: waitingFor(60),
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
    // Said in the headline, not left to the dot and the second line.
    expect(h.headline).toBe("Degraded · Nothing awaiting a block");
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

  it("says it cannot judge waiting work rather than guessing when there is no interval", () => {
    const h = networkHealth(
      base({
        throughput: {
          transactions: 0,
          blocks: 1,
          transactionsPerBlock: null,
          blockIntervalSeconds: { p50: null, p95: null, sampleCount: 0 },
          source: "blocks",
        },
        waiting: waitingFor(30),
      } as Partial<MetricsResponse>),
    );
    expect(h.state).toBe("unknown");
    expect(h.headline).toBe("1 withdrawal awaiting a block · 30s");
    expect(h.reasons[0]).toMatch(/^Too early to judge: 1 block in 24h/);
  });

  /** A day with no block leaves no gap to measure a cadence from, but work
   * that has waited longer than the whole window with no block in it is
   * stalled whatever the cadence. Reading "not enough history" there put a
   * grey verdict on a withdrawal a day overdue. */
  it("calls work that has waited longer than the whole window stalled", () => {
    const h = networkHealth(
      base({
        tip: {
          headerHash: "ab".repeat(28),
          height: null,
          at: null,
          ageSeconds: 90_600,
          source: "b",
        },
        throughput: {
          transactions: 0,
          blocks: 0,
          transactionsPerBlock: null,
          blockIntervalSeconds: { p50: null, p95: null, sampleCount: 0 },
          source: "blocks",
        },
        waiting: waitingFor(90_840),
      } as Partial<MetricsResponse>),
    );
    expect(h.state).toBe("stalled");
    expect(h.headline).toBe("Overdue · 1 withdrawal awaiting a block · 1d 1h");
  });

  it("says once that the figures are unavailable when metrics are missing entirely", () => {
    const h = networkHealth(null);
    expect(h.state).toBe("unknown");
    expect(h.headline).toBe("Figures unavailable");
    expect(h.reasons).toEqual([]);
  });

  it("gives every reason a figure a reader can check", () => {
    // A verdict a reader cannot audit is worth less than the number it
    // replaced, so every reason must cite something countable.
    for (const metrics of [
      base({ finality: { ...base().finality, abandoned: 5 } } as Partial<MetricsResponse>),
      base({
        tip: { headerHash: "ab".repeat(28), height: 1, at: null, ageSeconds: 300, source: "b" },
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
        headerHash: base().tip.headerHash,
        height: 20,
        // Branded now: `IsoTimestamp` rejects any string that will not parse,
        // which is what stopped "undefined" reaching the source banner.
        at: IsoTimestamp.make("2026-08-04T12:28:29.120Z"),
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

  it("calls a node that went quiet with nothing waiting idle, not unjudgeable", () => {
    const h = networkHealth(noInterval());
    expect(h.state).toBe("idle");
    expect(h.headline).toBe("Nothing awaiting a block");
  });

  // The chain tip figure the panel renders next to this verdict already gives
  // the block and its age. Nothing here needs a reason.
  it("gives no reasons: the headline and the chain tip figure already say it", () => {
    const h = networkHealth(noInterval());
    expect(h.reasons).toEqual([]);
  });

  // The discriminating case against the fix over-reaching: a chain that has
  // genuinely never produced a block still has no history to judge, and must
  // not be reported as having stopped.
  it("still reports a chain with no blocks at all as unjudgeable", () => {
    const h = networkHealth(
      base({
        tip: { headerHash: null, height: null, at: null, ageSeconds: 0, source: "blocks.height" },
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
    expect(h.headline).toBe("No blocks yet");
  });

  // And work waiting on a chain with only one block in the window is
  // unmeasurable rather than stalled: there is no gap to compare the wait with.
  it("reports waiting work with a single block in the window as unmeasurable pace", () => {
    const h = networkHealth({ ...noInterval({ blocks: 1 }), waiting: waitingFor(90) });
    expect(h.state).toBe("unknown");
    expect(h.headline).toBe("1 withdrawal awaiting a block · 1m 30s");
    expect(h.reasons[0]).toMatch(/^Too early to judge/);
  });
});

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdaAmount, ValueCell } from "../src/components/ui/amount";
import { Journey } from "../src/components/ui/journey";
import { NetworkMetrics } from "../src/components/ui/metrics";
import { EmptyState, ErrorState, L1L2Badge } from "../src/components/ui/primitives";
import { StatusBadge } from "../src/components/ui/status";
import { SummaryBand } from "../src/components/ui/summary";
import { DecodeWarn } from "../src/components/ui/table";
import { blockJourney, transactionJourney } from "../src/lib/journey";
import type {
  BlockFinalization,
  MetricsResponse,
  TxAdmission,
  ValueView,
} from "@midgard-explorer/contracts";

/** DecimalString is branded; fixtures build the branded shape without decoding. */
const value = (lovelace: string, assets: Record<string, Record<string, string>> = {}) =>
  ({ lovelace, assets }) as unknown as ValueView;

afterEach(cleanup);

describe("StatusBadge", () => {
  it("renders the registry label for a known status", () => {
    render(<StatusBadge status="committed" />);
    expect(screen.getByText("Committed")).toBeDefined();
  });

  it("renders an unknown status verbatim and announces it to screen readers", () => {
    render(<StatusBadge status="some_future_status" />);
    expect(screen.getByText("some_future_status")).toBeDefined();
    expect(screen.getByText("(unrecognized status)")).toBeDefined();
  });

  it("does not announce an unrecognized status for a known one", () => {
    render(<StatusBadge status="rejected" />);
    expect(screen.queryByText("(unrecognized status)")).toBeNull();
  });

  it("carries a plain-English explanation, not colour alone", () => {
    const { container } = render(<StatusBadge status="pending_commit" />);
    expect(container.querySelector("[title]")?.getAttribute("title")).toMatch(/waiting/i);
  });
});

/** The lifecycle stepper, admission timeline and settlement band were three
 * renderings of one story; `Journey` replaced all three. The invariants they
 * guarded did not go away with them, so they are asserted here against the
 * component that now does the rendering. */
describe("Journey", () => {
  const admission = {
    status: "accepted",
    firstSeenAt: "2026-07-28T12:00:00.000Z",
    validationStartedAt: "2026-07-28T12:00:01.700Z",
    terminalAt: "2026-07-28T12:00:05.900Z",
    updatedAt: "2026-07-28T12:00:05.900Z",
    attemptCount: 1,
    requestCount: 2,
    submitSource: "native",
  } as TxAdmission;

  const finalization = {
    status: "observed_waiting_stability",
    submitted_tx_hash: "ab".repeat(32),
    blockEndTime: "2026-07-28T12:00:00.000Z",
    createdAt: "2026-07-28T12:00:01.400Z",
    updatedAt: "2026-07-28T12:00:19.400Z",
    observedConfirmedAt: "2026-07-28T12:00:19.400Z",
  } as BlockFinalization;

  it("keeps the scrollable rail keyboard reachable", () => {
    render(<Journey model={transactionJourney({ status: "queued", admission, inclusion: null, finalization: null })} />);
    expect(screen.getByRole("list").getAttribute("tabindex")).toBe("0");
  });

  it("shows measured deltas between recorded stages", () => {
    render(<Journey model={transactionJourney({ status: "accepted", admission, inclusion: null, finalization: null })} />);
    expect(screen.getByText("+1.7s")).toBeDefined();
    expect(screen.getByText("+4.2s")).toBeDefined();
  });

  it("does not invent an L1 submission timestamp", () => {
    render(<Journey model={blockJourney(finalization, 40)} />);
    // The label is on the rail and again in the details; the details entry is
    // the one that carries the timestamp, or says it has none.
    const entry = screen
      .getAllByText("Submitted to L1")
      .map((el) => el.closest("dt")?.parentElement)
      .find((el) => el != null);
    expect(entry).toBeDefined();
    expect(within(entry!).getByText("Not recorded")).toBeDefined();
  });

  it("shows the failure path and no settlement stage for a rejection", () => {
    render(
      <Journey
        model={transactionJourney({
          status: "rejected",
          admission: { ...admission, status: "rejected" } as TxAdmission,
          inclusion: null,
          finalization: null,
        })}
      />,
    );
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);
    expect(screen.queryByText("Final on L1")).toBeNull();
  });

  it("names the stage a block is waiting on rather than restating its code", () => {
    render(<Journey model={blockJourney(finalization, 40)} />);
    expect(screen.getByText("Committed, awaiting L1 finality")).toBeDefined();
  });
});

describe("NetworkMetrics", () => {
  const base: MetricsResponse = {
    window: {
      hours: 24,
      start: "2026-07-27T12:00:00.000Z",
      end: "2026-07-28T12:00:00.000Z",
      observedFrom: "2026-07-20T12:00:00.000Z",
      partial: false,
    },
    tip: { height: 40, at: "2026-07-28T12:00:00.000Z", ageSeconds: 12, source: "blocks.height" },
    throughput: {
      transactions: 88,
      blocks: 40,
      transactionsPerBlock: 2.2,
      blockIntervalSeconds: { p50: 21, p95: 24, sampleCount: 39 },
      source: "blocks.time_stamp_tz",
    },
    admission: {
      latency: { p50Ms: 5900, p95Ms: 7100, sampleCount: 43, source: "tx_admissions.terminal_at" },
      accepted: 35,
      rejected: 8,
      rejectionRate: 8 / 43,
      queueDepth: 17,
      source: "tx_admissions.status",
    },
    finality: {
      settlementLatency: { p50Ms: null, p95Ms: null, sampleCount: 0, source: "pbf.updated_at" },
      finalized: 0,
      pending: 0,
      abandoned: 0,
      oldestUnsettled: null,
      source: "pbf.status",
    },
    statusBreakdown: { finalization: [], admission: [] },
    series: [],
  } as unknown as MetricsResponse;

  it("degrades to a message rather than blanking when metrics are unavailable", () => {
    render(<NetworkMetrics metrics={null} totalBlocks={40} totalTxs={60} />);
    expect(screen.getByText("Metrics are unavailable. Everything else on this page is unaffected."))
      .toBeDefined();
    // All-time counts survive a metrics failure: they come from another call.
    expect(screen.getByText("40")).toBeDefined();
  });

  it("says nothing completed rather than showing a zero latency", () => {
    render(<NetworkMetrics metrics={base} totalBlocks={40} totalTxs={60} />);
    expect(screen.getByText("Nothing completed in this window")).toBeDefined();
    // A p50 with no sample must read as absent, never as instant.
    expect(screen.queryByText("0s")).toBeNull();
  });

  it("judges tip lateness against the observed cadence, not a fixed threshold", () => {
    const late = {
      ...base,
      tip: { ...base.tip, ageSeconds: 300 },
    } as MetricsResponse;
    const { container } = render(<NetworkMetrics metrics={late} totalBlocks={40} totalTxs={60} />);
    // 300s against a 21s p50 is 14x: danger, not merely warning.
    expect(container.querySelector(".text-danger")).not.toBeNull();
  });

  it("marks a thin percentile sample instead of presenting it as a measurement", () => {
    const thin = {
      ...base,
      finality: {
        ...base.finality,
        settlementLatency: { p50Ms: 43_400, p95Ms: 61_200, sampleCount: 5, source: "pbf" },
      },
    } as MetricsResponse;
    render(<NetworkMetrics metrics={thin} totalBlocks={40} totalTxs={60} />);
    expect(screen.getByText(/thin sample/)).toBeDefined();
  });
});

describe("StatusBadge reads the authoritative registry", () => {
  /** The badge used to carry its own map, which disagreed with the registry on
   * these four codes. The registry is the source of truth for protocol state. */
  it.each([
    ["pending_commit", "Pending commit"],
    ["validating", "Validating"],
    ["observed_waiting_stability", "Awaiting stability"],
    ["awaiting", "Awaiting"],
  ])("renders the registry label for %s", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it("encodes state class in shape, not hue alone", () => {
    const settled = render(<StatusBadge status="committed" />);
    expect(settled.container.querySelector("svg")).not.toBeNull();
    cleanup();
    const failed = render(<StatusBadge status="rejected" />);
    expect(failed.container.querySelector("svg")).not.toBeNull();
    cleanup();
    // A state still in motion gets a dot, never the conclusion glyph.
    const waiting = render(<StatusBadge status="pending_commit" />);
    expect(waiting.container.querySelector("svg")).toBeNull();
  });
});

describe("AdaAmount", () => {
  it("shows grouped ada and keeps exact lovelace in the title", () => {
    render(<AdaAmount lovelace="1234567890" />);
    const el = screen.getByTitle("1234567890 lovelace");
    expect(el.textContent).toContain("1,234.56789");
  });

  it("puts the ada symbol before the amount", () => {
    render(<AdaAmount lovelace="1000000" />);
    const el = screen.getByTitle("1000000 lovelace");
    expect(el.textContent?.trim()).toBe("₳ 1");
  });
});

describe("SummaryBand", () => {
  /** Unfilled cells in the painted-gap grid used to render as solid blocks,
   * which read as a metric that failed to load. */
  it("pads the grid so no gap cell is left unpainted", () => {
    const { container } = render(
      <SummaryBand items={[{ label: "Height", value: "#40" }]} />,
    );
    const list = container.querySelector("dl");
    expect(list).not.toBeNull();
    // One item plus three fillers covers the 2-, 3- and 4-column breakpoints.
    expect(list!.children.length).toBe(4);
    for (const filler of Array.from(list!.children).slice(1)) {
      expect(filler.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("adds no fillers when the item count fills every breakpoint", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      label: `L${i}`,
      value: i,
    }));
    const { container } = render(<SummaryBand items={items} />);
    expect(container.querySelector("dl")!.children.length).toBe(12);
  });
});

describe("ValueCell", () => {
  it("omits the asset chip when there are no native assets", () => {
    render(<ValueCell value={value("1000000")} />);
    expect(screen.queryByText(/asset/)).toBeNull();
  });

  it("pluralises the native asset count", () => {
    const one = render(<ValueCell value={value("1", { p: { a: "1" } })} />);
    expect(within(one.container).getByText("+1 asset")).toBeDefined();
    cleanup();
    render(<ValueCell value={value("1", { p: { a: "1", b: "2" } })} />);
    expect(screen.getByText("+2 assets")).toBeDefined();
  });
});

describe("DecodeWarn", () => {
  it("renders nothing when the row decoded", () => {
    const { container } = render(<DecodeWarn error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("flags a row that failed to decode", () => {
    render(<DecodeWarn error="legacy encoding" />);
    expect(screen.getByText("Partial decode")).toBeDefined();
  });
});

describe("states", () => {
  it("gives an empty state a headline and a hint", () => {
    render(<EmptyState title="No blocks yet" hint="Blocks appear once the operator commits." />);
    expect(screen.getByText("No blocks yet")).toBeDefined();
    expect(screen.getByText(/operator commits/)).toBeDefined();
  });

  it("exposes an error state as an alert with a recovery action", () => {
    render(<ErrorState message="Could not load." onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });

  it("omits the retry button when there is nothing to retry", () => {
    render(<ErrorState message="Could not load." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("L1L2Badge", () => {
  it("labels both layers as text, not colour alone", () => {
    render(
      <>
        <L1L2Badge layer="L1" />
        <L1L2Badge layer="L2" />
      </>,
    );
    expect(screen.getByText("L1")).toBeDefined();
    expect(screen.getByText("L2")).toBeDefined();
  });
});

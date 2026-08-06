import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("carries a plain-English explanation reachable without a mouse", () => {
    const { container } = render(<StatusBadge status="pending_commit" />);
    // The explanation used to live in `title=`, which touch and screen-reader
    // users could not reach. It is now behind a real button.
    expect(container.querySelector("[title]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Pending commit" }));
    expect(screen.getByRole("tooltip").textContent).toMatch(/waiting/i);
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
    render(
      <Journey
        model={transactionJourney({
          status: "queued",
          admission,
          inclusion: null,
          finalization: null,
        })}
      />,
    );
    expect(screen.getByRole("list").getAttribute("tabindex")).toBe("0");
  });

  it("shows measured deltas between recorded stages", () => {
    render(
      <Journey
        model={transactionJourney({
          status: "accepted",
          admission,
          inclusion: null,
          finalization: null,
        })}
      />,
    );
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
    // The panel says it cannot judge, in the same grammar it uses when it can.
    // A panel that answers only when things are fine teaches a reader that
    // silence means trouble, which is a worse signal than saying so.
    expect(screen.getByText("The network's health cannot be judged right now.")).toBeDefined();
    expect(screen.getByText(/Everything else on this page is unaffected/)).toBeDefined();
    // All-time counts survive a metrics failure: they come from another call.
    expect(screen.getByText("40")).toBeDefined();
  });

  it("states a verdict above the figures rather than leaving the reader to add up five numbers", () => {
    render(<NetworkMetrics metrics={base} totalBlocks={40} totalTxs={60} />);
    const verdict = screen.getByText(/producing blocks and settling/i);
    expect(verdict).toBeDefined();
    // The verdict has to outrank the figures visually, or it is just another
    // line of text on a panel that already had plenty.
    const figure = screen.getByText("#40");
    const sizeOf = (el: Element) => Number(/text-\[(\d+)px\]/.exec(el.className)?.[1] ?? 0);
    expect(sizeOf(verdict)).toBeGreaterThan(sizeOf(figure));
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

  it("tints a live figure only after it changes, never on arrival", () => {
    const { container, rerender } = render(
      <NetworkMetrics metrics={base} totalBlocks={40} totalTxs={60} />,
    );
    // Arriving at the page must not look like a burst of activity that did
    // not happen.
    expect(container.querySelector(".mg-tint")).toBeNull();

    const advanced = { ...base, tip: { ...base.tip, height: 41 } } as MetricsResponse;
    rerender(<NetworkMetrics metrics={advanced} totalBlocks={40} totalTxs={60} />);
    expect(container.querySelector(".mg-tint")).not.toBeNull();
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
    // Scoped to the badge: the help trigger beside it carries its own glyph,
    // so an unscoped svg lookup would report a marker that is not there.
    const marker = (container: HTMLElement) =>
      container.querySelector(".rounded-full.border")?.querySelector("svg") ?? null;

    const settled = render(<StatusBadge status="committed" />);
    expect(marker(settled.container)).not.toBeNull();
    cleanup();
    const failed = render(<StatusBadge status="rejected" />);
    expect(marker(failed.container)).not.toBeNull();
    cleanup();
    // A state still in motion gets a dot, never the conclusion glyph.
    const waiting = render(<StatusBadge status="pending_commit" />);
    expect(marker(waiting.container)).toBeNull();
  });
});

describe("AdaAmount", () => {
  it("shows grouped ada at full precision", () => {
    const { container } = render(<AdaAmount lovelace="1234567890" />);
    // formatAda is lossless, so no hover-only copy of the raw figure is owed.
    expect(container.querySelector("[title]")).toBeNull();
    expect(container.textContent).toContain("1,234.56789");
  });

  it("puts the ada symbol before the amount and names the unit for screen readers", () => {
    const { container } = render(<AdaAmount lovelace="1000000" />);
    expect(container.textContent?.trim()).toBe("₳ 1 ada");
    expect(container.querySelector("[aria-hidden]")?.textContent).toBe("₳");
  });
});

describe("SummaryBand", () => {
  /** The band emits one cell per item and nothing else. An earlier version
   * painted invisible filler cells to cover an unfilled row, which hid the
   * artefact without removing the empty space it was covering. */
  it("renders exactly one cell per item, with no fillers", () => {
    for (const count of [1, 3, 5, 7, 12]) {
      const items = Array.from({ length: count }, (_, i) => ({ label: `L${i}`, value: i }));
      const { container, unmount } = render(<SummaryBand items={items} />);
      expect(container.querySelector("dl")!.children.length).toBe(count);
      expect(container.querySelector("[aria-hidden='true']")).toBeNull();
      unmount();
    }
  });

  /** This used to assert the class name `auto-fit`, and passed throughout the
   * period when the band left an empty cell at phone width. Asserting the
   * mechanism cannot fail when the mechanism is the bug, so what is checked
   * here now is the property the layout has to have: cells that grow.
   *
   * jsdom does no layout, so the real proof is the measured gate in
   * e2e/layout.spec.ts, which reads actual geometry at four widths. This is
   * the fast guard against silently reverting to a fixed track count. */
  it("gives every cell room to grow, so a short row still fills the width", () => {
    const { container } = render(<SummaryBand items={[{ label: "Height", value: "#40" }]} />);
    const dl = container.querySelector("dl")!;
    expect(dl.className).toMatch(/\bflex-wrap\b/);
    expect(dl.className).not.toMatch(/grid-cols/);
    expect((dl.firstElementChild as HTMLElement).className).toMatch(/\bgrow\b/);
  });

  /** A clipped number is a different number, so values must never truncate. */
  it("does not truncate values", () => {
    const { container } = render(
      <SummaryBand items={[{ label: "Supply", value: "4,500,000,000", emphasis: true }]} />,
    );
    const value = container.querySelector("dd > span")!;
    expect(value.className).not.toMatch(/\btruncate\b/);
    expect(value.className).toMatch(/overflow-wrap:anywhere/);
  });
});

describe("ValueCell", () => {
  it("omits the asset chip when there are no native assets", () => {
    render(<ValueCell value={value("1000000")} />);
    expect(screen.queryByText(/asset/)).toBeNull();
  });

  it("names the assets rather than only counting them", () => {
    // "+3 assets" tells a reader scanning a list nothing about what moved.
    const { container } = render(
      <ValueCell value={value("1", { p: { "4d494447415244": "1" } })} />,
    );
    expect(within(container).getByText("MIDGARD")).toBeDefined();
  });

  it("keeps the exact count reachable once the names are elided", () => {
    const { container } = render(
      <ValueCell value={value("1", { p: { "41": "1", "42": "2", "43": "3", "44": "4" } })} />,
    );
    // The count moved out of `title` into text assistive tech can actually read.
    expect(container.querySelector("[title]")).toBeNull();
    expect(within(container).getByText(/^4 native assets:/)).toBeDefined();
  });

  it("shows an unreadable name as its bytes, never as a guess", () => {
    const { container } = render(<ValueCell value={value("1", { p: { fffe: "1" } })} />);
    expect(within(container).getByText("fffe")).toBeDefined();
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

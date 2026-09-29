// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaAmount, ValueCell } from "../src/components/ui/domain/amount";
import { BlockRef } from "../src/components/ui/domain/blockref";
import { FilterNote } from "../src/components/ui/base/filternote";
import { Journey } from "../src/components/ui/domain/journey";
import { LedgerRow } from "../src/components/ui/base/mobilerow";
import { NetworkMetrics } from "../src/components/ui/domain/metrics";
import { Callout, EmptyState, ErrorState, L1L2Badge } from "../src/components/ui/base/layout";
import {
  StatusBadge,
  StatusCell,
  StatusMark,
  StatusPair,
} from "../src/components/ui/domain/status";
import { SummaryBand } from "../src/components/ui/domain/summary";
import { DataTable, DecodeWarn } from "../src/components/ui/base/table";
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

describe("LedgerRow", () => {
  it("allows repeated visible labels without duplicate React keys", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <LedgerRow
        spec={{
          primary: "Record",
          details: [
            { label: "Contract", value: "One" },
            { label: "Contract", value: "Two" },
          ],
        }}
      />,
    );
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("StatusBadge", () => {
  it("renders the registry label for a known status without mid-word breaking", () => {
    // Registry labels are short product copy, so they must never break inside a
    // word: `wrap-anywhere` turned "Projected" into a column of letters. They
    // still wrap at spaces, because forbidding every break put the overview
    // into horizontal scroll at 320px.
    render(<StatusBadge status="committed" />);
    expect(screen.getByText("Committed").className).not.toMatch(/\bwrap-anywhere\b/);
  });

  it("renders an unknown status verbatim and announces it to screen readers", () => {
    render(<StatusBadge status="some_future_status" />);
    const badge = screen.getByText("some_future_status");
    expect(badge.className).toMatch(/\bwrap-anywhere\b/);
    expect(badge.className).not.toMatch(/\bwhitespace-nowrap\b/);
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
describe("StatusMark", () => {
  it("names each state by its mark, with no visible word", () => {
    const { container } = render(
      <>
        <StatusMark status="finalized" />
        <StatusMark status="committed" />
        <StatusMark status="observed_waiting_stability" />
        <StatusMark status="abandoned" />
        <StatusMark status="some_future_stage" />
      </>,
    );
    for (const name of ["Finalized", "Committed", "Awaiting stability", "Abandoned"]) {
      expect(screen.getByRole("button", { name })).toBeDefined();
    }
    expect(screen.getByRole("button", { name: "some_future_stage" })).toBeDefined();
    expect(container.textContent).toBe("");
  });
});

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
    render(<Journey model={blockJourney(finalization, 40, "ab".repeat(28))} />);
    // The label is on the rail and again in the details; the details entry is
    // the one that carries the timestamp, or says it has none.
    const entry = screen
      .getAllByText("Submitted to Cardano")
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
    expect(screen.queryByText("Final on Cardano")).toBeNull();
  });

  it("names the stage a block is waiting on rather than restating its code", () => {
    render(<Journey model={blockJourney(finalization, 40, "ab".repeat(28))} />);
    expect(screen.getByText("Committed, awaiting Cardano finality")).toBeDefined();
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
    tip: {
      headerHash: "ab".repeat(28),
      height: 40,
      at: "2026-07-28T12:00:00.000Z",
      ageSeconds: 12,
      source: "blocks.height",
    },
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
  } as unknown as MetricsResponse;

  /** Work waiting since `seconds` before the window's end. */
  const waitingFor = (seconds: number) => ({
    ...base.waiting,
    transactions: 3,
    since: new Date(Date.parse(base.window.end) - seconds * 1000).toISOString(),
  });

  it("keeps every tile, the chart and the queue when metrics are unavailable", () => {
    const retry = vi.fn();
    render(<NetworkMetrics metrics={null} totalBlocks={40} totalTxs={60} onRetry={retry} />);
    // Said once, in the same grammar the panel uses when it can judge.
    expect(screen.getByText("Figures unavailable")).toBeDefined();
    for (const label of ["Chain tip", "Blocks", "Transactions"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
    // All-time counts survive a metrics failure: they come from another call.
    expect(screen.getByText("40")).toBeDefined();
    // A default is named unavailable, so it is not told apart by colour alone.
    expect(document.querySelector('[data-region="metrics"]')?.textContent).toContain(
      "(unavailable)",
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  /** Settlement stays off the overview until a block is waiting, and then the
   * panel says how many and for how long. */
  it("notes waiting settlements only when a block is waiting", () => {
    const { container, rerender } = render(
      <NetworkMetrics metrics={base} totalBlocks={40} totalTxs={60} />,
    );
    expect(container.querySelector('[data-region="settlement-notice"]')).toBeNull();
    const waiting = {
      ...base,
      finality: {
        ...base.finality,
        pending: 3,
        oldestUnsettled: {
          headerHash: "cd".repeat(28),
          status: "submitted_unconfirmed",
          blockEndTime: "2026-07-28T11:55:00.000Z",
          waitingSeconds: 300,
        },
      },
    } as unknown as MetricsResponse;
    rerender(<NetworkMetrics metrics={waiting} totalBlocks={40} totalTxs={60} />);
    expect(container.querySelector('[data-region="settlement-notice"]')?.textContent).toBe(
      "3 blocks awaiting settlement · oldest 5m 0s",
    );
    expect(screen.getByRole("link", { name: /Details/ }).getAttribute("href")).toBe("/health");
  });

  /** Density has to follow severity, not the other way round. On a phone the
   * healthy verdict's supporting sentences repeat figures that are already in
   * the tiles below it, so they collapse; a degraded or stalled verdict's
   * reasons are the only place its evidence appears, so they never do. */
  it("gives a healthy verdict no second line to collapse", () => {
    // The healthy line says what awaits a block; the cadence it used to add
    // lives on the network health page.
    const { container } = render(<NetworkMetrics metrics={base} totalBlocks={40} totalTxs={60} />);
    const verdict = container.querySelector('[data-region="verdict"]');
    expect(verdict?.getAttribute("data-verdict-state")).toBe("healthy");
    expect(verdict?.querySelector("[data-region='verdict-reasons']")).toBeNull();
  });

  it("keeps a stalled verdict's reasons at every width", () => {
    // Abandoned settlements, so the stalled verdict has a reason to show.
    const stalled = {
      ...base,
      tip: { ...base.tip, ageSeconds: 4_000 },
      waiting: waitingFor(4_000),
      finality: { ...base.finality, finalized: 10, abandoned: 5 },
    } as unknown as MetricsResponse;
    const { container } = render(
      <NetworkMetrics metrics={stalled} totalBlocks={40} totalTxs={60} />,
    );
    const verdict = container.querySelector('[data-region="verdict"]');
    expect(verdict?.getAttribute("data-verdict-state")).toBe("stalled");
    expect(
      verdict?.querySelector("[data-region='verdict-reasons']")?.getAttribute("data-density"),
    ).toBe("always");
  });

  it("states a verdict above the figures rather than leaving the reader to add up five numbers", () => {
    render(<NetworkMetrics metrics={base} totalBlocks={40} totalTxs={60} />);
    const verdict = screen.getByText("Nothing awaiting a block");
    expect(verdict).toBeDefined();
    const figure = screen.getByText("Block #40");
    expect(verdict.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("judges waiting work against the observed cadence, not a fixed threshold", () => {
    const late = {
      ...base,
      tip: { ...base.tip, ageSeconds: 300 },
      waiting: waitingFor(300),
    } as MetricsResponse;
    const { container } = render(<NetworkMetrics metrics={late} totalBlocks={40} totalTxs={60} />);
    // 300s against a 21s p50 is 14x: danger, not merely warning.
    expect(container.querySelector(".text-danger")).not.toBeNull();
  });

  /** The node makes a block only when something waits for one. A day-old tip
   * with nothing waiting is a quiet chain, and colouring it as a failure put a
   * red tip on a node that had simply had no transactions. */
  it("leaves an old tip uncoloured when nothing is waiting", () => {
    const quiet = {
      ...base,
      tip: { ...base.tip, ageSeconds: 77_679 },
    } as MetricsResponse;
    const { container } = render(<NetworkMetrics metrics={quiet} totalBlocks={40} totalTxs={60} />);
    expect(container.querySelector(".text-danger")).toBeNull();
    expect(
      container.querySelector('[data-region="verdict"]')?.getAttribute("data-verdict-state"),
    ).toBe("idle");
  });

  it("tints a live figure only after it changes, never on arrival", () => {
    const { container, rerender } = render(
      <NetworkMetrics metrics={base} totalBlocks={40} totalTxs={60} />,
    );
    // Arriving at the page must not look like a burst of activity that did
    // not happen.
    expect(container.querySelector(".mg-tint")).toBeNull();

    const advanced = {
      ...base,
      tip: { ...base.tip, headerHash: "cd".repeat(28), height: 41 },
    } as MetricsResponse;
    rerender(<NetworkMetrics metrics={advanced} totalBlocks={40} totalTxs={60} />);
    expect(container.querySelector(".mg-tint")).not.toBeNull();
  });

  it("shows canonical all-time totals when nothing happened in the window", () => {
    const idle = {
      ...base,
      throughput: {
        ...base.throughput,
        blocks: 0,
        transactions: 0,
        transactionsPerBlock: null,
        blockIntervalSeconds: { p50: null, p95: null, sampleCount: 0 },
      },
    } as MetricsResponse;
    render(<NetworkMetrics metrics={idle} totalBlocks={6} totalTxs={21} />);
    const region = document.querySelector('[data-region="metrics"]')!;
    expect(region.textContent).toContain("6");
    expect(region.textContent).toContain("21");
  });

  // The overview and list pages must never disagree merely because the node
  // has activity inside the metrics window. Window counts are context only.
  it("keeps showing canonical totals when the window has activity", () => {
    render(<NetworkMetrics metrics={base} totalBlocks={9999} totalTxs={9999} />);
    const region = document.querySelector('[data-region="metrics"]')!;
    expect(region.textContent).toContain("9,999");
    // The window's count is the chart's to show, not a second figure here.
    expect(region.textContent).not.toContain(`in ${base.window.hours}h`);
  });

  /** Settlement is the Cardano panel's to show; the tiles do not repeat it. */
  it("shows three tiles, with no settlement tile", () => {
    render(<NetworkMetrics metrics={base} totalBlocks={40} totalTxs={60} />);
    const region = document.querySelector('[data-region="metrics"]')!;
    expect(region.children).toHaveLength(3);
    expect(region.textContent).not.toMatch(/settle/i);
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
      container.querySelector(".rounded-full")?.querySelector("svg") ?? null;

    const settled = render(<StatusBadge status="finalized" />);
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

  it("marks an empty state, so an empty table does not read as a broken one", () => {
    const { container } = render(<EmptyState title="No blocks yet" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("keeps the empty-state mark out of the accessibility tree", () => {
    // The headline already says what is missing. A second announcement of the
    // same fact is noise to a screen reader.
    const { container } = render(<EmptyState title="No blocks yet" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks an error state, whether or not it can be retried", () => {
    const { container } = render(<ErrorState message="Could not load." />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("Callout", () => {
  const glyph = (tone: "info" | "warning" | "danger" | "success") => {
    const { container } = render(
      <Callout tone={tone} title="Something to know">
        Detail.
      </Callout>,
    );
    const svg = container.querySelector("svg")?.innerHTML ?? null;
    cleanup();
    return svg;
  };

  it("gives each toned callout a glyph, so the tone is not carried by colour alone", () => {
    for (const tone of ["info", "warning", "danger", "success"] as const) {
      expect(glyph(tone)).not.toBeNull();
    }
  });

  it("draws a different glyph for a warning than for a failure", () => {
    // Both are red-adjacent and both interrupt. If they share a mark, the mark
    // adds weight without adding information.
    expect(glyph("warning")).not.toBe(glyph("danger"));
  });

  it("draws a different glyph for success than for information", () => {
    expect(glyph("success")).not.toBe(glyph("info"));
  });

  it("draws no glyph on a neutral callout, which asserts no tone", () => {
    const { container } = render(<Callout tone="neutral" title="Plain note" />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps the title readable as text, with the glyph decorative", () => {
    const { container } = render(<Callout tone="warning" title="Outputs not decoded" />);
    expect(screen.getByText("Outputs not decoded")).toBeDefined();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
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

describe("StatusCell", () => {
  it("shows the label with no info button and no progress dots", () => {
    const { container } = render(<StatusCell status="committed" />);
    expect(screen.getByText("Committed")).toBeDefined();
    expect(screen.queryByRole("button", { name: /About/ })).toBeNull();
    expect(screen.queryByText(/step \d of \d/)).toBeNull();
    expect(container.querySelectorAll(".h-1.w-2\\.5").length).toBe(0);
  });
});

describe("StatusPair", () => {
  it("shows the L2 status and the L1 settlement together", () => {
    render(<StatusPair l2="committed" l1="pending_submission" />);
    expect(screen.getByText("Committed")).toBeDefined();
    expect(screen.getByText("L1")).toBeDefined();
    expect(screen.getByText("Pending submission")).toBeDefined();
  });

  it("says when no settlement is recorded rather than leaving a gap", () => {
    render(<StatusPair l2="committed" l1={null} />);
    expect(screen.getByText("Not recorded")).toBeDefined();
  });
});

describe("StatusBadge on a detail page", () => {
  it("keeps its explanation by default", () => {
    render(<StatusBadge status="pending_commit" />);
    expect(screen.getByRole("button", { name: "About Pending commit" })).toBeDefined();
  });
});

describe("FilterNote", () => {
  it("names the active filter and links back to the full list", () => {
    render(<FilterNote label="record" value={"ab".repeat(40)} clearHref="/deposits" />);
    expect(screen.getByText(/Filtered by record/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Clear filter" }).getAttribute("href")).toBe(
      "/deposits",
    );
    expect(screen.getByRole("button", { name: "Copy to clipboard" })).toBeDefined();
  });
});

describe("DataTable stacking", () => {
  const columns = [
    { header: "A", cell: () => "a" },
    { header: "B", cell: () => "b", hideBelow: "lg" as const },
  ];
  it("shows the row list up to the widest breakpoint a column hides at", () => {
    const { container } = render(
      <DataTable
        caption="t"
        rows={[{ id: "a" }]}
        keyOf={(r) => r.id}
        columns={columns}
        mobileRow={() => ({ primary: "a", details: [{ label: "B", value: "b" }] })}
      />,
    );
    expect(container.querySelector("ul")?.className).toContain("lg:hidden");
    expect(container.querySelector("table")?.closest("div")?.className).toContain("lg:block");
  });
  it("keeps the phone breakpoint when no column hides above it", () => {
    const { container } = render(
      <DataTable
        caption="t"
        rows={[{ id: "a" }]}
        keyOf={(r) => r.id}
        columns={[{ header: "A", cell: () => "a" }]}
      />,
    );
    expect(container.querySelector("ul")?.className).toContain("sm:hidden");
    expect(container.querySelector("table")?.closest("div")?.className).toContain("sm:block");
  });
});

describe("BlockRef", () => {
  const HASH = "fd0d00c13cc47c4bdf32d5646201a0c7939e9185d66f6d289ac52eea";
  it("names a numbered block and copies its hash", () => {
    render(<BlockRef hash={HASH} height={42} />);
    expect(screen.getByRole("link", { name: "Block #42" }).getAttribute("href")).toBe(
      `/block/${HASH}`,
    );
    expect(screen.getByRole("button", { name: "Copy to clipboard" })).toBeDefined();
  });
  it("shows a numberless block as a shortened hash in the site form", () => {
    const { container } = render(<BlockRef hash={HASH} height={null} />);
    expect(container.textContent).toContain("fd0d00c1...c52eea");
    expect(container.textContent).not.toContain("…");
  });
  it("honors copy={false} in both forms", () => {
    render(<BlockRef hash={HASH} height={null} copy={false} />);
    render(<BlockRef hash={HASH} height={7} copy={false} />);
    expect(screen.queryByRole("button", { name: "Copy to clipboard" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});

describe("FilterNote for a malformed filter", () => {
  it("says the value was ignored, shows it as text, and offers the full list", () => {
    render(<FilterNote label="record" value="zzz<b>" clearHref="/deposits" ignored />);
    expect(screen.getByText(/Ignored filter/)).toBeDefined();
    expect(screen.getByText(/not a record ID/)).toBeDefined();
    expect(screen.getByText(/zzz<b>/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Clear filter" }).getAttribute("href")).toBe(
      "/deposits",
    );
    expect(screen.queryByRole("button", { name: "Copy to clipboard" })).toBeNull();
  });
});

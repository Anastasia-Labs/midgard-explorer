import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdaAmount, ValueCell } from "../src/components/ui/amount";
import { LifecycleStepper } from "../src/components/ui/lifecycle";
import { EmptyState, ErrorState, L1L2Badge } from "../src/components/ui/primitives";
import { StatusBadge } from "../src/components/ui/status";
import { SummaryBand } from "../src/components/ui/summary";
import { DecodeWarn } from "../src/components/ui/table";
import { AdmissionTimeline, FinalizationTimeline } from "../src/components/ui/timeline";
import type { BlockFinalization, TxAdmission, ValueView } from "@midgard-explorer/contracts";

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

describe("LifecycleStepper", () => {
  it("marks the current step with aria-current", () => {
    render(<LifecycleStepper status="accepted" />);
    const current = screen.getByText("Accepted").closest("[aria-current]");
    expect(current?.getAttribute("aria-current")).toBe("step");
  });

  it("treats committed as reached rather than in progress", () => {
    render(<LifecycleStepper status="committed" />);
    expect(screen.getByText("Committed").closest("[aria-current]")).toBeNull();
  });

  it("shows the failure path for a rejected transaction", () => {
    render(<LifecycleStepper status="rejected" />);
    expect(screen.getByText("Rejected")).toBeDefined();
    expect(screen.queryByText("Committed")).toBeNull();
  });

  it("renders nothing for a status outside the lifecycle", () => {
    const { container } = render(<LifecycleStepper status="finalized" />);
    expect(container.firstChild).toBeNull();
  });

  it("keeps the scrollable step list keyboard reachable", () => {
    render(<LifecycleStepper status="queued" />);
    expect(screen.getByLabelText("Transaction lifecycle").getAttribute("tabindex")).toBe("0");
  });
});

describe("recorded timelines", () => {
  it("shows admission timestamps and measured deltas", () => {
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
    render(<AdmissionTimeline admission={admission} outcome="committed" />);
    expect(screen.getByLabelText("Node admission timeline")).toBeDefined();
    expect(screen.getByText("+1.7s")).toBeDefined();
    expect(screen.getByText("+4.2s")).toBeDefined();
    expect(screen.getByText(/2 requests/)).toBeDefined();
  });

  it("does not invent an L1 submission timestamp", () => {
    const finalization = {
      status: "observed_waiting_stability",
      submitted_tx_hash: "ab".repeat(32),
      blockEndTime: "2026-07-28T12:00:00.000Z",
      createdAt: "2026-07-28T12:00:01.400Z",
      updatedAt: "2026-07-28T12:00:19.400Z",
      observedConfirmedAt: "2026-07-28T12:00:19.400Z",
    } as BlockFinalization;
    render(<FinalizationTimeline finalization={finalization} />);
    const timeline = screen.getByLabelText("Block finalization timeline");
    const submitted = within(timeline).getByText("Submitted").closest("li");
    expect(submitted).not.toBeNull();
    expect(within(submitted!).getByText("Time not recorded")).toBeDefined();
    expect(within(timeline).getByText("Observed on L1")).toBeDefined();
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

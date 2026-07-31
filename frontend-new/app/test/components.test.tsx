import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdaAmount, ValueCell } from "../src/components/ui/amount";
import { LifecycleStepper } from "../src/components/ui/lifecycle";
import { EmptyState, ErrorState, L1L2Badge } from "../src/components/ui/primitives";
import { StatusBadge } from "../src/components/ui/status";
import { DecodeWarn } from "../src/components/ui/table";
import type { ValueView } from "@midgard-explorer/contracts";

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

describe("AdaAmount", () => {
  it("shows grouped ada and keeps exact lovelace in the title", () => {
    render(<AdaAmount lovelace="1234567890" />);
    const el = screen.getByTitle("1234567890 lovelace");
    expect(el.textContent).toContain("1,234.56789");
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

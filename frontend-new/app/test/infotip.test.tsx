import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldLabel, InfoTip } from "../src/components/ui/base/infotip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The trigger works on hover, click/touch and keyboard. `title=` was
 * invisible on touch and unreliable for screen readers, while an absolutely
 * positioned child was clipped by tables and tabs. */
describe("InfoTip", () => {
  it("keeps the explanation out of the accessibility tree until asked", () => {
    render(<InfoTip explain="Waiting to be merged into a block." />);
    expect(screen.queryByText("Waiting to be merged into a block.")).toBeNull();
  });

  it("exposes a button without relying on the title attribute", () => {
    render(<InfoTip explain="Some help." />);
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("title")).toBeNull();
  });

  it("reveals the explanation on click", () => {
    render(<InfoTip explain="Some help." />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Some help.")).toBeDefined();
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });

  it("reveals on mouse hover after a deliberate delay", () => {
    vi.useFakeTimers();
    render(<InfoTip explain="Some help." />);
    fireEvent.pointerEnter(screen.getByRole("button"), { pointerType: "mouse" });
    expect(screen.queryByText("Some help.")).toBeNull();
    act(() => vi.advanceTimersByTime(249));
    expect(screen.queryByText("Some help.")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Some help.")).toBeDefined();
  });

  it("does not treat touch movement as hover", () => {
    vi.useFakeTimers();
    render(<InfoTip explain="Some help." />);
    fireEvent.pointerEnter(screen.getByRole("button"), { pointerType: "touch" });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText("Some help.")).toBeNull();
  });

  it("closes again on a second click", () => {
    render(<InfoTip explain="Some help." />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText("Some help.")).toBeNull();
  });

  it("reveals the explanation when reached by keyboard", () => {
    render(<InfoTip explain="Some help." />);
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByText("Some help.")).toBeDefined();
  });

  it("does not double-toggle when a pointer press moves focus", () => {
    render(<InfoTip explain="Some help." />);
    const trigger = screen.getByRole("button");
    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    expect(screen.getByText("Some help.")).toBeDefined();
  });

  it("closes on Escape", () => {
    render(<InfoTip explain="Some help." />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByText("Some help.")).toBeNull();
  });

  it("describes the trigger by the explanation while open", () => {
    render(<InfoTip explain="Some help." />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Some help.");
  });

  it("portals the panel to body rather than a clipping ancestor", () => {
    const { container } = render(
      <div data-testid="clipped" style={{ overflow: "hidden" }}>
        <InfoTip explain="Some help." />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    const tooltip = screen.getByRole("tooltip");
    expect(document.body.contains(tooltip)).toBe(true);
    expect(container.contains(tooltip)).toBe(false);
  });

  it("flips above and clamps horizontally at a viewport edge", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute("role") === "tooltip") {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 200,
          bottom: 80,
          width: 200,
          height: 80,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 304,
        y: 180,
        left: 304,
        top: 180,
        right: 320,
        bottom: 196,
        width: 16,
        height: 16,
        toJSON: () => ({}),
      } as DOMRect;
    });
    render(<InfoTip explain="Some help." />);
    fireEvent.click(screen.getByRole("button"));
    const style = (screen.getByRole("tooltip") as HTMLElement).style;
    expect(style.top).toBe("92px");
    expect(style.left).toBe("112px");
    expect(style.position).toBe("fixed");
  });

  it("renders the shared glossary meaning and consequence", () => {
    render(<InfoTip term="referenceInput" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("tooltip").textContent).toMatch(
      /reading without being spent.*stays in the ledger/i,
    );
  });

  it("names the trigger for a screen reader using the subject it explains", () => {
    render(<InfoTip explain="Some help." subject="Status" />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("About Status");
  });
});

describe("FieldLabel", () => {
  it("puts the trigger after the label, so the glyph sits to its right", () => {
    const { container } = render(<FieldLabel label="Status" explain="What it means." />);
    const button = screen.getByRole("button");
    const text = screen.getByText("Status");
    // The button must FOLLOW the text in document order. Leading it would shift
    // where each label starts depending on whether that field has help, so a
    // column of labels would no longer align.
    expect(text.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("renders a plain label with no trigger when there is nothing to explain", () => {
    render(<FieldLabel label="Height" />);
    expect(screen.getByText("Height")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses the label as the trigger's subject", () => {
    render(<FieldLabel label="Fee" explain="What it costs." />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("About Fee");
  });
});

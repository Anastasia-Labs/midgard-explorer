import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldLabel, InfoTip } from "../src/components/ui/infotip";

afterEach(cleanup);

/** The captured convention (Etherscan, Blockscout): a help glyph before every
 * field label, opened by click or keyboard rather than by hover. `title=` was
 * invisible on touch and unreliable for screen readers, which is what these
 * tests exist to prevent regressing to. */
describe("InfoTip", () => {
  it("keeps the explanation out of the accessibility tree until asked", () => {
    render(<InfoTip explain="Waiting to be merged into a block." />);
    expect(screen.queryByText("Waiting to be merged into a block.")).toBeNull();
  });

  it("exposes a button, not a hover target", () => {
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

  it("names the trigger for a screen reader using the subject it explains", () => {
    render(<InfoTip explain="Some help." subject="Status" />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("About Status");
  });
});

describe("FieldLabel", () => {
  it("puts the trigger before the label, as the references do", () => {
    const { container } = render(<FieldLabel label="Status" explain="What it means." />);
    const button = screen.getByRole("button");
    const text = screen.getByText("Status");
    expect(button.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

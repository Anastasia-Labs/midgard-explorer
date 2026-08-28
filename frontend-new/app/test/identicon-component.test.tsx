import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Identicon } from "../src/components/ui/identicon";

afterEach(cleanup);

const A = "addr_test1vpqgspvmh6m2m5pwangvdg499srfzre2dd96qq9tnqvtvtqz0mzgz";
const B = "addr_test1g9pqgspvmh6m2m5pwangvdg499srfzre2dd96qq9tnqvtvpg8ex3qw";

describe("Identicon", () => {
  it("stays out of the accessibility tree: the address itself is the information", () => {
    const { container } = render(<Identicon seed={A} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("");
  });

  it("draws the same mark for the same address", () => {
    const first = render(<Identicon seed={A} />).container.innerHTML;
    cleanup();
    const second = render(<Identicon seed={A} />).container.innerHTML;
    expect(first).toBe(second);
  });

  it("draws a different mark for a different address", () => {
    const first = render(<Identicon seed={A} />).container.innerHTML;
    cleanup();
    const second = render(<Identicon seed={B} />).container.innerHTML;
    expect(first).not.toBe(second);
  });

  it("renders as server-side markup with no client hook", () => {
    // Nothing here may depend on the browser: identicons appear in lists that
    // are server-rendered, and a client-only mark would pop in after paint.
    const { container } = render(<Identicon seed={A} />);
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(1);
  });
});

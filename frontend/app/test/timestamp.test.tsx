// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timestamp } from "../src/components/ui/base/timestamp";
import { formatTimestamp } from "../src/lib/format";

const ISO = "2026-08-13T11:24:52Z";

describe("Timestamp", () => {
  it("puts the relative time and the exact instant on one line by default", () => {
    const { container } = render(<Timestamp exact iso={ISO} />);
    expect(container.textContent).toContain(" · ");
  });

  it("puts the exact instant on its own line when stacked", () => {
    const { container } = render(<Timestamp exact stacked iso={ISO} />);
    const lines = container.querySelectorAll("time > span.block");
    expect(lines).toHaveLength(2);
    expect(lines[1]?.textContent).toBe(formatTimestamp(ISO));
    expect(container.textContent).not.toContain(" · ");
  });
});

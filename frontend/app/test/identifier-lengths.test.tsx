// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Identifier } from "../src/components/ui/domain/identifier";

afterEach(cleanup);

const HASH = "0123456789abcdef".repeat(4);

/** Each length is shown from its breakpoint until the next one given, and all
 * of them sit inside one link beside one copy button. */
it("carries a length per breakpoint in one link", () => {
  render(
    <Identifier
      value={HASH}
      href="/transaction/x"
      head={4}
      tail={2}
      breakpoints={{ sm: { head: 8, tail: 6 }, lg: { head: 6, tail: 4 }, xl: { head: 8, tail: 6 } }}
    />,
  );
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  const lengths = [...screen.getByRole("link").querySelector(".font-mono")!.children];
  expect(lengths.map((s) => [s.textContent, s.className])).toEqual([
    ["0123...ef", "sm:hidden"],
    ["01234567...abcdef", "hidden sm:inline lg:hidden"],
    ["012345...cdef", "hidden lg:inline xl:hidden"],
    ["01234567...abcdef", "hidden xl:inline"],
  ]);
});

/** The site standard: head, three periods in the muted colour, tail. */
it("shows the gap as three muted periods between head and tail", () => {
  const { container } = render(<Identifier value={HASH} head={4} tail={2} />);
  const text = container.querySelector(".font-mono")!;
  expect(text.textContent).toBe("0123...ef");
  const gap = text.querySelector("span");
  expect(gap?.textContent).toBe("...");
  expect(gap?.className).toContain("text-text-3");
});

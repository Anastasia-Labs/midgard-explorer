import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { NewRowsBanner, useHeldList } from "../src/components/ui/livelist";

afterEach(cleanup);

type Row = { id: string };
const key = (r: Row) => r.id;

/** A harness standing in for a polling query: `poll` is what a refetch does. */
function Harness({ first, next }: { first: Row[]; next: Row[] }) {
  const [incoming, setIncoming] = useState(first);
  const { rows, pending, apply } = useHeldList<Row>(incoming, key);
  return (
    <div>
      <button type="button" onClick={() => setIncoming(next)}>
        poll
      </button>
      <NewRowsBanner count={pending} noun="block" onApply={apply} />
      <ul>
        {rows.map((r) => (
          <li key={r.id}>{r.id}</li>
        ))}
      </ul>
    </div>
  );
}

describe("a polled list", () => {
  it("shows the first rows with no banner", () => {
    render(<Harness first={[{ id: "a" }]} next={[{ id: "a" }]} />);
    expect(screen.getByText("a")).toBeDefined();
    expect(screen.queryByRole("button", { name: /new block/i })).toBeNull();
  });

  it("does not move the rows when new ones arrive", () => {
    render(<Harness first={[{ id: "a" }]} next={[{ id: "b" }, { id: "a" }]} />);
    fireEvent.click(screen.getByText("poll"));
    // The list is unchanged: this is the whole point.
    expect(screen.queryByText("b")).toBeNull();
    expect(screen.getByText("a")).toBeDefined();
  });

  it("says how many arrived", () => {
    render(<Harness first={[{ id: "a" }]} next={[{ id: "c" }, { id: "b" }, { id: "a" }]} />);
    fireEvent.click(screen.getByText("poll"));
    expect(screen.getByRole("button", { name: /2 new blocks/i })).toBeDefined();
  });

  it("uses the singular for one", () => {
    render(<Harness first={[{ id: "a" }]} next={[{ id: "b" }, { id: "a" }]} />);
    fireEvent.click(screen.getByText("poll"));
    expect(screen.getByRole("button", { name: /1 new block\./i })).toBeDefined();
  });

  it("shows the new rows only once the reader asks", () => {
    render(<Harness first={[{ id: "a" }]} next={[{ id: "b" }, { id: "a" }]} />);
    fireEvent.click(screen.getByText("poll"));
    fireEvent.click(screen.getByRole("button", { name: /1 new block/i }));
    expect(screen.getByText("b")).toBeDefined();
    expect(screen.queryByRole("button", { name: /new block/i })).toBeNull();
  });

  it("announces politely rather than interrupting", () => {
    render(<Harness first={[{ id: "a" }]} next={[{ id: "b" }, { id: "a" }]} />);
    fireEvent.click(screen.getByText("poll"));
    expect(screen.getByRole("button", { name: /1 new block/i }).getAttribute("aria-live")).toBe(
      "polite",
    );
  });
});

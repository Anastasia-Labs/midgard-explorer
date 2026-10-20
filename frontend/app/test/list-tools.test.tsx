// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListTools } from "../src/components/ui/base/listtools";

vi.mock("next/navigation", () => ({
  usePathname: () => "/blocks",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
afterEach(cleanup);

const props = {
  filterKey: "status",
  filterLabel: "L1 settlement",
  options: [{ value: "locally_applied", label: "Merge not recorded" }],
  rows: [],
  filename: "blocks",
  columns: [],
};

describe("a list filter the source cannot answer", () => {
  it("is disabled, and says why beside it", () => {
    render(
      <ListTools
        {...props}
        filterUnavailable="This explorer's archive holds no settlement records to filter by."
      />,
    );
    const select = screen.getByLabelText("L1 settlement") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(
      screen.getByText("This explorer's archive holds no settlement records to filter by."),
    ).toBeDefined();
  });

  it("stays usable when the source can answer it", () => {
    render(<ListTools {...props} />);
    expect((screen.getByLabelText("L1 settlement") as HTMLSelectElement).disabled).toBe(false);
  });
});

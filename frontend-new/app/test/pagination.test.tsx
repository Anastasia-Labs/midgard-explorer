import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, Pagination } from "../src/components/ui/table";
import { parsePage } from "../src/lib/parsePage";

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => {
    void _prefetch;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

afterEach(() => {
  cleanup();
  notFound.mockClear();
});

describe("parsePage", () => {
  it("defaults to page 1 when the parameter is absent", () => {
    expect(parsePage(undefined)).toBe(1);
  });

  it("accepts a plain positive integer", () => {
    expect(parsePage("7")).toBe(7);
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e3", "1234567", " 2"])(
    "rejects %o with a 404 rather than coercing it",
    (raw) => {
      expect(() => parsePage(raw)).toThrow("NEXT_NOT_FOUND");
    },
  );
});

describe("Pagination", () => {
  const hrefFor = (p: number) => `/blocks?page=${p}`;

  it("reports the visible range and the total", () => {
    render(<Pagination page={2} hasNextPage total={130} limit={25} hrefFor={hrefFor} />);
    expect(screen.getByText("Showing 26–50 of 130")).toBeDefined();
  });

  it("clamps the last page to the total", () => {
    render(<Pagination page={6} hasNextPage={false} total={130} limit={25} hrefFor={hrefFor} />);
    expect(screen.getByText("Showing 126–130 of 130")).toBeDefined();
  });

  it("falls back to the page number when totals are unknown", () => {
    render(<Pagination page={3} hasNextPage hrefFor={hrefFor} />);
    expect(screen.getByText("Page 3")).toBeDefined();
  });

  it("disables first and previous on page 1 without removing them from the reading order", () => {
    render(<Pagination page={1} hasNextPage total={130} limit={25} hrefFor={hrefFor} />);
    expect(screen.getByLabelText("First page").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByLabelText("Previous page").getAttribute("aria-disabled")).toBe("true");
  });

  it("disables next when there is no next page", () => {
    render(<Pagination page={6} hasNextPage={false} total={130} limit={25} hrefFor={hrefFor} />);
    expect(screen.getByLabelText("Next page").getAttribute("aria-disabled")).toBe("true");
  });

  it("marks the current page with aria-current", () => {
    render(<Pagination page={3} hasNextPage total={130} limit={25} hrefFor={hrefFor} />);
    expect(screen.getByLabelText("Page 3").getAttribute("aria-current")).toBe("page");
  });

  it("keeps the page window inside the real range", () => {
    render(<Pagination page={6} hasNextPage={false} total={130} limit={25} hrefFor={hrefFor} />);
    // 130/25 = 6 pages; a window of five must not offer page 7.
    expect(screen.queryByLabelText("Page 7")).toBeNull();
    expect(screen.getByLabelText("Page 6")).toBeDefined();
  });

  it("labels the pagination region for assistive tech", () => {
    render(<Pagination page={1} hasNextPage total={50} limit={25} hrefFor={hrefFor} />);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeDefined();
  });
});

type Row = { id: string; label: string };
const rows: Row[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];
const columns = [
  { header: "Id", cell: (r: Row) => r.id },
  { header: "Label", cell: (r: Row) => r.label },
];

describe("DataTable", () => {
  it("renders a captioned table for screen readers", () => {
    render(<DataTable caption="Blocks" columns={columns} rows={rows} keyOf={(r) => r.id} />);
    expect(screen.getByRole("table", { name: "Blocks" })).toBeDefined();
  });

  it("shows the loading state instead of an empty table", () => {
    render(
      <DataTable
        caption="Blocks"
        columns={columns}
        rows={[]}
        keyOf={(r) => r.id}
        state="loading"
      />,
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeDefined();
  });

  it("shows an error state with the given message", () => {
    render(
      <DataTable
        caption="Blocks"
        columns={columns}
        rows={[]}
        keyOf={(r) => r.id}
        state="error"
        errorMessage="Could not load blocks."
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Could not load blocks.");
  });

  it("shows the empty state when there are no rows", () => {
    render(
      <DataTable
        caption="Blocks"
        columns={columns}
        rows={[]}
        keyOf={(r) => r.id}
        emptyTitle="No blocks yet"
      />,
    );
    expect(screen.getByText("No blocks yet")).toBeDefined();
  });

  it("renders every column label on mobile when no mobileRow is supplied", () => {
    render(<DataTable caption="Blocks" columns={columns} rows={rows} keyOf={(r) => r.id} />);
    // Header cells plus the mobile definition list: nothing is lost below sm.
    expect(screen.getAllByText("Label").length).toBeGreaterThan(1);
  });
});

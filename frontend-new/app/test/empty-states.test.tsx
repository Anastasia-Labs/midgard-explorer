// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import Link from "next/link";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "../src/components/ui/base/layout";
import { DataTable } from "../src/components/ui/base/table";

afterEach(cleanup);

describe("empty states", () => {
  it("renders an action beneath the title", () => {
    render(
      <EmptyState title="No matching blocks" action={<Link href="/blocks">Clear filter</Link>} />,
    );
    expect(screen.getByText("No matching blocks")).toBeDefined();
    expect(screen.getByRole("link", { name: "Clear filter" }).getAttribute("href")).toBe("/blocks");
  });

  it("passes the action through a table with no rows", () => {
    render(
      <DataTable
        caption="Blocks"
        columns={[{ header: "Hash", cell: (r: { id: string }) => r.id }]}
        rows={[]}
        keyOf={(r) => r.id}
        emptyTitle="No matching blocks"
        emptyAction={<Link href="/blocks">Clear filter</Link>}
      />,
    );
    expect(screen.getByRole("link", { name: "Clear filter" })).toBeDefined();
  });
});

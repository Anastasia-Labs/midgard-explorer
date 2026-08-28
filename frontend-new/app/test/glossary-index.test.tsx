import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryIndex } from "../src/features/glossary/GlossaryIndex";
import { GLOSSARY } from "../src/lib/glossary";

afterEach(cleanup);

describe("GlossaryIndex", () => {
  it("derives its complete index and category counts from the shared glossary", () => {
    render(<GlossaryIndex />);
    const total = Object.keys(GLOSSARY).length;
    expect(screen.getByRole("status").textContent).toContain(`${total} terms`);
    expect(screen.getByRole("navigation", { name: "Glossary categories" })).toBeDefined();
    expect(screen.getByRole("link", { name: /^Ledger, \d+ terms$/ }).getAttribute("href")).toBe(
      "#glossary-category-ledger",
    );
  });

  it("filters labels, definitions, consequences, and categories as plain text", () => {
    render(<GlossaryIndex />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search glossary" }), {
      target: { value: "CIP-14" },
    });

    expect(screen.getByRole("status").textContent).toMatch(/^1 term matching/);
    expect(screen.getByRole("link", { name: "Asset fingerprint" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Ledger" })).toBeNull();
  });

  it("offers a recoverable no-result state", () => {
    render(<GlossaryIndex />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search glossary" }), {
      target: { value: "<script>not-a-term</script>" },
    });

    expect(screen.getByText("No matching terms")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Reference input", { exact: true })).toBeDefined();
  });

  it("bounds the client-only query before storing or reflecting it", () => {
    render(<GlossaryIndex />);
    const search = screen.getByRole("searchbox", { name: "Search glossary" }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "x".repeat(500) } });
    expect(search.value).toHaveLength(120);
  });

  it("gives every term a stable deep link", () => {
    render(<GlossaryIndex />);
    expect(screen.getByRole("link", { name: "Reference input" }).getAttribute("href")).toBe(
      "#glossary-term-referenceInput",
    );
  });
});

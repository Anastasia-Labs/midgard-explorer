// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { L1Activity } from "../src/features/overview/Overview";
import type { L1Summary } from "../src/lib/api";

afterEach(cleanup);

it("keeps bridge destinations available when Cardano data fails and offers retry", () => {
  const retry = vi.fn();
  render(<L1Activity summary={null} onRetry={retry} />);
  expect(screen.getByText("Could not load Cardano activity.")).toBeDefined();
  expect(
    screen.getByRole("navigation", { name: "Bridge activity" }).querySelectorAll("a"),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(retry).toHaveBeenCalledOnce();
});

it("distinguishes an empty index from unavailable data", () => {
  const summary: L1Summary = {
    source: null,
    blockHeaders: 0,
    sync: { state: "unbuilt", cursors: [] },
    transactions: 0,
    events: 0,
    lastSyncedHeight: 0,
    byValidator: [],
  };
  render(<L1Activity summary={summary} onRetry={vi.fn()} />);
  expect(screen.getByText("No Cardano activity indexed yet.")).toBeDefined();
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  expect(screen.getByRole("link", { name: /Withdrawals/ }).getAttribute("href")).toBe(
    "/withdrawals",
  );
});

it("shows separate totals and warns only when index coverage is incomplete", () => {
  const summary: L1Summary = {
    source: null,
    blockHeaders: 9,
    sync: { state: "reconciled", cursors: [] },
    transactions: 281,
    events: 297,
    lastSyncedHeight: 5130584,
    byValidator: [],
  };
  const { rerender } = render(<L1Activity summary={summary} onRetry={vi.fn()} />);
  expect(screen.getByText("281").closest("div")?.textContent).toContain("Transactions");
  expect(screen.getByText("297").closest("div")?.textContent).toContain("Contract events");
  expect(
    screen.queryByText(/Indexed through|Index coverage unavailable|Indexing in progress/),
  ).toBeNull();
  rerender(<L1Activity summary={{ ...summary, lastSyncedHeight: null }} onRetry={vi.fn()} />);
  expect(screen.getByText("Index coverage unavailable.")).toBeDefined();
});

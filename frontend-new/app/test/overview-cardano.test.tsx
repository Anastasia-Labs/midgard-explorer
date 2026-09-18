// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DeploymentContext } from "@midgard-explorer/contracts";
import { L1Activity } from "../src/features/overview/Overview";
import type { CardanoActivitySummary } from "../src/lib/api";

afterEach(cleanup);

const midgard = {
  deploymentId: "dep",
  network: "preprod",
  networkMagic: null,
  database: "midgard",
  sourceKind: "primary",
  identityState: "configured",
  freshness: { state: "live", observedAsOf: null, lagSeconds: null },
} as unknown as DeploymentContext;

const summary = (counts: Record<string, number>): CardanoActivitySummary =>
  ({
    midgard,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    newestRecordedAt: null,
    byKind: (["settlement", "deposit", "withdrawal", "forced_transaction"] as const).map(
      (kind) => ({ kind, count: counts[kind] ?? 0, newestRecordedAt: null }),
    ),
  }) as unknown as CardanoActivitySummary;

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

it("distinguishes nothing recorded from unavailable data", () => {
  render(<L1Activity summary={summary({})} onRetry={vi.fn()} />);
  expect(screen.getByText("The node has recorded nothing on Cardano yet.")).toBeDefined();
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  expect(screen.getByRole("link", { name: /Withdrawals/ }).getAttribute("href")).toBe(
    "/withdrawals",
  );
});

/** The figures are the node's own count of what it did on Cardano, and the
 * panel says so beside them rather than presenting a chain total. */
it("shows the node's counts and says whose they are", () => {
  render(
    <L1Activity
      summary={summary({ settlement: 9, deposit: 13, withdrawal: 1 })}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByText("9").closest("div")?.textContent).toContain("Block settlements");
  expect(screen.getByText("13").closest("div")?.textContent).toContain("Deposits");
  expect(screen.getByText(/23 records, as the node recorded them/)).toBeDefined();
  expect(screen.queryByText(/index/i)).toBeNull();
});

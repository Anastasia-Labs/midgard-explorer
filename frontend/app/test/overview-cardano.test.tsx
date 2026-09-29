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

type Kind = "settlement" | "deposit" | "withdrawal" | "forced_transaction";

/** Counts per kind, each given as its statuses: `{ settlement: { finalized: 9 } }`. */
const summary = (counts: Partial<Record<Kind, Record<string, number>>>): CardanoActivitySummary => {
  const byKind = (["settlement", "deposit", "withdrawal", "forced_transaction"] as const).map(
    (kind) => {
      const byStatus = Object.entries(counts[kind] ?? {}).map(([status, count]) => ({
        status,
        count,
      }));
      return {
        kind,
        count: byStatus.reduce((n, s) => n + s.count, 0),
        newestRecordedAt: null,
        byStatus,
      };
    },
  );
  return {
    midgard,
    total: byKind.reduce((n, k) => n + k.count, 0),
    newestRecordedAt: null,
    byKind,
  } as unknown as CardanoActivitySummary;
};

/** A figure's label, which now carries its explanation beside it. */
const dtFor = (label: string) =>
  [...document.querySelectorAll("dt")].find((dt) => dt.textContent?.trim() === label)!;

/** The figure's value element, found by its label. */
const valueOf = (label: string) => dtFor(label).parentElement?.querySelector("dd > span");

it("keeps every figure and the bridge links when Cardano data fails, and offers retry", () => {
  const retry = vi.fn();
  render(<L1Activity summary={null} onRetry={retry} />);
  for (const label of ["Block settlements", "Deposits", "Withdrawals", "Forced transactions"]) {
    // A default, named unavailable for a screen reader.
    expect(valueOf(label)?.textContent).toBe("0 (unavailable)");
  }
  expect(dtFor("Records")).toBeDefined();
  expect(
    screen.getByRole("navigation", { name: "Bridge activity" }).querySelectorAll("a"),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(retry).toHaveBeenCalledOnce();
});

it("shows zeros with no retry when the node has recorded nothing", () => {
  render(<L1Activity summary={summary({})} onRetry={vi.fn()} />);
  expect(valueOf("Withdrawals")?.textContent).toBe("0");
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  expect(screen.getByRole("link", { name: /Withdrawals/ }).getAttribute("href")).toBe(
    "/withdrawals",
  );
});

/** Every kind is shown, so the kinds add up to the record total beneath them. */
it("shows every kind and a record total that adds up", () => {
  render(
    <L1Activity
      summary={summary({
        settlement: { finalized: 9 },
        deposit: { consumed: 13 },
        withdrawal: { awaiting: 1 },
      })}
      onRetry={vi.fn()}
    />,
  );
  expect(valueOf("Block settlements")?.textContent).toBe("9");
  expect(valueOf("Deposits")?.textContent).toBe("13");
  expect(valueOf("Withdrawals")?.textContent).toBe("1");
  expect(valueOf("Forced transactions")?.textContent).toBe("0");
  expect(dtFor("Records").nextElementSibling?.textContent).toBe("23");
  expect(screen.queryByText(/index/i)).toBeNull();
});

/** A count takes the colour of its least advanced record, and its mark names
 * the breakdown for a reader who cannot rely on colour. */
it("colours each count by the state of its records", () => {
  render(
    <L1Activity
      summary={summary({
        settlement: { finalized: 5, observed_waiting_stability: 1 },
        withdrawal: { awaiting: 1 },
      })}
      onRetry={vi.fn()}
    />,
  );
  expect(valueOf("Withdrawals")?.className).toContain("text-warning");
  // One block still waiting for stability outranks five finished ones.
  expect(valueOf("Block settlements")?.className).toContain("text-warning");
  expect(screen.getByRole("button", { name: "5 finalized, 1 awaiting stability" })).toBeDefined();
  expect(valueOf("Forced transactions")?.className).not.toContain("text-warning");
});

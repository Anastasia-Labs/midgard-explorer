// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBlockResponse } from "@midgard-explorer/contracts";
import { BlockView } from "../src/features/block/BlockView";

vi.mock("next/navigation", () => ({
  usePathname: () => "/block/test",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
afterEach(cleanup);

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

/**
 * A block page served from the explorer's archive (the public source), from a
 * response shaped as the backend sends it: no heights, no node journal, and
 * nine evidence lines in place of the settlement journey.
 */

const HASH = "dd".repeat(28);
const line = (
  state: string,
  reason: string | null = null,
  value: string | null = null,
  observation: unknown = null,
) => ({ state, value, reason, observation });
const time = "2026-10-20T08:00:59.000Z";

const response = (outcome: unknown = null) =>
  decodeBlockResponse({
    header: {
      header_hash: HASH,
      height: null,
      block_start_time: "2026-10-20T08:00:40.000Z",
      block_end_time: time,
      header_l2_transaction_count: 3,
      header_deposit_count: 0,
      header_withdrawal_count: 0,
      header_forced_transaction_count: 0,
      materialized_l2_transaction_count: 3,
      payload_retained_locally: true,
    },
    rows: [
      {
        height: null,
        header_hash: HASH,
        tx_id: "aa".repeat(32),
        time_stamp_tz: time,
        transaction: null,
        decodeError: "in_detail_object",
      },
    ],
    da: null,
    finalization: null,
    commitments: null,
    neighbours: { prev: { height: null, header_hash: "cc".repeat(28) }, next: null },
    events: { deposits: [], withdrawals: [], forced_transactions: [] },
    archive: { state: "archived", at: null, reason: null },
    evidence: {
      payloadIntegrity: line("pass"),
      headerBinding: line("pass"),
      roots: line("not_run", "no_authenticated_l1_header_observation"),
      l1Observation: line("unknown", "no_queue_observation"),
      daStatus: line("unknown", "no_queue_observation"),
      maturity: line("unknown", "no_queue_observation"),
      localApplication: line("unknown", "not_read_by_public_source"),
      merge:
        outcome === null
          ? line("unknown", "no_queue_observation")
          : line("recorded", "queue_terminal", "removed", {
              source: "operator:alice",
              chainPoint: "slot-90",
              at: time,
            }),
      withdrawalPayment: line("not_applicable", "no_withdrawals_in_block"),
    },
    outcome,
    transactionsPage: { page: 1, pages: 2, records: 3 },
  });

describe("an archived block page", () => {
  it("states what was verified and what is unknown, line by line, with no settlement journey", () => {
    const { container } = render(<BlockView hash={HASH} data={response()} />);
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    const known = container.querySelector('[data-region="evidence"]') as HTMLElement;
    expect(within(known).getAllByText("Verified")).toHaveLength(2);
    expect(within(known).getAllByText("Unknown")).toHaveLength(5);
    expect(within(known).getByText("Not checked")).toBeDefined();
    // Unknown facts are words, never a zero.
    expect(known.textContent).not.toMatch(/\b0\b/);
    expect(container.querySelector('[data-region="association"]')).toBeNull();
    expect(screen.queryByText("Not retained locally")).toBeNull();
  });

  it("counts the block's archived records, not the rows on this page, and offers the next page", () => {
    render(<BlockView hash={HASH} data={response()} />);
    expect(screen.getByRole("tab", { name: /Transactions/ }).textContent).toContain("3");
    expect(screen.getByRole("link", { name: /next/i }).getAttribute("href")).toBe(
      `/block/${HASH}?page=2`,
    );
    // Sums over this page's rows say so, rather than passing for the block's.
    expect(screen.getAllByText("This page only").length).toBeGreaterThan(0);
  });

  it("reads Removed only with a recorded outcome, and names the operator who reported it", () => {
    const outcome = {
      outcome: "removed",
      evidence: "queue_terminal",
      anchor: null,
      view: null,
      observation: { source: "operator:alice", chainPoint: "slot-90", at: time },
    };
    const { container } = render(<BlockView hash={HASH} data={response(outcome)} />);
    expect(screen.getAllByText("Removed").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Reported by operator alice at slot-90");
  });
});

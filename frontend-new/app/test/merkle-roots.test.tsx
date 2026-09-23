// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BlockCommitments } from "@midgard-explorer/contracts";
import { MerkleRoots } from "../src/features/block/MerkleRoots";

afterEach(cleanup);

const root = (c: string) => c.repeat(64);

const commitments: BlockCommitments = {
  utxos: { base: root("a"), expected: root("b"), changed: true },
  transactions: { base: root("c"), expected: root("d"), changed: true },
  deposits: { base: root("e"), expected: root("e"), changed: false },
  withdrawals: { base: root("1"), expected: root("2"), changed: true },
  forced_transactions: { base: root("3"), expected: root("4"), changed: true },
  transition_trace: { base: null, expected: root("5"), changed: null },
  event_to_step: { base: null, expected: root("6"), changed: null },
};

describe("MerkleRoots", () => {
  it("shows every root with how it compares to the previous header's", () => {
    render(<MerkleRoots commitments={commitments} />);
    expect(screen.getAllByText("This block")).toHaveLength(7);
    expect(screen.getAllByText("Differs from the previous header")).toHaveLength(4);
    expect(screen.getAllByText("Same as the previous header")).toHaveLength(1);
    expect(screen.getAllByText("No previous root to compare")).toHaveLength(2);
  });

  it("says a missing root is not reported rather than leaving it blank", () => {
    render(<MerkleRoots commitments={commitments} />);
    expect(screen.getAllByText("Not reported by the node")).toHaveLength(2);
  });

  it("says the node reports no roots for a header with no finalization record", () => {
    render(<MerkleRoots commitments={null} />);
    expect(screen.getByText("Not reported by the node.")).toBeDefined();
    expect(screen.queryByText("UTxOs root")).toBeNull();
  });

  it("never describes a root as a proof or a verification", () => {
    const { container } = render(<MerkleRoots commitments={commitments} />);
    expect(container.textContent).not.toMatch(/proof|proven|verif/i);
    cleanup();
    const empty = render(<MerkleRoots commitments={null} />);
    expect(empty.container.textContent).not.toMatch(/proof|proven|verif/i);
  });
});

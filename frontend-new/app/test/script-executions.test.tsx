import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScriptExecutions } from "../src/features/l1transaction/executions";
import type { L1Redeemer, L1TransactionResponse } from "../src/lib/api";

afterEach(cleanup);

const redeemer = {
  scriptHash: "a".repeat(56),
  address: "addr_test1qq",
  purpose: "spend",
  memUnits: "3210456",
  stepUnits: "899321001",
  fee: "77421",
  datumHash: null,
  datum: null,
  validContract: true,
  scriptSize: 4128,
} as unknown as L1Redeemer;

/** Preprod's real limits, read from Koios on 2026-08-18. */
const limits = {
  epochNo: 318,
  maxTxExMem: "17500000",
  maxTxExSteps: "10000000000",
} as unknown as NonNullable<L1TransactionResponse["protocolParams"]>;

const tx = (over: Partial<L1TransactionResponse>) =>
  ({ redeemers: [redeemer], protocolParams: limits, ...over }) as L1TransactionResponse;

describe("ScriptExecutions", () => {
  it("states each execution's share of the limit for the transaction's own epoch", () => {
    render(<ScriptExecutions tx={tx({})} />);
    // 3210456 / 17500000 = 18.34%; 899321001 / 10000000000 = 8.99%.
    expect(screen.getByText("18.3%")).toBeDefined();
    expect(screen.getByText("9.0%")).toBeDefined();
    expect(screen.getByText(/epoch 318/)).toBeDefined();
  });

  it("shows the units without a share when no limit is on record", () => {
    // The units are a fact the chain reported and must survive. The share is
    // the only thing that needs a denominator, so it is the only thing that
    // goes; substituting another epoch's limit would state a false percentage.
    render(<ScriptExecutions tx={tx({ protocolParams: null })} />);
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(screen.getAllByText("No limit on record for this epoch")).toHaveLength(2);
    expect(screen.getByText(/No Cardano limits are on record/)).toBeDefined();
  });

  it("renders nothing when the transaction ran no scripts", () => {
    const { container } = render(<ScriptExecutions tx={tx({ redeemers: [] })} />);
    expect(container.innerHTML).toBe("");
  });

  it("marks a failed execution without relying on colour alone", () => {
    render(<ScriptExecutions tx={tx({ redeemers: [{ ...redeemer, validContract: false }] })} />);
    expect(screen.getByText("Failed")).toBeDefined();
  });
});

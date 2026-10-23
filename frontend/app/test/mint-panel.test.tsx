// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { MintView } from "@midgard-explorer/contracts";
import { MintPanel } from "../src/features/transaction/MintPanel";

afterEach(cleanup);
const policyId = "a".repeat(56) as MintView["policyIds"][number];
it("preserves large signed mint and burn quantities and asset destinations", () => {
  const { container } = render(
    <MintPanel
      mint={{
        policyIds: [policyId],
        assets: [
          {
            policyId,
            assetName: "41",
            quantity: "9007199254740993" as MintView["assets"][number]["quantity"],
          },
          { policyId, assetName: "42", quantity: "-7" as MintView["assets"][number]["quantity"] },
        ],
      }}
    />,
  );
  expect(screen.getByRole("heading", { name: /Minted and burned/ })).toBeTruthy();
  expect(screen.getByText("Mint", { exact: true })).toBeTruthy();
  expect(screen.getByText("Burn", { exact: true })).toBeTruthy();
  expect(container.textContent?.replaceAll(",", "")).toContain("9007199254740993");
  expect(container.querySelector(`a[href="/asset/${policyId}41"]`)).toBeTruthy();
});
it("does not claim zero mints when only policy IDs decoded", () => {
  render(<MintPanel mint={{ policyIds: [policyId], assets: [] }} />);
  expect(screen.getByRole("heading", { name: "Asset mint / burn" })).toBeTruthy();
  expect(screen.getByText(/Quantities could not be decoded/)).toBeTruthy();
  expect(screen.queryByText("Minted (0)")).toBeNull();
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TransactionView } from "@midgard-explorer/contracts";
import { TXS } from "../e2e/fixtures/data.mjs";
import { StateTab } from "../src/features/transaction/tabs/StateTab";

vi.mock("next/navigation", () => ({
  usePathname: () => "/transaction/test",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;
afterEach(cleanup);

const tx = (TXS as Array<{ transaction: TransactionView | null }>).find(
  (r) => r.transaction && r.transaction.outputs.length > 1 && r.transaction.inputs.length > 0,
)!.transaction!;

/** An output reference, `<transaction>#<index>`, lives in the UTxO preview
 * beside the output's address, and every reference opens that exact output:
 * the transaction page, scrolled to the output's card. */
it("anchors each output card, and keeps its reference in the preview, not on the card", () => {
  const { container } = render(<StateTab tx={tx} />);
  const cards = tx.outputs.map((o) => container.querySelector(`#output-${o.index}`));
  expect(cards.every((card) => card !== null)).toBe(true);
  expect(cards[0]!.textContent).not.toContain(`#${tx.outputs[0]!.index}`);
});

it("links the preview's reference to the exact output", () => {
  render(<StateTab tx={tx} />);
  fireEvent.click(screen.getAllByRole("button", { name: /^UTxO$/ }).at(-1)!);
  const last = tx.outputs.at(-1)!;
  const link = screen.getByRole("dialog", { name: "UTxO" }).querySelector("a")!;
  expect(link.getAttribute("href")).toBe(`/transaction/${tx.txId}#output-${last.index}`);
});

it("links an input's reference to the output it spends", () => {
  const { container } = render(<StateTab tx={tx} />);
  const input = tx.inputs[0]!;
  const link = container.querySelector(
    `a[href="/transaction/${input.txId}#output-${input.index}"]`,
  );
  expect(link).not.toBeNull();
});

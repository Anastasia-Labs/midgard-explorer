// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TransactionView } from "@midgard-explorer/contracts";
import { TXS } from "../e2e/fixtures/data.mjs";
import { StateTab } from "../src/features/transaction/tabs/StateTab";
import { UtxoFlow } from "../src/components/ui/domain/utxoflow";

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
  (r) =>
    r.transaction &&
    r.transaction.inputs.some((i) => i.resolved) &&
    r.transaction.outputs.length > 1,
)!.transaction!;

/** The icons beside each input's and output's address (credentials, UTxO
 * preview), leaving out the balance-changes rows above them. */
const iconsIn = (root: HTMLElement) =>
  [...root.querySelectorAll('[role="group"][aria-label="Address details"] button')]
    .filter((b) => b.closest('[data-region="balance-changes"]') === null)
    .map((b) => b.getAttribute("aria-label") ?? b.textContent)
    .sort();

/** What the table puts beside an address: a payment credential, a stake
 * credential when the address has one, and the UTxO preview. */
const expectedIcons = (identity: { stake: unknown } | null) =>
  identity === null
    ? []
    : ["Payment credential", ...(identity.stake ? ["Stake credential"] : []), "UTxO"];

it("gives every Flow card the same address icons the table shows", () => {
  const table = render(<StateTab tx={tx} />);
  const tableCards = [
    ...table.container.querySelectorAll('[role="group"][aria-label="Address details"]'),
  ].filter((g) => g.closest('[data-region="balance-changes"]') === null);
  expect(tableCards.length).toBeGreaterThan(0);
  cleanup();

  const flow = render(<UtxoFlow tx={tx} />);
  const cards = [
    ...flow.container.querySelectorAll(
      '[data-testid="flow-node-input"], [data-testid="flow-node-output"]',
    ),
  ] as HTMLElement[];
  const nodes = [
    ...tx.inputs.map((i) => i.resolved?.identity ?? null),
    ...tx.outputs.map((o) => o.identity),
  ];
  expect(cards).toHaveLength(nodes.length);
  cards.forEach((card, i) => {
    expect(iconsIn(card), `card ${i}`).toEqual(expectedIcons(nodes[i]!).sort());
  });
  // Each output card's preview opens that exact output.
  expect(within(cards.at(-1)!).getByRole("button", { name: /^UTxO$/ })).toBeDefined();
});

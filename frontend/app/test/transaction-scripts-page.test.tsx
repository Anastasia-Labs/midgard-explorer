// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TXS } from "../e2e/fixtures/data.mjs";
import TransactionPage from "../src/app/transaction/[txHash]/page";
import { api } from "../src/lib/api";

const state = vi.hoisted(() => ({ tab: "scripts" }));
vi.mock("../src/lib/api", () => ({ api: { transaction: vi.fn() } }));
vi.mock("../src/lib/viewerInit", () => ({ viewerInit: async () => ({}) }));
vi.mock("../src/components/ui/base/tabs", () => ({
  Tabs: ({
    tabs,
    aliases,
  }: {
    tabs: Array<{ id: string; label: string; content: ReactNode }>;
    aliases: Record<string, string>;
  }) => (
    <>
      <nav>
        {tabs.map((tab) => (
          <span key={tab.id}>{tab.label}</span>
        ))}
      </nav>
      {(tabs.find((tab) => tab.id === (aliases[state.tab] ?? state.tab)) ?? tabs[0])?.content}
    </>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/transaction/test",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
afterEach(cleanup);

async function page(scripts = true) {
  const row = TXS.find(
    (item) => item.transaction && item.transaction.witnesses.redeemers.length > 0 === scripts,
  )!;
  vi.mocked(api.transaction).mockResolvedValue({
    status: "committed",
    transaction: scripts
      ? row.transaction
      : {
          ...row.transaction!,
          outputs: row.transaction!.outputs.map((output) => ({
            ...output,
            datum: null,
            hasDatum: false,
          })),
        },
    admission: null,
    inclusion: null,
    finalization: null,
    cardano: null,
    midgard: null,
  } as unknown as Awaited<ReturnType<typeof api.transaction>>);
  return TransactionPage({ params: Promise.resolve({ txHash: row.tx_id }) });
}
it.each(["scripts", "datums", "events"])(
  "groups script evidence once and preserves the %s link",
  async (tab) => {
    state.tab = tab;
    render(await page());
    expect(screen.getByText("Scripts", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("Decoded redeemer and raw CBOR")).toHaveLength(1);
    expect(screen.queryByText("Redeemers (1)")).toBeNull();
    expect(screen.getByText("Script / policy")).toBeTruthy();
    fireEvent.click(screen.getByText("Decoded redeemer and raw CBOR"));
    expect(screen.getByRole("region", { name: "Invocation 1 redeemer CBOR" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Invocation 1 decoded redeemer" })).toBeTruthy();
    expect(screen.getByText("Script bytes and provenance")).toBeTruthy();
  },
);
it("omits Scripts for a transaction without script or datum evidence", async () => {
  state.tab = "raw";
  render(await page(false));
  expect(screen.queryByText("Scripts", { exact: true })).toBeNull();
});

it("shows mint and burn evidence once in Overview, not in Details", async () => {
  const row = TXS.find((item) => item.transaction?.mint?.assets.length)!;
  vi.mocked(api.transaction).mockResolvedValue({
    status: "committed",
    transaction: row.transaction,
    admission: null,
    inclusion: null,
    finalization: null,
    cardano: null,
    midgard: null,
  } as unknown as Awaited<ReturnType<typeof api.transaction>>);
  state.tab = "summary";
  const view = render(await TransactionPage({ params: Promise.resolve({ txHash: row.tx_id }) }));
  expect(screen.getAllByRole("heading", { name: /Minted|Burned/ })).toHaveLength(1);
  view.unmount();
  state.tab = "details";
  render(await TransactionPage({ params: Promise.resolve({ txHash: row.tx_id }) }));
  expect(screen.queryByRole("heading", { name: /Minted|Burned/ })).toBeNull();
});

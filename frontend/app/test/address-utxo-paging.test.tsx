// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom implements neither of these; the components under test only need them
// to exist, not to report real geometry.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

// Tabs reads the router to keep the selected tab in the URL; jsdom has none.
vi.mock("next/navigation", () => ({
  usePathname: () => "/address/test",
  // Select the UTxOs tab: an inactive panel is hidden, so its links are not
  // in the accessibility tree and getByRole would not see them.
  useSearchParams: () => new URLSearchParams("tab=utxos"),
  useRouter: () => ({ replace: vi.fn() }),
}));

import { AddressView } from "../src/features/address/AddressView";
import { ADDRESSES, addressResponse } from "../e2e/fixtures/data.mjs";

afterEach(cleanup);

// Indexed access is `string | undefined` under noUncheckedIndexedAccess, and a
// missing fixture address should fail loudly here rather than render "undefined".
const ADDRESS =
  ADDRESSES[1] ??
  (() => {
    throw new Error("fixture has no second address");
  })();

/**
 * The backend returns one page of UTxOs while `utxoCount` and the balance keep
 * describing the whole address. Without a way forward the count names UTxOs the
 * reader cannot reach, which is the regression these cases exist to catch.
 */
const withPaging = (over: Record<string, unknown>) => {
  const base = addressResponse(ADDRESS, 1) as Record<string, unknown>;
  return { ...base, ...over } as never;
};

const utxosPanel = () => {
  const tab = screen.getByRole("tab", { name: /UTxOs/i });
  return tab;
};

describe("address UTxO paging", () => {
  it("offers the next page when more UTxOs exist, carrying the cursor", () => {
    render(
      <AddressView
        address={ADDRESS}
        page={1}
        data={withPaging({ utxoCount: 5340, hasMoreUtxos: true, utxoCursor: "aabb01" })}
      />,
    );
    const next = screen.getByRole("link", { name: /Next 50/i });
    expect(next.getAttribute("href")).toContain("utxo_cursor=aabb01");
    expect(next.getAttribute("href")).toContain(encodeURIComponent(ADDRESS));
  });

  it("says how much of the set is on screen, so the count is not misread", () => {
    render(
      <AddressView
        address={ADDRESS}
        page={1}
        data={withPaging({ utxoCount: 5340, hasMoreUtxos: true, utxoCursor: "aabb01" })}
      />,
    );
    expect(screen.getByText(/of 5340 UTxOs/i)).toBeTruthy();
  });

  it("offers a way back to the first page once a cursor is in play", () => {
    render(
      <AddressView
        address={ADDRESS}
        page={1}
        utxoCursor="aabb01"
        data={withPaging({ utxoCount: 5340, hasMoreUtxos: false, utxoCursor: null })}
      />,
    );
    const first = screen.getByRole("link", { name: /First 50/i });
    expect(first.getAttribute("href")).not.toContain("utxo_cursor");
  });

  it("shows no paging controls when every UTxO is already on screen", () => {
    render(
      <AddressView
        address={ADDRESS}
        page={1}
        data={withPaging({ hasMoreUtxos: false, utxoCursor: null })}
      />,
    );
    expect(screen.queryByRole("link", { name: /Next 50/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /First 50/i })).toBeNull();
    expect(utxosPanel()).toBeTruthy();
  });
});

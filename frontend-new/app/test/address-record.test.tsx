// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AddressIdentityView, ValueView } from "@midgard-explorer/contracts";
import { AddressRecord } from "../src/components/ui/domain/addressrecord";

afterEach(cleanup);
const address = "addr_test1vpqgspvmh6m2m5pwangvdg499srfzre2dd96qq9tnqvtvtqz0mzgz";
const identity: AddressIdentityView = {
  payment: { kind: "PubKey", hash: "a".repeat(56) },
  stake: { kind: "Script", hash: "b".repeat(56) },
  networkId: 0,
  protected: false,
};
it("switches credentials without hiding the amount and Escape restores focus", () => {
  render(
    <AddressRecord address={address} identity={identity}>
      ₳ 3
    </AddressRecord>,
  );
  const payment = screen.getByRole("button", { name: "Payment credential" });
  const stake = screen.getByRole("button", { name: "Stake credential" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.focus(payment);
  expect(screen.getByText(identity.payment.hash)).toBeTruthy();
  fireEvent.blur(payment, { relatedTarget: stake });
  fireEvent.focus(stake);
  expect(screen.queryByText(identity.payment.hash)).toBeNull();
  expect(screen.getByText(identity.stake!.hash)).toBeTruthy();
  expect(screen.getByText("Stake credential · Script")).toBeTruthy();
  expect(screen.getByText("₳ 3")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(stake.getAttribute("aria-expanded")).toBe("false");
});
it("omits missing stake credentials and the redundant UTxO shortcut", () => {
  render(
    <AddressRecord address={address} identity={{ ...identity, stake: null }}>
      ₳ 3
    </AddressRecord>,
  );
  expect(screen.queryByRole("button", { name: "Stake credential" })).toBeNull();
  expect(screen.queryByRole("link", { name: "View address UTxOs" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Payment credential" }));
  expect(screen.getByText(/no stake credential/)).toBeTruthy();
});
it("preserves unknown credential kinds rather than calling them keys", () => {
  render(
    <AddressRecord
      address={address}
      identity={{ ...identity, payment: { ...identity.payment, kind: "FutureCredential" } }}
    >
      ₳ 3
    </AddressRecord>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Payment credential" }));
  expect(screen.getByText("Payment credential · FutureCredential")).toBeTruthy();
});

it("previews the row's exact UTxO rather than all outputs at an address", () => {
  const txId = "c".repeat(64);
  render(
    <AddressRecord
      address={address}
      identity={identity}
      utxo={{
        txId,
        index: 7,
        value: { lovelace: "3000000", assets: {} } as ValueView,
        context: "Output",
        status: "Unspent",
      }}
    >
      ₳ 3
    </AddressRecord>,
  );
  fireEvent.focus(screen.getByRole("button", { name: "UTxO" }));
  const dialog = screen.getByRole("dialog", { name: "UTxO" });
  expect(dialog.textContent).toContain(`${txId}#7`);
  expect(dialog.textContent).toContain("Unspent");
  expect(dialog.querySelector("a")?.getAttribute("href")).toBe(`/transaction/${txId}`);
});

it("draws a script credential as code, never as a key", () => {
  const glyph = (kind: string) => {
    render(
      <AddressRecord
        address={address}
        identity={{ ...identity, payment: { ...identity.payment, kind } }}
      >
        ₳ 3
      </AddressRecord>,
    );
    const html = screen.getByRole("button", { name: "Payment credential" }).innerHTML;
    cleanup();
    return html;
  };
  // Lucide code-xml's slash, and key-round's bow.
  expect(glyph("Script")).toContain("m14.5 4-5 16");
  expect(glyph("Script")).not.toContain("16.5");
  expect(glyph("PubKey")).toContain('cx="16.5"');
  expect(glyph("FutureCredential")).not.toContain('cx="16.5"');
});

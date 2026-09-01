import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AddressLink } from "../src/components/ui/domain/address";
import { IdentityBar } from "../src/components/ui/domain/identitybar";

afterEach(cleanup);

/** The identicon, told apart from the copy and external-link icons that share
 * the same card: its viewBox is the grid, five cells a side. */
const MARK = 'svg[viewBox="0 0 5 5"]';

const MIDGARD = "addr_test1vpqgspvmh6m2m5pwangvdg499srfzre2dd96qq9tnqvtvtqz0mzgz";
const CARDANO = "addr_test1g9pqgspvmh6m2m5pwangvdg499srfzre2dd96qq9tnqvtvpg8ex3qw";

/**
 * Every address the explorer renders carries its mark, whichever ledger it
 * belongs to. `AddressLink`'s own contract says why: a mark that is present in
 * some lists and missing in others is worse than none, because a reader learns
 * to scan for it and then finds nothing to scan. Four places had drifted from
 * that: both bridge listings, the flow nodes, and the address page's own
 * heading, which is the one page whose whole subject is an address.
 *
 * What differs between the two ledgers is the destination, not the mark. A
 * Cardano address has no page here, so it must not link to one that answers
 * "not found".
 */
describe("the mark on an address", () => {
  it("is drawn for a Midgard address, which links to its page", () => {
    const { container } = render(<AddressLink address={MIDGARD} />);
    expect(container.querySelector(MARK)).not.toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(`/address/${MIDGARD}`);
  });

  it("is drawn for a Cardano address, which links nowhere", () => {
    const { container } = render(<AddressLink address={CARDANO} chain="cardano" />);
    expect(container.querySelector(MARK)).not.toBeNull();
    expect(container.querySelector("a")).toBeNull();
    // The address is still readable and still copyable; only the link is gone.
    expect(container.textContent).toContain(CARDANO.slice(0, 8));
  });

  it("still follows an explicit destination for a Cardano address", () => {
    const { container } = render(
      <AddressLink address={CARDANO} chain="cardano" href="/l1/validator/abc" />,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/l1/validator/abc");
  });

  it("is the same mark wherever the address appears", () => {
    const inAList = render(<AddressLink address={MIDGARD} />).container.querySelector(
      MARK,
    )?.innerHTML;
    cleanup();
    const onItsOwnPage = render(
      <IdentityBar overline="Midgard address" value={MIDGARD} mark />,
    ).container.querySelector(MARK)?.innerHTML;
    expect(onItsOwnPage).toBe(inAList);
  });

  it("is absent from a heading that is not about an address", () => {
    // A block or transaction hash has no mark anywhere else in the explorer,
    // and one invented here would be the only place it appeared.
    const { container } = render(<IdentityBar overline="Block" value={"a".repeat(56)} />);
    expect(container.querySelector(MARK)).toBeNull();
  });
});

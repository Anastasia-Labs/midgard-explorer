// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** The component reads the configured explorer through `network.ts`, which
 * snapshots `process.env` at module load, so it has to be imported after the
 * environment is set. */
let L1TxLink: typeof import("../src/components/ui/domain/l1link").L1TxLink;
const HASH = "a".repeat(64);

beforeAll(async () => {
  process.env.NEXT_PUBLIC_L1_EXPLORER_TX_URL = "https://preprod.cexplorer.io/tx/{hash}";
  process.env.NEXT_PUBLIC_L1_EXPLORER_NAME = "CExplorer";
  vi.resetModules();
  ({ L1TxLink } = await import("../src/components/ui/domain/l1link"));
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_L1_EXPLORER_TX_URL;
  delete process.env.NEXT_PUBLIC_L1_EXPLORER_NAME;
  vi.resetModules();
});

describe("L1TxLink", () => {
  /* The rule this component exists to enforce. Midgard Explorer is not a
   * Cardano explorer: a hash earns an internal page only where we have Midgard
   * interpretation to add, and everything else is delegated. Both cases are
   * declared by the caller, because the failure this replaces was the same
   * hash resolving internally in one view and externally in another. */
  it("sends a Midgard record to the internal context page", () => {
    render(<L1TxLink hash={HASH} destination="midgard" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/l1/transaction/${HASH}`);
  });

  it("sends ordinary Cardano provenance straight to the configured explorer", () => {
    render(<L1TxLink hash={HASH} destination="cardano" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      `https://preprod.cexplorer.io/tx/${HASH}`,
    );
  });

  it("names the destination, so a reader knows before clicking", () => {
    render(<L1TxLink hash={HASH} destination="cardano" />);
    expect(screen.getByRole("link").getAttribute("aria-label")).toMatch(/CExplorer.*new tab/);
    // Named for every reader, not by a hover-only title (the lint rule bans those).
    expect(screen.getByRole("link").getAttribute("title")).toBeNull();
  });

  it("opens an external destination in a new tab, safely", () => {
    render(<L1TxLink hash={HASH} destination="cardano" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  /* An internal destination is our own page, so opening a tab for it would
   * break back navigation for no reason. */
  it("keeps an internal destination in the same tab", () => {
    render(<L1TxLink hash={HASH} destination="midgard" />);
    expect(screen.getByRole("link").getAttribute("target")).toBeNull();
  });

  /* A hash that silently loses its link is a small failure; a hash that
   * silently vanishes is a large one. */
  /* A valid hash still leads somewhere when no explorer is configured: the
   * internal page, which says what the node recorded about it. */
  it("falls back to the internal page when no explorer is configured", async () => {
    const previous = process.env.NEXT_PUBLIC_L1_EXPLORER_TX_URL;
    delete process.env.NEXT_PUBLIC_L1_EXPLORER_TX_URL;
    vi.resetModules();
    const unconfigured = await import("../src/components/ui/domain/l1link");

    render(<unconfigured.L1TxLink hash={HASH} destination="cardano" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(`/l1/transaction/${HASH}`);
    expect(link.getAttribute("target")).toBeNull();

    process.env.NEXT_PUBLIC_L1_EXPLORER_TX_URL = previous;
    vi.resetModules();
  });

  it("falls back to the internal page for synthetic data", async () => {
    const previous = process.env.NEXT_PUBLIC_L1_EXPLORER_SUPPRESS;
    process.env.NEXT_PUBLIC_L1_EXPLORER_SUPPRESS = "1";
    vi.resetModules();
    const synthetic = await import("../src/components/ui/domain/l1link");

    render(<synthetic.L1TxLink hash={HASH} destination="cardano" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/l1/transaction/${HASH}`);

    if (previous === undefined) delete process.env.NEXT_PUBLIC_L1_EXPLORER_SUPPRESS;
    else process.env.NEXT_PUBLIC_L1_EXPLORER_SUPPRESS = previous;
    vi.resetModules();
  });

  /* A hash that silently loses its link is a small failure; a value that is not
   * a Cardano hash turned into a link is a large one. */
  it("never links a value that is not a Cardano transaction hash", () => {
    const { container } = render(<L1TxLink hash="not-a-hash" destination="cardano" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("not-a-hash");
  });

  /* An unconfigured explorer must not take the internal page away too: that
   * destination does not depend on the external provider at all. */
  it("keeps the internal page available when no explorer is configured", async () => {
    const previous = process.env.NEXT_PUBLIC_L1_EXPLORER_TX_URL;
    delete process.env.NEXT_PUBLIC_L1_EXPLORER_TX_URL;
    vi.resetModules();
    const unconfigured = await import("../src/components/ui/domain/l1link");

    render(<unconfigured.L1TxLink hash={HASH} destination="midgard" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/l1/transaction/${HASH}`);

    process.env.NEXT_PUBLIC_L1_EXPLORER_TX_URL = previous;
    vi.resetModules();
  });
});

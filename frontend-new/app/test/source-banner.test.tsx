import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The explorer once read a phase-4 test database for weeks and presented it as
 * the live chain. The cause was one line in a gitignored .env, so no diff and
 * no review could have caught it. These tests hold the one thing that would
 * have: the page saying which database it is reading.
 */

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

const withSummary = async (source: unknown) => {
  vi.doMock("../src/lib/api", () => ({
    api: { l1Summary: async () => ({ source }) },
  }));
  return import("../src/components/shell/SourceBanner");
};

const live = {
  deployment: "a56045c3133c4bfa52714c3371b46afedff7de450df53e213866aa79b5c5f7fd",
  network: "preprod",
  deployedAt: "2026-07-15T17:25:29.605Z",
  l2Database: "midgard",
  isFixture: false,
};

const fixture = { ...live, l2Database: "midgard_phase4_process_txcoverage", isFixture: true };

describe("SourceBanner", () => {
  it("warns, and names the database, when the source is a fixture", async () => {
    const { SourceBanner } = await withSummary(fixture);
    render(await SourceBanner());
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/not live data/i);
    expect(banner.textContent).toContain("midgard_phase4_process_txcoverage");
  });

  it("says nothing when the source is the live node", async () => {
    const { SourceBanner } = await withSummary(live);
    const { container } = render(await SourceBanner());
    expect(container.innerHTML).toBe("");
  });

  // Failing open is the defect this component exists to prevent. A summary
  // that cannot be read must not silently remove the warning while the pages
  // below still render figures.
  it("warns that the source is unconfirmed when the backend reports none", async () => {
    const { SourceBanner } = await withSummary(null);
    render(await SourceBanner());
    expect(screen.getByRole("status").textContent).toMatch(/unconfirmed/i);
  });

  it("warns that the source is unconfirmed when the summary request fails", async () => {
    vi.doMock("../src/lib/api", () => ({
      api: {
        l1Summary: async () => {
          throw new Error("backend unreachable");
        },
      },
    }));
    const { SourceBanner } = await import("../src/components/shell/SourceBanner");
    render(await SourceBanner());
    expect(screen.getByRole("status").textContent).toMatch(/could not be reached/i);
  });
});

describe("DeploymentNote", () => {
  it("names the deployment, the network and the L2 database", async () => {
    const { DeploymentNote } = await withSummary(live);
    render(await DeploymentNote());
    expect(screen.getByText(/Deployment/).textContent).toContain("preprod");
    expect(screen.getByText("a56045c3133c")).toBeTruthy();
    expect(screen.getByText("midgard")).toBeTruthy();
  });

  it("renders nothing when the manifest carries no deployment id", async () => {
    const { DeploymentNote } = await withSummary({ ...live, deployment: null });
    const { container } = render(await DeploymentNote());
    expect(container.innerHTML).toBe("");
  });
});

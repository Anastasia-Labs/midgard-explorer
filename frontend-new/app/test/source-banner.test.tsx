// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The explorer once read a phase-4 test database for weeks and presented it as
 * the live chain. The cause was one line in a gitignored .env, so no diff and
 * no review could have caught it. These tests hold the one thing that would
 * have: the page saying which database it is reading.
 *
 * And one failure found later: the banner read the Cardano index's summary, so
 * stopping that second database made every page claim "the backend could not
 * be reached" while the backend served Midgard data perfectly. It now reads the
 * node's own source answer, and the tests below say which failure produces
 * which sentence.
 */

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

const withSource = async (source: unknown, fails = false) => {
  vi.doMock("../src/lib/api", () => ({
    api: {
      source: async () => {
        if (fails) throw new Error("connection refused");
        return source;
      },
    },
  }));
  return import("../src/components/shell/SourceBanner");
};

const live = {
  deploymentId: "a56045c3133c4bfa52714c3371b46afedff7de450df53e213866aa79b5c5f7fd",
  network: "preprod",
  networkMagic: null,
  database: "midgard",
  sourceKind: "primary",
  identityState: "configured",
  freshness: { state: "live", observedAsOf: "2026-08-13T11:40:53.000Z", lagSeconds: null },
};

const fixture = { ...live, database: "midgard_phase4_process_txcoverage", sourceKind: "fixture" };

const snapshot = {
  ...live,
  database: "midgard_snapshot",
  sourceKind: "snapshot",
  freshness: { state: "fixed", observedAsOf: "2026-09-02T09:15:00.000Z", lagSeconds: null },
};

describe("SourceBanner", () => {
  it("warns, and names the database, when the source is a fixture", async () => {
    const { SourceBanner } = await withSource(fixture);
    render(await SourceBanner());
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/not live data/i);
    expect(banner.textContent).toContain("midgard_phase4_process_txcoverage");
  });

  it("calls a restored snapshot real data, not a fixture, and says when it was taken", async () => {
    const { SourceBanner } = await withSource(snapshot);
    render(await SourceBanner());
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/Snapshot, not the live node/);
    expect(banner.textContent).not.toMatch(/fixture/i);
    expect(banner.textContent).toContain("2026-09-02T09:15:00.000Z");
  });

  it("says nothing when the source is the live node", async () => {
    const { SourceBanner } = await withSource(live);
    const out = await SourceBanner();
    expect(out).toBeNull();
  });

  /** An unreachable backend is what "could not be reached" is for, and only
   * that. */
  it("says the backend could not be reached only when it could not", async () => {
    const { SourceBanner } = await withSource(null, true);
    render(await SourceBanner());
    expect(screen.getByRole("status").textContent).toMatch(/could not be reached/);
  });

  /** The backend answered, and could not name the deployment. That is a
   * different failure and it says a different thing: a reader told the backend
   * is down goes looking in the wrong place. */
  it("distinguishes an unnamed deployment from an unreachable backend", async () => {
    const { SourceBanner } = await withSource({ ...live, identityState: "unconfigured" });
    render(await SourceBanner());
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/could not say which Midgard deployment/);
    expect(text).not.toMatch(/could not be reached/);
  });
});

describe("DeploymentNote", () => {
  /** A manifest that parses says what an operator intended. The note must not
   * turn that into a verification. */
  it("names the deployment as configured, never as verified", async () => {
    const { DeploymentNote } = await withSource(live);
    render((await DeploymentNote())!);
    const text = document.body.textContent ?? "";
    expect(text).toContain("a56045c3133c");
    expect(text).toMatch(/as configured/);
    expect(text).not.toMatch(/verified/i);
  });
});

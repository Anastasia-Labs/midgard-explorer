import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import type { Leadership } from "../src/indexer/leadership.js";
import { startSync, type SyncResult } from "../src/indexer/sync.js";

/**
 * The indexer's lifecycle, which had no tests at all.
 *
 * Everything here is about what happens around a pass rather than inside one:
 * whether a pass runs when this process does not hold the write lock, whether
 * it keeps running after the lock is gone, and whether shutdown waits for a
 * pass that is already writing. Each of those is a way to corrupt the index
 * that no amount of testing `syncOnce` can reach.
 *
 * The bootstrap sequence is awaited through `SyncHandle.started` rather than
 * slept on, so these cases are deterministic instead of timing-dependent.
 */

const RESULT: SyncResult = { scanned: 0, ingested: 0, reconciled: true };

/** A leadership that is held until it is released, and counts both. */
function grantedLeadership() {
  const state = { verified: 0, released: 0, held: true };
  const leadership: Leadership = {
    verify: async () => {
      state.verified += 1;
      return state.held;
    },
    release: async () => {
      state.released += 1;
      state.held = false;
    },
  };
  return { state, leadership };
}

const quietBootstrap = {
  warnOnPreDeploymentActivity: async () => [],
  healCursorIfDataWasWiped: async () => false,
};

describe("startSync leadership", () => {
  it("runs no pass when another process holds the lock", async () => {
    let passes = 0;
    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => null,
      syncOnce: async () => {
        passes += 1;
        return RESULT;
      },
    });

    await handle.started;
    expect(passes).toBe(0);
    await handle.stop();
  });

  it("runs a pass once it holds the lock", async () => {
    const { leadership } = grantedLeadership();
    let passes = 0;
    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => leadership,
      syncOnce: async () => {
        passes += 1;
        return RESULT;
      },
    });

    await handle.started;
    expect(passes).toBe(1);
    await handle.stop();
  });

  it("confirms the lock is still held before it writes", async () => {
    // The lock lives on one connection. Checking it only at boot meant a
    // connection that died left the loop writing while another process could
    // hold the lock.
    const { state, leadership } = grantedLeadership();
    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => leadership,
      syncOnce: async () => RESULT,
    });

    await handle.started;
    expect(state.verified).toBeGreaterThan(0);
    await handle.stop();
  });

  it("stops rather than writing when the lock has been lost", async () => {
    let passes = 0;
    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => ({
        verify: async () => false,
        release: async () => undefined,
      }),
      syncOnce: async () => {
        passes += 1;
        return RESULT;
      },
    });

    await handle.started;
    expect(passes).toBe(0);
    await handle.stop();
  });

  it("releases the lock on shutdown", async () => {
    const { state, leadership } = grantedLeadership();
    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => leadership,
      syncOnce: async () => RESULT,
    });

    await handle.started;
    await handle.stop();
    expect(state.released).toBe(1);
  });
});

describe("startSync draining", () => {
  it("waits for a pass that is already writing", async () => {
    // Disconnecting Prisma underneath a pass cuts its transaction mid-write,
    // so shutdown has to know when the last one finished.
    const { leadership } = grantedLeadership();
    let finished = false;
    let release = () => {};
    let began = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = new Promise<void>((resolve) => {
      began = resolve;
    });

    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => leadership,
      syncOnce: async () => {
        began();
        await blocked;
        finished = true;
        return RESULT;
      },
    });

    // Shutdown has to be asked for while a pass is actually writing. Asking
    // before one has started is a different case: the pass is then skipped
    // outright, which the next test covers.
    await inFlight;
    const stopped = handle.stop();
    expect(finished).toBe(false);
    release();
    await stopped;
    expect(finished).toBe(true);
  });

  it("skips the first pass entirely when stopped before it begins", async () => {
    const { leadership } = grantedLeadership();
    let passes = 0;
    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => leadership,
      syncOnce: async () => {
        passes += 1;
        return RESULT;
      },
    });

    await handle.stop();
    expect(passes).toBe(0);
  });

  it("schedules nothing after stop", async () => {
    const { leadership } = grantedLeadership();
    let passes = 0;
    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => leadership,
      syncOnce: async () => {
        passes += 1;
        return RESULT;
      },
    });

    await handle.started;
    await handle.stop();
    const after = passes;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(passes).toBe(after);
  });

  it("survives a pass that throws and does not stop the loop", async () => {
    const { leadership } = grantedLeadership();
    const handle = startSync({
      ...quietBootstrap,
      acquireLeadership: async () => leadership,
      syncOnce: async () => {
        throw new Error("Koios 503");
      },
    });

    await expect(handle.started).resolves.toBeUndefined();
    await handle.stop();
  });
});

describe("startSync bootstrap", () => {
  it("does not take the lock when the manifest is unusable", async () => {
    // Every row would be attributed to an identity nobody can query back, so
    // this has to fail before anything is written rather than after.
    const real = config.MIDGARD_MANIFEST_PATH;
    let acquired = 0;
    try {
      config.MIDGARD_MANIFEST_PATH = "/nonexistent/manifest.json";
      const handle = startSync({
        ...quietBootstrap,
        acquireLeadership: async () => {
          acquired += 1;
          return null;
        },
        syncOnce: async () => RESULT,
      });
      await handle.started;
      await handle.stop();
    } finally {
      config.MIDGARD_MANIFEST_PATH = real;
    }
    expect(acquired).toBe(0);
  });

  it("heals the cursor before the first pass, not alongside it", async () => {
    // Healing used to run concurrently with the first pass, so a pass could
    // read the stale cursor, healing could reset it to zero, and the pass
    // could write the stale value back over the reset.
    const { leadership } = grantedLeadership();
    const order: string[] = [];
    const handle = startSync({
      warnOnPreDeploymentActivity: async () => [],
      healCursorIfDataWasWiped: async () => {
        order.push("heal");
        return false;
      },
      acquireLeadership: async () => leadership,
      syncOnce: async () => {
        order.push("pass");
        return RESULT;
      },
    });

    await handle.started;
    await handle.stop();
    expect(order).toEqual(["heal", "pass"]);
  });

  it("still starts when the pre-deployment check fails", async () => {
    const { leadership } = grantedLeadership();
    let passes = 0;
    const handle = startSync({
      healCursorIfDataWasWiped: async () => false,
      warnOnPreDeploymentActivity: async () => {
        throw new Error("Koios 503");
      },
      acquireLeadership: async () => leadership,
      syncOnce: async () => {
        passes += 1;
        return RESULT;
      },
    });

    await handle.started;
    expect(passes).toBe(1);
    await handle.stop();
  });
});

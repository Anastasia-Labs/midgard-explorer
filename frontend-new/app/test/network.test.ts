import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** network.ts reads process.env at module load, so each case needs a fresh
 * module registry rather than a mutated import. */
const loadNetwork = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import("../src/lib/network");
};

const KEYS = ["NEXT_PUBLIC_NETWORK_LABEL", "NEXT_PUBLIC_L1_EXPLORER_URL", "MG_STRICT_CONFIG"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe("NETWORK_LABEL", () => {
  it("is null when unset, so the UI can say the network is not configured", async () => {
    const { NETWORK_LABEL } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: undefined,
      NEXT_PUBLIC_L1_EXPLORER_URL: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(NETWORK_LABEL).toBeNull();
  });

  it("is null when set to whitespace, never a blank badge", async () => {
    const { NETWORK_LABEL } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: "   ",
      MG_STRICT_CONFIG: undefined,
    });
    expect(NETWORK_LABEL).toBeNull();
  });

  it("never defaults to a guessed network name", async () => {
    const { NETWORK_LABEL } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(NETWORK_LABEL).not.toBe("Preprod");
  });

  it("uses the declared label verbatim", async () => {
    const { NETWORK_LABEL } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: "Preprod",
      MG_STRICT_CONFIG: undefined,
    });
    expect(NETWORK_LABEL).toBe("Preprod");
  });
});

describe("l1TxUrl", () => {
  it("returns null when no L1 explorer is configured", async () => {
    const { l1TxUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_URL: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1TxUrl("abc")).toBeNull();
  });

  it("builds a transaction URL from the configured base", async () => {
    const { l1TxUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_URL: "https://preprod.cardanoscan.io",
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1TxUrl("deadbeef")).toBe("https://preprod.cardanoscan.io/transaction/deadbeef");
  });

  it("tolerates trailing slashes in the configured base", async () => {
    const { l1TxUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_URL: "https://preprod.cardanoscan.io///",
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1TxUrl("deadbeef")).toBe("https://preprod.cardanoscan.io/transaction/deadbeef");
  });
});

describe("assertNetworkConfigured", () => {
  it("is a no-op when strict config is off", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: undefined,
      NEXT_PUBLIC_L1_EXPLORER_URL: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(() => assertNetworkConfigured()).not.toThrow();
  });

  it("fails the build when strict and both values are missing", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: undefined,
      NEXT_PUBLIC_L1_EXPLORER_URL: undefined,
      MG_STRICT_CONFIG: "1",
    });
    expect(() => assertNetworkConfigured()).toThrow(/NEXT_PUBLIC_NETWORK_LABEL/);
  });

  it("names the one missing value when the other is present", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: "Preprod",
      NEXT_PUBLIC_L1_EXPLORER_URL: undefined,
      MG_STRICT_CONFIG: "1",
    });
    expect(() => assertNetworkConfigured()).toThrow(/NEXT_PUBLIC_L1_EXPLORER_URL/);
  });

  it("passes when strict and both values are declared", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: "Preprod",
      NEXT_PUBLIC_L1_EXPLORER_URL: "https://preprod.cardanoscan.io",
      MG_STRICT_CONFIG: "1",
    });
    expect(() => assertNetworkConfigured()).not.toThrow();
  });
});

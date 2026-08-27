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

const KEYS = [
  "NEXT_PUBLIC_NETWORK_LABEL",
  "NEXT_PUBLIC_L1_EXPLORER_TX_URL",
  "NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL",
  "NEXT_PUBLIC_L1_EXPLORER_NAME",
  "NEXT_PUBLIC_API_BASE",
  "API_BASE_SERVER",
  "NEXT_PUBLIC_SITE_URL",
  "MG_STRICT_CONFIG",
];

/** Strict mode also requires the deployment's own URLs, because a production
 * build defaulted the public API base to localhost and published documentation
 * and examples pointing at each visitor's own machine. Cases about the L1
 * explorer templates supply them so they fail on the thing they are about. */
const DEPLOYMENT_URLS = {
  NEXT_PUBLIC_API_BASE: "https://api.example.test",
  API_BASE_SERVER: "http://backend:3101",
  NEXT_PUBLIC_SITE_URL: "https://explorer.example.test",
};
let saved: Record<string, string | undefined> = {};

const CEXPLORER = "https://preprod.cexplorer.io/tx/{hash}";
const CARDANOSCAN = "https://preprod.cardanoscan.io/transaction/{hash}";

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
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: undefined,
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
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1TxUrl("abc")).toBeNull();
  });

  /* The whole point of a template. A configurable base with a fixed
   * `/transaction/` path only ever addressed explorers that happen to use
   * Cardanoscan's route, so pointing the deployment at CExplorer produced
   * links to pages that do not exist. */
  it("places the hash wherever the provider puts it", async () => {
    const cexplorer = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: CEXPLORER,
      MG_STRICT_CONFIG: undefined,
    });
    expect(cexplorer.l1TxUrl("deadbeef")).toBe("https://preprod.cexplorer.io/tx/deadbeef");

    const cardanoscan = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: CARDANOSCAN,
      MG_STRICT_CONFIG: undefined,
    });
    expect(cardanoscan.l1TxUrl("deadbeef")).toBe(
      "https://preprod.cardanoscan.io/transaction/deadbeef",
    );
  });

  it("escapes the hash rather than trusting it into a URL", async () => {
    const { l1TxUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: CEXPLORER,
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1TxUrl("a/b?c=d")).toBe("https://preprod.cexplorer.io/tx/a%2Fb%3Fc%3Dd");
  });

  /* A template without the placeholder would send every transaction to the
   * same page. Silently linking the wrong record is worse for an explorer than
   * not linking at all, so a malformed template counts as unconfigured. */
  it("treats a template with no placeholder as unconfigured", async () => {
    const { l1TxUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: "https://preprod.cexplorer.io/tx/",
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1TxUrl("deadbeef")).toBeNull();
  });

  it("refuses a template that is not http", async () => {
    const { l1TxUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: "javascript:alert({hash})",
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1TxUrl("deadbeef")).toBeNull();
  });
});

describe("L1_EXPLORER_NAME", () => {
  it("names the provider so the action can say where it goes", async () => {
    const { L1_EXPLORER_NAME } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: CEXPLORER,
      NEXT_PUBLIC_L1_EXPLORER_NAME: "CExplorer",
      MG_STRICT_CONFIG: undefined,
    });
    expect(L1_EXPLORER_NAME).toBe("CExplorer");
  });

  /* "View on preprod.cexplorer.io" is worse copy than "View on CExplorer" and
   * better than "View on the configured Cardano explorer", which names
   * nothing. A deployment that skips the name still gets a truthful link. */
  it("falls back to the host rather than to an anonymous phrase", async () => {
    const { L1_EXPLORER_NAME } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: CEXPLORER,
      NEXT_PUBLIC_L1_EXPLORER_NAME: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(L1_EXPLORER_NAME).toBe("preprod.cexplorer.io");
  });

  it("is null when there is no explorer to name", async () => {
    const { L1_EXPLORER_NAME } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: undefined,
      NEXT_PUBLIC_L1_EXPLORER_NAME: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(L1_EXPLORER_NAME).toBeNull();
  });
});

describe("assertNetworkConfigured", () => {
  it("is a no-op when strict config is off", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: undefined,
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(() => assertNetworkConfigured()).not.toThrow();
  });

  it("fails the build when strict and both values are missing", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: undefined,
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: undefined,
      MG_STRICT_CONFIG: "1",
    });
    expect(() => assertNetworkConfigured()).toThrow(/NEXT_PUBLIC_NETWORK_LABEL/);
  });

  it("names the one missing value when the other is present", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: "Preprod",
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: undefined,
      MG_STRICT_CONFIG: "1",
    });
    expect(() => assertNetworkConfigured()).toThrow(/NEXT_PUBLIC_L1_EXPLORER_TX_URL/);
  });

  /* A malformed template reads as configured to anyone looking at the
   * environment, which is exactly the case a build-time check is for. */
  it("fails the build on a template it cannot use", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: "Preprod",
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: "https://preprod.cexplorer.io/tx/",
      MG_STRICT_CONFIG: "1",
    });
    expect(() => assertNetworkConfigured()).toThrow(/NEXT_PUBLIC_L1_EXPLORER_TX_URL/);
  });

  it("passes when strict and both values are declared", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: "Preprod",
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: CEXPLORER,
      MG_STRICT_CONFIG: "1",
      ...DEPLOYMENT_URLS,
    });
    expect(() => assertNetworkConfigured()).not.toThrow();
  });
});

/** A Cardano address has no page in this explorer. Without a template it is
 * text with a copy button, which is what a reader met on the Cardano
 * transaction page: an address they could copy and not follow. */
describe("l1AddressUrl", () => {
  const ADDRESS = "addr_test1wz3q9cphmpqzgpcc45sqzedtkwkj5nn6nwcje8a39ylu7dghn7vqy";
  const TEMPLATE = "https://preprod.cexplorer.io/address/{address}";

  it("fills the address placeholder", async () => {
    const { l1AddressUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL: TEMPLATE,
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1AddressUrl(ADDRESS)).toBe(`https://preprod.cexplorer.io/address/${ADDRESS}`);
  });

  it("is null when unset, so the address renders without a link", async () => {
    const { l1AddressUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL: undefined,
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1AddressUrl(ADDRESS)).toBeNull();
  });

  it("refuses a template that names no address", async () => {
    const { l1AddressUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL: "https://preprod.cexplorer.io/address/",
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1AddressUrl(ADDRESS)).toBeNull();
  });

  it("refuses a scheme a reader must not be sent to", async () => {
    const { l1AddressUrl } = await loadNetwork({
      NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL: "javascript:alert({address})",
      MG_STRICT_CONFIG: undefined,
    });
    expect(l1AddressUrl(ADDRESS)).toBeNull();
  });

  it("is not required configuration: a deployment may leave it unset", async () => {
    const { assertNetworkConfigured } = await loadNetwork({
      NEXT_PUBLIC_NETWORK_LABEL: "Preprod",
      NEXT_PUBLIC_L1_EXPLORER_TX_URL: CEXPLORER,
      NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL: undefined,
      MG_STRICT_CONFIG: "1",
      ...DEPLOYMENT_URLS,
    });
    expect(() => assertNetworkConfigured()).not.toThrow();
  });
});

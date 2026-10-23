import { describe, expect, it } from "vitest";
import {
  FRESHNESS_LABEL,
  JOURNEY_SOURCE_LABEL,
  SOURCE_KIND_LABEL,
  networkName,
  purposeLabel,
} from "../src/lib/labels";

/* Internal codes (`tx_admissions`, `preprod`, `lagging`) are the backend's
 * words. The page shows the reader's. */
describe("labels", () => {
  it("names networks, sources and purposes in plain words", () => {
    expect(networkName("preprod")).toBe("Preprod");
    expect(networkName("mainnet")).toBe("Mainnet");
    expect(networkName("custom-7")).toBe("custom-7");
    expect(SOURCE_KIND_LABEL.primary).toBe("Node database");
    expect(FRESHNESS_LABEL.lagging).toBe("behind");
    expect(JOURNEY_SOURCE_LABEL.tx_admissions).toBe("Node admission record");
    expect(purposeLabel("None")).toBe("Not stated");
    expect(purposeLabel("Spend")).toBe("Spend");
  });
});

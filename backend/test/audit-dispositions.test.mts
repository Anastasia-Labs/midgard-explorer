import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkDispositions, parseExpiry } from "../scripts/audit-gate.mjs";

/**
 * The disposition rules, as tests rather than as a session of hand-run
 * mutations.
 *
 * An acceptance recorded in security-advisories.json silences a production
 * advisory. Two things stop that from becoming permanent: it names a role that
 * owns it, and it carries a date it stops counting. Neither is worth anything
 * unless the check discriminates, and the first version of it did not: it
 * tested `/^\d{4}-\d{2}-\d{2}$/`, which accepts 2026-99-99, and that string
 * then compares as later than any real date, so the one input a typo produces
 * is the one that never expires.
 *
 * Importing the gate must not run an audit, which is why the two functions
 * under test are pure and the effects live behind an is-main guard.
 */

const TODAY = new Date("2026-08-27T00:00:00Z");
const entry = (over: Record<string, unknown> = {}) => ({
  id: "GHSA-test",
  module: "example",
  owner: "explorer-maintainers",
  expiresOn: "2026-11-27",
  ...over,
});

describe("parseExpiry", () => {
  it("accepts a real date", () => {
    expect(parseExpiry("2026-11-27")?.toISOString()).toBe("2026-11-27T00:00:00.000Z");
  });

  /** The discriminating case. This is what the regex-only check let through. */
  it("rejects a date-shaped string that is not a date", () => {
    expect(parseExpiry("2026-99-99")).toBeNull();
    expect(parseExpiry("2026-13-01")).toBeNull();
    expect(parseExpiry("2026-00-10")).toBeNull();
  });

  /** Date rolls 2026-02-31 forward to March rather than rejecting it, so the
   * value has to be read back out and compared. */
  it("rejects a day the month does not have", () => {
    expect(parseExpiry("2026-02-31")).toBeNull();
    expect(parseExpiry("2027-02-29")).toBeNull();
  });

  it("accepts a leap day in a leap year", () => {
    expect(parseExpiry("2028-02-29")).not.toBeNull();
  });

  it("rejects anything that is not a plain date string", () => {
    for (const value of ["", "soon", "2026-11-27T00:00:00Z", "26-11-27", null, undefined, 20261127]) {
      expect(parseExpiry(value)).toBeNull();
    }
  });
});

describe("checkDispositions", () => {
  it("passes an entry with an owner and a future date", () => {
    expect(checkDispositions([entry()], TODAY)).toEqual([]);
  });

  it("fails an entry with no owner", () => {
    expect(checkDispositions([entry({ owner: undefined })], TODAY)[0]).toMatch(/has no owner/);
  });

  it("fails an entry whose owner is whitespace", () => {
    expect(checkDispositions([entry({ owner: "   " })], TODAY)[0]).toMatch(/has no owner/);
  });

  it("fails an entry with no expiry", () => {
    expect(checkDispositions([entry({ expiresOn: undefined })], TODAY)[0]).toMatch(
      /no expiresOn date/,
    );
  });

  it("fails an entry whose expiry is not a real date", () => {
    expect(checkDispositions([entry({ expiresOn: "2026-99-99" })], TODAY)[0]).toMatch(
      /no expiresOn date/,
    );
  });

  it("fails an entry that expired yesterday", () => {
    const problems = checkDispositions([entry({ expiresOn: "2026-08-26" })], TODAY);
    expect(problems[0]).toMatch(/expired on 2026-08-26 and is owned by explorer-maintainers/);
  });

  it("accepts an entry expiring today", () => {
    expect(checkDispositions([entry({ expiresOn: "2026-08-27" })], TODAY)).toEqual([]);
  });

  it("reports every bad entry, not only the first", () => {
    const problems = checkDispositions(
      [entry({ id: "A", owner: undefined }), entry({ id: "B", expiresOn: "2020-01-01" })],
      TODAY,
    );
    expect(problems).toHaveLength(2);
  });
});

/** The file that is actually shipped, not a fixture of it. A disposition that
 * has quietly expired should fail the suite as well as the gate. */
describe("the recorded dispositions in this repository", () => {
  const recorded = JSON.parse(readFileSync(new URL("../security-advisories.json", import.meta.url), "utf8"));

  it("every entry has an owner and a real, unexpired date", () => {
    expect(checkDispositions(recorded.accepted)).toEqual([]);
  });

  it("names owners as roles, never as people", () => {
    for (const e of recorded.accepted) {
      expect(e.owner).toMatch(/^[a-z][a-z0-9-]+$/);
    }
  });
});

import { describe, expect, it } from "vitest";
import { forwardedFrom } from "../src/lib/forwardClient";

/**
 * What this server passes on about the viewer.
 *
 * It used to copy `x-forwarded-for` through unchanged, and to accept
 * `x-real-ip` as a second spelling. The backend then trusted the leftmost entry
 * because the socket peer was private, so any direct caller could state any
 * identity it liked, rotate it per request, never be rate limited, and grow the
 * bucket map with forged keys.
 *
 * Only the nearest entry survives now. Everything to its left was written
 * further from the edge, which means a client could have written it.
 */
const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("forwardedFrom", () => {
  it("passes a single entry through", () => {
    expect(forwardedFrom(headers({ "x-forwarded-for": "203.0.113.9" }))).toEqual({
      "x-forwarded-for": "203.0.113.9",
    });
  });

  it("keeps only the nearest entry of a chain", () => {
    expect(forwardedFrom(headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.9" }))).toEqual({
      "x-forwarded-for": "203.0.113.9",
    });
  });

  it("discards a forged prefix however long it is", () => {
    const forged = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "203.0.113.9"].join(", ");
    expect(forwardedFrom(headers({ "x-forwarded-for": forged }))).toEqual({
      "x-forwarded-for": "203.0.113.9",
    });
  });

  it("forwards nothing when there is no chain", () => {
    // Absent, not invented. A fabricated address gives the backend a bucket key
    // that corresponds to nobody.
    expect(forwardedFrom(headers({}))).toEqual({});
  });

  it("ignores x-real-ip, which was a second way to state an identity", () => {
    expect(forwardedFrom(headers({ "x-real-ip": "203.0.113.9" }))).toEqual({});
  });

  it("forwards nothing for a chain that is empty or only separators", () => {
    for (const chain of ["", "   ", ",", " , , "]) {
      expect(forwardedFrom(headers({ "x-forwarded-for": chain }))).toEqual({});
    }
  });

  it("trims whitespace around the entry it keeps", () => {
    expect(forwardedFrom(headers({ "x-forwarded-for": "198.51.100.1 ,  203.0.113.9  " }))).toEqual({
      "x-forwarded-for": "203.0.113.9",
    });
  });
});

import { describe, expect, it } from "vitest";
import { recordIdParam } from "../src/lib/recordIdParam";

describe("recordIdParam", () => {
  it("accepts a hex ID and lower-cases it", () => {
    expect(recordIdParam("ABcd12")).toEqual({ id: "abcd12" });
  });

  it("reports a value that is not an ID as ignored", () => {
    expect(recordIdParam("zzz")).toEqual({ ignored: "zzz" });
  });

  it("uses the first value when the parameter repeats", () => {
    expect(recordIdParam(["ab12", "zz"])).toEqual({ id: "ab12" });
    expect(recordIdParam(["zz", "ab12"])).toEqual({ ignored: "zz" });
  });

  it("treats an absent or empty parameter as no filter", () => {
    expect(recordIdParam(undefined)).toEqual({});
    expect(recordIdParam("")).toEqual({});
    expect(recordIdParam([])).toEqual({});
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { JsonPanel } from "../src/components/ui/base/jsonpanel";

afterEach(cleanup);

const cbor = "84a4".repeat(400); // 1,600 hex characters

it("keeps a long value whole, in its own wrapped block under its key", () => {
  const value = { fee: "171013", transaction: { cborHex: cbor } };
  render(<JsonPanel title="Raw response" value={value} variant="full" filename="t.json" />);
  const body = screen.getByRole("region", { name: "Raw response body" });
  // Every character of the response is on screen; only the wrapping changed.
  const squash = (text: string) => text.replace(/\s+/g, "");
  expect(squash(body.textContent ?? "")).toBe(squash(JSON.stringify(value, null, 2)));
  const block = [...body.querySelectorAll("span.block")].find((el) =>
    el.textContent?.includes(cbor),
  );
  expect(block).toBeTruthy();
  expect(block!.className).toContain("break-all");
});

it("leaves short values on their own line", () => {
  render(<JsonPanel title="Raw response" value={{ fee: "171013" }} variant="full" />);
  const body = screen.getByRole("region", { name: "Raw response body" });
  expect(body.querySelectorAll("span.block")).toHaveLength(0);
});

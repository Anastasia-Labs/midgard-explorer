// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { IsoTimestamp } from "@midgard-explorer/contracts";
import { Bars, HourlyChart } from "../src/components/ui/domain/metrics/charts";

afterEach(cleanup);
const series = [
  { hour: IsoTimestamp.make("2026-09-14T14:00:00Z"), blocks: 0, transactions: 0 },
  { hour: IsoTimestamp.make("2026-09-15T14:00:00Z"), blocks: 0, transactions: 0 },
];

it("keeps a zero-valued plot without inventing a peak or invalid geometry", () => {
  render(<Bars series={series.map((row) => ({ ...row, blocks: 3 }))} measure="transactions" />);
  const chart = screen.getByRole("img");
  expect(chart.getAttribute("aria-label")).toContain("Peak 0.");
  expect(chart.querySelectorAll("rect")).toHaveLength(2);
  expect(chart.outerHTML).not.toMatch(/NaN|Infinity/);
});

it("uses the observed peak and distinguishes hourly intervals from elapsed hours", () => {
  render(<Bars series={[series[0]!, { ...series[1]!, blocks: 3 }]} measure="blocks" />);
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "2 hourly intervals. Peak 3.",
  );
});

it("distinguishes missing history from a measured zero", () => {
  render(<HourlyChart series={[]} measure="blocks" hours={24} />);
  expect(screen.getByText("No production history in this window.")).toBeDefined();
  expect(screen.queryByText(/No blocks or transactions recorded/)).toBeNull();
});

/** One measure each, with its own table, so neither needs a toggle. */
it("draws one measure and tables every hour of it", () => {
  render(
    <HourlyChart
      series={[{ ...series[0]!, blocks: 2, transactions: 5 }, series[1]!]}
      measure="transactions"
      hours={24}
    />,
  );
  expect(screen.getByText("Transactions per hour, last 24h")).toBeDefined();
  expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/^transactions per hour/);
  const table = screen.getByRole("table", { name: "Transactions per hour" });
  expect(table.querySelectorAll("tbody td")[0]?.textContent).toBe("5");
});

it("keeps its shape in the danger tone when the series did not arrive", () => {
  render(<HourlyChart series={null} measure="blocks" hours={24} />);
  const chart = screen.getByRole("img", { name: "Blocks per hour are unavailable." });
  expect(chart.querySelectorAll("rect.fill-danger")).toHaveLength(25);
});

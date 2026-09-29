import type { MetricsResponse } from "@midgard-explorer/contracts";
import { formatTimestamp } from "../../../../lib/format";

/**
 * The panel's drawing primitives.
 *
 * Hand-drawn SVG rather than a charting library: three shapes do not justify a
 * dependency, and inline SVG has no runtime to hydrate.
 */

/** Hourly production over the window, for one measure at a time.
 *
 * Bars rather than a line: production is a count per hour, and a line between
 * two counts implies values in between that were never measured. An hour with
 * no blocks draws as a marked gap, because that is the single most important
 * thing this chart can tell an operator.
 *
 * One measure at a time rather than two axes. Blocks and transactions are
 * different units, and putting them on a shared axis draws a relationship the
 * data does not contain. The toggle is the same control the UTxO flow uses, so
 * "these are two views of one thing" reads the same way in both places.
 *
 * Every value is in the table below the chart. That table is visually hidden
 * but present in the accessibility tree and reachable by keyboard, which is
 * what a chart owes a reader who cannot hover: the SVG `<title>` this used to
 * rely on was invisible on touch and unreliable in screen readers, the same
 * defect the hover-only `title=` attributes had. */
export function Bars({
  series,
  measure,
  caption,
}: {
  series: MetricsResponse["series"];
  measure: "blocks" | "transactions";
  /** Replaces the default "{measure} per hour" heading. */
  caption?: string;
}) {
  const values = series.map((s) => s[measure]);
  const peak = Math.max(...values, 0);
  const width = 100;
  const height = 34;
  const gap = 0.35;
  const barWidth = width / Math.max(series.length, 1) - gap;
  const empty = values.filter((v) => v === 0).length;
  const noun = measure === "blocks" ? "blocks" : "transactions";

  return (
    <>
      {/* Not a `figcaption`: that has to be a direct child of its `figure`,
          and the toggle puts a wrapper in between. */}
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="mg-overline">{caption ?? `${noun} per hour`}</span>
        <span className="mg-micro text-text-3">peak {peak}</span>
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-2 h-16 w-full"
        role="img"
        aria-label={`${noun} per hour across ${series.length} hourly intervals. Peak ${peak}. ${
          empty === 0 ? `No empty hours.` : `${empty} hourly intervals contain no ${noun}.`
        } Every hour's figure is in the table that follows.`}
      >
        {series.map((s, i) => {
          const v = s[measure];
          const h = (v / Math.max(peak, 1)) * height;
          const x = i * (barWidth + gap);
          return v === 0 ? (
            // An empty hour gets a floor mark rather than nothing, so a gap in
            // production is visibly a gap and not a rendering failure.
            <rect
              key={s.hour}
              x={x}
              y={height - 1}
              width={barWidth}
              height={1}
              className="fill-warning"
            />
          ) : (
            <rect
              key={s.hour}
              x={x}
              y={height - h}
              width={barWidth}
              height={h}
              className="fill-accent/70"
            />
          );
        })}
      </svg>
    </>
  );
}

/**
 * One measure per hour across the window, drawn inside the list it describes:
 * blocks above the latest blocks, transactions above the latest transactions.
 * Each carries its own table of every hour for a reader who cannot see bars.
 */
export function HourlyChart({
  series,
  measure,
  hours,
}: {
  series: MetricsResponse["series"] | null;
  measure: "blocks" | "transactions";
  /** The window the series covers, for the heading. */
  hours: number;
}) {
  const noun = measure === "blocks" ? "Blocks" : "Transactions";
  const caption = `${noun} per hour, last ${hours}h`;
  if (series === null) {
    // No history arrived. The chart keeps its shape: a floor mark for every
    // hour, in the danger tone rather than the warning tone of an empty hour,
    // so it reads as figures that failed to load and not as a quiet day.
    const bars = hours + 1;
    const barWidth = 100 / bars - 0.35;
    return (
      <figure className="border-b border-border px-4 py-3">
        <p className="mg-overline">{caption}</p>
        <svg
          viewBox="0 0 100 34"
          preserveAspectRatio="none"
          className="mt-2 h-16 w-full"
          role="img"
          aria-label={`${noun} per hour are unavailable.`}
        >
          {Array.from({ length: bars }, (_, i) => (
            <rect
              key={i}
              x={i * (barWidth + 0.35)}
              y={33}
              width={barWidth}
              height={1}
              className="fill-danger"
            />
          ))}
        </svg>
      </figure>
    );
  }
  if (series.length === 0) {
    return (
      <p className="border-b border-border px-4 py-6 text-center mg-caption text-text-3">
        No production history in this window.
      </p>
    );
  }

  return (
    <figure className="border-b border-border px-4 py-3">
      <Bars series={series} measure={measure} caption={caption} />
      {/* The wrapper carries `sr-only`, not the table. A table box takes its
          min-content width whatever width is set on it, so `sr-only` on the
          table itself left a 359px element on a 320px page. */}
      <div className="sr-only">
        <table>
          <caption>{noun} per hour</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">{noun}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.hour}>
                <th scope="row">{formatTimestamp(s.hour)}</th>
                <td>{s[measure]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

import type { MetricsResponse, Percentile } from "@midgard-explorer/contracts";
import { cn, formatTimestamp, groupThousands } from "../../../lib/format";
import type { GlossaryTerm } from "../../../lib/glossary";
import { FieldLabel } from "../infotip";
import { StatusBadge } from "../status";
import { ViewToggle } from "../viewtoggle";
import { THIN_SAMPLE } from "./model";

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
}: {
  series: MetricsResponse["series"];
  measure: "blocks" | "transactions";
}) {
  const values = series.map((s) => s[measure]);
  const peak = Math.max(...values, 1);
  const width = 100;
  const height = 34;
  const gap = 0.35;
  const barWidth = width / series.length - gap;
  const empty = values.filter((v) => v === 0).length;
  const noun = measure === "blocks" ? "blocks" : "transactions";

  return (
    <>
      {/* Not a `figcaption`: that has to be a direct child of its `figure`,
          and the toggle puts a wrapper in between. */}
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="mg-overline">{noun} per hour</span>
        <span className="mg-micro text-text-3">
          peak {peak}
          {empty > 0 ? (
            <span className="ml-1.5 text-warning">
              · {empty} {empty === 1 ? "hour" : "hours"} with no {noun}
            </span>
          ) : null}
        </span>
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-2 h-16 w-full"
        role="img"
        aria-label={`${noun} per hour across ${series.length} hours. Peak ${peak}. ${
          empty === 0 ? `No empty hours.` : `${empty} hours produced no ${noun}.`
        } Every hour's figure is in the table that follows.`}
      >
        {series.map((s, i) => {
          const v = s[measure];
          const h = (v / peak) * height;
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
      <p className="mt-1 flex justify-between text-micro text-text-3">
        <span>{formatTimestamp(series[0]!.hour)}</span>
        <span>{formatTimestamp(series[series.length - 1]!.hour)}</span>
      </p>
    </>
  );
}

export function ProductionChart({ series }: { series: MetricsResponse["series"] }) {
  if (series.length === 0) {
    return (
      <p className="px-4 py-6 text-center mg-caption text-text-3">
        No production history in this window.
      </p>
    );
  }

  return (
    <figure className="px-4 pt-3 pb-2">
      <ViewToggle
        label="Chart measure"
        param="chart"
        views={[
          { id: "blocks", label: "Blocks", content: <Bars series={series} measure="blocks" /> },
          {
            id: "transactions",
            label: "Transactions",
            content: <Bars series={series} measure="transactions" />,
          },
        ]}
      />
      {/* The wrapper carries `sr-only`, not the table. A table box takes its
          min-content width whatever width is set on it, so `sr-only` on the
          table itself left a 359px element on a 320px page. */}
      <div className="sr-only">
        <table>
          <caption>Blocks and transactions per hour</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col">Blocks</th>
              <th scope="col">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.hour}>
                <th scope="row">{formatTimestamp(s.hour)}</th>
                <td>{s.blocks}</td>
                <td>{s.transactions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Proportional bar for a set of statuses, so an unrecognized code is visible
 * as its own share rather than folded into a bucket the explorer invented. */
export function StatusBar({ counts }: { counts: readonly { status: string; count: number }[] }) {
  const total = counts.reduce((n, c) => n + c.count, 0);
  if (total === 0) return null;
  return (
    <div className="px-4 py-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
        {counts.map((c) => (
          <span
            key={c.status}
            className={cn(
              "h-full",
              c.status === "finalized" || c.status === "accepted" || c.status === "consumed"
                ? "bg-success"
                : c.status === "abandoned" || c.status === "rejected"
                  ? "bg-danger"
                  : "bg-info/70",
            )}
            style={{ width: `${(c.count / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {counts.map((c) => (
          <li key={c.status} className="flex items-center gap-1.5 mg-micro">
            <StatusBadge status={c.status} />
            <span className="tabular-nums text-text-2">{groupThousands(String(c.count))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

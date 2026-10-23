import Link from "next/link";
import { BlockRef } from "../../components/ui/domain/blockref";
import type { Metadata } from "next";
import { Identifier } from "../../components/ui/domain/identifier";
import { StatusCell } from "../../components/ui/domain/status";
import { ListTools } from "../../components/ui/base/listtools";
import { Count, PageHeader } from "../../components/ui/base/layout";
import { DataTable, Pagination } from "../../components/ui/base/table";
import { Timestamp } from "../../components/ui/base/timestamp";
import { HourlyChart } from "../../components/ui/domain/metrics";
import { ApiError, api } from "../../lib/api";
import { countNoun, groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { ARCHIVE_FILTER_REASON, readsArchive } from "../../lib/evidence";
import { filterOptionsFor } from "../../lib/status-registry";
import { listErrorMessage } from "../../lib/serverErrors";
import { viewerInit } from "../../lib/viewerInit";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";
import { StateQueue } from "../../features/block/StateQueue";
import { ListError } from "../../components/ui/base/listerror";

export const metadata: Metadata = {
  title: "Blocks",
  description: "Browse Midgard blocks.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Blocks" }];

export default async function BlocksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const status = params.status;

  // The hourly chart reads metrics on the side: when that call fails the chart
  // shows its unavailable state and the list is untouched.
  const init = await viewerInit();
  const [pageResult, metricsResult, sourceResult, queueResult] = await Promise.allSettled([
    api.blocksPage(page, status, init),
    api.metrics(init),
    api.source(init),
    api.stateQueue(init),
  ]);
  if (pageResult.status === "rejected") {
    return (
      <ListError
        crumbs={CRUMBS}
        entity="block"
        title="Blocks"
        message={listErrorMessage(pageResult.reason)}
      />
    );
  }
  const data = pageResult.value;
  const metrics = metricsResult.status === "fulfilled" ? metricsResult.value : null;
  const archive = sourceResult.status === "fulfilled" && readsArchive(sourceResult.value);
  const queue = queueResult.status === "fulfilled" ? queueResult.value : null;
  const queueUnavailable =
    queueResult.status === "rejected" &&
    queueResult.reason instanceof ApiError &&
    queueResult.reason.category === "unavailable";

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="block"
        title="Blocks"
        meta={
          <span>
            <strong className="font-semibold text-text tabular-nums">
              {groupThousands(String(data.total))}
            </strong>{" "}
            {countNoun(data.total, "block", "blocks")}
          </span>
        }
      />
      <StateQueue initial={queue} unavailable={queueUnavailable} />
      <ListTools
        filterKey="status"
        filterLabel="L1 settlement"
        options={filterOptionsFor("finalization")}
        filterUnavailable={archive ? ARCHIVE_FILTER_REASON : undefined}
        rows={data.rows}
        filename={`midgard-blocks-page-${page}${status ? `-${status}` : ""}`}
        columns={[
          { header: "height", path: "height" },
          { header: "header_hash", path: "header_hash" },
          { header: "l2_transactions", path: "header_l2_transaction_count" },
          { header: "deposits", path: "header_deposit_count" },
          { header: "withdrawals", path: "header_withdrawal_count" },
          { header: "forced_transactions", path: "header_forced_transaction_count" },
          { header: "finalization_status", path: "finalization_status" },
          { header: "block_start_time", path: "block_start_time" },
          { header: "block_end_time", path: "block_end_time" },
        ]}
      />

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <HourlyChart
          series={metrics?.series ?? null}
          measure="blocks"
          hours={metrics?.window.hours ?? 24}
        />
        <DataTable
          caption="Midgard blocks, newest first"
          columns={[
            {
              header: "Block",
              cell: (r) => <BlockRef height={r.height} hash={r.header_hash} />,
            },
            {
              header: "Header hash",
              // A block with no number is already named by its hash in the
              // first column.
              cell: (r) =>
                r.height === null ? (
                  <span className="text-text-3">—</span>
                ) : (
                  <Identifier value={r.header_hash} href={`/block/${r.header_hash}`} />
                ),
              hideBelow: "md",
            },
            {
              header: "Transactions",
              cell: (r) => <Count value={r.header_l2_transaction_count} />,
              align: "right",
            },
            {
              header: "Deposits",
              cell: (r) => <Count value={r.header_deposit_count} />,
              align: "right",
            },
            {
              header: "Withdrawals",
              cell: (r) => <Count value={r.header_withdrawal_count} />,
              align: "right",
              hideBelow: "lg",
            },
            {
              header: "Forced",
              cell: (r) => <Count value={r.header_forced_transaction_count} />,
              align: "right",
              hideBelow: "lg",
            },
            {
              header: "L1 settlement",
              cell: (r) =>
                r.finalization_status === null ? (
                  <span className="text-text-3">Not yet recorded</span>
                ) : (
                  <StatusCell status={r.finalization_status} />
                ),
              hideBelow: "sm",
            },
            {
              header: "Time",
              cell: (r) => <Timestamp iso={r.block_end_time} />,
              align: "right",
              hideBelow: "md",
            },
          ]}
          mobileRow={(r) => ({
            primary: <BlockRef height={r.height} hash={r.header_hash} />,
            status:
              r.finalization_status === null ? null : <StatusCell status={r.finalization_status} />,
            meta: <Timestamp iso={r.block_end_time} />,
            secondary: (
              <span className="tabular-nums">
                {r.header_l2_transaction_count} tx · {r.header_deposit_count}{" "}
                {countNoun(r.header_deposit_count ?? 0, "deposit", "deposits")} ·{" "}
                {r.header_withdrawal_count}{" "}
                {countNoun(r.header_withdrawal_count ?? 0, "withdrawal", "withdrawals")} ·{" "}
                {r.header_forced_transaction_count} forced
              </span>
            ),
            details: [
              {
                label: "Header hash",
                value: <Identifier value={r.header_hash} head={8} tail={6} />,
              },
            ],
          })}
          rows={data.rows}
          keyOf={(r) => r.header_hash}
          emptyTitle={status ? "No matching blocks" : "No blocks yet"}
          {...(status
            ? {
                emptyAction: (
                  <Link href="/blocks" className="text-link hover:text-link-hover hover:underline">
                    Clear filter
                  </Link>
                ),
              }
            : { emptyHint: "Blocks appear once the node's operator starts committing." })}
        />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) =>
            `/blocks?page=${p}${status ? `&status=${encodeURIComponent(status)}` : ""}`
          }
        />
      </section>
    </>
  );
}

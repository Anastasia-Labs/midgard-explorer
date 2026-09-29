import Link from "next/link";
import type { Metadata } from "next";
import { Identifier } from "../../components/ui/domain/identifier";
import { StatusCell } from "../../components/ui/domain/status";
import { ListTools } from "../../components/ui/base/listtools";
import { Count, PageHeader } from "../../components/ui/base/layout";
import { DataTable, Pagination } from "../../components/ui/base/table";
import { Timestamp } from "../../components/ui/base/timestamp";
import { api } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { legendFor } from "../../lib/status-registry";
import { listErrorMessage } from "../../lib/serverErrors";
import { viewerInit } from "../../lib/viewerInit";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";
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

  let data;
  try {
    data = await api.blocksPage(page, status, await viewerInit());
  } catch (e) {
    return (
      <ListError crumbs={CRUMBS} entity="block" title="Blocks" message={listErrorMessage(e)} />
    );
  }

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
            total blocks
          </span>
        }
      />
      <ListTools
        filterKey="status"
        filterLabel="L1 settlement"
        options={legendFor("finalization").map((e) => ({ value: e.code, label: e.label }))}
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
                {r.header_l2_transaction_count} tx · {r.header_deposit_count} deposits ·{" "}
                {r.header_withdrawal_count} withdrawals · {r.header_forced_transaction_count} forced
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

/** A block by its number, or by its header hash when it has none. */
function BlockRef({ height, hash }: { height: number | null; hash: string }) {
  if (height === null) return <Identifier value={hash} href={`/block/${hash}`} head={8} tail={6} />;
  return (
    <Link
      href={`/block/${hash}`}
      className="font-mono font-semibold tabular-nums text-link hover:text-link-hover hover:underline"
    >
      Block #{height}
    </Link>
  );
}

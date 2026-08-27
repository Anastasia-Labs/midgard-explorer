import type { Metadata } from "next";
import Link from "next/link";
import { ValueCell } from "../../components/ui/amount";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Identifier } from "../../components/ui/identifier";
import { ListTools } from "../../components/ui/listtools";
import { PageError } from "../../components/ui/pageerror";
import { StatusCell } from "../../components/ui/status";
import { PageHeader } from "../../components/ui/primitives";
import { DataTable, DecodeWarn, Pagination } from "../../components/ui/table";
import { Timestamp } from "../../components/ui/timestamp";
import { api } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { legendFor } from "../../lib/status-registry";
import { listErrorMessage } from "../../lib/serverErrors";
import { viewerInit } from "../../lib/viewerInit";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Browse Midgard transactions.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Transactions" }];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const status = params.status;

  let data;
  try {
    data = await api.txsPage(page, status, await viewerInit());
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="transaction" title="Transactions" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="transaction"
        title="Transactions"
        subtitle="Transactions processed by the Midgard ledger, newest first. Open one for its journey, ledger equation, and raw data."
        meta={
          <span>
            <strong className="font-semibold text-text tabular-nums">
              {groupThousands(String(data.total))}
            </strong>{" "}
            total transactions
          </span>
        }
      />
      <ListTools
        filterKey="status"
        filterLabel="L1 settlement"
        options={legendFor("finalization").map((e) => ({ value: e.code, label: e.label }))}
        rows={data.rows}
        filename={`midgard-transactions-page-${page}${status ? `-${status}` : ""}`}
        columns={[
          { header: "tx_id", path: "tx_id" },
          { header: "height", path: "height" },
          { header: "header_hash", path: "header_hash" },
          { header: "status", path: "status" },
          { header: "finalization_status", path: "finalization_status" },
          { header: "fee", path: "transaction.fee" },
          { header: "time", path: "time_stamp_tz" },
        ]}
      />

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Midgard transactions, newest first"
          columns={[
            {
              header: "Transaction",
              cell: (r) => (
                <span className="inline-flex items-center gap-2">
                  <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} />
                  <DecodeWarn error={r.decodeError} />
                </span>
              ),
            },
            {
              header: "Status",
              cell: (r) => <StatusCell status={r.status} />,
            },
            {
              header: "Block",
              cell: (r) => (
                <Link
                  href={`/block/${r.header_hash}`}
                  className="font-mono font-semibold tabular-nums text-link hover:text-link-hover hover:underline"
                >
                  {r.height === null ? `${r.header_hash.slice(0, 8)}…` : `#${r.height}`}
                </Link>
              ),
              hideBelow: "sm",
            },
            {
              header: "In / out",
              cell: (r) =>
                r.transaction ? (
                  <span className="tabular-nums text-text-2">
                    {r.transaction.inputs.length} → {r.transaction.outputs.length}
                  </span>
                ) : (
                  <span className="text-text-3">Unknown</span>
                ),
              hideBelow: "lg",
              align: "right",
            },
            {
              header: "Fee",
              cell: (r) =>
                r.transaction ? (
                  <ValueCell value={{ lovelace: r.transaction.fee, assets: {} }} />
                ) : (
                  "Unknown"
                ),
              hideBelow: "md",
              align: "right",
            },
            {
              header: "Time",
              cell: (r) => <Timestamp iso={r.time_stamp_tz} />,
              hideBelow: "md",
              align: "right",
            },
          ]}
          mobileRow={(r) => ({
            primary: (
              <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={6} />
            ),
            status: (
              <span className="inline-flex items-center gap-1.5">
                <StatusCell status={r.status} />
                {r.decodeError ? <DecodeWarn error={r.decodeError} /> : null}
              </span>
            ),
            meta: <Timestamp iso={r.time_stamp_tz} />,
            secondary: r.transaction ? (
              <ValueCell value={{ lovelace: r.transaction.fee, assets: {} }} />
            ) : null,
            details: [
              {
                label: "Block",
                value: (
                  <Link href={`/block/${r.header_hash}`} className="tabular-nums text-link">
                    {r.height === null ? `${r.header_hash.slice(0, 8)}…` : `#${r.height}`}
                  </Link>
                ),
              },
            ],
          })}
          rows={data.rows}
          keyOf={(r) => r.tx_id}
          emptyTitle="No transactions yet"
          emptyHint="Submitted transactions appear here as the node processes them."
        />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) =>
            `/transactions?page=${p}${status ? `&status=${encodeURIComponent(status)}` : ""}`
          }
        />
      </section>
    </>
  );
}

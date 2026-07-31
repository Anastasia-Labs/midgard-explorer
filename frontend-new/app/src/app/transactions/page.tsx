import type { Metadata } from "next";
import { ValueCell } from "../../components/ui/amount";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Identifier } from "../../components/ui/identifier";
import { PageError } from "../../components/ui/pageerror";
import { PageHeader } from "../../components/ui/primitives";
import { DataTable, DecodeWarn, Pagination } from "../../components/ui/table";
import { Timestamp } from "../../components/ui/timestamp";
import { api } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Browse Midgard L2 transactions.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Transactions" }];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);

  let data;
  try {
    data = await api.txsPage(page);
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Transactions" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Transactions"
        subtitle="Transactions processed by the Midgard L2 ledger, newest first. Open one for its lifecycle, UTxO flow, and raw data."
        meta={
          <span>
            <strong className="font-semibold text-text tabular-nums">
              {groupThousands(String(data.total))}
            </strong>{" "}
            total transactions
          </span>
        }
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
              header: "Block",
              cell: (r) => <Identifier value={r.header_hash} href={`/block/${r.header_hash}`} />,
              hideBelow: "sm",
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
            status: r.decodeError ? <DecodeWarn error={r.decodeError} /> : null,
            meta: <Timestamp iso={r.time_stamp_tz} />,
            secondary: r.transaction ? (
              <ValueCell value={{ lovelace: r.transaction.fee, assets: {} }} />
            ) : null,
            details: [
              {
                label: "Block",
                value: (
                  <Identifier
                    value={r.header_hash}
                    href={`/block/${r.header_hash}`}
                    head={8}
                    tail={6}
                  />
                ),
              },
            ],
          })}
          rows={data.rows}
          keyOf={(r) => r.tx_id}
          emptyTitle="No transactions yet"
        />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) => `/transactions?page=${p}`}
        />
      </section>
    </>
  );
}

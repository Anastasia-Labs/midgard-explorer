import type { Metadata } from "next";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Icon } from "../../components/ui/icons";
import { Identifier } from "../../components/ui/identifier";
import { L1TxLink } from "../../components/ui/l1link";
import { StatusLegend } from "../../components/ui/legend";
import { PageError } from "../../components/ui/pageerror";
import { L1L2Badge, PageHeader } from "../../components/ui/primitives";
import { StatusBadge, StatusCell } from "../../components/ui/status";
import { DataTable, Pagination } from "../../components/ui/table";
import { Timestamp } from "../../components/ui/timestamp";
import { api } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";

export const metadata: Metadata = {
  title: "Forced transactions",
  description: "L1-forced transaction orders processed by Midgard.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Forced transactions" }];

export default async function ForcedTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);

  let data;
  try {
    data = await api.forcedTxsPage(page);
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Forced transactions" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Forced transactions"
        subtitle="Transaction orders escrowed on Cardano L1 that the Midgard operator is obliged to include."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <L1L2Badge layer="L1" />
              <Icon name="arrowRight" size={12} className="text-text-3" />
              <L1L2Badge layer="L2" />
            </span>
            <span>
              <strong className="font-semibold text-text tabular-nums">
                {groupThousands(String(data.total))}
              </strong>{" "}
              total orders
            </span>
          </>
        }
      />
      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Forced transaction orders, newest first"
          columns={[
            {
              header: "Order",
              cell: (r) => <Identifier value={r.tx_order_id} />,
            },
            {
              header: "L1 tx",
              headerNote: "on Cardano",
              cell: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <L1TxLink hash={r.tx_order_l1_tx_hash} />
                  <span className="font-mono text-[11px] text-text-3">
                    #{r.tx_order_l1_output_index}
                    <span className="sr-only"> (L1 output index)</span>
                  </span>
                </span>
              ),
              hideBelow: "md",
            },
            {
              header: "L2 tx",
              cell: (r) => <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} />,
              hideBelow: "sm",
            },
            {
              header: "Operator validity",
              cell: (r) => <StatusBadge status={r.operator_validity} />,
              hideBelow: "sm",
            },
            {
              header: "Status",
              cell: (r) => <StatusCell status={r.status} />,
            },
            {
              header: "Projected block",
              cell: (r) =>
                r.projected_header_hash ? (
                  <Identifier
                    value={r.projected_header_hash}
                    href={`/block/${r.projected_header_hash}`}
                  />
                ) : (
                  "Not yet"
                ),
              hideBelow: "lg",
            },
            {
              header: "Included",
              cell: (r) => <Timestamp iso={r.inclusion_time} />,
              hideBelow: "md",
              align: "right",
            },
          ]}
          mobileRow={(r) => ({
            primary: (
              <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={6} />
            ),
            status: <StatusCell status={r.status} />,
            meta: <Timestamp iso={r.inclusion_time} />,
            secondary: <StatusBadge status={r.operator_validity} />,
            details: [
              { label: "Order ID", value: <Identifier value={r.tx_order_id} head={8} tail={6} /> },
              {
                label: "L1 tx",
                value: (
                  <span className="inline-flex items-center gap-1.5">
                    <L1TxLink hash={r.tx_order_l1_tx_hash} />
                    <span className="font-mono text-[11px] text-text-3">
                      #{r.tx_order_l1_output_index}
                    </span>
                  </span>
                ),
              },
              {
                label: "Projected block",
                value: r.projected_header_hash ? (
                  <Identifier
                    value={r.projected_header_hash}
                    href={`/block/${r.projected_header_hash}`}
                    head={8}
                    tail={6}
                  />
                ) : (
                  "Not yet"
                ),
              },
            ],
          })}
          rows={data.rows}
          keyOf={(r) => r.tx_order_id}
          emptyTitle="No forced transactions yet"
          emptyHint="These appear when a user escrows an order on Cardano L1 for the operator to include."
        />
        <StatusLegend kinds={["bridge_status", "forced_validity"]} />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) => `/forced-transactions?page=${p}`}
        />
      </section>
    </>
  );
}

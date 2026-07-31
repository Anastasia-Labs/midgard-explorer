import type { Metadata } from "next";
import { ValueCell } from "../../components/ui/amount";
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
  title: "Withdrawals",
  description: "L2 → L1 withdrawals from Midgard.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Withdrawals" }];

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);

  let data;
  try {
    data = await api.withdrawalsPage(page);
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Withdrawals" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Withdrawals"
        subtitle="Funds leaving the Midgard L2 ledger back to Cardano L1. Validity and lifecycle status are separate checks."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <L1L2Badge layer="L2" />
              <Icon name="arrowRight" size={12} className="text-text-3" />
              <L1L2Badge layer="L1" />
            </span>
            <span>
              <strong className="font-semibold text-text tabular-nums">
                {groupThousands(String(data.total))}
              </strong>{" "}
              total withdrawals
            </span>
          </>
        }
      />
      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Withdrawals from Midgard to Cardano L1"
          columns={[
            {
              header: "L1 tx",
              cell: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <L1TxLink hash={r.withdrawal_l1_tx_hash} />
                  <span className="font-mono text-[11px] text-text-3" title="L1 output index">
                    #{r.withdrawal_l1_output_index}
                  </span>
                </span>
              ),
            },
            {
              header: "L2 outref",
              cell: (r) => <Identifier value={r.l2_outref} href={`/transaction/${r.l2_outref}`} />,
              hideBelow: "lg",
            },
            {
              header: "L1 address",
              cell: (r) => <Identifier value={r.l1_address} head={8} tail={6} />,
              hideBelow: "lg",
            },
            {
              header: "L2 value",
              cell: (r) =>
                r.l2_value ? (
                  <ValueCell value={r.l2_value} />
                ) : (
                  <span className="text-text-3" title="This row could not be decoded.">
                    undecodable
                  </span>
                ),
              align: "right",
            },
            {
              header: "Validity",
              cell: (r) =>
                r.validity === null ? (
                  <span className="text-text-3" title="Not yet validated by the node.">
                    Not yet
                  </span>
                ) : (
                  <StatusBadge status={r.validity} />
                ),
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
            primary: <Identifier value={r.l1_address} head={10} tail={6} />,
            status: <StatusCell status={r.status} />,
            meta: <Timestamp iso={r.inclusion_time} />,
            secondary: r.l2_value ? (
              <ValueCell value={r.l2_value} />
            ) : (
              <span className="text-text-3">undecodable</span>
            ),
            details: [
              {
                label: "L1 tx",
                value: (
                  <span className="inline-flex items-center gap-1.5">
                    <L1TxLink hash={r.withdrawal_l1_tx_hash} />
                    <span className="font-mono text-[11px] text-text-3">
                      #{r.withdrawal_l1_output_index}
                    </span>
                  </span>
                ),
              },
              {
                label: "L2 outref",
                value: (
                  <Identifier
                    value={r.l2_outref}
                    href={`/transaction/${r.l2_outref}`}
                    head={8}
                    tail={6}
                  />
                ),
              },
              {
                label: "Validity",
                value:
                  r.validity === null ? (
                    <span className="text-text-3">Not validated yet</span>
                  ) : (
                    <StatusBadge status={r.validity} />
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
          keyOf={(r) => r.event_id}
          emptyTitle="No withdrawals yet"
        />
        <StatusLegend kinds={["bridge_status", "withdrawal_validity"]} />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) => `/withdrawals?page=${p}`}
        />
      </section>
    </>
  );
}

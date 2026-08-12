import type { Metadata } from "next";
import { ValueCell } from "../../components/ui/amount";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Icon } from "../../components/ui/icons";
import { Identifier } from "../../components/ui/identifier";
import { L1TxLink } from "../../components/ui/l1link";
import { InfoTip } from "../../components/ui/infotip";
import { StatusLegend } from "../../components/ui/legend";
import { PageError } from "../../components/ui/pageerror";
import { L1L2Badge, PageHeader } from "../../components/ui/primitives";
import { StatusCell } from "../../components/ui/status";
import { DataTable, Pagination } from "../../components/ui/table";
import { Timestamp } from "../../components/ui/timestamp";
import { api } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";
import { AddressLink } from "../../components/ui/address";
import { viewerInit } from "../../lib/viewerInit";

export const metadata: Metadata = {
  title: "Deposits",
  description: "L1 → L2 deposits into Midgard.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Deposits" }];

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);

  let data;
  try {
    data = await api.depositsPage(page, await viewerInit());
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="deposit" title="Deposits" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="deposit"
        title="Deposits"
        subtitle="Funds locked on Cardano L1 and credited to an address on the Midgard ledger."
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
              total deposits
            </span>
          </>
        }
      />
      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Deposits from Cardano L1 into Midgard"
          columns={[
            {
              header: "L1 tx",
              cell: (r) => <L1TxLink hash={r.deposit_l1_tx_hash} destination="midgard" />,
            },
            {
              header: "L2 ledger tx",
              cell: (r) => (
                <Identifier value={r.ledger_tx_id} href={`/transaction/${r.ledger_tx_id}`} />
              ),
              hideBelow: "md",
            },
            {
              header: "L2 recipient",
              cell: (r) => <AddressLink address={r.ledger_address} />,
              hideBelow: "sm",
            },
            {
              header: "Value",
              cell: (r) =>
                r.value ? (
                  <ValueCell value={r.value} />
                ) : (
                  <span className="inline-flex items-center gap-1 text-text-3">
                    undecodable
                    <InfoTip
                      subject="undecodable value"
                      term="partialDecode"
                      explain="This deposit's value is one of the unavailable fields."
                    />
                  </span>
                ),
              align: "right",
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
            primary: <AddressLink address={r.ledger_address} head={10} tail={6} />,
            status: <StatusCell status={r.status} />,
            meta: <Timestamp iso={r.inclusion_time} />,
            secondary: r.value ? (
              <ValueCell value={r.value} />
            ) : (
              <span className="text-text-3">undecodable</span>
            ),
            details: [
              { label: "L1 tx", value: <L1TxLink hash={r.deposit_l1_tx_hash} destination="midgard" /> },
              {
                label: "L2 ledger tx",
                value: (
                  <Identifier
                    value={r.ledger_tx_id}
                    href={`/transaction/${r.ledger_tx_id}`}
                    head={8}
                    tail={6}
                  />
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
          emptyTitle="No deposits yet"
          emptyHint="Deposits appear once funds are locked on Cardano L1 for an address on this network."
        />
        <StatusLegend kinds={["bridge_status"]} />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) => `/deposits?page=${p}`}
        />
      </section>
    </>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { ValueCell } from "../../components/ui/domain/amount";
import { Icon } from "../../components/ui/base/icons";
import { Identifier } from "../../components/ui/domain/identifier";
import { L1TxLink } from "../../components/ui/domain/l1link";
import { StatusLegend } from "../../components/ui/base/legend";
import { L1L2Badge, PageHeader } from "../../components/ui/base/layout";
import { StatusCell } from "../../components/ui/domain/status";
import { DataTable, Pagination } from "../../components/ui/base/table";
import { Timestamp } from "../../components/ui/base/timestamp";
import { api } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";
import { AddressLink } from "../../components/ui/domain/address";
import { viewerInit } from "../../lib/viewerInit";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";
import { ListError } from "../../components/ui/base/listerror";

export const metadata: Metadata = {
  title: "Deposits",
  description: "Deposits from Cardano into Midgard.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Deposits" }];

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; id?: string }>;
}) {
  const query = await searchParams;
  const page = parsePage(query.page);
  const id = /^[0-9a-f]+$/i.test(query.id ?? "") ? query.id?.toLowerCase() : undefined;

  let data;
  const init = await viewerInit();
  try {
    data = await api.depositsPage(page, init, id);
  } catch (e) {
    return (
      <ListError crumbs={CRUMBS} entity="deposit" title="Deposits" message={listErrorMessage(e)} />
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="deposit"
        title="Deposits"
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
          caption="Deposits from Cardano into Midgard"
          columns={[
            {
              header: "Deposit on Cardano",
              cell: (r) => (
                <L1TxLink hash={r.deposit_l1_tx_hash} destination="cardano" marker={false} />
              ),
            },
            {
              header: "Ledger entry ID",
              headerNote: "deposit-derived, not an L2 transaction",
              cell: (r) => <Identifier value={r.ledger_tx_id} />,
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
                  <span className="text-text-3">undecodable</span>
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
              {
                label: "L1 tx",
                value: <L1TxLink hash={r.deposit_l1_tx_hash} destination="cardano" />,
              },
              {
                label: "Ledger entry ID",
                value: <Identifier value={r.ledger_tx_id} head={8} tail={6} />,
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
          emptyTitle={id ? "No matching deposit" : "No deposits yet"}
          {...(id
            ? {
                emptyAction: (
                  <Link
                    href="/deposits"
                    className="text-link hover:text-link-hover hover:underline"
                  >
                    Clear filter
                  </Link>
                ),
              }
            : {
                emptyHint:
                  "Deposits appear once funds are locked on Cardano for an address on this network.",
              })}
        />
        <StatusLegend kinds={["bridge_status"]} />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) => `/deposits?page=${p}${id ? `&id=${id}` : ""}`}
        />
      </section>
    </>
  );
}

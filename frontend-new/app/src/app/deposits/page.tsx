import type { Metadata } from "next";
import { ValueCell } from "../../components/ui/domain/amount";
import { Icon } from "../../components/ui/base/icons";
import { Identifier } from "../../components/ui/domain/identifier";
import { L1TxLink } from "../../components/ui/domain/l1link";
import { InfoTip } from "../../components/ui/base/infotip";
import { StatusLegend } from "../../components/ui/base/legend";
import { Callout, L1L2Badge, PageHeader } from "../../components/ui/base/layout";
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
  const l1Observations = await api.l1Deposits(100, init).catch(() => []);
  const l1ByTx = new Map(l1Observations.map((row) => [row.txHash, row]));
  const nodeTxs = new Set(data.rows.map((row) => row.deposit_l1_tx_hash));
  const unmatchedL1 = l1Observations.filter((row) => !nodeTxs.has(row.txHash));

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="deposit"
        title="Deposits"
        subtitle="Funds deposited from Cardano into Midgard."
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
              header: "Deposit origin",
              cell: (r) => <L1TxLink hash={r.deposit_l1_tx_hash} destination="cardano" />,
            },
            {
              header: "Ledger entry ID",
              headerNote: "deposit-derived, not an L2 transaction",
              cell: (r) => <Identifier value={r.ledger_tx_id} />,
              hideBelow: "md",
            },
            {
              header: "Cardano source",
              cell: (r) => {
                const addresses = l1ByTx.get(r.deposit_l1_tx_hash)?.fundingAddresses ?? [];
                return addresses.length === 0 ? (
                  <span className="text-text-3">Not indexed</span>
                ) : addresses.length === 1 ? (
                  <AddressLink address={addresses[0]!} chain="cardano" head={10} tail={8} />
                ) : (
                  <span>{addresses.length} funding addresses</span>
                );
              },
              hideBelow: "2xl",
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
              {
                label: "L1 tx",
                value: <L1TxLink hash={r.deposit_l1_tx_hash} destination="cardano" />,
              },
              {
                label: "Ledger entry ID",
                value: <Identifier value={r.ledger_tx_id} head={8} tail={6} />,
              },
              {
                label: "Cardano source",
                value: (() => {
                  const addresses = l1ByTx.get(r.deposit_l1_tx_hash)?.fundingAddresses ?? [];
                  return addresses.length === 0 ? (
                    "Not indexed"
                  ) : addresses.length === 1 ? (
                    <AddressLink address={addresses[0]!} chain="cardano" head={8} tail={6} />
                  ) : (
                    `${addresses.length} addresses`
                  );
                })(),
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
          emptyHint="Deposits appear once funds are locked on Cardano for an address on this network."
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
      <details className="mt-4 rounded-lg border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-2">
          Cardano observations ({l1Observations.length})
        </summary>
        {unmatchedL1.length > 0 ? (
          <div className="border-t border-border p-4">
            <Callout tone="neutral" title="Additional Cardano observations">
              These are not present on the current node-results page and remain visible from the
              explorer-owned L1 index.
            </Callout>
            <ul className="mt-3 space-y-2">
              {unmatchedL1.map((row) => (
                <li
                  key={`${row.txHash}-${row.outputIndex}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <L1TxLink hash={row.txHash} destination="cardano" />
                  <span className="mg-caption text-text-3">
                    {row.eventType} · output #{row.outputIndex}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="border-t border-border px-4 py-3 text-sm text-text-3">
            All indexed observations match the current node records.
          </p>
        )}
      </details>
    </>
  );
}

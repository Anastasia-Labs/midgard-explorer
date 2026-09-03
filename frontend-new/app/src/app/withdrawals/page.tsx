import type { Metadata } from "next";
import { ValueCell } from "../../components/ui/domain/amount";
import { Icon } from "../../components/ui/base/icons";
import { AddressLink } from "../../components/ui/domain/address";
import { Identifier } from "../../components/ui/domain/identifier";
import { L1TxLink } from "../../components/ui/domain/l1link";
import { InfoTip } from "../../components/ui/base/infotip";
import { StatusLegend } from "../../components/ui/base/legend";
import { L1L2Badge, PageHeader } from "../../components/ui/base/layout";
import { StatusBadge, StatusCell } from "../../components/ui/domain/status";
import { DataTable, Pagination } from "../../components/ui/base/table";
import { Timestamp } from "../../components/ui/base/timestamp";
import { api } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";
import { viewerInit } from "../../lib/viewerInit";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";
import { ListError } from "../../components/ui/base/listerror";

export const metadata: Metadata = {
  title: "Withdrawals",
  description: "Withdrawals from Midgard back to Cardano.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Withdrawals" }];

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; id?: string }>;
}) {
  const query = await searchParams;
  const page = parsePage(query.page);
  const id = /^[0-9a-f]+$/i.test(query.id ?? "") ? query.id?.toLowerCase() : undefined;

  let data;
  try {
    data = await api.withdrawalsPage(page, await viewerInit(), id);
  } catch (e) {
    return (
      <ListError
        crumbs={CRUMBS}
        entity="withdrawal"
        title="Withdrawals"
        message={listErrorMessage(e)}
      />
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="withdrawal"
        title="Withdrawals"
        subtitle="Funds leaving Midgard for Cardano."
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
          caption="Withdrawals from Midgard to Cardano"
          columns={[
            {
              header: "Withdrawal request",
              headerNote: "on Cardano",
              cell: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <L1TxLink hash={r.withdrawal_l1_tx_hash} destination="cardano" />
                  <span className="font-mono text-micro text-text-3">
                    #{r.withdrawal_l1_output_index}
                    <span className="sr-only"> (L1 output index)</span>
                  </span>
                </span>
              ),
            },
            {
              header: "L2 outref",
              headerNote: "stored output reference",
              cell: (r) => <Identifier value={r.l2_outref} />,
              hideBelow: "lg",
            },
            {
              header: "L1 address",
              cell: (r) => (
                <span className="inline-flex items-center gap-1">
                  <AddressLink
                    address={r.l1_address_bech32 ?? r.l1_address}
                    chain="cardano"
                    head={10}
                    tail={8}
                  />
                  {r.l1_address_decode_error ? (
                    <InfoTip
                      subject="address decode error"
                      term="partialDecode"
                      explain={`${r.l1_address_decode_error} Raw Plutus data is shown instead.`}
                    />
                  ) : null}
                </span>
              ),
              hideBelow: "lg",
            },
            {
              header: "L2 value",
              cell: (r) =>
                r.l2_value ? (
                  <ValueCell value={r.l2_value} />
                ) : (
                  <span className="inline-flex items-center gap-1 text-text-3">
                    decode error
                    <InfoTip
                      subject="value decode error"
                      term="partialDecode"
                      explain={`${r.l2_value_decode_error ?? "The canonical decoder did not return a value."} Raw Plutus data is preserved in the API response.`}
                    />
                  </span>
                ),
              align: "right",
            },
            {
              header: "Validity",
              headerNote: "whether the node accepted it",
              cell: (r) =>
                r.validity === null ? (
                  <span className="inline-flex items-center gap-1 text-text-3">
                    Not yet
                    <InfoTip
                      subject="validity"
                      explain="The node has not validated this withdrawal yet, so it has no validity result. It can still become valid or fail a specific check."
                    />
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
            primary: (
              <AddressLink
                address={r.l1_address_bech32 ?? r.l1_address}
                chain="cardano"
                head={12}
                tail={8}
              />
            ),
            status: <StatusCell status={r.status} />,
            meta: <Timestamp iso={r.inclusion_time} />,
            secondary: r.l2_value ? (
              <ValueCell value={r.l2_value} />
            ) : (
              <span className="text-text-3">decode error</span>
            ),
            details: [
              {
                label: "L1 tx",
                value: (
                  <span className="inline-flex items-center gap-1.5">
                    <L1TxLink hash={r.withdrawal_l1_tx_hash} destination="cardano" />
                    <span className="font-mono text-micro text-text-3">
                      #{r.withdrawal_l1_output_index}
                    </span>
                  </span>
                ),
              },
              {
                label: "L2 outref",
                value: <Identifier value={r.l2_outref} head={8} tail={6} />,
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
          emptyHint="Withdrawals appear once an address sends funds from the Midgard ledger back to Cardano."
        />
        <StatusLegend kinds={["bridge_status", "withdrawal_validity"]} />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) => `/withdrawals?page=${p}${id ? `&id=${id}` : ""}`}
        />
      </section>
    </>
  );
}

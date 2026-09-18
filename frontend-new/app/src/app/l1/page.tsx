import type { Metadata } from "next";
import { Identifier } from "../../components/ui/domain/identifier";
import { L1TxLink } from "../../components/ui/domain/l1link";
import { DeploymentNote } from "../../components/shell/SourceBanner";
import { ListError } from "../../components/ui/base/listerror";
import { Callout, PageHeader } from "../../components/ui/base/layout";
import { DataTable, Pagination } from "../../components/ui/base/table";
import { StatusBadge } from "../../components/ui/domain/status";
import { Timestamp } from "../../components/ui/base/timestamp";
import { api } from "../../lib/api";
import type { CardanoActivityRow } from "@midgard-explorer/contracts";
import { groupThousands, truncateId } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";
import { viewerInit } from "../../lib/viewerInit";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";

export const metadata: Metadata = {
  title: "Cardano activity",
  description: "The Cardano transactions the Midgard node recorded.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Cardano" }];

/** What each kind of record is, in the reader's terms rather than the table's. */
const KIND_LABEL: Record<CardanoActivityRow["kind"], string> = {
  settlement: "Block settlement",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  forced_transaction: "Forced transaction",
};

/** Where the Midgard record behind a row lives. A settlement belongs to its
 * block; the three bridge kinds belong to their own lists, filtered to the one
 * record, which is the closest thing to a detail page each of them has. */
const recordHref = (row: CardanoActivityRow): string | null => {
  if (row.kind === "settlement") {
    return row.headerHash === null ? null : `/block/${row.headerHash}`;
  }
  if (row.recordId === null) return null;
  const list =
    row.kind === "deposit"
      ? "deposits"
      : row.kind === "withdrawal"
        ? "withdrawals"
        : "forced-transactions";
  return `/${list}?id=${row.recordId}`;
};

/**
 * Midgard's footprint on Cardano, as the NODE recorded it.
 *
 * Distinct from /transactions, which lists transactions inside the Midgard
 * ledger. Every row here is a Cardano transaction the node wrote down: the
 * commitment it submitted for a block, and the deposits, withdrawals and
 * forced-transaction orders it read.
 *
 * What this page cannot show, and says so rather than implying otherwise: a
 * Cardano transaction no Midgard record names. The explorer used to keep its
 * own chain index, which could find those; it is decommissioned, and ADR 0009
 * records the trade. Nothing on this page is a confirmation that Cardano
 * accepted any of these transactions.
 */
export default async function L1Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);

  let data;
  try {
    data = await api.cardanoActivity(page, await viewerInit());
  } catch (e) {
    return (
      <ListError
        crumbs={CRUMBS}
        entity="transaction"
        title="Cardano activity"
        message={listErrorMessage(e)}
      />
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="transaction"
        title="Cardano activity"
        subtitle="The Cardano transactions the Midgard node recorded, newest first."
        meta={
          <span>
            <strong className="font-semibold text-text tabular-nums">
              {groupThousands(String(data.total))}
            </strong>{" "}
            records
          </span>
        }
      />

      <div className="mb-4">
        <DeploymentNote />
      </div>

      <div className="mb-4">
        <Callout tone="neutral" title="These are the node's records, not a chain scan.">
          Each row is a Cardano transaction this Midgard node wrote down. The explorer does not read
          Cardano itself, so a transaction no Midgard record names does not appear here, and nothing
          on this page confirms that Cardano accepted one.
        </Callout>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Cardano transactions recorded by the Midgard node, newest first"
          columns={[
            {
              header: "Transaction",
              cell: (r) => <L1TxLink hash={r.l1TxHash} destination="midgard" />,
            },
            {
              header: "Record",
              cell: (r) => <span className="text-text-2">{KIND_LABEL[r.kind]}</span>,
            },
            {
              header: "Midgard record",
              cell: (r) => {
                const href = recordHref(r);
                const label =
                  r.kind === "settlement"
                    ? r.headerHash === null
                      ? null
                      : `Block ${truncateId(r.headerHash)}`
                    : r.recordId === null
                      ? null
                      : truncateId(r.recordId);
                if (label === null) return <span className="text-text-3">None recorded</span>;
                return href === null ? (
                  <span className="font-mono text-sm">{label}</span>
                ) : (
                  <Identifier value={label} href={href} />
                );
              },
              hideBelow: "sm",
            },
            {
              header: "State",
              cell: (r) =>
                r.status === null ? (
                  <span className="text-text-3">Unknown</span>
                ) : (
                  <StatusBadge status={r.status} />
                ),
              hideBelow: "md",
            },
            {
              header: "Recorded",
              align: "right",
              cell: (r) => <Timestamp iso={r.recordedAt} />,
            },
          ]}
          /* Below `sm`, a prioritized row rather than a card per column, which
             is what every other list on the site shows on a phone. */
          mobileRow={(r) => {
            const href = recordHref(r);
            const label =
              r.kind === "settlement"
                ? r.headerHash === null
                  ? null
                  : `Block ${truncateId(r.headerHash)}`
                : r.recordId === null
                  ? null
                  : truncateId(r.recordId);
            return {
              primary: <L1TxLink hash={r.l1TxHash} destination="midgard" />,
              status: r.status === null ? undefined : <StatusBadge status={r.status} />,
              meta: <Timestamp iso={r.recordedAt} />,
              secondary: <span className="text-text-2">{KIND_LABEL[r.kind]}</span>,
              details:
                label === null
                  ? []
                  : [
                      {
                        label: "Midgard record",
                        value:
                          href === null ? (
                            <span className="font-mono text-sm">{label}</span>
                          ) : (
                            <Identifier value={label} href={href} />
                          ),
                      },
                    ],
            };
          }}
          rows={data.rows}
          keyOf={(r) => `${r.kind}-${r.recordId ?? r.headerHash ?? r.l1TxHash}`}
          emptyTitle="The node has recorded nothing on Cardano."
          emptyHint="A block commitment, deposit, withdrawal or forced-transaction order appears here once the node records one."
        />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) => `/l1?page=${p}`}
        />
      </section>
    </>
  );
}

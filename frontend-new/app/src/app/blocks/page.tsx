import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Identifier } from "../../components/ui/identifier";
import { StatusBadge } from "../../components/ui/status";
import { PageError } from "../../components/ui/pageerror";
import { PageHeader } from "../../components/ui/primitives";
import { DataTable, Pagination } from "../../components/ui/table";
import { Timestamp } from "../../components/ui/timestamp";
import { api } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";

export const metadata: Metadata = {
  title: "Blocks",
  description: "Browse Midgard L2 blocks.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Blocks" }];

export default async function BlocksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);

  let data;
  try {
    data = await api.blocksPage(page);
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Blocks" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Blocks"
        subtitle="L2 blocks produced on Midgard, newest first. Open a block for finalization state, data-availability roots, and transactions."
        meta={
          <span>
            <strong className="font-semibold text-text tabular-nums">
              {groupThousands(String(data.total))}
            </strong>{" "}
            total blocks
          </span>
        }
      />
      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Midgard blocks, newest first"
          columns={[
            {
              header: "Height",
              cell: (r) => (
                <Link
                  href={`/block/${r.header_hash}`}
                  className="font-display font-semibold tabular-nums text-accent hover:underline"
                >
                  #{r.height}
                </Link>
              ),
            },
            {
              header: "Header hash",
              cell: (r) => <Identifier value={r.header_hash} href={`/block/${r.header_hash}`} />,
              hideBelow: "md",
            },
            {
              header: "Txs",
              cell: (r) => <span className="tabular-nums">{r.tx_count}</span>,
              align: "right",
            },
            {
              header: "L1 settlement",
              cell: (r) =>
                r.finalization_status === null ? (
                  <span className="text-text-3">Not yet recorded</span>
                ) : (
                  <StatusBadge status={r.finalization_status} />
                ),
              hideBelow: "sm",
            },
            {
              header: "Time",
              cell: (r) => <Timestamp iso={r.time_stamp_tz} />,
              align: "right",
            },
          ]}
          mobileRow={(r) => ({
            primary: (
              <Link
                href={`/block/${r.header_hash}`}
                className="font-display font-semibold tabular-nums text-accent"
              >
                #{r.height}
              </Link>
            ),
            status:
              r.finalization_status === null ? null : (
                <StatusBadge status={r.finalization_status} />
              ),
            meta: <Timestamp iso={r.time_stamp_tz} />,
            secondary: (
              <span className="tabular-nums">
                {r.tx_count} {r.tx_count === 1 ? "transaction" : "transactions"}
              </span>
            ),
            details: [
              {
                label: "Header hash",
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
          keyOf={(r) => r.header_hash}
          emptyTitle="No blocks yet"
          emptyHint="Blocks appear once the node's operator starts committing."
        />
        <Pagination
          page={page}
          hasNextPage={data.hasNextPage}
          total={data.total}
          limit={data.limit}
          hrefFor={(p) => `/blocks?page=${p}`}
        />
      </section>
    </>
  );
}

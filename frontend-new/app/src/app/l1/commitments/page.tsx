import type { Metadata } from "next";
import { Breadcrumbs } from "../../../components/ui/base/breadcrumbs";
import { Identifier } from "../../../components/ui/domain/identifier";
import { InfoTip } from "../../../components/ui/base/infotip";
import { PageError } from "../../../components/ui/base/pageerror";
import { DeploymentNote } from "../../../components/shell/SourceBanner";
import { Count, PageHeader } from "../../../components/ui/base/layout";
import { DataTable } from "../../../components/ui/base/table";
import { Timestamp } from "../../../components/ui/base/timestamp";
import { api, type L1BlockHeader } from "../../../lib/api";
import { groupThousands } from "../../../lib/format";
import { listErrorMessage } from "../../../lib/serverErrors";
import { viewerInit } from "../../../lib/viewerInit";

export const metadata: Metadata = {
  title: "State commitments",
  description: "Midgard block headers committed to the Cardano preprod chain.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [
  { label: "Overview", href: "/" },
  { label: "Cardano", href: "/l1" },
  { label: "State commitments" },
];

/** How many the backend will return. `/api/l1/block-headers` answers with a
 * bounded array and no total, so this page states its own bound instead of
 * rendering pagination controls that cannot page. */
const LIMIT = 100;

/** POSIX milliseconds as a decimal string, which is how the header records the
 * window it covers. `Timestamp` takes an ISO string. */
const isoFromPosixMs = (ms: string): string => new Date(Number(ms)).toISOString();

/** Midgard block headers as Cardano recorded them.
 *
 * This is the L1 side of a Midgard block: the roots, the counts and the
 * Cardano transaction that carried them. It is deliberately an index rather
 * than a second detail view. `/block/[headerHash]` already renders the same
 * header in full, including all eight roots, beside the block's contents from
 * the node, so a commitment links there rather than restating it here.
 *
 * The list stands on its own evidence. These rows come from the explorer's own
 * chain indexer, so they render whether or not the Midgard node is reachable,
 * and a header whose block the node has never seen still appears.
 */
export default async function CommitmentsPage() {
  let headers: readonly L1BlockHeader[];
  try {
    headers = await api.l1BlockHeaders(LIMIT, await viewerInit());
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="block" title="State commitments" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="block"
        title="State commitments"
        subtitle="Midgard block headers observed in Cardano preprod transactions, newest first. Each one commits a block's contents by Merkle root; the contents themselves are not on Cardano."
        meta={
          <>
            <span>
              <strong className="font-semibold text-text tabular-nums">
                {groupThousands(String(headers.length))}
              </strong>{" "}
              commitments indexed
            </span>
            <span>
              Most recent {LIMIT}
              <InfoTip term="stateCommitment" subject="state commitment" />
            </span>
          </>
        }
      />

      <div className="mb-4">
        <DeploymentNote />
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Midgard state commitments observed on Cardano preprod, newest first"
          columns={[
            {
              header: "Block header",
              cell: (h) => <Identifier value={h.headerHash} href={`/block/${h.headerHash}`} />,
            },
            {
              header: "Settlement transaction",
              // Null is not "missing data": a commit transaction re-outputs the
              // previous queue node alongside the new head, so a header can be
              // seen carried forward before the transaction that committed it
              // is observed. Saying so beats an empty cell.
              cell: (h) =>
                h.l1TxHash === null ? (
                  <span className="text-text-3">
                    Not yet attributed
                    <InfoTip term="settlementTransaction" subject="settlement transaction" />
                  </span>
                ) : (
                  <Identifier value={h.l1TxHash} href={`/l1/transaction/${h.l1TxHash}`} />
                ),
              hideBelow: "sm",
            },
            {
              header: "Cardano block",
              cell: (h) =>
                h.blockHeight === null ? (
                  <span className="text-text-3">Not attributed</span>
                ) : (
                  <span className="font-mono tabular-nums text-text-2">#{h.blockHeight}</span>
                ),
              hideBelow: "lg",
            },
            {
              header: "Midgard transactions",
              cell: (h) => <Count value={h.l2TransactionCount} />,
              hideBelow: "md",
              align: "right",
            },
            {
              header: "Events",
              cell: (h) => <Count value={h.totalEventCount} />,
              hideBelow: "lg",
              align: "right",
            },
            {
              header: "Window end",
              cell: (h) => <Timestamp iso={isoFromPosixMs(h.endTime)} />,
              hideBelow: "md",
              align: "right",
            },
          ]}
          mobileRow={(h) => ({
            primary: (
              <Identifier value={h.headerHash} href={`/block/${h.headerHash}`} head={10} tail={6} />
            ),
            meta: <Timestamp iso={isoFromPosixMs(h.endTime)} />,
            details: [
              {
                label: "Settlement transaction",
                value:
                  h.l1TxHash === null ? (
                    <span className="text-text-3">Not yet attributed</span>
                  ) : (
                    <Identifier
                      value={h.l1TxHash}
                      href={`/l1/transaction/${h.l1TxHash}`}
                      head={8}
                      tail={6}
                    />
                  ),
              },
              {
                label: "Midgard transactions",
                value: <Count value={h.l2TransactionCount} />,
              },
              {
                label: "Deposits",
                value: <Count value={h.depositCount} />,
              },
              {
                label: "Withdrawals",
                value: <Count value={h.withdrawalCount} />,
              },
              {
                label: "Forced",
                value: <Count value={h.forcedTransactionCount} />,
              },
            ],
          })}
          rows={headers}
          keyOf={(h) => h.headerHash}
          emptyTitle="No state commitments indexed yet"
          emptyHint="The indexer records a commitment when it observes a Midgard block header in a Cardano transaction at the state-queue validator. If this is empty, no block has been committed to Cardano preprod yet."
        />
      </section>
    </>
  );
}

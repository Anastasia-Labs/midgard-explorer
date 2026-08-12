import type { Metadata } from "next";
import { ValueCell } from "../../components/ui/amount";
import { Breadcrumbs } from "../../components/ui/breadcrumbs";
import { Identifier } from "../../components/ui/identifier";
import { PageError } from "../../components/ui/pageerror";
import { DeploymentNote } from "../../components/shell/SourceBanner";
import { PageHeader } from "../../components/ui/primitives";
import { DataTable, Pagination } from "../../components/ui/table";
import { Timestamp } from "../../components/ui/timestamp";
import { ValidatorLabel } from "../../components/ui/validatorlabel";
import { api, type L1ValidatorIdentity } from "../../lib/api";
import { groupThousands } from "../../lib/format";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";
import { viewerInit } from "../../lib/viewerInit";

export const metadata: Metadata = {
  title: "Cardano L1 activity",
  description: "Midgard's transactions on the Cardano preprod chain.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Cardano L1" }];

/** Midgard's own footprint on the Cardano preprod chain.
 *
 * Distinct from /transactions, which lists transactions inside the Midgard
 * ledger. These are the L1 transactions that touch a Midgard validator
 * address: contract deployment, block commitments to the state queue,
 * operator registration, and user deposits.
 *
 * The indexer scans from block height 0, so this list starts at the
 * deployment's very first transaction rather than at whenever a local node
 * was last running.
 */
export default async function L1Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);

  let data;
  let validators: readonly L1ValidatorIdentity[] = [];
  try {
    const init = await viewerInit();
    const [rows, summary] = await Promise.all([
      api.l1TxsPage(page, init),
      api.l1Summary(init).catch(() => null),
    ]);
    data = rows;
    validators = summary?.source?.validators ?? [];
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="transaction" title="Cardano L1 activity" />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        entity="transaction"
        title="Cardano L1 activity"
        subtitle="Midgard's transactions on the Cardano preprod chain, newest first. Indexed from block height 0, so this covers the deployment from its first transaction onward."
        meta={
          <span>
            <strong className="font-semibold text-text tabular-nums">
              {groupThousands(String(data.total))}
            </strong>{" "}
            L1 transactions
          </span>
        }
      />

      <div className="mb-4">
        <DeploymentNote />
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
        <DataTable
          caption="Midgard transactions on Cardano preprod, newest first"
          columns={[
            {
              header: "Transaction",
              cell: (r) => <Identifier value={r.txHash} href={`/l1/transaction/${r.txHash}`} />,
            },
            {
              header: "Contract",
              // A transaction commonly touches more than one validator, so
              // this names each distinct one rather than picking a winner.
              cell: (r) => {
                const names = [...new Set(r.events.map((e) => e.validator))];
                return names.length > 0 ? (
                  <span className="flex flex-wrap gap-x-2 gap-y-1 text-text-2">
                    {names.map((name) => (
                      <ValidatorLabel key={name} family={name} validators={validators} />
                    ))}
                  </span>
                ) : (
                  <span className="text-text-3">None</span>
                );
              },
              hideBelow: "sm",
            },
            {
              header: "Block",
              cell: (r) => (
                <span className="font-mono tabular-nums text-text-2">#{r.blockHeight}</span>
              ),
              hideBelow: "sm",
            },
            {
              header: "Size",
              cell: (r) => (
                <span className="tabular-nums text-text-2">{groupThousands(String(r.size))} B</span>
              ),
              hideBelow: "lg",
              align: "right",
            },
            {
              header: "Fee",
              cell: (r) => <ValueCell value={{ lovelace: r.fee, assets: {} }} />,
              hideBelow: "md",
              align: "right",
            },
            {
              header: "Time",
              cell: (r) => <Timestamp iso={r.txTime} />,
              hideBelow: "md",
              align: "right",
            },
          ]}
          mobileRow={(r) => ({
            primary: (
              <Identifier
                value={r.txHash}
                href={`/l1/transaction/${r.txHash}`}
                head={10}
                tail={6}
              />
            ),
            meta: <Timestamp iso={r.txTime} />,
            secondary: <ValueCell value={{ lovelace: r.fee, assets: {} }} />,
            details: [
              {
                label: "Block",
                value: <span className="tabular-nums">#{r.blockHeight}</span>,
              },
              {
                label: "Epoch",
                value: <span className="tabular-nums">{r.epoch}</span>,
              },
              ...[...new Set(r.events.map((event) => event.validator))].map((family) => ({
                label: "Contract",
                value: <ValidatorLabel family={family} validators={validators} />,
              })),
            ],
          })}
          rows={data.rows}
          keyOf={(r) => r.txHash}
          emptyTitle="No L1 activity indexed yet"
          emptyHint="The indexer scans Cardano preprod for transactions at Midgard's validator addresses. If this is empty, the indexer has not completed its first pass."
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

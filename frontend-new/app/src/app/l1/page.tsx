import type { Metadata } from "next";
import Link from "next/link";
import { ValueCell } from "../../components/ui/domain/amount";
import { Identifier } from "../../components/ui/domain/identifier";
import { DeploymentNote } from "../../components/shell/SourceBanner";
import { ListError } from "../../components/ui/base/listerror";
import { PageHeader } from "../../components/ui/base/layout";
import { DataTable, Pagination } from "../../components/ui/base/table";
import { Timestamp } from "../../components/ui/base/timestamp";
import { ValidatorLabel } from "../../components/ui/domain/validatorlabel";
import { api, type L1ValidatorIdentity } from "../../lib/api";
import type { L1Sync } from "@midgard-explorer/contracts";
import { groupThousands } from "../../lib/format";
import { l1EmptyState } from "../../lib/l1sync";
import { parsePage } from "../../lib/parsePage";
import { listErrorMessage } from "../../lib/serverErrors";
import { viewerInit } from "../../lib/viewerInit";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";

export const metadata: Metadata = {
  title: "Cardano activity",
  description: "Midgard's transactions on the Cardano preprod chain.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Cardano" }];

/** Midgard's own footprint on the Cardano preprod chain.
 *
 * Distinct from /transactions, which lists transactions inside the Midgard
 * ledger. These are the Cardano transactions that touch a Midgard validator
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
  let sync: L1Sync | null = null;
  try {
    const init = await viewerInit();
    const [rows, summary] = await Promise.all([
      api.l1TxsPage(page, init),
      api.l1Summary(init).catch(() => null),
    ]);
    data = rows;
    validators = summary?.source?.validators ?? [];
    sync = summary?.sync ?? null;
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
        subtitle="Midgard contract activity observed on Cardano preprod, newest first."
        meta={
          <span>
            <strong className="font-semibold text-text tabular-nums">
              {groupThousands(String(data.total))}
            </strong>{" "}
            Cardano transactions
          </span>
        }
      />

      <div className="mb-4">
        <DeploymentNote />
      </div>

      {/* The other half of Midgard's L1 footprint. This list is every Cardano
          transaction touching a validator; that one is only the block headers,
          which is the question most readers arrive with and which no list of
          transactions answers on its own. */}
      <p className="mb-4 text-sm text-text-2">
        Looking for the block headers Midgard commits to Cardano?{" "}
        <Link className="text-link hover:text-link-hover hover:underline" href="/l1/commitments">
          State commitments
        </Link>
      </p>

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
          mobileRow={(r) => {
            const families = [...new Set(r.events.map((event) => event.validator))];
            return {
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
                ...(families.length === 0
                  ? []
                  : [
                      {
                        label: "Contracts",
                        value: (
                          <span className="flex flex-wrap justify-end gap-x-2 gap-y-1">
                            {families.map((family) => (
                              <ValidatorLabel
                                key={family}
                                family={family}
                                validators={validators}
                              />
                            ))}
                          </span>
                        ),
                      },
                    ]),
              ],
            };
          }}
          rows={data.rows}
          keyOf={(r) => r.txHash}
          emptyTitle={l1EmptyState(sync).title}
          emptyHint={l1EmptyState(sync).hint}
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

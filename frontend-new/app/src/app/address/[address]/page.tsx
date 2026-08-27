import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdaAmount, ValueCell } from "../../../components/ui/amount";
import { ApiExample } from "../../../components/ui/apiexample";
import { AssetHierarchy } from "../../../components/ui/asset";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { InfoTip } from "../../../components/ui/infotip";
import { Identifier } from "../../../components/ui/identifier";
import { IdentityBar } from "../../../components/ui/identitybar";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, Card, Chip, EmptyState, PageHeader } from "../../../components/ui/primitives";
import { RawData } from "../../../components/ui/rawdata";
import { StatusCell } from "../../../components/ui/status";
import { SummaryBand } from "../../../components/ui/summary";
import { Tabs } from "../../../components/ui/tabs";
import { Timestamp } from "../../../components/ui/timestamp";
import { DataTable, DecodeWarn, Pagination } from "../../../components/ui/table";
import { api } from "../../../lib/api";
import { classify } from "../../../lib/classify";
import { assetCount, truncateId } from "../../../lib/format";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";
import { viewerInit } from "../../../lib/viewerInit";
import { parsePage } from "../../../lib/parsePage";

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Address" }];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  return {
    title: `Address ${truncateId(decodeURIComponent(address))}`,
    description: "Midgard address balance and history.",
  };
}

export default async function AddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const address = decodeURIComponent((await params).address);
  const page = parsePage((await searchParams).page);
  if (classify(address).kind !== "address") notFound();

  let data;
  try {
    data = await orNotFound(api.address(address, page, await viewerInit()));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader entity="address" title="Address" />
        <IdentityBar overline="Midgard address" value={address} mark />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  const assets = assetCount(data.balance.assets);
  const undecodableUtxos = data.utxos.filter((u) => u.decodeError !== null).length;

  const activityTab = (
    <Card>
      <DataTable
        caption="Transactions involving this address"
        columns={[
          {
            header: "Transaction",
            cell: (r) => (
              <span className="inline-flex items-center gap-2">
                <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} />
                <DecodeWarn error={r.decodeError} />
              </span>
            ),
          },
          {
            header: "Status",
            cell: (r) => <StatusCell status={r.status} />,
            hideBelow: "sm",
          },
          {
            header: "Block",
            cell: (r) =>
              r.header_hash === null ? (
                <span className="text-text-3">Not in a block</span>
              ) : r.height === null ? (
                <Identifier
                  value={r.header_hash}
                  href={`/block/${r.header_hash}`}
                  head={8}
                  tail={6}
                />
              ) : (
                <Link
                  href={`/block/${r.header_hash}`}
                  className="font-mono font-semibold tabular-nums text-link hover:text-link-hover hover:underline"
                >
                  #{r.height}
                </Link>
              ),
            hideBelow: "md",
          },
          {
            header: "L1 settlement",
            cell: (r) =>
              r.finalization_status === null ? (
                <span className="text-text-3">Not recorded</span>
              ) : (
                <StatusCell status={r.finalization_status} />
              ),
            hideBelow: "lg",
          },
          {
            header: "Received",
            cell: (r) =>
              r.received === null ? (
                <span className="text-text-3">Unknown</span>
              ) : (
                <ValueCell value={r.received} />
              ),
            align: "right",
          },
          {
            header: "Spent",
            cell: (r) =>
              r.spentComplete && r.spent !== null ? (
                <ValueCell value={r.spent} />
              ) : (
                <span className="inline-flex items-center gap-1 text-text-3">
                  Inputs pruned
                  <InfoTip
                    subject="pruned inputs"
                    explain="Some inputs of this transaction are no longer in the ledger, so the amount spent from this address cannot be determined. Treat its net address movement as unknown, not zero."
                  />
                </span>
              ),
            hideBelow: "lg",
            align: "right",
          },
          {
            header: "Time",
            cell: (r) =>
              r.time_stamp_tz ? <Timestamp iso={r.time_stamp_tz} /> : <span>Not recorded</span>,
            hideBelow: "sm",
            align: "right",
          },
        ]}
        mobileRow={(r) => ({
          primary: (
            <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={6} />
          ),
          status: (
            <span className="inline-flex items-center gap-1.5">
              <StatusCell status={r.status} />
              {r.decodeError ? <DecodeWarn error={r.decodeError} /> : null}
            </span>
          ),
          meta: r.time_stamp_tz ? <Timestamp iso={r.time_stamp_tz} /> : "Not recorded",
          secondary:
            r.received === null ? null : (
              <span>
                Received <ValueCell value={r.received} />
              </span>
            ),
          details: [
            {
              label: "Spent",
              value:
                r.spentComplete && r.spent !== null ? (
                  <ValueCell value={r.spent} />
                ) : (
                  <span className="text-text-3">Inputs pruned</span>
                ),
            },
            {
              label: "Block",
              value:
                r.header_hash === null ? (
                  "Not in a block"
                ) : r.height === null ? (
                  <Identifier
                    value={r.header_hash}
                    href={`/block/${r.header_hash}`}
                    head={8}
                    tail={6}
                  />
                ) : (
                  <Link href={`/block/${r.header_hash}`} className="text-link hover:underline">
                    #{r.height}
                  </Link>
                ),
            },
            {
              label: "L1 settlement",
              value:
                r.finalization_status === null ? (
                  "Not recorded"
                ) : (
                  <StatusCell status={r.finalization_status} />
                ),
            },
          ],
        })}
        rows={data.history}
        keyOf={(r) => r.tx_id}
        emptyTitle="No transactions for this address"
        emptyHint="This address has not appeared in a transaction on the Midgard ledger yet."
      />
      <Pagination
        page={page}
        hasNextPage={data.hasNextPage}
        total={data.txCount}
        limit={data.limit}
        hrefFor={(p) => `/address/${encodeURIComponent(address)}?page=${p}`}
      />
    </Card>
  );

  const assetsTab = (
    <Card>
      {assets === 0 ? (
        <EmptyState title="No native assets" />
      ) : (
        <div className="p-4">
          <AssetHierarchy assets={data.balance.assets} />
        </div>
      )}
    </Card>
  );

  const utxosTab = (
    <Card>
      {/* Breaking a balance into the entries that produce it is what makes it
          checkable rather than something to take on trust. */}
      <DataTable
        caption="Spendable UTxOs at this address"
        columns={[
          {
            header: "UTxO",
            cell: (u) =>
              u.txId === null || u.index === null ? (
                <Identifier value={u.outRefHex} head={10} tail={6} />
              ) : (
                <Identifier
                  value={`${u.txId}#${u.index}`}
                  href={`/transaction/${u.txId}`}
                  head={10}
                  tail={6}
                />
              ),
          },
          {
            header: "Flags",
            cell: (u) => (
              <span className="flex gap-1.5">
                {u.hasDatum ? <Chip on="surface-2">datum</Chip> : null}
                {u.hasScriptRef ? <Chip on="surface-2">script ref</Chip> : null}
                {u.decodeError ? <DecodeWarn error={u.decodeError} /> : null}
              </span>
            ),
            hideBelow: "sm",
          },
          {
            header: "Value",
            cell: (u) =>
              u.value === null ? (
                <span className="text-text-3">Unreadable</span>
              ) : (
                <ValueCell value={u.value} />
              ),
            align: "right",
          },
        ]}
        mobileRow={(u) => ({
          primary:
            u.txId === null || u.index === null ? (
              <Identifier value={u.outRefHex} head={10} tail={6} />
            ) : (
              <Identifier
                value={`${u.txId}#${u.index}`}
                href={`/transaction/${u.txId}`}
                head={10}
                tail={6}
              />
            ),
          status: u.decodeError ? <DecodeWarn error={u.decodeError} /> : null,
          secondary:
            u.value === null ? (
              <span className="text-text-3">Unreadable</span>
            ) : (
              <ValueCell value={u.value} />
            ),
          details: [
            { label: "Datum", value: u.hasDatum ? "Yes" : "No" },
            { label: "Script ref", value: u.hasScriptRef ? "Yes" : "No" },
          ],
        })}
        rows={[...data.utxos]}
        keyOf={(u) => u.outRefHex}
        emptyTitle="No spendable UTxOs at this address"
        emptyHint="Every UTxO this address received has since been spent."
      />
    </Card>
  );

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader entity="address" title="Address" />
      <IdentityBar overline="Midgard address" value={address} mark />

      {data.undecodedOutputs > 0 ? (
        <div className="mb-4">
          <Callout tone="warning" title="Balance is incomplete.">
            {data.undecodedOutputs} UTxO{data.undecodedOutputs === 1 ? "" : "s"} at this address
            could not be decoded (legacy encoding), so the balance below undercounts by their value.
            {undecodableUtxos > 0
              ? " They are listed in the UTxOs tab, marked unreadable, rather than omitted."
              : null}
          </Callout>
        </div>
      ) : null}

      <SummaryBand
        items={[
          {
            label: "Spendable balance",
            value: <AdaAmount lovelace={data.balance.lovelace} />,
            emphasis: true,
            ...(data.undecodedOutputs > 0
              ? {
                  sub: `Undercount: ${data.undecodedOutputs} output${
                    data.undecodedOutputs === 1 ? "" : "s"
                  } could not be decoded`,
                }
              : {}),
          },
          { label: "Native assets", value: assets },
          { label: "UTxOs", value: data.utxoCount },
          { label: "Transactions", value: data.txCount },
          {
            label: "First activity",
            value: data.firstActivity ? (
              <Timestamp exact iso={data.firstActivity} />
            ) : (
              "Not recorded"
            ),
          },
          {
            label: "Latest activity",
            value: data.latestActivity ? (
              <Timestamp exact iso={data.latestActivity} />
            ) : (
              "Not recorded"
            ),
          },
        ]}
      />

      <Tabs
        tabs={[
          { id: "activity", label: "Activity", count: data.txCount, content: activityTab },
          { id: "assets", label: "Assets", count: assets, content: assetsTab },
          { id: "utxos", label: "UTxOs", count: data.utxoCount, content: utxosTab },
          {
            id: "raw",
            label: "Raw",
            content: (
              <>
                <div className="mb-4">
                  <ApiExample
                    path={`/api/address?address=${encodeURIComponent(address)}&page=${page}`}
                  />
                </div>
                <RawData data={data} filename={`address-${truncateId(address, 8, 6)}.json`} />
              </>
            ),
          },
        ]}
      />
    </>
  );
}

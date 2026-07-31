import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdaAmount, ValueCell } from "../../../components/ui/amount";
import { ApiExample } from "../../../components/ui/apiexample";
import { AssetHierarchy } from "../../../components/ui/asset";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { Identifier } from "../../../components/ui/identifier";
import { IdentityBar } from "../../../components/ui/identitybar";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, Card, EmptyState, PageHeader } from "../../../components/ui/primitives";
import { RawData } from "../../../components/ui/rawdata";
import { StatusCell } from "../../../components/ui/status";
import { SummaryBand } from "../../../components/ui/summary";
import { Tabs } from "../../../components/ui/tabs";
import { Timestamp } from "../../../components/ui/timestamp";
import { DataTable, DecodeWarn } from "../../../components/ui/table";
import { api } from "../../../lib/api";
import { classify } from "../../../lib/classify";
import { assetCount, truncateId } from "../../../lib/format";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";

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
    description: "Midgard L2 address balance and history.",
  };
}

export default async function AddressPage({ params }: { params: Promise<{ address: string }> }) {
  const address = decodeURIComponent((await params).address);
  if (classify(address).kind !== "address") notFound();

  let data;
  try {
    data = await orNotFound(api.address(address));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Address" />
        <IdentityBar overline="L2 address" value={address} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  const assets = assetCount(data.balance.assets);
  const undecodableUtxos = data.utxos.filter((u) => u.decodeError !== null).length;

  const activityTab = (
    <Card>
      {/* The confidence rule travels with the columns it qualifies rather than
          sitting in a paragraph above the page, where it was read once and
          then forgotten by the time the numbers were reached. */}
      {/* Explicit {" "} after each element: JSX drops the space between an
          element and the text that follows it on the same line here, and
          "Receivedis exact" shipped once already. */}
      <p className="border-b border-border px-4 py-2.5 mg-micro leading-relaxed text-text-3">
        <strong className="font-semibold text-text-2">Received</strong>{" "}
        is exact: it reads each transaction&apos;s own outputs.{" "}
        <strong className="font-semibold text-text-2">Spent</strong>{" "}
        appears only when every input of a transaction resolved, because a transaction&apos;s inputs
        leave the ledger once it is applied. An unresolved input reads as unknown, never as zero.
      </p>
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
              r.header_hash === null || r.height === null ? (
                <span className="text-text-3">Not in a block</span>
              ) : (
                <Link
                  href={`/block/${r.header_hash}`}
                  className="font-display font-semibold tabular-nums text-accent hover:underline"
                >
                  #{r.height}
                </Link>
              ),
            hideBelow: "md",
          },
          {
            header: "Received",
            cell: (r) =>
              r.received === null ? (
                <span className="text-text-3">Unknown</span>
              ) : (
                <AdaAmount lovelace={r.received} />
              ),
            align: "right",
          },
          {
            header: "Spent",
            cell: (r) =>
              r.spentComplete && r.spent !== null ? (
                <AdaAmount lovelace={r.spent} />
              ) : (
                <span
                  className="text-text-3"
                  title="Some inputs of this transaction are no longer in the ledger, so the amount spent from this address cannot be determined."
                >
                  Inputs pruned
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
          primary: <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={6} />,
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
                Received <AdaAmount lovelace={r.received} />
              </span>
            ),
          details: [
            {
              label: "Spent",
              value:
                r.spentComplete && r.spent !== null ? (
                  <AdaAmount lovelace={r.spent} />
                ) : (
                  <span className="text-text-3">Inputs pruned</span>
                ),
            },
          ],
        })}
        rows={data.history}
        keyOf={(r) => r.tx_id}
        emptyTitle="No transactions for this address"
      />
    </Card>
  );

  const assetsTab = (
    <Card>
      {assets === 0 ? (
        <EmptyState
          title="No native assets"
          hint="This address holds ada only. Assets appear here once a UTxO at this address carries one."
        />
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
                {u.hasDatum ? <Flag>datum</Flag> : null}
                {u.hasScriptRef ? <Flag>script ref</Flag> : null}
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
      />
    </Card>
  );

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader title="Address" />
      <IdentityBar overline="L2 address" value={address} />

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
            value: data.firstActivity ? <Timestamp iso={data.firstActivity} /> : "Not recorded",
          },
          {
            label: "Latest activity",
            value: data.latestActivity ? <Timestamp iso={data.latestActivity} /> : "Not recorded",
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
                  <ApiExample path={`/api/address?address=${encodeURIComponent(address)}`} />
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

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-surface-2 px-1.5 py-px text-[11px] text-text-3">
      {children}
    </span>
  );
}

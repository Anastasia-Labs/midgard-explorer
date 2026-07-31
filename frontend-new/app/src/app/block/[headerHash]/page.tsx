import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdaAmount, ValueCell } from "../../../components/ui/amount";
import { ApiExample } from "../../../components/ui/apiexample";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { Identifier } from "../../../components/ui/identifier";
import { IdentityBar } from "../../../components/ui/identitybar";
import { Journey } from "../../../components/ui/journey";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, Card, PageHeader } from "../../../components/ui/primitives";
import { RawData } from "../../../components/ui/rawdata";
import { StatusBadge } from "../../../components/ui/status";
import { SummaryBand } from "../../../components/ui/summary";
import { DataTable, DecodeWarn } from "../../../components/ui/table";
import { Tabs } from "../../../components/ui/tabs";
import { Timestamp } from "../../../components/ui/timestamp";
import { api } from "../../../lib/api";
import { formatDuration, formatTimestamp, truncateId } from "../../../lib/format";
import { blockJourney } from "../../../lib/journey";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";

export const dynamic = "force-dynamic";

const isBlockHash = (s: string) => /^[0-9a-fA-F]{56}$/.test(s);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ headerHash: string }>;
}): Promise<Metadata> {
  const { headerHash } = await params;
  return {
    title: `Block ${truncateId(headerHash)}`,
    description: `Midgard L2 block ${headerHash}.`,
  };
}

export default async function BlockPage({ params }: { params: Promise<{ headerHash: string }> }) {
  const { headerHash } = await params;
  if (!isBlockHash(headerHash)) notFound();
  const hash = headerHash.toLowerCase();

  let data;
  try {
    data = await orNotFound(api.block(hash));
  } catch (e) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Overview", href: "/" },
            { label: "Blocks", href: "/blocks" },
            { label: "Block" },
          ]}
        />
        <PageHeader title="Block" />
        <IdentityBar overline="Block header hash" value={hash} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  const first = data.rows[0];
  const finalization = data.finalization;

  // Fee total over decodable transactions (BigInt: never Number).
  const decodable = data.rows.filter((r) => r.transaction);
  const feeSum = decodable.reduce((acc, r) => acc + BigInt(r.transaction?.fee ?? "0"), 0n);

  // Input count and total output value across decodable transactions.
  const inputCount = decodable.reduce((n, r) => n + (r.transaction?.inputs.length ?? 0), 0);
  const outputLovelace = decodable.reduce(
    (acc, r) =>
      acc + (r.transaction?.outputs ?? []).reduce((a, o) => a + BigInt(o.value.lovelace), 0n),
    0n,
  );

  const windowMs =
    data.da === null
      ? null
      : new Date(data.da.block_end_time).getTime() - new Date(data.da.block_start_time).getTime();

  const transactionsTab = (
    <DataTable
      caption="Transactions in this block"
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
          header: "Outputs",
          cell: (r) => r.transaction?.outputs.length ?? "Unknown",
          hideBelow: "sm",
          align: "right",
        },
        {
          header: "Fee",
          cell: (r) =>
            r.transaction ? (
              <ValueCell value={{ lovelace: r.transaction.fee, assets: {} }} />
            ) : (
              "Unknown"
            ),
          hideBelow: "md",
          align: "right",
        },
        {
          header: "Time",
          cell: (r) => <Timestamp iso={r.time_stamp_tz} />,
          hideBelow: "md",
        },
      ]}
      mobileRow={(r) => ({
        primary: <Identifier value={r.tx_id} href={`/transaction/${r.tx_id}`} head={10} tail={6} />,
        status: r.decodeError ? <DecodeWarn error={r.decodeError} /> : null,
        meta: <Timestamp iso={r.time_stamp_tz} />,
        secondary: r.transaction ? (
          <ValueCell value={{ lovelace: r.transaction.fee, assets: {} }} />
        ) : null,
        details: [{ label: "Outputs", value: String(r.transaction?.outputs.length ?? "Unknown") }],
      })}
      rows={data.rows}
      keyOf={(r) => r.tx_id}
      emptyTitle="No transactions in this block"
    />
  );

  const daTab = data.da ? (
    <>
      <div className="grid gap-x-8 gap-y-2 p-4 sm:grid-cols-2">
        {(
          [
            ["UTxOs root", data.da.utxos_root],
            ["Transactions root", data.da.transactions_root],
            ["Deposits root", data.da.deposits_root],
            ["Withdrawals root", data.da.withdrawals_root],
            ["Forced txs root", data.da.forced_transactions_root],
            ["Transition trace root", data.da.transition_trace_root],
            ["Event-to-step root", data.da.event_to_step_root],
          ] as const
        ).map(([label, root]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="text-sm text-text-3">{label}</span>
            <Identifier value={root} head={6} tail={6} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 border-t border-border p-4 text-sm sm:grid-cols-3">
        <Field label="Block start" value={<Timestamp iso={data.da.block_start_time} />} />
        <Field label="Block end" value={<Timestamp iso={data.da.block_end_time} />} />
        <Field
          label="Duration"
          value={windowMs === null ? "Not recorded" : formatDuration(windowMs)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-border p-4 text-sm text-text-2 sm:grid-cols-3">
        <span>Txs: {data.da.l2_transaction_count}</span>
        <span>Deposits: {data.da.deposit_count}</span>
        <span>Withdrawals: {data.da.withdrawal_count}</span>
        <span>Forced: {data.da.forced_transaction_count}</span>
        <span>Events: {data.da.total_event_count}</span>
        <span>Steps: {data.da.transition_step_count}</span>
      </div>
    </>
  ) : (
    <div className="p-4">
      <Callout tone="neutral" title="No data-availability record for this block yet." />
    </div>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/" },
          { label: "Blocks", href: "/blocks" },
          { label: first ? `Block #${first.height}` : "Block" },
        ]}
      />
      <PageHeader title={`Block ${first ? `#${first.height}` : ""}`}>
        {finalization ? <StatusBadge status={finalization.status} /> : null}
      </PageHeader>
      <IdentityBar overline="Block header hash" value={hash} />

      {/* One journey replaces the five-column finalization timeline and the
          callout that restated it: the same milestones, the same evidence, in
          the grammar every other record on the site uses. It leads the page
          because "is this block final?" is the question a block is opened to
          answer; the counts below are context for that answer. */}
      <Journey
        model={blockJourney(finalization, first?.height ?? 0)}
        detailsLabel="Settlement timings and evidence"
      >
        {finalization ? (
          <p className="mg-micro text-text-3">
            Latest node update: {formatTimestamp(finalization.updatedAt)}
            {finalization.submitted_tx_hash ? null : " · no L1 settlement transaction recorded yet"}
          </p>
        ) : null}
      </Journey>

      {/* Height is in the title and the closing time is in the journey, so
          neither is repeated here. */}
      <SummaryBand
        items={[
          {
            label: "Transactions",
            value: data.rows.length,
            ...(decodable.length < data.rows.length ? { sub: `${decodable.length} decoded` } : {}),
          },
          { label: "Inputs", value: inputCount },
          {
            label: "Output total",
            value: <AdaAmount lovelace={outputLovelace.toString()} />,
            ...(decodable.length < data.rows.length ? { sub: "Decoded transactions only" } : {}),
          },
          {
            label: "Fees",
            value: decodable.length > 0 ? <AdaAmount lovelace={feeSum.toString()} /> : "Unknown",
          },
          {
            label: "Duration",
            value: windowMs === null ? "Not recorded" : formatDuration(windowMs),
            ...(data.da ? { sub: "Block window" } : {}),
          },
        ]}
      />

      <Tabs
        tabs={[
          {
            id: "transactions",
            label: "Transactions",
            count: data.rows.length,
            content: <Card>{transactionsTab}</Card>,
          },
          { id: "da", label: "Data availability", content: <Card>{daTab}</Card> },
          {
            id: "raw",
            label: "Raw",
            content: (
              <>
                <div className="mb-4">
                  <ApiExample path={`/api/block?header_hash=${hash}`} />
                </div>
                <RawData data={data} filename={`block-${hash}.json`} />
              </>
            ),
          },
        ]}
      />
    </>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mg-overline">{label}</p>
      <div className="mt-0.5 text-text">{value}</div>
    </div>
  );
}

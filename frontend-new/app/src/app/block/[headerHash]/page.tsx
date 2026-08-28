import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { BlockEventMember } from "@midgard-explorer/contracts";
import type { ReactNode } from "react";
import { AdaAmount, ValueCell } from "../../../components/ui/amount";
import { ApiExample } from "../../../components/ui/apiexample";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { Identifier } from "../../../components/ui/identifier";
import { BlockNav } from "../../../components/ui/blocknav";
import { IdentityBar } from "../../../components/ui/identitybar";
import { L1TxLink } from "../../../components/ui/l1link";
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
import { viewerInit } from "../../../lib/viewerInit";

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
    description: `Midgard block ${headerHash}.`,
  };
}

export default async function BlockPage({ params }: { params: Promise<{ headerHash: string }> }) {
  const { headerHash } = await params;
  if (!isBlockHash(headerHash)) notFound();
  const hash = headerHash.toLowerCase();

  let data;
  const init = await viewerInit();
  try {
    data = await orNotFound(api.block(hash, init));
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
        <PageHeader entity="block" title="Block" />
        <IdentityBar overline="Block header hash" value={hash} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  // Cardano-observed evidence is independent from the node DB. Its absence
  // must not make an otherwise valid node block fail to render.
  const l1Header = await api.l1BlockHeader(hash, init).catch(() => null);

  const header = data.header;
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
    header.block_start_time === null
      ? null
      : new Date(header.block_end_time).getTime() - new Date(header.block_start_time).getTime();

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
      emptyHint={
        (header.header_deposit_count ?? 0) +
          (header.header_withdrawal_count ?? 0) +
          (header.header_forced_transaction_count ?? 0) >
        0
          ? "This header contains protocol events but no Midgard transactions."
          : "This header contains no Midgard transactions."
      }
    />
  );

  const daTab = data.da ? (
    <>
      <div className="p-4 pb-0">
        <Callout tone="neutral" title="Payload retained locally." />
      </div>
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
        <Field label="Block start" value={<Timestamp exact iso={data.da.block_start_time} />} />
        <Field label="Block end" value={<Timestamp exact iso={data.da.block_end_time} />} />
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
      <Callout tone="neutral" title="No payload is retained locally for this header." />
    </div>
  );

  const l1EvidenceTab = l1Header ? (
    <Card>
      <div className="p-4">
        <Callout tone="neutral" title="Observed on Cardano." />
      </div>
      <dl className="grid gap-x-8 gap-y-3 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Protocol version" value={l1Header.protocolVersion} />
        <Field
          label="Cardano transaction"
          value={
            l1Header.l1TxHash ? (
              <L1TxLink hash={l1Header.l1TxHash} destination="midgard" />
            ) : (
              "Carried forward; head transaction not attributed"
            )
          }
        />
        <Field
          label="Cardano block"
          value={l1Header.blockHeight === null ? "Not attributed" : `#${l1Header.blockHeight}`}
        />
        <Field
          label="Window start"
          value={<Timestamp exact iso={new Date(Number(l1Header.startTime)).toISOString()} />}
        />
        <Field
          label="Window end"
          value={<Timestamp exact iso={new Date(Number(l1Header.endTime)).toISOString()} />}
        />
        <Field
          label="Previous header"
          value={
            <Identifier
              value={l1Header.prevHeaderHash}
              href={`/block/${l1Header.prevHeaderHash}`}
            />
          }
        />
        <Field label="Operator key hash" value={<Identifier value={l1Header.operatorVkey} />} />
      </dl>
      <div className="grid grid-cols-2 gap-2 border-t border-border p-4 text-sm text-text-2 sm:grid-cols-3">
        <span>Midgard transactions: {l1Header.l2TransactionCount}</span>
        <span>Deposits: {l1Header.depositCount}</span>
        <span>Withdrawals: {l1Header.withdrawalCount}</span>
        <span>Forced: {l1Header.forcedTransactionCount}</span>
        <span>Total events: {l1Header.totalEventCount}</span>
        <span>Transition steps: {l1Header.transitionStepCount}</span>
      </div>
      <div className="grid gap-x-8 gap-y-2 border-t border-border p-4 sm:grid-cols-2">
        {(
          [
            ["Previous UTxOs root", l1Header.prevUtxosRoot],
            ["UTxOs root", l1Header.utxosRoot],
            ["Transactions root", l1Header.transactionsRoot],
            ["Deposits root", l1Header.depositsRoot],
            ["Withdrawals root", l1Header.withdrawalsRoot],
            ["Forced transactions root", l1Header.forcedTransactionsRoot],
            ["Transition trace root", l1Header.transitionTraceRoot],
            ["Event-to-step root", l1Header.eventToStepRoot],
          ] as const
        ).map(([label, root]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="text-sm text-text-3">{label}</span>
            <Identifier value={root} head={6} tail={6} />
          </div>
        ))}
      </div>
    </Card>
  ) : (
    <Callout tone="neutral" title="Not observed in the Cardano index yet.">
      The node has this header, but the explorer-owned Cardano index has not attributed its Cardano
      commitment transaction.
    </Callout>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/" },
          { label: "Blocks", href: "/blocks" },
          {
            label:
              header.height === null ? `Header ${truncateId(hash)}` : `Block #${header.height}`,
          },
        ]}
      />
      <PageHeader
        entity="block"
        title={header.height === null ? `Header ${truncateId(hash)}` : `Block #${header.height}`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <BlockNav neighbours={data.neighbours} />
          {finalization ? <StatusBadge status={finalization.status} /> : null}
        </span>
      </PageHeader>
      <IdentityBar overline="Block header hash" value={hash} />

      {/* One journey replaces the five-column finalization timeline and the
          callout that restated it: the same milestones, the same evidence, in
          the grammar every other record on the site uses. It leads the page
          because "is this block final?" is the question a block is opened to
          answer; the counts below are context for that answer. */}
      <Journey
        model={blockJourney(finalization, header.height, hash)}
        detailsLabel="Settlement timings and evidence"
      >
        {finalization ? (
          <p className="mg-micro text-text-3">
            Latest node update: {formatTimestamp(finalization.updatedAt)}
            {finalization.submitted_tx_hash
              ? null
              : " · no Cardano block-commitment transaction recorded yet"}
          </p>
        ) : null}
      </Journey>

      {/* Height is in the title and the closing time is in the journey, so
          neither is repeated here. */}
      <SummaryBand
        items={[
          {
            label: "Committed txs",
            value: header.header_l2_transaction_count ?? "Unknown",
            ...(decodable.length < data.rows.length ? { sub: `${decodable.length} decoded` } : {}),
          },
          {
            label: "Deposits",
            value: header.header_deposit_count ?? "Unknown",
          },
          {
            label: "Withdrawals",
            value: header.header_withdrawal_count ?? "Unknown",
          },
          {
            label: "Forced transactions",
            value: header.header_forced_transaction_count ?? "Unknown",
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
            sub: "Header window",
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
          { id: "l1", label: "Cardano evidence", content: l1EvidenceTab },
          {
            id: "events",
            label: "Protocol events",
            count:
              data.events.deposits.length +
              data.events.withdrawals.length +
              data.events.forced_transactions.length,
            content: (
              <Card>
                <EventMembers title="Deposits" rows={data.events.deposits} />
                <EventMembers title="Withdrawals" rows={data.events.withdrawals} />
                <EventMembers title="Forced transactions" rows={data.events.forced_transactions} />
              </Card>
            ),
          },
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

function EventMembers({ title, rows }: { title: string; rows: readonly BlockEventMember[] }) {
  return (
    <section className="border-b border-border p-4 last:border-b-0">
      <h3 className="mb-2 text-sm font-semibold text-text">
        {title} <span className="font-normal text-text-3">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-text-3">None in this header.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.member_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2"
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-xs tabular-nums text-text-3">#{row.ordinal}</span>
                <Identifier value={row.member_id} head={10} tail={8} />
              </span>
              <Timestamp iso={row.source_time_stamp_tz} />
            </li>
          ))}
        </ul>
      )}
    </section>
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

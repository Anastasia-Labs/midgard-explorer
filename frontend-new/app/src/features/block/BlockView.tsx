import type { BlockEventMember } from "@midgard-explorer/contracts";
import { AdaAmount, ValueCell } from "../../components/ui/domain/amount";
import { ApiExample } from "../../components/ui/domain/apiexample";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";
import { Identifier } from "../../components/ui/domain/identifier";
import { BlockNav } from "../../components/ui/domain/blocknav";
import { IdentityBar } from "../../components/ui/domain/identitybar";
import { CardanoAssociation, hasRecordedSettlement } from "../../components/ui/domain/association";
import { Journey } from "../../components/ui/domain/journey";
import { Card } from "../../components/ui/base/layout";
import { FactGroup, FactRow } from "../../components/ui/base/facts";
import { L1TxLink } from "../../components/ui/domain/l1link";
import { RawData } from "../../components/ui/base/rawdata";
import { SettlementDetails } from "../../components/ui/domain/settlementdetails";
import { ToneBadge } from "../../components/ui/domain/status";
import { DataTable, DecodeWarn } from "../../components/ui/base/table";
import { Tabs } from "../../components/ui/base/tabs";
import { Timestamp } from "../../components/ui/base/timestamp";
import { blockForDisplay } from "../../lib/blockDisplay";
import { formatDuration, truncateId } from "../../lib/format";
import { OUTCOME_TONE, blockJourney } from "../../lib/journey";
import { MerkleRoots } from "./MerkleRoots";
import type { BlockResponse } from "@midgard-explorer/contracts";

/**
 * Everything a block page shows, given the records it was handed.
 *
 * The route above fetches and decides what a failure looks like. This decides
 * what the reader sees, which is why the two are apart: the derivations below
 * are arithmetic over records and can be read without a running backend.
 */
export function BlockView({ hash, data }: { hash: string; data: BlockResponse }) {
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

  const journeyModel = blockJourney(finalization, header.height, hash);
  const settlementHash =
    hasRecordedSettlement(data.cardano) && "l1TxHash" in data.cardano
      ? data.cardano.l1TxHash
      : null;
  const title = header.height === null ? `Header ${truncateId(hash)}` : `Block #${header.height}`;

  const counts = [
    header.header_deposit_count,
    header.header_withdrawal_count,
    header.header_forced_transaction_count,
  ];
  const eventTotal = counts.some((n) => n === null)
    ? null
    : counts.reduce<number>((a, n) => a + (n ?? 0), 0);
  const eventCount =
    data.events.deposits.length +
    data.events.withdrawals.length +
    data.events.forced_transactions.length;
  const partial = decodable.length < data.rows.length;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/" },
          { label: "Blocks", href: "/blocks" },
          { label: title },
        ]}
      />
      <IdentityBar
        title={title}
        overline="Block header hash"
        value={hash}
        badges={
          <>
            <ToneBadge
              tone={OUTCOME_TONE[journeyModel.outcome]}
              label={journeyModel.headline}
              explain={journeyModel.explanation || undefined}
            />
            <BlockNav neighbours={data.neighbours} />
          </>
        }
        summary={[
          ...(settlementHash
            ? [
                {
                  label: "Settlement",
                  value: (
                    <L1TxLink
                      hash={settlementHash}
                      destination="midgard"
                      marker={false}
                      head={6}
                      tail={6}
                    />
                  ),
                },
              ]
            : []),
          { label: "Time", value: <Timestamp stacked iso={header.block_end_time} /> },
          {
            label: "Transactions",
            value: header.header_l2_transaction_count ?? "Unknown",
            ...(partial ? { sub: `${decodable.length} decoded` } : {}),
          },
          {
            label: "Protocol events",
            value: eventTotal ?? "Unknown",
            ...(eventTotal
              ? {
                  sub: [
                    plural(header.header_deposit_count ?? 0, "deposit"),
                    plural(header.header_withdrawal_count ?? 0, "withdrawal"),
                    plural(header.header_forced_transaction_count ?? 0, "forced"),
                  ].join(" · "),
                }
              : {}),
          },
          {
            label: "Total output",
            value: <AdaAmount lovelace={outputLovelace.toString()} />,
            ...(partial ? { sub: "Decoded transactions only" } : {}),
          },
          {
            label: "Fees",
            value: decodable.length > 0 ? <AdaAmount lovelace={feeSum.toString()} /> : "Unknown",
          },
        ]}
      />

      {journeyModel.outcome !== "complete" ? (
        <Journey model={journeyModel} showHeadline={false} />
      ) : null}
      {hasRecordedSettlement(data.cardano) ? null : (
        <CardanoAssociation association={data.cardano} context={data.midgard} />
      )}

      <Tabs
        aliases={{ da: "details" }}
        tabs={[
          {
            id: "transactions",
            label: "Transactions",
            count: data.rows.length,
            content: <Card>{transactionsTab}</Card>,
          },
          {
            id: "events",
            label: "Protocol events",
            count: eventCount,
            content: (
              <Card>
                {eventCount === 0 ? (
                  <p className="p-4 text-sm text-text-3">
                    {eventTotal === 0
                      ? "No deposits, withdrawals or forced transactions in this block."
                      : eventTotal === null
                        ? "The node recorded no list of this block's protocol events."
                        : `The header counts ${plural(eventTotal, "protocol event")}, but the node recorded no list of them.`}
                  </p>
                ) : (
                  <>
                    {eventTotal !== null && eventTotal !== eventCount ? (
                      <p className="border-b border-border px-4 py-3 mg-caption text-text-3">
                        The header counts {plural(eventTotal, "protocol event")}. The node recorded{" "}
                        {eventCount} of them.
                      </p>
                    ) : null}
                    <EventMembers title="Deposits" rows={data.events.deposits} />
                    <EventMembers title="Withdrawals" rows={data.events.withdrawals} />
                    <EventMembers
                      title="Forced transactions"
                      rows={data.events.forced_transactions}
                    />
                  </>
                )}
              </Card>
            ),
          },
          {
            id: "roots",
            label: "Merkle roots",
            content: (
              <Card>
                <MerkleRoots commitments={data.commitments ?? null} />
              </Card>
            ),
          },
          {
            id: "details",
            label: "Details",
            content: (
              <Card>
                <FactGroup title="Timing">
                  <FactRow label="Started">
                    {header.block_start_time === null ? (
                      "Not recorded"
                    ) : (
                      <Timestamp exact iso={header.block_start_time} />
                    )}
                  </FactRow>
                  <FactRow label="Closed">
                    <Timestamp exact iso={header.block_end_time} />
                  </FactRow>
                  <FactRow label="Duration">
                    {windowMs === null ? "Not recorded" : formatDuration(windowMs)}
                  </FactRow>
                </FactGroup>
                <FactGroup title="Contents">
                  <FactRow label="Inputs">
                    {inputCount}
                    {partial ? <span className="text-text-3"> in decoded transactions</span> : null}
                  </FactRow>
                  {data.da ? (
                    <>
                      <FactRow label="Events">{data.da.total_event_count}</FactRow>
                      <FactRow label="Transition steps">{data.da.transition_step_count}</FactRow>
                    </>
                  ) : null}
                  <FactRow label="Payload">
                    {header.payload_retained_locally ? "Retained locally" : "Not retained locally"}
                  </FactRow>
                </FactGroup>
                <FactGroup title="Settlement">
                  <SettlementDetails
                    association={data.cardano}
                    context={data.midgard}
                    journey={journeyModel}
                  />
                </FactGroup>
              </Card>
            ),
          },
          {
            id: "raw",
            label: "Raw",
            content: (
              <div className="space-y-4">
                <ApiExample
                  path={`/api/block?header_hash=${hash}`}
                  note="Returns the full API response, including every transaction body and the explorer's source and settlement records."
                />
                <RawData
                  title="Block JSON"
                  data={blockForDisplay(data)}
                  filename={`block-${hash}.json`}
                />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

function plural(n: number, noun: string): string {
  if (noun === "forced") return `${n} forced`;
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function EventMembers({ title, rows }: { title: string; rows: readonly BlockEventMember[] }) {
  return (
    <section className="border-b border-border p-4 last:border-b-0">
      <h3 className="mb-2 text-sm font-semibold text-text">
        {title} <span className="font-normal text-text-3">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-text-3">None in this block.</p>
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

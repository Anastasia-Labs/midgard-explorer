import Link from "next/link";
import { outputHref } from "../../lib/entities";
import { BlockRef } from "../../components/ui/domain/blockref";
import { AdaAmount, ValueCell } from "../../components/ui/domain/amount";
import { ApiExample } from "../../components/ui/domain/apiexample";
import { AssetHierarchy } from "../../components/ui/domain/asset";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";
import { Identifier } from "../../components/ui/domain/identifier";
import { IdentityBar } from "../../components/ui/domain/identitybar";
import { Callout, Card, Chip, EmptyState } from "../../components/ui/base/layout";
import { RawData } from "../../components/ui/base/rawdata";
import { StatusCell, StatusPair } from "../../components/ui/domain/status";
import { Tabs } from "../../components/ui/base/tabs";
import { Timestamp } from "../../components/ui/base/timestamp";
import { DataTable, DecodeWarn, Pagination } from "../../components/ui/base/table";
import { addressForDisplay } from "../../lib/addressDisplay";
import { assetCount, truncateId } from "../../lib/format";
const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Address" }];

import type { AddressResponse } from "@midgard-explorer/contracts";

/**
 * Everything an address page shows, given the records it was handed.
 *
 * The route above resolves the address, the page number and what a failure
 * looks like. This decides what the reader sees.
 */
export function AddressView({
  address,
  page,
  data,
  utxoCursor,
}: {
  address: string;
  page: number;
  data: AddressResponse;
  /** The UTxO page being shown. Absent means the first. */
  utxoCursor?: string | undefined;
}) {
  // `tab=utxos` is carried deliberately: without it, paging the UTxO list
  // navigates and the reader lands back on Activity, having pressed a control
  // that was only reachable from the UTxOs tab.
  const utxoPageHref = (cursor: string | undefined) =>
    `/address/${encodeURIComponent(address)}?page=${page}&tab=utxos` +
    (cursor ? `&utxo_cursor=${encodeURIComponent(cursor)}` : "");
  const assets = assetCount(data.balance.assets);
  const undecodableUtxos = data.utxos.filter((u) => u.decodeError !== null).length;

  const spentUnknown = data.history.some((r) => !r.spentComplete || r.spent === null);

  const activityTab = (
    <Card>
      {/* Said once for the page. Each affected row keeps its own label. */}
      {spentUnknown ? (
        <p className="border-b border-border px-4 py-3 mg-caption text-text-3">
          Spent amount unknown
        </p>
      ) : null}
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
            header: "L2 status",
            cell: (r) => <StatusCell status={r.status} />,
            hideBelow: "sm",
          },
          {
            header: "Block",
            cell: (r) =>
              r.header_hash === null ? (
                <span className="text-text-3">Not in a block</span>
              ) : (
                <BlockRef hash={r.header_hash} height={r.height} />
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
                <span className="text-text-3">Spent unknown</span>
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
              <StatusPair l2={r.status} l1={r.finalization_status} />
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
                  <span className="text-text-3">Spent unknown</span>
                ),
            },
            {
              label: "Block",
              value:
                r.header_hash === null ? (
                  "Not in a block"
                ) : (
                  <BlockRef hash={r.header_hash} height={r.height} />
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
                  href={outputHref(u.txId, u.index)}
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
                href={outputHref(u.txId, u.index)}
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
      {/* The table shows one page of a larger set. Without a way forward the
          count above would name UTxOs the reader cannot reach. The balance and
          the count describe every UTxO, not this page. */}
      {data.hasMoreUtxos || utxoCursor ? (
        <nav className="mt-4 flex items-center justify-between gap-4 text-sm">
          <span className="text-text-3">
            Showing {data.utxos.length} of {data.utxoCount} UTxOs
          </span>
          <span className="flex gap-4">
            {utxoCursor ? (
              <Link className="text-accent hover:underline" href={utxoPageHref(undefined)}>
                First 50
              </Link>
            ) : null}
            {data.hasMoreUtxos && data.utxoCursor ? (
              <Link className="text-accent hover:underline" href={utxoPageHref(data.utxoCursor)}>
                Next 50
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </Card>
  );

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <IdentityBar
        title="Address"
        overline="Midgard address"
        value={address}
        mark
        summary={[
          {
            label: "Spendable balance",
            value: <AdaAmount lovelace={data.balance.lovelace} />,
            emphasis: true,
            ...(data.undecodedOutputs > 0 ? { sub: "Incomplete, see below" } : {}),
          },
          { label: "Native assets", value: assets },
          { label: "UTxOs", value: data.utxoCount },
          { label: "Transactions", value: data.txCount },
          {
            label: "First activity",
            value: data.firstActivity ? (
              <Timestamp stacked iso={data.firstActivity} />
            ) : (
              "Not recorded"
            ),
          },
          {
            label: "Latest activity",
            value: data.latestActivity ? (
              <Timestamp stacked iso={data.latestActivity} />
            ) : (
              "Not recorded"
            ),
          },
        ]}
      />

      {data.undecodedOutputs > 0 ? (
        <div className="mb-4">
          <Callout tone="warning" title="Balance is incomplete.">
            Excludes {data.undecodedOutputs} undecodable UTxO
            {data.undecodedOutputs === 1 ? "" : "s"}
            {undecodableUtxos > 0 ? ", listed in the UTxOs tab" : null}.
          </Callout>
        </div>
      ) : null}

      <Tabs
        tabs={[
          { id: "activity", label: "Activity", count: data.txCount, content: activityTab },
          { id: "assets", label: "Assets", count: assets, content: assetsTab },
          { id: "utxos", label: "UTxOs", count: data.utxoCount, content: utxosTab },
          {
            id: "raw",
            label: "Raw",
            content: (
              <div className="space-y-4">
                <ApiExample
                  path={`/api/address?address=${encodeURIComponent(address)}&page=${page}`}
                  note="Returns the full API response, including each transaction body and the paging cursors."
                />
                <RawData
                  title="Address JSON"
                  data={addressForDisplay(address, data)}
                  filename={`address-${truncateId(address, 8, 6)}.json`}
                />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

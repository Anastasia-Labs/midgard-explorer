import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { TransactionView } from "@midgard-explorer/contracts";
import { LifecyclePoller } from "../../../features/transaction/LifecyclePoller";
import { ApiExample } from "../../../components/ui/apiexample";
import { AdaAmount, AssetHierarchy, ValueCell } from "../../../components/ui/amount";
import { Breadcrumbs } from "../../../components/ui/breadcrumbs";
import { Icon } from "../../../components/ui/icons";
import { Identifier } from "../../../components/ui/identifier";
import { IdentityBar } from "../../../components/ui/identitybar";
import { PageError } from "../../../components/ui/pageerror";
import { Callout, Card, PageHeader } from "../../../components/ui/primitives";
import { RawData } from "../../../components/ui/rawdata";
import { Journey } from "../../../components/ui/journey";
import { LedgerEquation } from "../../../components/ui/ledger";
import { StatusBadge } from "../../../components/ui/status";
import { SummaryBand } from "../../../components/ui/summary";
import { Tabs } from "../../../components/ui/tabs";
import { api } from "../../../lib/api";
import { transactionJourney } from "../../../lib/journey";
import { formatTimestamp, truncateId } from "../../../lib/format";
import { TERMINAL_TX_STATUSES } from "../../../lib/queryKeys";
import { listErrorMessage, orNotFound } from "../../../lib/serverErrors";
import { statusOf } from "../../../lib/status-registry";

export const dynamic = "force-dynamic";

const isTxHash = (s: string) => /^[0-9a-fA-F]{64}$/.test(s);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txHash: string }>;
}): Promise<Metadata> {
  const { txHash } = await params;
  return {
    title: `Tx ${truncateId(txHash)}`,
    description: `Midgard L2 transaction ${txHash}.`,
  };
}

const CRUMBS = [
  { label: "Overview", href: "/" },
  { label: "Transactions", href: "/transactions" },
  { label: "Transaction" },
];

export default async function TransactionPage({ params }: { params: Promise<{ txHash: string }> }) {
  const { txHash } = await params;
  if (!isTxHash(txHash)) notFound();
  const hash = txHash.toLowerCase();

  let data;
  try {
    data = await orNotFound(api.transaction(hash));
  } catch (e) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Transaction" />
        <IdentityBar overline="Transaction hash" value={hash} />
        <PageError message={listErrorMessage(e)} />
      </>
    );
  }

  const status = data.status;
  const terminal = TERMINAL_TX_STATUSES.has(status);
  const journey = (
    <Journey
      model={transactionJourney({
        status,
        admission: data.admission,
        inclusion: data.inclusion,
        finalization: data.finalization,
      })}
    >
      {data.admission ? (
        <p className="font-mono text-[12px] text-text-3">
          Node admission record · {data.admission.attemptCount} validation attempt
          {data.admission.attemptCount === 1 ? "" : "s"} · {data.admission.requestCount} request
          {data.admission.requestCount === 1 ? "" : "s"} · source: {data.admission.submitSource}
        </p>
      ) : null}
    </Journey>
  );

  if (data.transaction === null) {
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <PageHeader title="Transaction">
          <StatusBadge status={status} />
        </PageHeader>
        {/* Status is on the page header and in the stepper; a third copy here
            adds no information. */}
        <IdentityBar overline="Transaction hash" value={hash} />
        {journey}
        {data.decodeError ? (
          <Callout tone="warning" title="This transaction's body could not be decoded.">
            <p>
              Everything above comes from the node&apos;s own records and is unaffected. Only the
              transaction body is unavailable.
            </p>
            {data.decodeError.detail ? (
              <p className="mt-1.5 font-mono text-[12.5px] wrap-break-word text-text-2">
                {data.decodeError.detail}
              </p>
            ) : null}
          </Callout>
        ) : null}
        {"rejection" in data && data.rejection ? (
          <Callout tone="danger" title="Rejected by the node">
            {data.rejection.reasonCode ? (
              <p>
                Reason: <StatusBadge status={data.rejection.reasonCode} />
              </p>
            ) : null}
            {data.rejection.reasonDetail ? (
              <p className="mt-1.5 font-mono text-[12.5px] wrap-break-word text-text-2">
                {data.rejection.reasonDetail}
              </p>
            ) : null}
            {/* The timeline's terminal entry already carries the rejection
                time from the admission record. Only fall back to the rejection
                row's own timestamp when there is no timeline to carry it, so
                the page never shows two different rejection times. */}
            {data.rejection.rejectedAt && !data.admission ? (
              <p className="mt-1.5">At: {formatTimestamp(data.rejection.rejectedAt)}</p>
            ) : null}
          </Callout>
        ) : data.decodeError ? null : (
          <Callout tone={statusOf(status).tone} title={statusOf(status).explain}>
            The transaction is known to the node but its bytes are not yet in a block or the
            mempool.
          </Callout>
        )}
        {!terminal ? <LifecyclePoller /> : null}
      </>
    );
  }

  const tx = data.transaction;

  const summaryTab = (
    <>
      <Card className="mb-4">
        <h2 className="mg-overline px-4 pt-4">Technical details</h2>
        <dl className="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Fee" value={<AdaAmount lovelace={tx.fee} />} />
          <Detail label="Validity" value={<StatusBadge status={tx.validity} />} />
          <Detail label="Time" value={formatTimestamp(tx.timestamp)} />
          <Detail
            label="Validity interval"
            value={validityIntervalText(tx.validityInterval)}
            hint="The ledger accepts this transaction only inside this slot range."
          />
          <Detail
            label="Network ID"
            value={
              tx.networkId === null
                ? "Not declared"
                : tx.networkId === 0
                  ? "0 (testnet)"
                  : tx.networkId === 1
                    ? "1 (mainnet)"
                    : String(tx.networkId)
            }
          />
          <Detail label="Format version" value={String(tx.formatVersion)} />
          <Detail
            label="Witnesses"
            value={`${tx.witnesses.vkeyCount} vkey · ${tx.witnesses.scriptCount} script · ${tx.witnesses.redeemerCount} redeemer`}
          />
          <Detail label="Inputs" value={String(tx.inputs.length)} />
          <Detail label="Outputs" value={String(tx.outputs.length)} />
        </dl>
      </Card>

      {tx.mint && tx.mint.policyIds.length > 0 ? (
        <Card className="mb-4">
          <h2 className="mg-overline px-4 pt-4">
            Mint / burn policies ({tx.mint.policyIds.length})
          </h2>
          <p className="px-4 pt-1 text-[12.5px] text-text-3">
            Policy IDs whose assets this transaction mints or burns. Quantities per asset appear on
            the affected outputs in the UTxO flow.
          </p>
          <ul className="space-y-1 p-4">
            {tx.mint.policyIds.map((p) => (
              <li key={p}>
                <Identifier value={p} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {tx.referenceInputs.length > 0 ? (
        <Card>
          <h2 className="mg-overline px-4 pt-4">Reference inputs ({tx.referenceInputs.length})</h2>
          <p className="px-4 pt-1 text-[12.5px] text-text-3">
            Read by scripts without being spent.
          </p>
          <ul className="space-y-1 p-4">
            {tx.referenceInputs.map((r) => (
              <li key={`${r.txId}-${r.index}`}>
                <Identifier value={`${r.txId}#${r.index}`} href={`/transaction/${r.txId}`} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );

  const utxoTab = (
    <>
      {/* The equation leads the tab: two lists show what the transaction
          contains, and inputs = outputs + fee shows what it did. */}
      <LedgerEquation tx={tx} />
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
      <Card>
        <h2 className="mg-overline px-4 pt-4">Inputs ({tx.inputs.length})</h2>
        <ul className="space-y-3 p-4">
          {tx.inputs.map((input) => (
            <li
              key={`${input.txId}-${input.index}`}
              className="rounded-lg border border-border bg-surface-2/40 p-3"
            >
              <Identifier
                value={`${input.txId}#${input.index}`}
                href={`/transaction/${input.txId}`}
              />
              {input.resolved ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Identifier
                    value={input.resolved.address}
                    href={`/address/${input.resolved.address}`}
                  />
                  <ValueCell value={input.resolved.value} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-text-3">
                  Spend side not resolvable (already spent or pruned).
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="hidden items-center text-text-3 lg:flex">
        <Icon name="arrowRight" size={20} />
      </div>

      <Card>
        <h2 className="mg-overline px-4 pt-4">Outputs ({tx.outputs.length})</h2>
        <ul className="space-y-3 p-4">
          {tx.outputs.map((output, i) => (
            <li
              key={i}
              // Neutral by default: an accent on every output encodes nothing.
              // Accent is reserved for something provable (belongs to the
              // viewed address, carries a mint, holds a datum or script ref).
              className="rounded-lg border border-border bg-surface-2/40 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <Identifier value={output.address} href={`/address/${output.address}`} />
                <ValueCell value={output.value} />
              </div>
              {output.hasDatum || output.hasScriptRef ? (
                <div className="mt-1.5 flex gap-1.5">
                  {output.hasDatum ? <Chip>datum</Chip> : null}
                  {output.hasScriptRef ? <Chip>script ref</Chip> : null}
                </div>
              ) : null}
              {Object.keys(output.value.assets).length > 0 ? (
                <div className="mt-2 border-t border-border pt-2">
                  <AssetHierarchy assets={output.value.assets} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      </div>
    </>
  );

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader title="Transaction">
        <StatusBadge status={status} />
      </PageHeader>
      <IdentityBar
        overline="Transaction hash"
        value={tx.txId}
        badges={<StatusBadge status={tx.validity} />}
      />

      {journey}
      {!terminal ? <LifecyclePoller /> : null}

      <SummaryBand
        items={[
          { label: "Inputs", value: tx.inputs.length },
          { label: "Outputs", value: tx.outputs.length },
          { label: "Fee", value: <AdaAmount lovelace={tx.fee} /> },
        ]}
      />

      <Tabs
        tabs={[
          { id: "summary", label: "Summary", content: summaryTab },
          {
            id: "utxo",
            label: "UTxO flow",
            count: tx.inputs.length + tx.outputs.length,
            content: utxoTab,
          },
          {
            id: "raw",
            label: "Raw",
            content: (
              <>
                <div className="mb-4">
                  <ApiExample path={`/api/transaction?tx_hash=${tx.txId}`} />
                </div>
                <RawData data={data} filename={`tx-${tx.txId}.json`} />
              </>
            ),
          },
        ]}
      />
    </>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-border bg-surface px-1.5 py-px text-[11px] text-text-3">
      {children}
    </span>
  );
}

/** Reads as a phrase rather than a pair of slots joined by a glyph, and each
 * open-ended case says which side is open. */
function validityIntervalText(interval: TransactionView["validityInterval"]): string {
  const { start, end } = interval;
  if (start !== null && end !== null) return `Slots ${start} to ${end}`;
  if (start !== null) return `From slot ${start}`;
  if (end !== null) return `Until slot ${end}`;
  return "Unbounded";
}

function Detail({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="mg-overline">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">
        {value}
        {hint ? <span className="mt-0.5 block text-[12px] text-text-3">{hint}</span> : null}
      </dd>
    </div>
  );
}

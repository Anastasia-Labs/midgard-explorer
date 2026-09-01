import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdaAmount } from "../../../../components/ui/domain/amount";
import { ApiExample } from "../../../../components/ui/domain/apiexample";
import { Breadcrumbs } from "../../../../components/ui/base/breadcrumbs";
import { Identifier } from "../../../../components/ui/domain/identifier";
import { IdentityBar } from "../../../../components/ui/domain/identitybar";
import { PageError } from "../../../../components/ui/base/pageerror";
import { Callout, Card, PageHeader } from "../../../../components/ui/base/layout";
import { RawData } from "../../../../components/ui/base/rawdata";
import { SummaryBand } from "../../../../components/ui/domain/summary";
import { DataTable } from "../../../../components/ui/base/table";
import { Tabs } from "../../../../components/ui/base/tabs";
import { Timestamp } from "../../../../components/ui/base/timestamp";
import { ManifestBadge, contractName } from "../../../../components/ui/domain/validatorlabel";
import { api } from "../../../../lib/api";
import { formatQuantity } from "../../../../lib/asset";
import { truncateId } from "../../../../lib/format";
import { listErrorMessage, orNotFound } from "../../../../lib/serverErrors";
import { viewerInit } from "../../../../lib/viewerInit";

export const dynamic = "force-dynamic";

const isScriptHash = (value: string) => /^[0-9a-fA-F]{56}$/.test(value);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ scriptHash: string }>;
}): Promise<Metadata> {
  const { scriptHash } = await params;
  return { title: `Validator ${truncateId(scriptHash)}` };
}

export default async function ValidatorPage({
  params,
}: {
  params: Promise<{ scriptHash: string }>;
}) {
  const { scriptHash } = await params;
  if (!isScriptHash(scriptHash)) notFound();
  const hash = scriptHash.toLowerCase();

  let data;
  try {
    data = await orNotFound(api.l1Validator(hash, await viewerInit()));
  } catch (error) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Overview", href: "/" },
            { label: "Cardano", href: "/l1" },
            { label: "Validator" },
          ]}
        />
        <PageHeader title="Validator" />
        <IdentityBar overline="Script hash" value={hash} />
        <PageError message={listErrorMessage(error)} />
      </>
    );
  }

  const totalExecutions = data.operations.reduce((sum, row) => sum + row.count, 0);
  const successful = data.operations
    .filter((row) => row.validContract)
    .reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/" },
          { label: "Cardano", href: "/l1" },
          { label: contractName(data.validator.family) },
        ]}
      />
      <PageHeader
        entity="validator"
        title={`${contractName(data.validator.family)} validator`}
        subtitle="Indexed Cardano UTxOs, transactions, and script executions for this Midgard validator."
      >
        <ManifestBadge entryName={data.validator.entryName} />
      </PageHeader>
      <IdentityBar overline="Validator script hash" value={data.validator.scriptHash} />

      <p className="mb-4 mg-caption text-text-3">
        Deployment: <span className="font-mono">{data.deployment}</span>
      </p>

      {data.coverage.truncated ? (
        <Callout tone="warning" title="Showing the latest indexed evidence only.">
          At least one section reached the {data.coverage.limitedTo}-row response bound.
        </Callout>
      ) : null}

      <SummaryBand
        items={[
          { label: "Current UTxOs", value: data.utxos.length },
          { label: "Transactions", value: data.history.length },
          { label: "Executions", value: totalExecutions },
          { label: "Validated", value: `${successful}/${totalExecutions}` },
        ]}
      />

      <Tabs
        label="Validator evidence"
        tabs={[
          {
            id: "utxos",
            label: "UTxOs",
            count: data.utxos.length,
            content: (
              <Card>
                <DataTable
                  caption="Current Cardano UTxOs at this validator"
                  columns={[
                    {
                      header: "Output reference",
                      cell: (row) => (
                        <Identifier
                          value={`${row.sourceTxHash}#${row.sourceIndex}`}
                          head={10}
                          tail={8}
                        />
                      ),
                    },
                    {
                      header: "Value",
                      cell: (row) => <AdaAmount lovelace={row.lovelace} />,
                      align: "right",
                    },
                    {
                      header: "Assets",
                      cell: (row) => row.assets.length,
                      align: "right",
                      hideBelow: "sm",
                    },
                    {
                      header: "Datum",
                      cell: (row) =>
                        row.inlineDatum === null
                          ? row.datumHash
                            ? "Hash only"
                            : "None"
                          : "Inline",
                      hideBelow: "md",
                    },
                    {
                      header: "Observed",
                      cell: (row) => <Timestamp iso={row.tx.txTime} />,
                      hideBelow: "md",
                    },
                  ]}
                  mobileRow={(row) => ({
                    primary: (
                      <Identifier
                        value={`${row.sourceTxHash}#${row.sourceIndex}`}
                        head={10}
                        tail={6}
                      />
                    ),
                    secondary: <AdaAmount lovelace={row.lovelace} />,
                    meta: <Timestamp iso={row.tx.txTime} />,
                    details: [{ label: "Assets", value: String(row.assets.length) }],
                  })}
                  rows={data.utxos}
                  keyOf={(row) => `${row.sourceTxHash}#${row.sourceIndex}`}
                  emptyTitle="No current validator UTxOs"
                  emptyHint="Every indexed output at this validator has been consumed."
                />
              </Card>
            ),
          },
          {
            id: "history",
            label: "History",
            count: data.history.length,
            content: (
              <Card>
                <DataTable
                  caption="Transactions touching this validator"
                  columns={[
                    {
                      header: "Transaction",
                      cell: (row) => (
                        <Identifier value={row.txHash} href={`/l1/transaction/${row.txHash}`} />
                      ),
                    },
                    { header: "Block", cell: (row) => `#${row.blockHeight}`, hideBelow: "sm" },
                    { header: "I/O rows", cell: (row) => row.ioCount, align: "right" },
                    { header: "Executions", cell: (row) => row.executionCount, align: "right" },
                    { header: "Events", cell: (row) => row.eventCount, align: "right" },
                    {
                      header: "Time",
                      cell: (row) => <Timestamp iso={row.txTime} />,
                      hideBelow: "md",
                    },
                  ]}
                  mobileRow={(row) => ({
                    primary: (
                      <Identifier
                        value={row.txHash}
                        href={`/l1/transaction/${row.txHash}`}
                        head={10}
                        tail={6}
                      />
                    ),
                    meta: <Timestamp iso={row.txTime} />,
                    details: [
                      { label: "I/O rows", value: String(row.ioCount) },
                      { label: "Executions", value: String(row.executionCount) },
                      { label: "Events", value: String(row.eventCount) },
                    ],
                  })}
                  rows={data.history}
                  keyOf={(row) => row.txHash}
                  emptyTitle="No validator history"
                  emptyHint="No indexed Cardano transaction has touched this validator."
                />
              </Card>
            ),
          },
          {
            id: "operations",
            label: "Operations",
            count: data.operations.length,
            content: (
              <Card>
                <DataTable
                  caption="Redeemer operation breakdown"
                  columns={[
                    { header: "Purpose", cell: (row) => row.purpose },
                    {
                      header: "Result",
                      cell: (row) => (row.validContract ? "Validated" : "Failed"),
                    },
                    { header: "Executions", cell: (row) => row.count, align: "right" },
                    {
                      header: "Memory units",
                      cell: (row) => formatQuantity(row.memUnits),
                      align: "right",
                      hideBelow: "sm",
                    },
                    {
                      header: "Step units",
                      cell: (row) => formatQuantity(row.stepUnits),
                      align: "right",
                      hideBelow: "md",
                    },
                    {
                      header: "Fees",
                      cell: (row) => <AdaAmount lovelace={row.fee} />,
                      align: "right",
                    },
                  ]}
                  mobileRow={(row) => ({
                    primary: row.purpose,
                    status: row.validContract ? "Validated" : "Failed",
                    secondary: <AdaAmount lovelace={row.fee} />,
                    details: [{ label: "Executions", value: String(row.count) }],
                  })}
                  rows={data.operations}
                  keyOf={(row) => `${row.purpose}-${row.validContract}`}
                  emptyTitle="No validator executions"
                  emptyHint="No redeemers for this validator have been indexed."
                />
              </Card>
            ),
          },
          {
            id: "raw",
            label: "Raw",
            content: (
              <>
                <div className="mb-4">
                  <ApiExample path={`/api/l1/validator?scriptHash=${hash}`} />
                </div>
                <RawData data={data} filename={`validator-${hash}.json`} />
              </>
            ),
          },
        ]}
      />
    </>
  );
}

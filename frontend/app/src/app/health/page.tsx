import type { Metadata } from "next";
import Link from "next/link";
import type { MetricsResponse, Percentile } from "@midgard-explorer/contracts";
import { Breadcrumbs } from "../../components/ui/base/breadcrumbs";
import { FactGroup, FactRow } from "../../components/ui/base/facts";
import { Card, PageHeader } from "../../components/ui/base/layout";
import { ShortId } from "../../components/ui/domain/identifier";
import { Missing, Verdict } from "../../components/ui/domain/metrics/figures";
import { StatusBadge } from "../../components/ui/domain/status";
import { RefreshRetry } from "../../features/health/RefreshRetry";
import { api } from "../../lib/api";
import { formatDuration, formatTimestamp, groupThousands } from "../../lib/format";
import { networkHealth, waitingPhrase } from "../../lib/health";
import { viewerInit } from "../../lib/viewerInit";

export const metadata: Metadata = {
  title: "Network health",
  description: "How the Midgard node is producing, settling and admitting work.",
};

export const dynamic = "force-dynamic";

const CRUMBS = [{ label: "Overview", href: "/" }, { label: "Network health" }];

const count = (n: number | undefined) =>
  n === undefined ? <Missing /> : groupThousands(String(n));

/** A median and a 95th percentile, with the sample they came from, since a
 * percentile over four records is not a measurement. */
function spread(p50: number | null, p95: number | null, n: number) {
  if (p50 === null) return <span className="text-text-3">Not measured yet</span>;
  const p95Text = p95 === null ? "" : ` · ${formatDuration(p95)} for 95%`;
  return (
    <>
      {formatDuration(p50)} typical{p95Text}
      <span className="text-text-3"> · over {groupThousands(String(n))}</span>
    </>
  );
}

const latency = (p: Percentile | undefined) =>
  p === undefined ? <Missing>None</Missing> : spread(p.p50Ms, p.p95Ms, p.sampleCount);

/**
 * The operator's view of the node, moved off the overview.
 *
 * Every figure the overview's operations panel used to carry, and the ones it
 * never had room for, read from the same `/api/metrics` response. Zeros are
 * shown rather than hidden: here a zero is an answer. When the response fails,
 * every row keeps its place with its default, as the overview's cards do.
 */
export default async function HealthPage() {
  let metrics: MetricsResponse | null = null;
  try {
    metrics = await api.metrics(await viewerInit());
  } catch {
    metrics = null;
  }
  const tip = metrics?.tip;
  const throughput = metrics?.throughput;
  const finality = metrics?.finality;
  const admission = metrics?.admission;
  const w = metrics?.window;
  const hours = w?.hours ?? 24;
  const waiting = metrics === null ? null : waitingPhrase(metrics.waiting);

  return (
    <>
      <Breadcrumbs items={CRUMBS} />
      <PageHeader
        title="Network health"
        subtitle={w?.partial ? `Since ${formatTimestamp(w.observedFrom ?? w.start)}` : undefined}
        meta={metrics === null ? <RefreshRetry /> : undefined}
      />

      <Card region="network-health" className="mb-4">
        <Verdict health={networkHealth(metrics)} />

        <FactGroup title="Production">
          <FactRow label="Chain tip" term="chainTip">
            {tip === undefined || tip.headerHash === null ? (
              <Missing>None</Missing>
            ) : (
              <>
                <Link
                  href={`/block/${tip.headerHash}`}
                  className="font-mono text-link hover:text-link-hover hover:underline"
                >
                  {tip.height === null ? (
                    <ShortId value={tip.headerHash} head={12} tail={10} />
                  ) : (
                    `Block #${groupThousands(String(tip.height))}`
                  )}
                </Link>
                {tip.ageSeconds === null ? null : (
                  <span className="text-text-3">
                    {" "}
                    · {formatDuration(tip.ageSeconds * 1000)} ago
                  </span>
                )}
              </>
            )}
          </FactRow>
          <FactRow label={`Blocks in ${hours}h`} term="blockThroughput">
            {count(throughput?.blocks)}
          </FactRow>
          <FactRow label={`Transactions in ${hours}h`} term="transactionThroughput">
            {count(throughput?.transactions)}
          </FactRow>
          <FactRow label={`Time between blocks in ${hours}h`}>
            {throughput === undefined ? (
              <Missing>None</Missing>
            ) : (
              spread(
                throughput.blockIntervalSeconds.p50 === null
                  ? null
                  : throughput.blockIntervalSeconds.p50 * 1000,
                throughput.blockIntervalSeconds.p95 === null
                  ? null
                  : throughput.blockIntervalSeconds.p95 * 1000,
                throughput.blockIntervalSeconds.sampleCount,
              )
            )}
          </FactRow>
          <FactRow label="Awaiting a block" term="awaitingBlock">
            {waiting === null ? (
              <Missing />
            ) : waiting.count === 0 ? (
              "Nothing"
            ) : (
              <>
                {waiting.parts.join(" · ")}
                {metrics?.waiting.since ? (
                  <span className="text-text-3">
                    {" "}
                    · {waiting.count > 1 ? "oldest since" : "since"}{" "}
                    {formatTimestamp(metrics.waiting.since)}
                  </span>
                ) : null}
              </>
            )}
          </FactRow>
        </FactGroup>

        <FactGroup title="Settlement on Cardano">
          <FactRow label="Settled" term="l1Finality">
            {count(finality?.finalized)}
          </FactRow>
          <FactRow label="Awaiting settlement" term="awaitingSettlement">
            {count(finality?.pending)}
          </FactRow>
          <FactRow label="Abandoned">{count(finality?.abandoned)}</FactRow>
          <FactRow label="Oldest awaiting">
            {finality === undefined ? (
              <Missing>None</Missing>
            ) : finality.oldestUnsettled === null ? (
              "None"
            ) : (
              <span className="inline-flex flex-wrap items-center gap-2">
                <Link
                  href={`/block/${finality.oldestUnsettled.headerHash}`}
                  className="font-mono text-link hover:text-link-hover hover:underline"
                >
                  <ShortId value={finality.oldestUnsettled.headerHash} head={12} tail={10} />
                </Link>
                <StatusBadge status={finality.oldestUnsettled.status} />
                <span className="text-text-3">
                  waiting {formatDuration(finality.oldestUnsettled.waitingSeconds * 1000)}
                </span>
              </span>
            )}
          </FactRow>
          <FactRow label="Time to settle, all time">{latency(finality?.settlementLatency)}</FactRow>
        </FactGroup>

        <FactGroup title="Admission">
          <FactRow label="Queue" term="admissionQueue">
            {count(admission?.queueDepth)}
          </FactRow>
          <FactRow label={`Accepted in ${hours}h`}>{count(admission?.accepted)}</FactRow>
          <FactRow label={`Rejected in ${hours}h`}>
            {admission === undefined ? (
              <Missing />
            ) : (
              <>
                {groupThousands(String(admission.rejected))}
                {admission.rejectionRate === null ? null : (
                  <span className="text-text-3">
                    {" "}
                    · {(admission.rejectionRate * 100).toFixed(1)}% of decisions
                  </span>
                )}
              </>
            )}
          </FactRow>
          <FactRow label={`Time to admit in ${hours}h`} term="admissionLatency">
            {latency(admission?.latency)}
          </FactRow>
        </FactGroup>
      </Card>
    </>
  );
}

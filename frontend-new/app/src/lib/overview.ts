import { api, type FetchInit } from "./api";

/** Every panel degrades independently: one failing endpoint must not blank the
 * whole overview, so each result is settled and reported as null on failure. */
export async function getOverviewData(init?: FetchInit) {
  const [blocks, txs, totalB, totalT, metrics, l1] = await Promise.allSettled([
    api.recentBlocks(init),
    api.recentTxs(init),
    api.totalBlocks(init),
    api.totalTxs(init),
    api.metrics(init),
    api.l1Summary(init),
  ]);
  return {
    recentBlocks: blocks.status === "fulfilled" ? blocks.value.rows : null,
    recentTxs: txs.status === "fulfilled" ? txs.value.rows : null,
    totalBlocks: totalB.status === "fulfilled" ? totalB.value.total : null,
    totalTxs: totalT.status === "fulfilled" ? totalT.value.total : null,
    metrics: metrics.status === "fulfilled" ? metrics.value : null,
    l1: l1.status === "fulfilled" ? l1.value : null,
  };
}

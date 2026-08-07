import { api } from "./api";

/** Every panel degrades independently: one failing endpoint must not blank the
 * whole overview, so each result is settled and reported as null on failure. */
export async function getOverviewData() {
  const [blocks, txs, totalB, totalT, metrics, l1] = await Promise.allSettled([
    api.recentBlocks(),
    api.recentTxs(),
    api.totalBlocks(),
    api.totalTxs(),
    api.metrics(),
    api.l1Summary(),
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

import { useEffect, useState } from "react";
import { fetchRecentBlocks, fetchTotalBlocks } from "../api/block";
import {
  fetchRecentTransactions,
  fetchTotalTransactions,
} from "../api/transaction";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import { formatHash, formatTimestamp } from "../utils";
import { Link } from "react-router-dom";

type RecentTransaction = {
  header_hash: string;
  tx_id: string;
  time_stamp_tz: string;
};

type RecentBlock = {
  header_hash: string;
  time_stamp_tz: string;
};

export default function HomePage() {
  const [totalTransactions, setTotalTransactions] = useState<string>("—");
  const [totalBlocks, setTotalBlocks] = useState<string>("—");
  const [recentBlocks, setRecentBlocks] = useState<RecentBlock[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<
    RecentTransaction[]
  >([]);

  useEffect(() => {
    Promise.all([
      fetchTotalTransactions(),
      fetchTotalBlocks(),
    ])
      .then(([txs, blocks]) => {
        if (typeof txs?.total === "number") {
          setTotalTransactions(txs.total.toString());
        }
        if (typeof blocks?.total === "number") {
          setTotalBlocks(blocks.total.toString());
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  useEffect(() => {
    fetchRecentBlocks()
      .then((blocks) => setRecentBlocks(blocks))
      .catch((error) => {
        console.error(error);
      });
  }, []);

  useEffect(() => {
    fetchRecentTransactions()
      .then((rows) => setRecentTransactions(rows))
      .catch((error) => {
        console.error(error);
      });
  }, []);

  const stats = [
    { label: "Total Transactions", value: totalTransactions },
    { label: "Total Blocks", value: totalBlocks },
  ];

  const recentBlocksToRender = recentBlocks;

  return (
    <PageShell>
      <SectionHeader
        title="Home"
        subtitle="Monitor recent activity and network health at a glance."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {stats.map((item) => (
          <GlassCard key={item.label} className="p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-100">
              {item.value}
            </p>
          </GlassCard>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
              Recent Transactions
            </h2>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <div className="grid grid-cols-[1.4fr_1fr] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
              <div className="px-4 py-3">Tx Hash</div>
              <div className="px-4 py-3">Timestamp</div>
            </div>
            <div className="divide-y divide-white/10">
              {recentTransactions.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400">
                  No transactions yet.
                </div>
              ) : (
                recentTransactions.map((tx) => (
                  <div
                    key={tx.tx_id}
                    className="grid grid-cols-[1.4fr_1fr] gap-0 bg-slate-950/40"
                  >
                    <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                      <Link
                        to={`/transaction/${tx.tx_id}`}
                        title={tx.tx_id}
                        className="hover:text-cyan-200"
                      >
                        {formatHash(tx.tx_id)}
                      </Link>
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-300">
                      {formatTimestamp(tx.time_stamp_tz)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
              Recent Blocks
            </h2>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <div className="grid grid-cols-[1.4fr_1fr] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
              <div className="px-4 py-3">Header Hash</div>
              <div className="px-4 py-3">Timestamp</div>
            </div>
            <div className="divide-y divide-white/10">
              {recentBlocksToRender.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400">
                  No blocks yet.
                </div>
              ) : (
                recentBlocksToRender.map((block) => (
                  <div
                    key={block.header_hash}
                    className="grid grid-cols-[1.4fr_1fr] gap-0 bg-slate-950/40"
                  >
                    <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                      <Link
                        to={`/block/${block.header_hash}`}
                        title={block.header_hash}
                        className="hover:text-cyan-200"
                      >
                        {formatHash(block.header_hash)}
                      </Link>
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-300">
                      {formatTimestamp(block.time_stamp_tz)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </GlassCard>
      </div>
    </PageShell>
  );
}

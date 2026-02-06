import { useEffect, useState } from "react";
import { fetchTotalBlocks } from "../api/block";
import { fetchTotalTransactions } from "../api/transaction";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";

type RecentTransaction = {
  tx_id: string;
  time_stamp_tz: string;
};

type RecentBlock = {
  height: number;
  header_hash: string;
  time_stamp_tz: string;
};

export default function HomePage() {
  const [totalTransactions, setTotalTransactions] = useState<string>("—");
  const [totalBlocks, setTotalBlocks] = useState<string>("—");

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

  const stats = [
    { label: "Total Transactions", value: totalTransactions },
    { label: "Total Blocks", value: totalBlocks },
  ];

  const recentTransactions: RecentTransaction[] = [];
  const recentBlocks: RecentBlock[] = [];

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
            <div className="grid grid-cols-[1.4fr,1fr] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
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
                    className="grid grid-cols-[1.4fr,1fr] gap-0 bg-slate-950/40"
                  >
                    <div className="px-4 py-4 text-xs text-slate-200">
                      {tx.tx_id}
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-300">
                      {tx.time_stamp_tz}
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
            <div className="grid grid-cols-[120px,1.4fr,1fr] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
              <div className="px-4 py-3">Height</div>
              <div className="px-4 py-3">Header Hash</div>
              <div className="px-4 py-3">Timestamp</div>
            </div>
            <div className="divide-y divide-white/10">
              {recentBlocks.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400">
                  No blocks yet.
                </div>
              ) : (
                recentBlocks.map((block) => (
                  <div
                    key={`${block.height}-${block.header_hash}`}
                    className="grid grid-cols-[120px,1.4fr,1fr] gap-0 bg-slate-950/40"
                  >
                    <div className="px-4 py-4 text-sm text-slate-200">
                      {block.height}
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-200">
                      {block.header_hash}
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-300">
                      {block.time_stamp_tz}
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

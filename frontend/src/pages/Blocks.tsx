import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchBlocksPage } from "../api/block";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import { formatHash, formatTimestamp } from "../utils";

type BlockRow = {
  header_hash: string;
  time_stamp_tz: string;
};

export default function BlocksPage() {
  const { page } = useParams();
  const currentPage = Math.max(1, Number(page) || 1);
  const [rows, setRows] = useState<BlockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, limit)));

  useEffect(() => {
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchBlocksPage(currentPage)
      .then((data) => {
        setRows(data.rows);
        setTotal(data.total);
        setLimit(data.limit);
      })
      .catch((error) => {
        console.error(error);
        setError(error?.message ?? "Failed to load blocks");
      })
      .finally(() => setIsLoading(false));
  }, [currentPage]);

  const pagination = useMemo(() => {
    if (pageCount <= 1) return [1];
    const items = new Set<number>();
    items.add(1);
    items.add(pageCount);
    for (let i = -2; i <= 2; i += 1) {
      const value = currentPage + i;
      if (value > 1 && value < pageCount) items.add(value);
    }
    return Array.from(items).sort((a, b) => a - b);
  }, [currentPage, pageCount]);

  return (
    <PageShell>
      <SectionHeader
        title="Blocks"
        subtitle="Browse recent blocks with timestamps."
      />

      <div className="mt-8 grid gap-6">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
              Blocks
            </h2>
            <span className="text-xs text-slate-400">
              Page {currentPage} of {pageCount}
            </span>
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-200 ring-1 ring-rose-400/30">
              {error}
            </div>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <div className="grid grid-cols-[1.6fr_1fr] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
              <div className="px-4 py-3">Header Hash</div>
              <div className="px-4 py-3">Timestamp</div>
            </div>
            <div className="divide-y divide-white/10">
              {rows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400">
                  {isLoading ? "Loading blocks..." : "No blocks found."}
                </div>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.header_hash}
                    className="grid grid-cols-[1.6fr_1fr] gap-0 bg-slate-950/40"
                  >
                    <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                      <Link
                        to={`/block/${row.header_hash}`}
                        title={row.header_hash}
                        className="hover:text-cyan-200"
                      >
                        {formatHash(row.header_hash)}
                      </Link>
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-300">
                      {formatTimestamp(row.time_stamp_tz)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {pagination.map((value, index) => {
              const isActive = value === currentPage;
              const showEllipsis =
                index > 0 && value - pagination[index - 1] > 1;
              return (
                <div key={`page-${value}`}>
                  {showEllipsis ? (
                    <span className="px-3 text-xs text-slate-400">…</span>
                  ) : null}
                  <Link
                    to={`/blocks/${value}`}
                    className={`inline-flex h-9 min-w-[36px] items-center justify-center rounded-full px-3 text-xs font-semibold transition ${
                      isActive
                        ? "bg-cyan-400/90 text-slate-950"
                        : "bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    {value}
                  </Link>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>
    </PageShell>
  );
}

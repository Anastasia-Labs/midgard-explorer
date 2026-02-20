import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchTransactionsPage } from "../api/transaction";
import type { Transaction } from "../cddl";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import {
  formatAda,
  formatHash,
  formatTimestamp,
  getFee,
  getInputsCount,
  getOutputsCount,
  getTotalOutput,
  parseCbor,
} from "../utils";

type TransactionRow = {
  header_hash: string;
  tx_id: string;
  time_stamp_tz: string;
  transaction: Transaction | null;
};

export default function TransactionsPage() {
  const { page } = useParams();
  const currentPage = Math.max(1, Number(page) || 1);
  const [rows, setRows] = useState<TransactionRow[]>([]);
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

    fetchTransactionsPage(currentPage)
      .then((data) => {
        setTotal(data.total);
        setLimit(data.limit);
        const fetched = data.rows.map((row) => ({
          ...row,
          transaction: row.tx ? parseCbor(row.tx) : null,
        }));
        setRows(fetched);
      })
      .catch((error) => {
        console.error(error);
        setError(error?.message ?? "Failed to load transactions");
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
    const sorted = Array.from(items).sort((a, b) => a - b);
    return sorted;
  }, [currentPage, pageCount]);

  return (
    <PageShell>
      <SectionHeader
        title="Transactions"
        subtitle="Browse recent transactions with inputs, outputs, and fees."
      />

      <div className="mt-8 grid gap-6">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
              Transactions
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
            <div className="grid grid-cols-[1.4fr_110px_110px_140px_160px_1fr] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
              <div className="px-4 py-3">Tx Hash</div>
              <div className="px-4 py-3">Inputs</div>
              <div className="px-4 py-3">Outputs</div>
              <div className="px-4 py-3">Fee</div>
              <div className="px-4 py-3">Total Output</div>
              <div className="px-4 py-3">Timestamp</div>
            </div>
            <div className="divide-y divide-white/10">
              {rows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400">
                  {isLoading
                    ? "Loading transactions..."
                    : "No transactions found."}
                </div>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.tx_id}
                    className="grid grid-cols-[1.4fr_110px_110px_140px_160px_1fr] gap-0 bg-slate-950/40"
                  >
                    <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                      <Link
                        to={`/transaction/${row.tx_id}`}
                        title={row.tx_id}
                        className="hover:text-cyan-200"
                      >
                        {formatHash(row.tx_id)}
                      </Link>
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-200">
                      {row.transaction ? getInputsCount(row.transaction) : "—"}
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-200">
                      {row.transaction ? getOutputsCount(row.transaction) : "—"}
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                      {row.transaction ? formatAda(getFee(row.transaction)) : "—"}
                    </div>
                    <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                      {row.transaction
                        ? formatAda(getTotalOutput(row.transaction))
                        : "—"}
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
                    to={`/transactions/${value}`}
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

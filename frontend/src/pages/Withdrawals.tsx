import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchWithdrawalsPage } from "../api/withdrawals";
import type { WithdrawalRow, WithdrawalStatus } from "../api/withdrawals";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import { formatHash, formatTimestamp, formatValueView } from "../utils";

const STATUS_STYLES: Record<WithdrawalStatus, string> = {
  awaiting: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/30",
  projected: "bg-blue-400/10 text-blue-300 ring-1 ring-blue-400/30",
  finalized: "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30",
};

function StatusBadge({ status }: { status: WithdrawalStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
        STATUS_STYLES[status] ??
        "bg-white/5 text-slate-300 ring-1 ring-white/10"
      }`}
    >
      {status}
    </span>
  );
}

function ValidityBadge({ validity }: { validity: string | null }) {
  if (!validity) return <span className="text-slate-500">—</span>;
  const isValid = validity === "WithdrawalIsValid";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
        isValid
          ? "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30"
          : "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/30"
      }`}
    >
      {validity}
    </span>
  );
}

export default function WithdrawalsPage() {
  const { page } = useParams();
  const currentPage = Math.max(1, Number(page) || 1);
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, limit)));

  useEffect(() => {
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchWithdrawalsPage(currentPage)
      .then((data) => {
        setTotal(data.total);
        setLimit(data.limit);
        setRows(data.rows);
      })
      .catch((error) => {
        console.error(error);
        setError(error?.message ?? "Failed to load withdrawals");
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
        title="Withdrawals"
        subtitle="Browse L2 to L1 withdrawals and their projection status."
      />

      <div className="mt-8 grid gap-6">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
              Withdrawals
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

          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
            <div className="grid min-w-[1180px] grid-cols-[100px_120px_1.2fr_140px_1.2fr_180px_140px] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
              <div className="px-4 py-3">Status</div>
              <div className="px-4 py-3">Validity</div>
              <div className="px-4 py-3">L1 Tx</div>
              <div className="px-4 py-3">L2 Value</div>
              <div className="px-4 py-3">L1 address (hex)</div>
              <div className="px-4 py-3">Inclusion Time</div>
              <div className="px-4 py-3">Projected Block</div>
            </div>
            <div className="min-w-[1180px] divide-y divide-white/10">
              {rows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400">
                  {isLoading ? "Loading withdrawals..." : "No withdrawals found."}
                </div>
              ) : (
                rows.map((row) => {
                  const l1TxRef = `${row.withdrawal_l1_tx_hash}#${row.withdrawal_l1_output_index}`;
                  return (
                    <div
                      key={row.event_id}
                      className="grid grid-cols-[100px_120px_1.2fr_140px_1.2fr_180px_140px] gap-0 bg-slate-950/40"
                    >
                      <div className="px-4 py-4">
                        <StatusBadge status={row.status} />
                      </div>
                      <div className="px-4 py-4">
                        <ValidityBadge validity={row.validity} />
                      </div>
                      <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                        <span title={l1TxRef}>
                          {formatHash(row.withdrawal_l1_tx_hash)}#
                          {row.withdrawal_l1_output_index}
                        </span>
                      </div>
                      <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                        {row.l2_value ? formatValueView(row.l2_value) : "—"}
                      </div>
                      <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                        <span title={row.l1_address}>
                          {formatHash(row.l1_address, 12, 8)}
                        </span>
                      </div>
                      <div className="px-4 py-4 text-xs text-slate-300">
                        {formatTimestamp(row.inclusion_time)}
                      </div>
                      <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                        {row.projected_header_hash ? (
                          <Link
                            to={`/block/${row.projected_header_hash}`}
                            title={row.projected_header_hash}
                            className="hover:text-cyan-200"
                          >
                            {formatHash(row.projected_header_hash)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                  );
                })
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
                    to={`/withdrawals/${value}`}
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

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchBlock } from "../api/block";
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
  isHexOfLength,
  parseCbor,
  safeStringify,
} from "../utils";

export default function BlockPage() {
  const { headerHash } = useParams();
  const [transactions, setTransactions] = useState<
    { tx_id: string; timestamp_tz: string; transaction: Transaction | null }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const formatFee = (tx: Transaction | null) =>
    tx ? formatAda(getFee(tx)) : "0.000000 ADA";
  const formatTotalOutput = (tx: Transaction | null) =>
    tx ? formatAda(getTotalOutput(tx)) : "0.000000 ADA";
  const totalFees = useMemo(
    () =>
      transactions.reduce((sum, item) => sum + getFee(item.transaction), 0n),
    [transactions],
  );
  const stats = useMemo(
    () => [
      { label: "Transaction Count", value: transactions.length.toString() },
      { label: "Total Fees", value: formatAda(totalFees) },
    ],
    [transactions.length, totalFees],
  );

  useEffect(() => {
    if (!headerHash) return;
    if (!isHexOfLength(headerHash, 56)) {
      Promise.resolve().then(() => {
        setError("Invalid block hash.");
        setTransactions([]);
      });
      return;
    }
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchBlock(headerHash)
      .then((data) => {
        const fetched = data.rows.map((row) => ({
          tx_id: row.tx_id,
          timestamp_tz: row.time_stamp_tz,
          transaction: row.tx ? parseCbor(row.tx) : null,
        }));
        setTransactions(fetched);
      })
      .catch((error) => {
        console.error(error);
        const apiMessage = error?.response?.data?.error;
        if (apiMessage === "Block not found.") {
          setError(apiMessage);
          setTransactions([]);
          return;
        }
        setError(error?.message ?? "Failed to load block");
      })
      .finally(() => setIsLoading(false));
  }, [headerHash]);

  if (error === "Invalid block hash." || error === "Block not found.") {
    return (
      <PageShell>
        <div className="mx-auto mt-20 max-w-3xl px-4 text-center text-lg text-slate-200">
          {error}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <SectionHeader
        title="Block Overview"
        subtitle="Inspect the transaction hashes returned by Midgard and decode each CBOR payload."
      />

      <div className="mt-8 grid gap-6">
        <GlassCard className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
                Header Hash
              </p>
              <p className="mt-2 break-all text-sm text-slate-200">
                {headerHash}
              </p>
            </div>
            <div className="text-xs text-slate-300" />
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-200 ring-1 ring-rose-400/30">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {stats.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                  {item.label}
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-100">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      <GlassCard className="mt-8 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Transactions
          </h2>
        </div>
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
            {transactions.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-400">
                {isLoading ? "Loading transactions..." : "No transactions yet."}
              </div>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.tx_id}
                  className="grid grid-cols-[1.4fr_110px_110px_140px_160px_1fr] gap-0 bg-slate-950/40"
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
                  <div className="px-4 py-4 text-xs text-slate-200">
                    {tx.transaction ? getInputsCount(tx.transaction) : "—"}
                  </div>
                  <div className="px-4 py-4 text-xs text-slate-200">
                    {tx.transaction ? getOutputsCount(tx.transaction) : "—"}
                  </div>
                  <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                    {tx.transaction ? formatFee(tx.transaction) : "—"}
                  </div>
                  <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                    {tx.transaction ? formatTotalOutput(tx.transaction) : "—"}
                  </div>
                  <div className="px-4 py-4 text-xs text-slate-300">
                    {formatTimestamp(tx.timestamp_tz)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard className="mt-8 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Parsed Transactions
          </h2>
        </div>
        <div className="mt-4 space-y-4">
          {transactions.length === 0 ? (
            <p className="text-sm text-slate-400">
              {isLoading ? "Parsing CBOR..." : "No transactions decoded yet."}
            </p>
          ) : (
            transactions.map((tx, index) => (
              <div
                key={`tx-${index}`}
                className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
              >
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-200">
                  Transaction {index + 1}
                </p>
                <pre className="mt-3 max-h-72 overflow-auto text-xs text-slate-200">
                  {tx.transaction ? safeStringify(tx.transaction) : "—"}
                </pre>
              </div>
            ))
          )}
        </div>
      </GlassCard>
    </PageShell>
  );
}

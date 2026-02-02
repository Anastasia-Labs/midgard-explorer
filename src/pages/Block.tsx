import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchBlock } from "../api/block";
import { fetchTransaction } from "../api/transaction";
import type { Transaction } from "../cddl";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import { parseCbor } from "../utils";

export default function BlockPage() {
  const { headerHash } = useParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [hashes, setHashes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const stats = useMemo(
    () => [
      { label: "Tx Count", value: hashes.length.toString() },
      { label: "Parsed", value: transactions.length.toString() },
    ],
    [hashes.length, transactions.length],
  );
  const safeStringify = (value: unknown) =>
    JSON.stringify(
      value,
      (_key, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );

  useEffect(() => {
    if (!headerHash) return;
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchBlock(headerHash)
      .then(async (data) => {
        const txIds: string[] = data.hashes;
        setHashes(txIds);
        const fetched = await Promise.all(
          txIds.map((txId) => fetchTransaction(txId)),
        );
        const parsed = fetched.map((tx) => parseCbor(tx.tx));
        setTransactions(parsed);
        console.log(parsed);
      })
      .catch((error) => {
        console.error(error);
        setError(error?.message ?? "Failed to load block");
      })
      .finally(() => setIsLoading(false));
  }, [headerHash]);

  return (
    <PageShell>
      <SectionHeader
        title="Block Overview"
        subtitle="Inspect the transaction hashes returned by Midgard and decode each CBOR payload."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr,1fr]">
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

        <GlassCard className="p-6">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Transaction Hashes
          </h2>
          <div className="mt-4 space-y-3">
            {hashes.length === 0 ? (
              <p className="text-sm text-slate-400">
                {isLoading ? "Loading hashes..." : "No hashes found."}
              </p>
            ) : (
              hashes.map((hash, index) => (
                <div
                  key={`${hash}-${index}`}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-200"
                >
                  {hash}
                </div>
              ))
            )}
          </div>
        </GlassCard>
      </div>

      <GlassCard className="mt-8 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Parsed Transactions
          </h2>
          <span className="text-xs text-slate-400">
            {transactions.length} decoded
          </span>
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
                  {safeStringify(tx)}
                </pre>
              </div>
            ))
          )}
        </div>
      </GlassCard>
    </PageShell>
  );
}

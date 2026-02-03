import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchAddressTransactions } from "../api/address";
import type { Transaction } from "../cddl";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import { parseCbor } from "../utils";

export default function AddressPage() {
  const { address } = useParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const safeStringify = (value: unknown) =>
    JSON.stringify(
      value,
      (_key, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );

  const stats = useMemo(
    () => [
      { label: "Balance", value: "1,234.56 ADA" },
      { label: "Transactions", value: transactions.length.toString() },
    ],
    [transactions.length],
  );

  useEffect(() => {
    if (!address) return;
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchAddressTransactions(address)
      .then((data) => {
        const txs: string[] = data.txs ?? [];
        const parsed = txs.map((cbor) => parseCbor(cbor));
        setTransactions(parsed);
      })
      .catch((error) => {
        console.error(error);
        setError(error?.message ?? "Failed to load address transactions");
      })
      .finally(() => setIsLoading(false));
  }, [address]);

  return (
    <PageShell>
      <SectionHeader
        title="Address"
        subtitle="Track activity and decode CBOR transactions tied to this address."
      />

      <div className="mt-8 grid gap-6">
        <GlassCard className="p-6">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
              Address
            </p>
            <p className="mt-2 break-all text-sm text-slate-200">{address}</p>
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Transactions
          </h2>
          <span className="text-xs text-slate-400">
            {transactions.length} rows
          </span>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
          <div className="grid grid-cols-[120px,1fr] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
            <div className="px-4 py-3">Index</div>
            <div className="px-4 py-3">Decoded</div>
          </div>
          <div className="divide-y divide-white/10">
            {transactions.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-400">
                {isLoading ? "Decoding CBOR..." : "No transactions found."}
              </div>
            ) : (
              transactions.map((tx, index) => (
                <div
                  key={`address-tx-${index}`}
                  className="grid grid-cols-[120px,1fr] gap-0 bg-slate-950/40"
                >
                  <div className="px-4 py-4 text-sm text-slate-300">
                    #{index + 1}
                  </div>
                  <div className="px-4 py-4">
                    <pre className="max-h-40 overflow-auto text-xs text-slate-200">
                      {safeStringify(tx)}
                    </pre>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </GlassCard>
    </PageShell>
  );
}

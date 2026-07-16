import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchAddressTransactions } from "../api/address";
import type { TransactionView } from "../cddl";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import {
  formatAda,
  formatHash,
  getFee,
  getInputsCount,
  getOutputsCount,
  getTotalOutput,
  isValidAddress,
} from "../utils";

type AddressTx = { tx_id: string; transaction: TransactionView };

export default function AddressPage() {
  const { address } = useParams();
  const [transactions, setTransactions] = useState<AddressTx[]>([]);
  // Balance is the ledger-derived lovelace total from the backend (decimal string),
  // not a client-side replay of the returned history.
  const [balance, setBalance] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const stats = useMemo(
    () => [
      { label: "Balance", value: formatAda(balance) },
      { label: "Transactions", value: transactions.length.toString() },
    ],
    [balance, transactions.length],
  );

  useEffect(() => {
    if (!address) return;
    if (!isValidAddress(address)) {
      Promise.resolve().then(() => {
        setError("Address is not valid.");
        setTransactions([]);
      });
      return;
    }
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchAddressTransactions(address)
      .then((data) => {
        setBalance(data.balance?.lovelace ?? "0");
        const parsed: AddressTx[] = data.history
          .filter((row) => Boolean(row.transaction))
          .map((row) => ({ tx_id: row.tx_id, transaction: row.transaction! }));
        setTransactions(parsed);
      })
      .catch((err) => {
        console.error(err);
        setError(err?.message ?? "Failed to load address transactions");
      })
      .finally(() => setIsLoading(false));
  }, [address]);

  if (error === "Address is not valid.") {
    return (
      <PageShell>
        <div className="mx-auto mt-20 max-w-3xl px-4 text-center text-lg text-slate-200">
          Address is not valid.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <SectionHeader
        title="Address"
        subtitle="Track activity and inspect the transactions tied to this address."
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
        <div className="flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Transactions
          </h2>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
          <div className="grid grid-cols-[1.4fr_110px_110px_140px_160px] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
            <div className="px-4 py-3">Tx Hash</div>
            <div className="px-4 py-3">Inputs</div>
            <div className="px-4 py-3">Outputs</div>
            <div className="px-4 py-3">Fee</div>
            <div className="px-4 py-3">Total Output</div>
          </div>
          <div className="divide-y divide-white/10">
            {transactions.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-400">
                {isLoading ? "Loading transactions..." : "No transactions found."}
              </div>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.tx_id}
                  className="grid grid-cols-[1.4fr_110px_110px_140px_160px] gap-0 bg-slate-950/40"
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
                    {getInputsCount(tx.transaction)}
                  </div>
                  <div className="px-4 py-4 text-xs text-slate-200">
                    {getOutputsCount(tx.transaction)}
                  </div>
                  <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                    {formatAda(getFee(tx.transaction))}
                  </div>
                  <div className="px-4 py-4 text-xs text-slate-200 font-mono">
                    {formatAda(getTotalOutput(tx.transaction))}
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

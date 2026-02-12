import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchAddressTransactions } from "../api/address";
import type { Transaction } from "../cddl";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import {
  addressToBech32,
  formatAda,
  formatHash,
  getInputsCount,
  getOutputsCount,
  getTotalOutput,
  parseCbor,
  toHex,
} from "../utils";

export default function AddressPage() {
  const { address } = useParams();
  const [transactions, setTransactions] = useState<
    { tx_id: string; transaction: Transaction }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const normalizeTxId = (value: Uint8Array | string | undefined) => {
    if (!value) return "";
    return typeof value === "string" ? value : toHex(value);
  };
  const getCoin = (value: unknown) => {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (Array.isArray(value)) {
      const coin = value[0];
      if (typeof coin === "bigint") return coin;
      if (typeof coin === "number") return BigInt(coin);
    }
    return 0n;
  };
  const balance = useMemo(() => {
    if (!address) return 0n;
    const utxos = new Map<string, bigint>();
    for (const { tx_id, transaction } of transactions) {
      const outputs = transaction?.[0]?.[1];
      if (!Array.isArray(outputs)) continue;
      outputs.forEach((output, index) => {
        if (!output?.[0]) return;
        const outputAddress = addressToBech32(output[0]);
        if (outputAddress !== address) return;
        const value = getCoin(output?.[1]);
        utxos.set(`${tx_id}:${index}`, value);
      });
    }
    for (const { transaction } of transactions) {
      const inputs = transaction?.[0]?.[0];
      if (!Array.isArray(inputs)) continue;
      inputs.forEach((input) => {
        const inputTxId = normalizeTxId(input?.[0]);
        if (!inputTxId) return;
        const index =
          typeof input?.[1] === "number" ? input[1] : Number(input?.[1] ?? 0);
        const key = `${inputTxId}:${index}`;
        if (utxos.has(key)) {
          utxos.delete(key);
        }
      });
    }
    let total = 0n;
    for (const value of utxos.values()) {
      total += value;
    }
    return total;
  }, [address, transactions]);
  const stats = useMemo(
    () => [
      { label: "Balance", value: formatAda(balance) },
      { label: "Transactions", value: transactions.length.toString() },
    ],
    [balance, transactions.length],
  );
  const getFee = (tx: Transaction) => {
    const fee = tx?.[0]?.[2];
    if (typeof fee === "bigint") return fee;
    if (typeof fee === "number") return BigInt(fee);
    return 0n;
  };

  useEffect(() => {
    if (!address) return;
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchAddressTransactions(address)
      .then((data) => {
        const rows = Array.isArray(data?.history) ? data.history : [];
        const parsed = rows
          .filter((row: { tx?: string }) => Boolean(row?.tx))
          .map((row: { tx_id: string; tx: string }) => ({
            tx_id: row.tx_id,
            transaction: parseCbor(row.tx),
          }));
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
                {isLoading ? "Decoding CBOR..." : "No transactions found."}
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

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchTransaction } from "../api/transaction";
import type { Transaction } from "../cddl";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import { parseCbor } from "../utils";

export default function TransactionPage() {
  const { txHash } = useParams();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const safeStringify = (value: unknown) =>
    JSON.stringify(
      value,
      (_key, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );

  const metrics = useMemo(() => {
    if (!transaction) return [];
    const [body, witnessSet] = transaction;
    const inputs = Array.isArray(body?.[0]) ? body[0].length : 0;
    const outputs = Array.isArray(body?.[1]) ? body[1].length : 0;
    const witnesses = Array.isArray(witnessSet?.[0]) ? witnessSet[0].length : 0;
    const fee = body?.[2];
    return [
      { label: "Inputs", value: inputs.toString() },
      { label: "Outputs", value: outputs.toString() },
      { label: "Witnesses", value: witnesses.toString() },
      {
        label: "Fee",
        value:
          typeof fee === "bigint" || typeof fee === "number"
            ? fee.toString()
            : "0",
      },
    ];
  }, [transaction]);

  useEffect(() => {
    if (!txHash) return;
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchTransaction(txHash)
      .then((data) => {
        const parsed: Transaction = parseCbor(data.tx);
        setTransaction(parsed);
        console.log(parsed);
      })
      .catch((error) => {
        console.error(error);
        setError(error?.message ?? "Failed to load transaction");
      })
      .finally(() => setIsLoading(false));
  }, [txHash]);

  return (
    <PageShell>
      <SectionHeader
        title="Transaction"
        subtitle="Decode CBOR payloads into readable structures and inspect their inputs, outputs, and witnesses."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr,1fr]">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
                Transaction Hash
              </p>
              <p className="mt-2 break-all text-sm text-slate-200">{txHash}</p>
            </div>
            {transaction ? (
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    transaction[2] ? "bg-emerald-400" : "bg-rose-400"
                  }`}
                />
                {transaction[2] ? "Transaction Valid" : "Transaction Invalid"}
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-200 ring-1 ring-rose-400/30">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {metrics.length === 0 ? (
              <p className="text-sm text-slate-400">
                {isLoading ? "Loading metrics..." : "No data yet."}
              </p>
            ) : (
              metrics.map((item) => (
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
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Inputs / Outputs
          </h2>
          <p className="mt-3 text-sm text-slate-300">
            Inspect the raw inputs and outputs from the decoded transaction
            body.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-200">
                Inputs
              </p>
              <pre className="mt-3 max-h-72 overflow-auto text-xs text-slate-200">
                {transaction ? safeStringify(transaction[0]?.[0]) : "No data"}
              </pre>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-200">
                Outputs
              </p>
              <pre className="mt-3 max-h-72 overflow-auto text-xs text-slate-200">
                {transaction ? safeStringify(transaction[0]?.[1]) : "No data"}
              </pre>
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard className="mt-8 p-6">
        <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
          Raw Body
        </h2>
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
          <pre className="max-h-96 overflow-auto text-xs text-slate-200">
            {transaction ? safeStringify(transaction[0]) : "No data"}
          </pre>
        </div>
      </GlassCard>
    </PageShell>
  );
}

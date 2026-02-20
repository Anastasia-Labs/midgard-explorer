import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchTransaction } from "../api/transaction";
import type { Transaction } from "../cddl";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import {
  addressToBech32,
  formatAda,
  formatHash,
  parseCbor,
  safeStringify,
  isHexOfLength,
  toHex,
} from "../utils";

export default function TransactionPage() {
  const { txHash } = useParams();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const formatBytes = (value: Uint8Array | string | undefined) => {
    if (!value) return "";
    return typeof value === "string" ? value : toHex(value);
  };
  const formatValue = (value: unknown) => {
    if (value == null) return "0";
    if (typeof value === "bigint") return formatAda(value);
    if (typeof value === "number") return formatAda(BigInt(value));
    if (Array.isArray(value)) {
      const coin = value[0];
      const assets = value[1] ?? {};
      const assetCount =
        assets && typeof assets === "object" ? Object.keys(assets).length : 0;
      const coinValue =
        typeof coin === "bigint" || typeof coin === "number"
          ? formatAda(BigInt(coin))
          : "0";
      return assetCount > 0 ? `${coinValue} + ${assetCount} assets` : coinValue;
    }
    return "0";
  };

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
    if (!isHexOfLength(txHash, 64)) {
      Promise.resolve().then(() => {
        setError("Invalid transaction hash.");
        setTransaction(null);
      });
      return;
    }
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchTransaction(txHash)
      .then((data) => {
        const parsed: Transaction = parseCbor(data.tx);
        setTransaction(parsed);
      })
      .catch((error) => {
        console.error(error);
        const apiMessage = error?.response?.data?.error;
        if (apiMessage === "Transaction not found.") {
          setError(apiMessage);
          setTransaction(null);
          return;
        }
        setError(error?.message ?? "Failed to load transaction");
      })
      .finally(() => setIsLoading(false));
  }, [txHash]);

  if (error === "Invalid transaction hash." || error === "Transaction not found.") {
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
            Inspect the inputs and outputs from the decoded transaction body.
          </p>
          <div className="mt-4 grid gap-4">
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-200">
                Inputs
              </p>
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[1.6fr_120px] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
                  <div className="px-3 py-2">TxID</div>
                  <div className="px-3 py-2">Index</div>
                </div>
                <div className="divide-y divide-white/10">
                  {Array.isArray(transaction?.[0]?.[0]) &&
                  transaction[0][0].length > 0 ? (
                    transaction[0][0].map((input, index) => {
                      const txId = formatBytes(input?.[0]);
                      const outIndex =
                        typeof input?.[1] === "number" ? input[1] : 0;
                      return (
                        <div
                          key={`${txId}-${outIndex}-${index}`}
                          className="grid grid-cols-[1.6fr_120px] gap-0 bg-slate-950/40"
                        >
                          <div className="px-3 py-2 text-xs text-slate-200 font-mono">
                            <span title={txId}>{formatHash(txId)}</span>
                          </div>
                          <div className="px-3 py-2 text-xs text-slate-200">
                            {outIndex}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-3 py-4 text-sm text-slate-400">
                      {isLoading ? "Loading inputs..." : "No inputs found."}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-200">
                Outputs
              </p>
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-[1.6fr_1fr] gap-0 bg-white/5 text-xs uppercase tracking-[0.22em] text-slate-400">
                  <div className="px-3 py-2">Address</div>
                  <div className="px-3 py-2">Value</div>
                </div>
                <div className="divide-y divide-white/10">
                  {Array.isArray(transaction?.[0]?.[1]) &&
                  transaction[0][1].length > 0 ? (
                    transaction[0][1].map((output, index) => {
                      const address = output?.[0]
                        ? addressToBech32(output[0])
                        : "";
                      const value = output?.[1];
                      return (
                        <div
                          key={`${address}-${index}`}
                          className="grid grid-cols-[1.6fr_1fr] gap-0 bg-slate-950/40"
                        >
                          <div className="px-3 py-2 text-xs text-slate-200 font-mono">
                            <Link
                              to={`/address/${address}`}
                              title={address}
                              className="hover:text-cyan-200"
                            >
                              {address}
                            </Link>
                          </div>
                          <div className="px-3 py-2 text-xs text-slate-200 font-mono">
                            {formatValue(value)}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-3 py-4 text-sm text-slate-400">
                      {isLoading ? "Loading outputs..." : "No outputs found."}
                    </div>
                  )}
                </div>
              </div>
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

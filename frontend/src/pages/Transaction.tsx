import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchTransaction, type TxRejection } from "../api/transaction";
import type { TransactionView, TxStatus } from "../cddl";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";
import SectionHeader from "../components/SectionHeader";
import {
  formatAda,
  formatHash,
  formatValueView,
  isHexOfLength,
  safeStringify,
} from "../utils";

const STATUS_LABELS: Record<TxStatus, string> = {
  committed: "Committed",
  pending_commit: "Pending commit",
  accepted: "Accepted (mempool)",
  rejected: "Rejected",
  validating: "Validating",
  queued: "Queued",
};

const STATUS_BADGE_CLASSNAMES: Record<TxStatus, string> = {
  committed:
    "rounded-full bg-emerald-400/15 px-2.5 py-1 text-emerald-200 ring-1 ring-emerald-400/30",
  pending_commit:
    "rounded-full bg-amber-400/15 px-2.5 py-1 text-amber-200 ring-1 ring-amber-400/30",
  accepted:
    "rounded-full bg-amber-400/15 px-2.5 py-1 text-amber-200 ring-1 ring-amber-400/30",
  validating:
    "rounded-full bg-amber-400/15 px-2.5 py-1 text-amber-200 ring-1 ring-amber-400/30",
  queued:
    "rounded-full bg-amber-400/15 px-2.5 py-1 text-amber-200 ring-1 ring-amber-400/30",
  rejected:
    "rounded-full bg-rose-400/15 px-2.5 py-1 text-rose-200 ring-1 ring-rose-400/30",
};

export default function TransactionPage() {
  const { txHash } = useParams();
  const [transaction, setTransaction] = useState<TransactionView | null>(null);
  const [status, setStatus] = useState<TxStatus | undefined>(undefined);
  const [rejection, setRejection] = useState<TxRejection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const metrics = useMemo(() => {
    if (!transaction) return [];
    return [
      { label: "Inputs", value: transaction.inputs.length.toString() },
      { label: "Outputs", value: transaction.outputs.length.toString() },
      { label: "Witnesses", value: transaction.witnesses.vkeyCount.toString() },
      { label: "Fee", value: formatAda(transaction.fee) },
    ];
  }, [transaction]);

  useEffect(() => {
    if (!txHash) return;
    if (!isHexOfLength(txHash, 64)) {
      Promise.resolve().then(() => {
        setError("Invalid transaction hash.");
        setTransaction(null);
        setStatus(undefined);
        setRejection(null);
      });
      return;
    }
    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });

    fetchTransaction(txHash)
      .then((data) => {
        setTransaction(data.transaction);
        setStatus(data.status);
        setRejection(data.rejection ?? null);
        // Legacy fallback: no status means an older backend that only ever
        // returns `transaction: null` when nothing was found.
        if (!data.transaction && !data.status) {
          setError("Transaction not found.");
        }
      })
      .catch((err) => {
        console.error(err);
        const apiMessage = err?.response?.data?.error;
        if (apiMessage === "Transaction not found.") {
          setError(apiMessage);
          setTransaction(null);
          setStatus(undefined);
          setRejection(null);
          return;
        }
        setError(err?.message ?? "Failed to load transaction");
      })
      .finally(() => setIsLoading(false));
  }, [txHash]);

  if (
    error === "Invalid transaction hash." ||
    (error === "Transaction not found." && !status)
  ) {
    return (
      <PageShell>
        <div className="mx-auto mt-20 max-w-3xl px-4 text-center text-lg text-slate-200">
          {error}
        </div>
      </PageShell>
    );
  }

  const isValid = transaction?.validity === "TxIsValid";

  return (
    <PageShell>
      <SectionHeader
        title="Transaction"
        subtitle="Inspect a Midgard transaction's inputs, outputs, and witnesses."
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
            {status || transaction ? (
              <div className="flex items-center gap-3 text-xs text-slate-300">
                {status ? (
                  <span className={STATUS_BADGE_CLASSNAMES[status]}>
                    {STATUS_LABELS[status]}
                  </span>
                ) : transaction?.pending ? (
                  // Legacy fallback: older backend response with no `status`.
                  <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-amber-200 ring-1 ring-amber-400/30">
                    Pending (mempool)
                  </span>
                ) : null}
                {transaction ? (
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        isValid ? "bg-emerald-400" : "bg-rose-400"
                      }`}
                    />
                    {isValid ? "Transaction Valid" : "Transaction Invalid"}
                  </span>
                ) : null}
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

        {status === "rejected" ? (
          <GlassCard className="p-6">
            <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
              Rejection Reason
            </h2>
            <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-rose-300">
                {rejection?.reasonCode ?? "Unknown reason"}
              </p>
              {rejection?.reasonDetail ? (
                <p className="mt-2 text-sm text-rose-200">
                  {rejection.reasonDetail}
                </p>
              ) : null}
            </div>
          </GlassCard>
        ) : (
        <GlassCard className="p-6">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Inputs / Outputs
          </h2>
          <p className="mt-3 text-sm text-slate-300">
            Inputs and outputs from the decoded transaction.
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
                  {transaction && transaction.inputs.length > 0 ? (
                    transaction.inputs.map((input, index) => (
                      <div
                        key={`${input.txId}-${input.index}-${index}`}
                        className="grid grid-cols-[1.6fr_120px] gap-0 bg-slate-950/40"
                      >
                        <div className="px-3 py-2 text-xs text-slate-200 font-mono">
                          <Link
                            to={`/transaction/${input.txId}`}
                            title={input.txId}
                            className="hover:text-cyan-200"
                          >
                            {formatHash(input.txId)}
                          </Link>
                          {input.resolved ? (
                            <Link
                              to={`/address/${input.resolved.address}`}
                              title={input.resolved.address}
                              className="block text-[10px] text-slate-400 hover:text-cyan-200"
                            >
                              {formatHash(input.resolved.address, 10, 6)}
                            </Link>
                          ) : null}
                        </div>
                        <div className="px-3 py-2 text-xs text-slate-200">
                          {input.index}
                        </div>
                      </div>
                    ))
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
                  {transaction && transaction.outputs.length > 0 ? (
                    transaction.outputs.map((output, index) => (
                      <div
                        key={`${output.address}-${index}`}
                        className="grid grid-cols-[1.6fr_1fr] gap-0 bg-slate-950/40"
                      >
                        <div className="px-3 py-2 text-xs text-slate-200 font-mono">
                          <Link
                            to={`/address/${output.address}`}
                            title={output.address}
                            className="hover:text-cyan-200"
                          >
                            {output.address}
                          </Link>
                        </div>
                        <div className="px-3 py-2 text-xs text-slate-200 font-mono">
                          {formatValueView(output.value)}
                        </div>
                      </div>
                    ))
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
        )}
      </div>

      {status === "rejected" ? null : (
        <GlassCard className="mt-8 p-6">
          <h2 className="text-sm uppercase tracking-[0.32em] text-slate-400">
            Decoded Transaction
          </h2>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <pre className="max-h-96 overflow-auto text-xs text-slate-200">
              {transaction ? safeStringify(transaction) : "No data"}
            </pre>
          </div>
        </GlassCard>
      )}
    </PageShell>
  );
}

"use client";

import type { StateQueueResponse } from "@midgard-explorer/contracts";
import { ShortId } from "../../components/ui/domain/identifier";

// Checked against the pinned f4cf28ca1 SDK's da-payload.da-payload-reader.ts.
// These are the decoded DA payload fields, not an invented byte layout.
const sections = [
  {
    title: "Header",
    explanation: "Links to the previous block and commits to this block’s data.",
    fields: [
      "prevUtxosRoot",
      "utxosRoot",
      "withdrawalsRoot",
      "forcedTransactionsRoot",
      "transactionsRoot",
      "depositsRoot",
      "transitionTraceRoot",
      "eventToStepRoot",
      "validationTracesRoot",
      "withdrawalCount",
      "forcedTransactionCount",
      "l2TransactionCount",
      "depositCount",
      "totalEventCount",
      "transitionStepCount",
      "validationTraceCount",
      "startTime",
      "endTime",
      "blockSlot",
      "expectedNetworkId",
      "minFeeA",
      "minFeeB",
      "prevHeaderHash",
      "operatorVkey",
      "protocolVersion",
    ],
  },
  {
    title: "Transactions and bridge events",
    explanation: "Transactions, deposits, withdrawals and forced transactions.",
    fields: [
      "transactions",
      "transaction_preimages",
      "deposits",
      "withdrawals",
      "forced_transactions",
      "forced_transaction_preimages",
    ],
  },
  {
    title: "Execution data",
    explanation: "Program material and traces used to check the block’s execution.",
    fields: [
      "cek_program_material",
      "transition_trace",
      "event_to_step",
      "validation_traces",
      "validation_trace_witnesses",
    ],
  },
  {
    title: "Counts",
    explanation: "Totals for the events, steps and traces in the payload.",
    fields: [
      "withdrawalCount",
      "forcedTransactionCount",
      "l2TransactionCount",
      "depositCount",
      "totalEventCount",
      "transitionStepCount",
      "validationTraceCount",
    ],
  },
] as const;

export function DemoBlockAnatomy({ queue, step }: { queue: StateQueueResponse; step: number }) {
  // Follow the block involved in this scene, and explicitly name it. Values
  // are illustrative; no root, signature, proof or DA observation is invented.
  const subject =
    step >= 5
      ? queue.removedBlocks[0]
      : step === 3
        ? queue.oldest.at(-1)
        : step === 1 || step === 2 || step === 4
          ? null
          : queue.oldest[0];
  const hash =
    step === 1 || step === 2
      ? queue.committing?.headerHash
      : step === 4
        ? queue.confirmed?.headerHash
        : subject?.headerHash;
  const state =
    step >= 5
      ? "Removed"
      : step === 4
        ? "Merged"
        : step === 1
          ? "Preparing commitment"
          : step === 2
            ? "Commit submitted"
            : "Waiting to merge";
  const counts = subject
    ? ([
        ["Transactions", subject.transactions],
        ["Deposits", subject.deposits],
        ["Withdrawals", subject.withdrawals],
        ["Forced transactions", subject.forcedTransactions],
      ] as const)
    : null;

  return (
    <details className="mt-4 rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-3 text-sm font-medium text-text">
        Inside this example block
      </summary>
      <div className="space-y-4 border-t border-border p-3">
        <p className="text-sm text-text-2">
          A block keeps its contents when it merges. Its place in the queue and observed state
          change.
          {hash ? (
            <>
              {" "}
              This scene follows{" "}
              <span className="font-mono">
                <ShortId value={hash} head={6} tail={4} />
              </span>
              .
            </>
          ) : null}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <section
            className="rounded-md border border-border p-3"
            aria-label="Example block contents"
          >
            <h3 className="text-sm font-semibold text-text">Inside the payload</h3>
            <p className="mt-1 mg-caption text-text-3">
              A header, event data, execution data and counts.
            </p>
            {counts ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 mg-caption">
                {counts.map(([name, count]) => (
                  <div key={name} className="flex justify-between gap-2">
                    <dt className="text-text-2">{name}</dt>
                    <dd className="tabular-nums text-text">{count}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-3 mg-caption text-text-3">
                This scene does not display body counts.
              </p>
            )}
          </section>
          <section className="rounded-md border border-border p-3" aria-label="Example block state">
            <h3 className="text-sm font-semibold text-text">State in this example</h3>
            <p className="mt-2 text-sm font-medium text-text">{state}</p>
            <p className="mt-2 mg-caption text-text-3">
              DA status, maturity and Cardano rollback depth are not simulated.
              {step === 4 ? " Merged does not mean finalized." : ""}
            </p>
          </section>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-text-2">Exact payload fields</summary>
          <p className="mt-2 mg-caption text-text-3">
            Field names from Midgard’s pinned f4cf28ca1 payload decoder. Example values are made up;
            this is a logical structure, not a byte-layout or verified payload.
          </p>
          <p className="mt-2 mg-caption text-text-2">
            The envelope contains <code>version</code> and <code>block_body</code>. The body
            contains <code>header_hash</code>, <code>header</code>, the lists below and{" "}
            <code>counts</code>.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {sections.map((section) => (
              <section key={section.title} className="min-w-0">
                <h4 className="text-sm font-medium text-text">{section.title}</h4>
                <p className="mt-1 mg-caption text-text-3">{section.explanation}</p>
                <p className="mt-2 flex flex-wrap gap-1">
                  {section.fields.map((field) => (
                    <code
                      key={field}
                      className="break-all rounded bg-surface-2 px-1 py-0.5 mg-caption text-text-2"
                    >
                      {field}
                    </code>
                  ))}
                </p>
              </section>
            ))}
          </div>
          <p className="mt-3 mg-caption text-text-3">
            <code>transactions</code> contains committed entries; transaction bodies are in{" "}
            <code>transaction_preimages</code>. <code>validation_trace_witnesses</code> is always
            empty in this format. Queue DA state and commit time belong to the on-chain queue
            record, not this header.
          </p>
        </details>
      </div>
    </details>
  );
}

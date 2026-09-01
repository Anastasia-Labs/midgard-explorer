import type { TransactionView } from "@midgard-explorer/contracts";
import { scriptInvocations } from "../../../lib/transactionEvents";
import { AddressLink } from "./address";
import { CopyButton, Identifier } from "./identifier";
import { InfoTip } from "../base/infotip";
import { Card } from "../base/layout";
import { SemanticLabel } from "../base/semantic";

function ExecutionBudget({ mem, steps }: { mem: string; steps: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-text-3">
      <span className="font-mono tabular-nums">{BigInt(mem).toLocaleString("en-US")}</span> mem
      <span aria-hidden>·</span>
      <span className="font-mono tabular-nums">{BigInt(steps).toLocaleString("en-US")}</span> steps
      <InfoTip term="executionUnits" subject="execution units" />
    </span>
  );
}

export function TransactionEvents({ tx }: { tx: TransactionView }) {
  const invocations = scriptInvocations(tx);

  return (
    <div className="space-y-4">
      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-body font-semibold text-text">
            {/* The SemanticLabel carries what a protocol event is on hover, so
                the section no longer restates it in a callout and a subtitle. */}
            <SemanticLabel
              kind="protocolEvent"
              label={`Script invocations (${invocations.length})`}
            />
          </h2>
        </div>

        {invocations.length === 0 ? (
          <p className="px-4 py-5 text-sm text-text-3">No script invocations.</p>
        ) : (
          <ol className="divide-y divide-border">
            {invocations.map((invocation) => (
              <li key={invocation.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="mg-overline text-text-3">Invocation {invocation.ordinal + 1}</p>
                    <h3 className="mt-0.5 text-sm font-semibold text-text">
                      {invocation.operation}
                    </h3>
                    <p className="mt-1 font-mono text-xs text-text-3">{invocation.pointer}</p>
                  </div>
                  {invocation.redeemer.exUnits ? (
                    <ExecutionBudget {...invocation.redeemer.exUnits} />
                  ) : (
                    <span className="mg-caption text-text-3">Execution budget unavailable</span>
                  )}
                </div>

                <dl className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="mg-overline">Emitter</dt>
                    <dd className="mt-1 text-sm text-text">
                      {invocation.emitter.hash === null ? (
                        <span className="text-text-3">Not provable from this transaction</span>
                      ) : (
                        <span className="inline-flex max-w-full items-center gap-1.5">
                          <Identifier value={invocation.emitter.hash} head={12} tail={8} />
                          <span className="rounded border border-border px-1.5 py-px mg-micro text-text-3">
                            {invocation.emitter.kind}
                          </span>
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="mg-overline">Resolved target</dt>
                    <dd className="mt-1 text-sm text-text-2">
                      {invocation.emitter.address === null ? (
                        invocation.emitter.source
                      ) : (
                        <AddressLink address={invocation.emitter.address} kind="Script" />
                      )}
                    </dd>
                  </div>
                </dl>

                <details className="mt-3 rounded border border-border bg-surface-2/40">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-link">
                    Decoded redeemer and raw CBOR
                  </summary>
                  <div className="border-t border-border">
                    {invocation.redeemer.data === null ? (
                      <p className="px-3 py-2 mg-caption text-text-3">
                        The redeemer payload did not decode to a readable structure.
                      </p>
                    ) : (
                      <pre
                        tabIndex={0}
                        role="region"
                        aria-label={`Invocation ${invocation.ordinal + 1} decoded redeemer`}
                        className="max-h-64 overflow-auto p-3 font-mono text-xs leading-relaxed"
                      >
                        {JSON.stringify(invocation.redeemer.data, null, 2)}
                      </pre>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                      <span className="mg-overline">Redeemer CBOR</span>
                      <CopyButton value={invocation.redeemer.cborHex} />
                    </div>
                    <pre
                      tabIndex={0}
                      role="region"
                      aria-label={`Invocation ${invocation.ordinal + 1} redeemer CBOR`}
                      className="max-h-40 overflow-auto break-all whitespace-pre-wrap p-3 pt-0 font-mono text-xs text-text-2"
                    >
                      {invocation.redeemer.cborHex}
                    </pre>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

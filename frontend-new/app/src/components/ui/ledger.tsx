import type { TransactionView } from "@midgard-explorer/contracts";
import { addressDeltas, ledgerEquation } from "../../lib/ledger";
import { cn, formatAda } from "../../lib/format";
import { Identifier } from "./identifier";

/** What a transaction did, stated as arithmetic.
 *
 * Two lists of addresses show what a transaction *contains*. The equation
 * inputs = outputs + fee shows what it *did*, and it is the one statement a
 * UTxO transaction always satisfies. It appears only when every input resolved,
 * because a sum over the inputs that happened to survive looks exactly like a
 * total while being a lower bound.
 *
 * There is deliberately no flow diagram. A UTxO transaction does not record
 * which input funded which output, so any line drawn between the two sides
 * would be an invention, and a convincing one.
 */

function Amount({ lovelace, tone }: { lovelace: bigint; tone?: "positive" | "negative" }) {
  const negative = lovelace < 0n;
  const magnitude = negative ? -lovelace : lovelace;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        tone === "positive" && "text-success",
        tone === "negative" && "text-danger",
      )}
    >
      {negative ? "−" : tone === "positive" ? "+" : ""}
      <span className="text-text-3">₳</span> {formatAda(magnitude.toString())}
    </span>
  );
}

function Term({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="mg-overline">{label}</span>
      <span className="mt-0.5 text-[15px]">{children}</span>
      {sub ? <span className="mt-0.5 mg-micro text-text-3">{sub}</span> : null}
    </span>
  );
}

export function LedgerEquation({ tx }: { tx: TransactionView }) {
  const eq = ledgerEquation(tx);
  const deltas = addressDeltas(tx);

  return (
    <section
      data-region="ledger"
      aria-label="Ledger equation"
      className="mb-4 overflow-hidden rounded-xl border border-border bg-surface shadow-(--mg-shadow)"
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 pt-3.5 pb-3">
        {eq.kind === "incomplete" ? (
          <>
            {/* No number on the input side, because none of the numbers
                available is the input total. Writing "At least ₳9.501" here and
                then "=" asserted an equality between a lower bound and an exact
                sum, which is false whenever it is interesting: the reader was
                told 9.501 equals 4.871. The identity itself still holds, so the
                honest rendering is to keep the "=" and say the left term is not
                known, with the part that did resolve as context beneath it. */}
            <Term
              label={`Inputs (${eq.resolvedCount} of ${eq.resolvedCount + eq.unresolvedCount} resolved)`}
              sub={
                eq.resolvedCount > 0 ? (
                  <>
                    {"of which "}
                    <span className="font-mono tabular-nums">
                      ₳ {formatAda(eq.resolvedInputs.toString())}
                    </span>
                    {" is visible"}
                  </>
                ) : null
              }
            >
              <span className="text-text-3">Not known in full</span>
            </Term>
            <Operator>=</Operator>
            <Term label={`Outputs (${eq.outputCount})`}>
              <Amount lovelace={eq.outputs} />
            </Term>
            <Operator>+</Operator>
            <Term label="Fee">
              <Amount lovelace={eq.fee} />
            </Term>
          </>
        ) : (
          <>
            <Term label={`Inputs (${eq.inputCount})`}>
              <Amount lovelace={eq.inputs} />
            </Term>
            <Operator>=</Operator>
            <Term label={`Outputs (${eq.outputCount})`}>
              <Amount lovelace={eq.outputs} />
            </Term>
            <Operator>+</Operator>
            <Term label="Fee">
              <Amount lovelace={eq.fee} />
            </Term>
            {eq.kind === "unbalanced" ? (
              <>
                <Operator>+</Operator>
                <Term label="Unaccounted">
                  <Amount lovelace={-eq.difference} tone="negative" />
                </Term>
              </>
            ) : null}
          </>
        )}
      </div>

      <p className="border-t border-border px-4 py-2.5 mg-caption leading-relaxed text-text-2">
        {eq.kind === "balanced" ? (
          <>
            The transaction balances: everything spent is accounted for by the outputs and the fee.
          </>
        ) : eq.kind === "unbalanced" ? (
          <>
            These figures do not balance, which means a value on one side did not decode as
            expected. Treat the amounts as unverified and read the raw response.
          </>
        ) : (
          // One string rather than interleaved expressions: JSX drops the
          // space between an expression and the text that follows it here, and
          // "1 of 2inputs" shipped once already.
          `${eq.unresolvedCount} of ${eq.resolvedCount + eq.unresolvedCount} inputs could not be resolved, so the input total is not stated here and the equation cannot be checked against it. The sum of the inputs that did resolve is not that total, only the part of it still visible, so it is shown as such rather than in the equation. A transaction's inputs leave the ledger once it is applied, so this is the usual case for anything but the newest transactions.`
        )}
      </p>

      {deltas.length > 0 ? (
        <div className="border-t border-border">
          <h3 className="mg-overline px-4 pt-3">Net movement by address</h3>
          <ul className="divide-y divide-border">
            {deltas.map((d) => {
              const net = d.received - d.spent;
              return (
                <li
                  key={d.address}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
                >
                  <Identifier value={d.address} href={`/address/${d.address}`} head={12} tail={8} />
                  {d.exact ? (
                    <Amount lovelace={net} tone={net >= 0n ? "positive" : "negative"} />
                  ) : (
                    <span className="text-right mg-caption">
                      <Amount lovelace={d.received} tone="positive" />
                      <span className="block text-text-3">received; spend side unknown</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {deltas.some((d) => !d.exact) ? (
            <p className="border-t border-border px-4 py-2.5 mg-micro text-text-3">
              A net figure needs both sides. Where an input did not resolve, only what an address
              received is shown, because a net that ignores an unknown spend is not a smaller truth
              than the real one, it is a different number.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Operator({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="pb-0.5 font-mono text-[15px] text-text-3">
      {children}
    </span>
  );
}

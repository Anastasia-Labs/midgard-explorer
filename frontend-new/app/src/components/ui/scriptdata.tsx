"use client";

import { useState } from "react";
import type {
  DatumView,
  RedeemerView,
  ScriptRefView,
  ScriptWitnessView,
} from "@midgard-explorer/contracts";
import { cn, truncateId } from "../../lib/format";
import { CopyButton } from "./identifier";
import { FieldLabel, InfoTip } from "./infotip";
import { SemanticLabel } from "./semantic";

/** A byte payload with its decoded reading, if one exists.
 *
 * The bytes are the answer of record: every reference explorer shows raw hex
 * beside a decoded view rather than instead of it, because a decoder that
 * guesses wrong is worse than no decoder. `json` is null whenever the codec
 * could not render the shape, and the hex still stands.
 */
function Payload({ cborHex, json, label }: { cborHex: string; json?: unknown; label: string }) {
  const [showing, setShowing] = useState<"decoded" | "hex">(json == null ? "hex" : "decoded");
  const decoded = json == null ? null : JSON.stringify(json, null, 2);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="inline-flex items-center gap-1.5">
          <span className="mg-overline">
            {label === "Inline datum" ? (
              <SemanticLabel kind="datum" label={label} />
            ) : label.startsWith("Redeemer") ? (
              <SemanticLabel kind="script" label={label} />
            ) : label === "Script bytes" ? (
              <SemanticLabel kind="script" label={label} />
            ) : (
              <FieldLabel label={label} />
            )}
          </span>
          <span className="font-mono text-micro text-text-3">{cborHex.length / 2} bytes</span>
        </div>
        <div className="inline-flex items-center gap-1">
          {decoded === null ? (
            <span className="inline-flex items-center gap-1 mg-micro text-text-3">
              hex only
              <InfoTip
                subject="hex only"
                explain="This payload's CBOR did not decode to a readable shape, so only its bytes are shown. The bytes are complete."
              />
            </span>
          ) : (
            <div role="group" aria-label={`${label} view`} className="inline-flex gap-0.5">
              {(["decoded", "hex"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={showing === mode}
                  onClick={() => setShowing(mode)}
                  className={cn(
                    "rounded px-2 py-0.5 text-micro font-medium",
                    showing === mode
                      ? "bg-surface-3 text-text"
                      : "text-text-3 hover:bg-surface-2 hover:text-text-2",
                  )}
                >
                  {mode === "decoded" ? "Decoded" : "Hex"}
                </button>
              ))}
            </div>
          )}
          <CopyButton value={showing === "hex" || decoded === null ? cborHex : decoded} />
        </div>
      </div>
      <pre
        tabIndex={0}
        role="region"
        aria-label={`${label} contents`}
        className="max-h-72 overflow-auto p-3 font-mono text-caption leading-relaxed break-all whitespace-pre-wrap"
      >
        {showing === "hex" || decoded === null ? cborHex : decoded}
      </pre>
    </div>
  );
}

/** Datums carried by a transaction's outputs, keyed to the output they sit on. */
export function DatumPanel({
  datums,
}: {
  datums: Array<{ index: number; address: string; datum: DatumView }>;
}) {
  // Nothing rather than a sentence saying there is nothing: the tab count
  // already reads 0, and the caller renders one empty state for the whole tab.
  if (datums.length === 0) return null;
  return (
    <div className="space-y-3">
      {datums.map(({ index, address, datum }) => (
        <div key={index} className="space-y-2">
          <p className="mg-caption text-text-2">
            Output #{index} to <span className="font-mono">{truncateId(address, 12, 8)}</span>
          </p>
          <Payload cborHex={datum.cborHex} json={datum.json} label="Inline datum" />
        </div>
      ))}
    </div>
  );
}

const SCRIPT_SOURCE: Record<ScriptWitnessView["source"] | ScriptRefView["source"], string> = {
  witness_set:
    "Source: transaction witness set. The displayed hash was recomputed from these versioned-script bytes.",
  reference_output:
    "Source: this output's reference script. The displayed hash was recomputed from these versioned-script bytes.",
};

/** One script, wherever it was carried.
 *
 * A witness-set script and an output's reference script are the same record
 * with the same three facts, so they read the same way: hash and language in
 * the open, bytes behind a disclosure. A reference script used to render as the
 * word "script ref" and nothing else, which named a field rather than showing
 * it. */
export function ScriptEntry({
  script,
  className,
}: {
  script: ScriptWitnessView | ScriptRefView;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-caption break-all">{truncateId(script.hash, 12, 8)}</span>
          <CopyButton value={script.hash} />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full border border-border-strong px-2 py-0.5 text-micro font-medium text-text-2">
            {script.language}
          </span>
          <span className="rounded-full border border-success/35 bg-success/10 px-2 py-0.5 text-micro font-medium text-success">
            Hash verified
          </span>
        </span>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer mg-caption text-link">
          Script bytes and provenance
        </summary>
        <div className="mt-2">
          <Payload cborHex={script.cborHex} label="Script bytes" />
          <p className="mt-1.5 mg-micro text-text-3">{SCRIPT_SOURCE[script.source]}</p>
        </div>
      </details>
    </div>
  );
}

/** The reference script an output carries, labelled as what it is. */
export function ReferenceScript({ script }: { script: ScriptRefView }) {
  return (
    <div className="mt-2 border-t border-border pt-2">
      <p className="mg-overline mb-1.5">
        <SemanticLabel kind="script" label="Reference script" />
      </p>
      <ScriptEntry script={script} />
    </div>
  );
}

/** Scripts and redeemers from the witness set.
 *
 * Midgard defines no redeemer decoder, so a redeemer shows its bytes and adds
 * tag, index and execution units only when the generic decode produced them.
 */
export function WitnessPanel({
  scripts,
  redeemers,
}: {
  scripts: readonly ScriptWitnessView[];
  redeemers: readonly RedeemerView[];
}) {
  if (scripts.length === 0 && redeemers.length === 0) return null;
  return (
    <div className="space-y-4">
      {scripts.length > 0 ? (
        <section>
          <h3 className="mg-overline mb-2">
            <SemanticLabel kind="script" label={`Scripts (${scripts.length})`} />
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {scripts.map((script) => (
              <li key={script.hash} className="px-3 py-2.5">
                <ScriptEntry script={script} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {redeemers.length > 0 ? (
        <section>
          <h3 className="mg-overline mb-2">
            <SemanticLabel kind="script" label={`Redeemers (${redeemers.length})`} />
          </h3>
          <div className="space-y-3">
            {redeemers.map((redeemer, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mg-caption text-text-2">
                  {redeemer.tag === null ? (
                    <span className="inline-flex items-center gap-1 text-text-3">
                      purpose not readable
                      <InfoTip
                        subject="redeemer purpose"
                        explain="Midgard does not define a redeemer layout, so a redeemer whose bytes do not match the standard shape is reported as bytes alone. Do not infer a purpose from undecoded bytes."
                      />
                    </span>
                  ) : (
                    <span>
                      purpose <span className="font-mono">{redeemer.purpose}</span>, index{" "}
                      <span className="font-mono">{redeemer.index}</span>
                    </span>
                  )}
                  {redeemer.exUnits ? (
                    <span className="inline-flex items-center gap-1 text-text-3">
                      {Number(redeemer.exUnits.mem).toLocaleString("en-US")} mem,{" "}
                      {Number(redeemer.exUnits.steps).toLocaleString("en-US")} steps
                      <InfoTip term="executionUnits" subject="execution units" />
                    </span>
                  ) : null}
                </div>
                <Payload
                  cborHex={redeemer.cborHex}
                  json={redeemer.data ?? undefined}
                  label={`Redeemer ${i}`}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** The transaction's own bytes. */
export function RawCbor({
  cborHex,
  truncated,
  size,
  txId,
}: {
  cborHex: string;
  truncated: boolean;
  size: number;
  txId: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-body font-semibold text-text">
          <SemanticLabel kind="cbor" label="Transaction CBOR" />
        </h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-micro text-text-3">{size} bytes</span>
          <CopyButton value={cborHex} />
          <a
            href={`data:application/octet-stream;charset=utf-8,${encodeURIComponent(cborHex)}`}
            download={`tx-${txId}.cbor.hex`}
            className="inline-flex h-9 items-center rounded border border-border-strong px-2.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text"
          >
            Download
          </a>
        </div>
      </div>
      {truncated ? (
        <p className="border-b border-border bg-warning/10 px-4 py-2 mg-caption text-warning">
          This transaction is larger than the inline limit, so the hex below is cut short. Use the
          API for the whole body.
        </p>
      ) : null}
      <pre
        tabIndex={0}
        role="region"
        aria-label="Transaction CBOR bytes"
        className="max-h-96 overflow-auto p-4 font-mono text-caption leading-relaxed break-all whitespace-pre-wrap"
      >
        {cborHex}
      </pre>
    </section>
  );
}

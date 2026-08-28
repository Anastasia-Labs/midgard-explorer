"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Card } from "../../components/ui/primitives";
import { CopyButton } from "../../components/ui/identifier";
import { InfoTip } from "../../components/ui/infotip";
import { adaToLovelace, decodeCborHex, lovelaceToAda, splitAssetUnit } from "../../lib/tools";

/** A tool is a labelled input, a result, and nothing else.
 *
 * These borrow the shape the reference explorers use for their calldata
 * decoders and unit converters: paste, read, copy. They deliberately reuse the
 * explorer's own primitives rather than inventing a "tools" look, so moving
 * between a record page and a utility does not feel like changing product. */
function Tool({
  title,
  explain,
  children,
}: {
  title: string;
  explain: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="space-y-3 p-4">
        <h2 className="inline-flex items-center gap-1.5 text-body font-semibold text-text">
          {title}
          <InfoTip subject={title} explain={explain} />
        </h2>
        {children}
      </div>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const shared =
    "w-full rounded-lg border border-border-strong bg-surface-2 px-3 py-2 font-mono text-caption text-text placeholder:text-text-3";
  return (
    <label className="block space-y-1.5">
      <span className="mg-overline">{label}</span>
      {rows ? (
        <textarea
          value={value}
          rows={rows}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={shared}
        />
      ) : (
        <input
          type="text"
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={shared}
        />
      )}
    </label>
  );
}

function Result({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "error" }) {
  return (
    <p
      role="status"
      className={
        tone === "error"
          ? "rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 mg-caption text-danger"
          : "rounded-lg border border-border bg-surface-2/40 px-3 py-2 font-mono text-caption break-all text-text"
      }
    >
      {children}
    </p>
  );
}

/** Attempt a conversion, returning either its result or the message explaining
 * why it could not be done. An empty box is neither. */
function attempt(input: string, run: (v: string) => string) {
  if (input.trim() === "") return null;
  try {
    return { ok: true as const, value: run(input) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

function UnitConverter() {
  const [lovelace, setLovelace] = useState("");
  const [ada, setAda] = useState("");
  const fromLovelace = useMemo(() => attempt(lovelace, lovelaceToAda), [lovelace]);
  const fromAda = useMemo(() => attempt(ada, adaToLovelace), [ada]);

  return (
    <Tool
      title="Ada and lovelace"
      explain="One ada is 1,000,000 lovelace. Both directions use whole-number arithmetic, so a large amount is exact rather than rounded."
    >
      <Field label="Lovelace" value={lovelace} onChange={setLovelace} placeholder="1234567" />
      {fromLovelace ? (
        fromLovelace.ok ? (
          <Result>
            ₳ {fromLovelace.value} <CopyButton value={fromLovelace.value} />
          </Result>
        ) : (
          <Result tone="error">{fromLovelace.error}</Result>
        )
      ) : null}

      <Field label="Ada" value={ada} onChange={setAda} placeholder="1.234567" />
      {fromAda ? (
        fromAda.ok ? (
          <Result>
            {fromAda.value} lovelace <CopyButton value={fromAda.value} />
          </Result>
        ) : (
          <Result tone="error">{fromAda.error}</Result>
        )
      ) : null}
    </Tool>
  );
}

function AssetUnitSplitter() {
  const [unit, setUnit] = useState("");
  const parts = useMemo(() => attempt(unit, (v) => JSON.stringify(splitAssetUnit(v))), [unit]);
  const parsed = parts?.ok ? (JSON.parse(parts.value) as ReturnType<typeof splitAssetUnit>) : null;

  return (
    <Tool
      title="Asset unit"
      explain="An asset unit is a 56-character policy id followed by the asset name in hex. This splits one into its parts and decodes the name only when the bytes read as text."
    >
      <Field
        label="Unit"
        value={unit}
        onChange={setUnit}
        placeholder="policyId + assetName in hex"
        rows={2}
      />
      {parts && !parts.ok ? <Result tone="error">{parts.error}</Result> : null}
      {parsed ? (
        <dl className="space-y-2">
          <div>
            <dt className="mg-overline">Policy id</dt>
            <dd>
              <Result>
                {parsed.policyId} <CopyButton value={parsed.policyId} />
              </Result>
            </dd>
          </div>
          <div>
            <dt className="mg-overline">Asset name (hex)</dt>
            <dd>
              <Result>{parsed.assetName === "" ? "(none)" : parsed.assetName}</Result>
            </dd>
          </div>
          <div>
            <dt className="mg-overline">Asset name (decoded)</dt>
            <dd>
              <Result>
                {parsed.readable === null
                  ? "Not readable as text; the bytes above are its identity."
                  : parsed.readable === ""
                    ? "(none)"
                    : parsed.readable}
              </Result>
            </dd>
          </div>
        </dl>
      ) : null}
    </Tool>
  );
}

function CborDecoder() {
  const [hex, setHex] = useState("");
  const result = useMemo(() => (hex.trim() === "" ? null : decodeCborHex(hex)), [hex]);
  const rendered = result?.ok ? JSON.stringify(result.value, null, 2) : null;

  return (
    <Tool
      title="CBOR decoder"
      explain="Paste the hex of any CBOR payload, such as a datum or a redeemer taken from a transaction's Raw tab. Bytes are shown as hex and large integers as decimal strings, the same way the rest of the explorer shows them."
    >
      <Field label="CBOR hex" value={hex} onChange={setHex} placeholder="d8799f0102ff" rows={4} />
      {result && !result.ok ? <Result tone="error">{result.error}</Result> : null}
      {rendered !== null ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="mg-overline">Decoded</span>
            <CopyButton value={rendered} />
          </div>
          <pre
            tabIndex={0}
            role="region"
            aria-label="Decoded CBOR"
            className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-2/40 p-3 font-mono text-micro leading-relaxed whitespace-pre-wrap"
          >
            {rendered}
          </pre>
        </div>
      ) : null}
    </Tool>
  );
}

export function Tools() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CborDecoder />
      <div className="space-y-4">
        <UnitConverter />
        <AssetUnitSplitter />
      </div>
    </div>
  );
}

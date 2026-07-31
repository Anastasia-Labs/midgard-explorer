"use client";

export function RawData({ data, filename }: { data: unknown; filename: string }) {
  const json = JSON.stringify(data, null, 2);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold text-text">Raw response</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(json)}
            className="inline-flex h-9 items-center rounded border border-border-strong px-2.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text"
          >
            Copy JSON
          </button>
          <a
            href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
            download={filename}
            className="inline-flex h-9 items-center rounded border border-border-strong px-2.5 text-xs text-text-2 hover:bg-surface-2 hover:text-text"
          >
            Download
          </a>
        </div>
      </div>
      <pre className="max-h-128 overflow-auto p-4 font-mono text-xs leading-relaxed">{json}</pre>
    </section>
  );
}

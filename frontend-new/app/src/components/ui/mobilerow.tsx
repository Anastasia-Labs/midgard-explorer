import type { ReactNode } from "react";

/** Mobile record summary. Deliberately ordered rather than a squeezed table:
 * primary identity and status on line one, meta and amount on line two, and
 * everything else behind a disclosure. */
export type LedgerRowSpec = {
  primary: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  secondary?: ReactNode;
  details?: Array<{ label: string; value: ReactNode }>;
};

export function LedgerRow({ spec }: { spec: LedgerRowSpec }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">{spec.primary}</div>
        {spec.status ? <div className="shrink-0">{spec.status}</div> : null}
      </div>
      {spec.meta || spec.secondary ? (
        <div className="mt-1 flex items-baseline justify-between gap-3 text-[13px]">
          <span className="min-w-0 text-text-3">{spec.meta}</span>
          <span className="shrink-0 tabular-nums text-text-2">{spec.secondary}</span>
        </div>
      ) : null}
      {spec.details && spec.details.length > 0 ? (
        <details className="mt-1.5">
          <summary className="inline-flex h-8 cursor-pointer items-center text-[12.5px] text-text-3">
            Details
          </summary>
          <dl className="mt-1 space-y-1.5">
            {spec.details.map((d) => (
              <div key={d.label} className="flex items-start justify-between gap-3">
                <dt className="mg-overline shrink-0">{d.label}</dt>
                <dd className="min-w-0 text-right text-[13px]">{d.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

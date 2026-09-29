import { legendFor, type StatusKind } from "../../../lib/status-registry";
import { StatusBadge } from "../domain/status";

export function StatusLegend({
  kinds,
  label = "Status key",
}: {
  kinds: StatusKind[];
  label?: string;
}) {
  const entries = kinds.flatMap((k) => legendFor(k));
  if (entries.length === 0) return null;
  return (
    <details className="border-t border-border">
      <summary className="cursor-pointer px-4 py-2.5 mg-caption text-text-2 hover:text-text">
        {label}
      </summary>
      <dl className="grid gap-x-8 gap-y-2 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => (
          <div key={`${e.kind}-${e.code}`} className="flex items-start gap-2">
            <dt className="shrink-0">
              <StatusBadge status={e.code} />
            </dt>
            <dd className="mg-caption text-text-3">{e.explain}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

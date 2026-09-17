import { Panel, Skeleton } from "../../components/ui/base/layout";

import { OverviewHeader } from "../../features/overview/OverviewHeader";

export default function Loading() {
  return (
    <>
      <OverviewHeader>
        <Skeleton className="h-11 w-full" />
      </OverviewHeader>

      <Skeleton className="mb-4 h-80 w-full sm:h-52" />

      <Skeleton className="mb-4 h-48 w-full" />

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {["Latest blocks", "Latest transactions"].map((title) => (
          <Panel key={title} title={title}>
            <div role="status" aria-label="Loading" className="space-y-2 p-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <Skeleton className="mb-4 h-40 w-full" />
    </>
  );
}

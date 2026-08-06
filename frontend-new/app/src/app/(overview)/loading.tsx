import { PageHeader, Panel, Skeleton } from "../../components/ui/primitives";

// The overview awaits five endpoints before it returns anything, so without a
// boundary here the route streams no HTML at all until the slowest one settles.
// It lives in the `(overview)` route group so the Suspense boundary covers this
// page alone. At the root it covered every route, which committed a 200 before
// the detail routes could call `notFound()`. See ../LOADING.md.
// Header and search are static, so they paint immediately; only the data
// regions shimmer, and the layout matches Overview to avoid a shift on swap.
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Midgard Blockchain Explorer"
        subtitle="Blocks, transactions and bridge activity on Midgard, the Layer 2 ledger that settles on Cardano."
      />

      <div className="mb-5 max-w-2xl">
        <Skeleton className="h-10 w-full" />
      </div>

      <Skeleton className="mb-4 h-28 w-full" />

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
    </>
  );
}

import { Panel, Skeleton } from "../../components/ui/base/layout";

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
      {/* Mirrors Overview's hero column for column. If the two disagree the
          page jumps when the data arrives, which is the whole reason this
          file duplicates the layout rather than importing it. */}
      <header className="mb-5">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <h1 className="mg-brand-green min-w-0 font-display text-2xl font-semibold tracking-tight text-page-title sm:text-title">
            Midgard Blockchain Explorer
          </h1>
          <div className="w-full sm:w-96 lg:w-112">
            <Skeleton className="h-11 w-full" />
          </div>
        </div>
        <div className="mt-2.5 flex justify-center">
          <Skeleton className="h-4 w-56" />
        </div>
      </header>

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

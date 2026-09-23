import type { ReactNode } from "react";

export function OverviewHeader({ children }: { children: ReactNode }) {
  return (
    <header className="mg-hero-field -mx-4 mb-5 px-4 pt-2 pb-1 lg:-mx-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        <h1 className="mg-brand-green min-w-0 font-display text-2xl font-semibold tracking-tight text-page-title sm:text-title">
          Midgard Blockchain Explorer
        </h1>
        <div className="w-full sm:w-96 lg:w-112">{children}</div>
      </div>
    </header>
  );
}

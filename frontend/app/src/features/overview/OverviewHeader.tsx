import type { ReactNode } from "react";

export function OverviewHeader({ children }: { children: ReactNode }) {
  return (
    <header className="mg-hero-field -mx-4 mb-5 px-4 pt-2 pb-1 lg:-mx-6 lg:px-6">
      {/* The page's heading, for screen readers and the outline. On screen
          the search bar leads the page on its own. */}
      <h1 className="sr-only">Midgard Blockchain Explorer</h1>
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </header>
  );
}

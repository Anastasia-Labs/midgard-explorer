import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { HeaderSearchBox, SearchBox } from "../search/SearchOverlay";
import { HealthIndicator } from "./HealthIndicator";
import { MobileNav, NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";
import { NETWORK_LABEL } from "../../lib/network";

function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Midgard L2 Explorer, home"
      className={
        small
          ? "flex min-h-9 min-w-0 items-center gap-2.5"
          : "flex min-h-11 shrink-0 items-center gap-2.5"
      }
    >
      <Image
        src="/midgard-mark.png"
        alt=""
        width={small ? 20 : 28}
        height={small ? 20 : 28}
        priority={!small}
        className="shrink-0"
      />
      {small ? (
        <span className="min-w-0 text-sm text-text-3">Midgard L2 Explorer, by Anastasia Labs</span>
      ) : (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[17px] font-bold tracking-[0.02em] text-text">
            MIDGARD
          </span>
          <span className="mt-0.5 text-[10.5px] font-semibold tracking-[0.1em] text-text-3">
            L2 EXPLORER
          </span>
        </span>
      )}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-bg">
        <div className="mx-auto flex h-[60px] max-w-7xl items-center gap-4 px-4">
          <Brand />
          <NavLinks />
          <div className="mx-auto hidden w-full max-w-md lg:block">
            <HeaderSearchBox />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
            {NETWORK_LABEL === null ? (
              <span
                className="hidden items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11.5px] font-semibold text-warning sm:inline-flex"
                title="Set NEXT_PUBLIC_NETWORK_LABEL to identify this deployment's network."
              >
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                Network not configured
              </span>
            ) : (
              <span className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 font-mono text-[11.5px] font-semibold text-text-2 sm:inline-flex">
                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                {NETWORK_LABEL}
              </span>
            )}
            <span className="lg:hidden">
              <SearchBox variant="icon" />
            </span>
            <ThemeToggle />
            <MobileNav />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>

      <footer className="mt-6 border-t border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 text-sm text-text-3">
          <Brand small />
          <span className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 mg-caption">
            <HealthIndicator />
            <span className="font-mono">1 ADA = 1,000,000 lovelace</span>
            <span>Data from the connected Midgard node</span>
          </span>
        </div>
      </footer>
    </>
  );
}

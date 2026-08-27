import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { HeaderSearchBox, SearchBox } from "../search/SearchOverlay";
import { Icon } from "../ui/icons";
import { InfoTip } from "../ui/infotip";
import { HealthIndicator } from "./HealthIndicator";
import { MobileNav, NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";
import { BRIDGE, TOP } from "../../lib/nav";
import { NETWORK_LABEL } from "../../lib/network";

function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Midgard Explorer, home"
      className={
        small
          ? "flex min-h-9 min-w-0 items-center gap-2.5"
          : "flex min-h-11 shrink-0 items-center gap-2.5"
      }
    >
      {/* Vector, so the mark stays crisp at 20px, 28px and on a retina screen,
          and costs a fifth of the raster it replaced. `unoptimized` because the
          image optimizer cannot improve an SVG and would need
          `dangerouslyAllowSVG` to pass it through at all. */}
      <Image
        src="/midgard-mark.svg"
        alt=""
        width={small ? 20 : 28}
        height={small ? 20 : 28}
        priority={!small}
        unoptimized
        className="shrink-0"
      />
      {small ? (
        <span className="mg-brand-green min-w-0 font-display text-sm font-semibold text-text-2">
          Midgard Explorer
        </span>
      ) : (
        <span className="flex flex-col leading-none">
          <span className="mg-brand-green font-display text-lg font-bold tracking-[0.02em] text-text">
            MIDGARD
          </span>
          <span className="mg-brand-green mt-0.5 text-micro font-semibold tracking-[0.1em] text-text-3">
            EXPLORER
          </span>
        </span>
      )}
    </Link>
  );
}

const YEAR = new Date().getFullYear();

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mg-overline mb-2.5">{title}</p>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}

/** Footer links carry a comfortable tap target on phones and collapse to the
 * text height once there is a pointer, matching the density of the columns.
 *
 * An external link is marked, because leaving the site in a new tab is a
 * different act from moving inside it and the two looked identical. The glyph
 * is decorative and the words carry the destination; the announcement for a
 * screen reader is the "opens in a new tab" text beside it, not the mark. */
function FooterLink({
  href,
  external = false,
  children,
}: {
  href: string;
  external?: boolean;
  children: ReactNode;
}) {
  const className =
    "inline-flex min-h-9 items-center gap-1.5 text-sm text-text-3 transition-colors hover:text-link hover:underline sm:min-h-0 sm:py-0.5";
  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer" className={className}>
          {children}
          <Icon name="external" size={12} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <Link href={href} className={className}>
          {children}
        </Link>
      )}
    </li>
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

      <header className="sticky top-0 z-40 border-b border-border bg-(--mg-header-bg)">
        {/* Three columns rather than a flex row with mx-auto: the centre column
            is measured against the header, not against whatever the two side
            clusters happen to weigh. The active nav item turns semibold and the
            network badge appears at sm, both of which would otherwise shift the
            nav sideways as you navigate and resize. */}
        <div className="mx-auto grid h-[60px] max-w-[96rem] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 lg:px-6">
          <Brand />
          <NavLinks />
          <div className="flex min-w-0 items-center justify-end gap-2">
            <HeaderSearchBox />
            {NETWORK_LABEL === null ? (
              <span className="hidden items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-micro font-semibold text-warning sm:inline-flex">
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                Network not configured
                <InfoTip
                  subject="network configuration"
                  explain="Set NEXT_PUBLIC_NETWORK_LABEL to identify which network this deployment reads from. Until then, the explorer withholds a network claim rather than guessing."
                />
              </span>
            ) : (
              <span className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 font-mono text-micro font-semibold text-text-2 sm:inline-flex">
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

      <main id="main" className="mx-auto min-w-0 w-full max-w-[96rem] flex-1 px-4 py-6 lg:px-6">
        {children}
      </main>

      <footer className="mt-6 border-t border-border bg-surface">
        <div className="mx-auto max-w-[96rem] px-4 py-8 lg:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
            <div className="min-w-0">
              <Brand small />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 mg-caption text-text-3">
                <HealthIndicator />
                {NETWORK_LABEL === null ? null : <span className="font-mono">{NETWORK_LABEL}</span>}
              </div>
            </div>

            <FooterColumn title="Explore">
              {TOP.map((t) => (
                <FooterLink key={t.href} href={t.href}>
                  {t.label}
                </FooterLink>
              ))}
            </FooterColumn>

            <FooterColumn title="Bridge">
              {BRIDGE.map((b) => (
                <FooterLink key={b.href} href={b.href}>
                  {b.label}
                </FooterLink>
              ))}
            </FooterColumn>

            <FooterColumn title="Resources">
              {/* A utility rather than a record type, so it sits here rather
                  than competing for room in the primary nav. */}
              <FooterLink href="/glossary">Glossary</FooterLink>
              <FooterLink href="/api-docs">API reference</FooterLink>
              <FooterLink href="/tools">Tools</FooterLink>
              <FooterLink href="https://midgardprotocol.com" external>
                About Midgard
              </FooterLink>
              <FooterLink href="https://github.com/Anastasia-Labs/midgard" external>
                Source
              </FooterLink>
            </FooterColumn>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border pt-5 mg-caption text-text-3">
            <span>© {YEAR} Midgard Labs</span>
            <span className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="font-mono">1 ADA = 1,000,000 lovelace</span>
              <span>Data from the connected Midgard node</span>
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}

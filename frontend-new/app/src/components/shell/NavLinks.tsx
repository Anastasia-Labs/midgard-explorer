"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons";
import { cn } from "../../lib/format";

/** Information architecture from the Ledger Redesign template: top-level
 * routes match the domain model; the three L1↔L2 bridge mechanisms live
 * under one "Bridge" menu instead of crowding the header. */
const TOP = [
  { href: "/", label: "Overview" },
  { href: "/blocks", label: "Blocks" },
  { href: "/transactions", label: "Transactions" },
  { href: "/assets", label: "Assets" },
];

export const BRIDGE = [
  {
    href: "/deposits",
    label: "Deposits",
    desc: "L1 funds entering the L2 ledger",
    from: "L1",
    to: "L2",
  },
  {
    href: "/withdrawals",
    label: "Withdrawals",
    desc: "L2 funds exiting back to L1",
    from: "L2",
    to: "L1",
  },
  {
    href: "/forced-transactions",
    label: "Forced transactions",
    desc: "L1-escrowed transactions the operator must include",
    from: "L1",
    to: "L2",
  },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function ActiveBar() {
  return (
    <span aria-hidden className="absolute inset-x-2.5 -bottom-[13px] h-0.5 rounded bg-accent" />
  );
}

function BridgeMenu() {
  const isActive = useActive();
  const active = BRIDGE.some((b) => isActive(b.href));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-surface-2 hover:text-text",
          active ? "font-semibold text-text" : "text-text-2",
        )}
      >
        Bridge
        <Icon
          name="chevronDown"
          size={14}
          className={cn("transition-transform", open && "rotate-180")}
        />
        {active ? <ActiveBar /> : null}
      </button>
      {open ? (
        <div
          role="menu"
          className="mg-pop absolute left-0 top-[calc(100%+13px)] z-50 w-72 rounded-xl border border-border-strong bg-surface p-1.5 shadow-lg"
        >
          {BRIDGE.map((b) => (
            <Link
              key={b.href}
              href={b.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-surface-2"
            >
              <span className="mt-0.5 text-accent">
                <Icon name="bridge" size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{b.label}</span>
                <span className="block text-xs text-text-3">{b.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function NavLinks() {
  const isActive = useActive();
  return (
    <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex">
      {TOP.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={cn(
            "relative whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-surface-2 hover:text-text",
            isActive(href) ? "font-semibold text-text" : "text-text-2",
          )}
        >
          {label}
          {isActive(href) ? <ActiveBar /> : null}
        </Link>
      ))}
      <BridgeMenu />
    </nav>
  );
}

export function MobileNav() {
  const isActive = useActive();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

  const item = (href: string, label: string, desc?: string) => (
    <Link
      key={href}
      href={href}
      aria-current={isActive(href) ? "page" : undefined}
      onClick={close}
      className={cn(
        "block rounded-lg px-3 py-2.5",
        isActive(href) ? "bg-surface-2 text-text" : "text-text-2",
      )}
    >
      <span className="block text-sm font-medium">{label}</span>
      {desc ? <span className="block text-xs text-text-3">{desc}</span> : null}
    </Link>
  );

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => dialogRef.current?.showModal()}
        className="flex size-9 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text"
      >
        <Icon name="menu" size={19} />
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Navigation"
        className="mg-pop m-0 ml-auto h-dvh max-h-none w-72 max-w-[85vw] border-l border-border bg-surface p-0 text-text backdrop:bg-black/50"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="mg-overline">Navigate</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="flex size-9 items-center justify-center rounded-md text-text-2 hover:bg-surface-2"
          >
            <Icon name="x" size={17} />
          </button>
        </div>
        <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
          {TOP.map(({ href, label }) => item(href, label))}
          <p className="mg-overline px-3 pb-1 pt-3">Bridge</p>
          {BRIDGE.map((b) => item(b.href, b.label, b.desc))}
        </nav>
      </dialog>
    </div>
  );
}

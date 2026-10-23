"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Icon } from "../ui/icons";

/** Theme choice persisted in localStorage("mg_theme"); "system" clears it and
 * follows the OS. The root layout's inline script applies the stored value
 * before paint.
 *
 * The button toggles the EFFECTIVE theme, not the stored enum, so every click
 * changes what is on screen. Picking the theme the OS already asks for clears
 * the override instead of pinning it: that keeps "follow my system" as the
 * resting state without a third click that renders identically. */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const lightQuery = () => window.matchMedia("(prefers-color-scheme: light)");

const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  const mql = lightQuery();
  mql.addEventListener("change", notify);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
    mql.removeEventListener("change", notify);
  };
};

/** "<stored>:<os>": one primitive that changes when either side does.
 * Dark is the default when the OS expresses no preference, matching tokens.css. */
const getSnapshot = () => {
  const raw = localStorage.getItem("mg_theme");
  const stored = raw === "dark" || raw === "light" ? raw : "system";
  return `${stored}:${lightQuery().matches ? "light" : "dark"}`;
};

const getServerSnapshot = () => "system:dark";

export function ThemeToggle() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [stored, os] = snapshot.split(":") as [string, string];
  const effective = stored === "system" ? os : stored;
  const next = effective === "dark" ? "light" : "dark";

  const apply = useCallback((choice: string, osTheme: string) => {
    if (choice === osTheme) {
      localStorage.removeItem("mg_theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("mg_theme", choice);
      document.documentElement.dataset.theme = choice;
    }
    notify();
  }, []);

  const label =
    stored === "system"
      ? `Theme: ${effective}, following your system. Switch to ${next}.`
      : `Theme: ${effective}. Switch to ${next}.`;

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => apply(next, os)}
      className="relative flex size-9 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text"
    >
      <Icon name={effective === "light" ? "sun" : "moon"} size={17} />
      {stored === "system" ? (
        <span
          aria-hidden
          className="absolute bottom-1.5 right-1.5 size-1.5 rounded-full bg-text-3"
        />
      ) : null}
      <span className="sr-only">{label}</span>
    </button>
  );
}

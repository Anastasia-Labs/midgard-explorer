import type { AssetMap } from "@midgard-explorer/contracts";

/** Formatting helpers. All amount math is BigInt: never Number. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatAda(lovelace: string | bigint): string {
  const n = BigInt(lovelace);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  const wholeStr = groupThousands(whole.toString());
  if (frac === 0n) return wholeStr;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${wholeStr}.${fracStr}`;
}

export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function truncateId(id: string, head = 8, tail = 8): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function relativeTime(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  // Past a month the reading gets coarser, it does not stop.
  //
  // This used to fall back to the absolute timestamp, which made a list
  // inconsistent with itself: rows inside the window read "20d ago" and older
  // ones printed "2026-07-26 09:40:53 UTC", so a reader had to compare two
  // different kinds of value down one column. The fallback existed because the
  // absolute form is about three times the width of the relative one and a
  // table sized for "30d ago" overflowed the day a row reached 31 days.
  //
  // A coarser relative unit answers both. "2mo ago" is NARROWER than "30d ago",
  // so the width that motivated the fallback is bounded at every age rather
  // than only inside the window. The absolute instant is still one field away:
  // `Timestamp` renders it beside the relative reading on detail pages and
  // always exposes it to assistive technology.
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

export function assetCount(assets: AssetMap): number {
  return Object.values(assets).reduce((n, m) => n + Object.keys(m).length, 0);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = ms / 1000;
  if (s < 10) return `${Number(s.toFixed(1))}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s - m * 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m - h * 60}m`;
  // Days, because this explorer routinely shows long quiet periods and an
  // hours-only reading stops being readable at exactly that point: a chain
  // twenty days quiet rendered as "485h 45m", which nobody converts in their
  // head. The tiers below a day are unchanged.
  const d = Math.floor(h / 24);
  return `${d}d ${h - d * 24}h`;
}

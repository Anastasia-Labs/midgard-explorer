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
  if (d <= 30) return `${d}d ago`;
  return formatTimestamp(iso);
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
  return `${h}h ${m - h * 60}m`;
}

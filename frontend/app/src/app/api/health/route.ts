import { apiBase } from "../../../lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // `/readyz`, not `/healthz`: the question this indicator answers is whether
    // the explorer can serve a record, and `/healthz` answers 200 from a
    // process whose databases have both gone away.
    const res = await fetch(`${apiBase()}/readyz`, { signal: AbortSignal.timeout(3_000) });
    // The public source fails readiness when only the Midgard node is down,
    // while it keeps serving archived records: that is the node, not the API.
    let nodeDown = false;
    if (!res.ok) {
      const report = (await res.json().catch(() => null)) as {
        checks?: Array<{ name: string; ok: boolean }>;
      } | null;
      const failing = (report?.checks ?? []).filter((c) => !c.ok).map((c) => c.name);
      nodeDown = failing.length > 0 && failing.every((name) => name === "node-deployment");
    }
    return Response.json(
      { up: res.ok || nodeDown, nodeDown },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ up: false }, { headers: { "cache-control": "no-store" } });
  }
}

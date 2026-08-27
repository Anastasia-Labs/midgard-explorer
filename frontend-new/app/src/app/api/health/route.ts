import { apiBase } from "../../../lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // `/readyz`, not `/healthz`: the question this indicator answers is whether
    // the explorer can serve a record, and `/healthz` answers 200 from a
    // process whose databases have both gone away.
    const res = await fetch(`${apiBase()}/readyz`, { signal: AbortSignal.timeout(3_000) });
    return Response.json({ up: res.ok }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ up: false }, { headers: { "cache-control": "no-store" } });
  }
}

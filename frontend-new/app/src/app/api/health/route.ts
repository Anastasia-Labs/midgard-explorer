import { apiBase } from "../../../lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${apiBase()}/healthz`, { signal: AbortSignal.timeout(3_000) });
    return Response.json({ up: res.ok }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ up: false }, { headers: { "cache-control": "no-store" } });
  }
}

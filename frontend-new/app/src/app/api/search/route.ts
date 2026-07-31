import { apiBase } from "../../../lib/env";

export const dynamic = "force-dynamic";

/** Same-origin proxy for prefix search.
 *
 * The search box runs in the browser, where the backend may not be reachable
 * directly, which is why every other client-side fetch in this app goes through
 * a route handler too. The response is passed through unchanged; the shape is
 * the backend's.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const res = await fetch(`${apiBase()}/api/search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return Response.json({ hits: [] }, { headers: { "cache-control": "no-store" } });
    return Response.json(await res.json(), { headers: { "cache-control": "no-store" } });
  } catch {
    // A suggestion that cannot be fetched is an absent suggestion, not an error
    // worth interrupting typing for.
    return Response.json({ hits: [] }, { headers: { "cache-control": "no-store" } });
  }
}

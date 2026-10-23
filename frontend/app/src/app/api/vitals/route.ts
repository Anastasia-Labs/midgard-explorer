import { apiBase } from "../../../lib/env";
import { forwardedForHeader } from "../../../lib/forwardClient";
import { readLimitedText, RequestBodyError } from "../../../lib/requestBody";

export const dynamic = "force-dynamic";

const reply = (status: number) =>
  new Response(null, { status, headers: { "cache-control": "no-store" } });

/** Same-origin beacon relay; the backend owns sample validation and rate limits. */
export async function POST(request: Request) {
  let body: string;
  try {
    body = await readLimitedText(request, 1024, 3_000);
  } catch (error) {
    return reply(error instanceof RequestBodyError ? error.status : 400);
  }
  try {
    const res = await fetch(`${apiBase()}/api/vitals`, {
      method: "POST",
      headers: { "content-type": "text/plain", ...forwardedForHeader(request) },
      body,
      signal: AbortSignal.timeout(3_000),
    });
    return reply(res.status);
  } catch {
    // Telemetry delivery failure must not interrupt the page.
    return reply(202);
  }
}

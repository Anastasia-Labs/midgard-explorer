import { apiBase } from "../../../lib/env";

export const dynamic = "force-dynamic";

/**
 * The Web Vitals beacon, forwarded from this origin to the API.
 *
 * The browser used to post straight to the configured API base, which is an
 * absolute URL. Where the API is a different origin from the application, and
 * that is one of the two deployment shapes the README documents, the page's own
 * Content Security Policy refused it: `connect-src 'self'`. The beacon fired,
 * the browser blocked it, and the register recorded "0 samples" as a missing
 * deployment rather than as a policy the application sets on itself.
 *
 * Posting here instead keeps the request same-origin, so no policy has to be
 * widened to admit an API origin for every other request too. It is the same
 * shape `/api/health`, `/api/overview` and `/api/search` already use.
 *
 * Not an open relay: the destination is this deployment's configured API and
 * nothing in the request can redirect it. The body is passed through as text
 * and validated by the API, which is where the schema lives.
 */
export async function POST(request: Request) {
  const body = await request.text();
  // The API's own limit is 1 KB. Refusing a larger body here means an
  // oversized beacon costs one request to this process rather than two.
  if (body.length > 1024) {
    return new Response(null, { status: 413, headers: { "cache-control": "no-store" } });
  }
  try {
    const res = await fetch(`${apiBase()}/api/vitals`, {
      method: "POST",
      // `text/plain` is what the beacon sends and what the API parses.
      headers: { "content-type": "text/plain" },
      body,
      signal: AbortSignal.timeout(3_000),
    });
    return new Response(null, {
      status: res.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    // A sample is telemetry. Losing one because the API is briefly away is not
    // worth an error in the browser console on every page.
    return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });
  }
}

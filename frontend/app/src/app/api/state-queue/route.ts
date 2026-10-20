import { ApiError, api } from "../../../lib/api";
import { forwardedForHeader } from "../../../lib/forwardClient";

export const dynamic = "force-dynamic";

/** Same-origin relay for the Blocks page's queue poll. The payload is decoded
 * here, so the browser receives only a contract-shaped queue. */
export async function GET(request: Request) {
  try {
    const queue = await api.stateQueue({ headers: forwardedForHeader(request) });
    return Response.json(queue, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // A source that cannot read the queue says so, and so does a backend older
    // than the queue route, which the frontend-first rollout meets for a
    // while. Anything else is a failure the poll retries.
    const unavailable =
      error instanceof ApiError &&
      (error.category === "unavailable" || error.category === "http_404");
    return Response.json(
      { unavailable },
      { status: unavailable ? 501 : 503, headers: { "cache-control": "no-store" } },
    );
  }
}

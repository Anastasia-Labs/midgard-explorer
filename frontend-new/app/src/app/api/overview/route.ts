import { forwardedForHeader } from "../../../lib/forwardClient";
import { getOverviewData } from "../../../lib/overview";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // The backend rate-limits per client. Without forwarding the original
  // address, every viewer of the home page shares one budget.
  const data = await getOverviewData({ headers: forwardedForHeader(request) });
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}

import { getOverviewData } from "../../../lib/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getOverviewData();
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}

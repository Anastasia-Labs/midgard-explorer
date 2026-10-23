import { headers } from "next/headers";
import type { FetchInit } from "./api";
import { forwardedFrom } from "./forwardClient";

/**
 * What a server component passes to `api.*` so the backend can tell its readers
 * apart.
 *
 * The route handlers under `app/api` already forward the viewer's address. A
 * page rendered on the server fetches without one unless it asks for it here,
 * and the rate-limited routes it reaches (the asset scan, metrics) would then
 * count every reader against a single budget.
 *
 * Kept apart from `forwardClient.ts` because `next/headers` may only be read
 * while rendering on the server, and that module is also reachable from code
 * that is not.
 */
export async function viewerInit(): Promise<FetchInit> {
  return { headers: forwardedFrom(await headers()) };
}

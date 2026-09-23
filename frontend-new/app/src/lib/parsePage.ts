import { maxPageFor } from "@midgard-explorer/contracts";
import { notFound } from "next/navigation";

/**
 * The page number in a URL, or a 404.
 *
 * Bounded by what the API will serve rather than by digit count. The six-digit
 * pattern this used to carry allowed page 999,999, which every list route now
 * answers with a 400, so a reader who edited the URL got a server error where
 * the honest answer is that there is no such page. `pageSize` is the route's
 * own, because the bound is on rows scanned and the page sizes differ.
 *
 * A page past the end of the data is NOT this: that is a real, cheap, empty
 * page, and the list says so. This is only the depth nothing will serve.
 */
export function parsePage(raw: string | undefined, pageSize = 25): number {
  if (raw === undefined) return 1;
  if (!/^[0-9]{1,9}$/.test(raw)) notFound();
  const page = Number(raw);
  if (page < 1 || page > maxPageFor(pageSize)) notFound();
  return page;
}

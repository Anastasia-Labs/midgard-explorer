/**
 * Web Vitals, shaped for the backend's `POST /api/vitals`.
 *
 * The budget is per route CLASS and device CLASS, never per path: a label per
 * block page would be one series per block. Classes are derived from the path
 * here, and the backend refuses any value outside the same closed sets.
 */

export type VitalName = "LCP" | "INP" | "CLS";
export type RouteClass = "overview" | "list" | "detail" | "other";
export type DeviceClass = "mobile" | "desktop";

export type VitalSample = {
  name: VitalName;
  value: number;
  routeClass: RouteClass;
  deviceClass: DeviceClass;
};

const BUDGETED: ReadonlySet<string> = new Set<VitalName>(["LCP", "INP", "CLS"]);

/** Index pages, with or without a page number. */
const LIST =
  /^\/(blocks|transactions|deposits|withdrawals|forced-transactions)(\/\d+)?$|^\/(assets|l1)$/;

/** One record each. */
const DETAIL =
  /^\/(block\/[^/]+|block\/height\/[^/]+|transaction\/[^/]+|address\/[^/]+|asset\/[^/]+|asset\/by-fingerprint\/[^/]+|l1\/transaction\/[^/]+|l1\/validator\/[^/]+)$/;

export function routeClass(pathname: string): RouteClass {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/") return "overview";
  if (LIST.test(path)) return "list";
  if (DETAIL.test(path)) return "detail";
  return "other";
}

/** The layout's own breakpoint: below `md` (768 px) the page is the mobile one. */
export const MOBILE_QUERY = "(max-width: 767.98px)";

/** A sample for a budgeted metric, or `null` for one the budget does not name. */
export function vitalSample(
  metric: { name: string; value: number },
  pathname: string,
  mobile: boolean,
): VitalSample | null {
  if (!BUDGETED.has(metric.name) || !Number.isFinite(metric.value) || metric.value < 0) {
    return null;
  }
  return {
    name: metric.name as VitalName,
    value: metric.value,
    routeClass: routeClass(pathname),
    deviceClass: mobile ? "mobile" : "desktop",
  };
}

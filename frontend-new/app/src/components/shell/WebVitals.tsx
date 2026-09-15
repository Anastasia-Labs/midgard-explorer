"use client";

import { useReportWebVitals } from "next/web-vitals";
import { PUBLIC_API_BASE } from "../../lib/env";
import { MOBILE_QUERY, vitalSample } from "../../lib/vitals";

export function WebVitals() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[web-vitals]", metric.name, metric.value, metric.rating);
      return;
    }
    const sample = vitalSample(
      metric,
      window.location.pathname,
      window.matchMedia(MOBILE_QUERY).matches,
    );
    if (sample === null || typeof navigator.sendBeacon !== "function") return;
    // text/plain posts without a CORS preflight, and a beacon survives the page
    // being hidden, which is when LCP, INP and CLS are usually final.
    navigator.sendBeacon(
      `${PUBLIC_API_BASE}/api/vitals`,
      new Blob([JSON.stringify(sample)], { type: "text/plain" }),
    );
  });
  return null;
}

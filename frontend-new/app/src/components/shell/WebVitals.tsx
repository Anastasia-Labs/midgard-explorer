"use client";

import { useReportWebVitals } from "next/web-vitals";
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
    // Same-origin, and relative on purpose. This posted to the configured API
    // base, which is an absolute URL: in the split-origin deployment shape the
    // page's own `connect-src 'self'` refused every beacon, so the one feature
    // that reports how the site performs reported nothing. `/api/vitals` is a
    // route handler on this origin that forwards to the API.
    //
    // text/plain posts without a CORS preflight, and a beacon survives the page
    // being hidden, which is when LCP, INP and CLS are usually final.
    navigator.sendBeacon("/api/vitals", new Blob([JSON.stringify(sample)], { type: "text/plain" }));
  });
  return null;
}

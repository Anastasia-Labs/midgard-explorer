"use client";

import { useReportWebVitals } from "next/web-vitals";

export function WebVitals() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[web-vitals]", metric.name, metric.value, metric.rating);
    }
  });
  return null;
}

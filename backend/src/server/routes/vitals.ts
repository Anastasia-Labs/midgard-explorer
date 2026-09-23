import express, { type RequestHandler } from "express";
import { z } from "zod";
import { webVitals } from "../../telemetry/metrics";

/**
 * One Web Vitals sample from a browser.
 *
 * Sent with `navigator.sendBeacon` as `text/plain`, which a browser posts
 * cross-origin without a preflight, so the body is read as text and parsed
 * here. Anyone can post to this route: every field is drawn from a closed set
 * or a bounded range, so a forged sample can skew a figure but cannot add a
 * series, and the per-client rate limit bounds how many one client sends.
 */

/** Far above anything a real page reports. LCP and INP are milliseconds. */
const CEILINGS = { LCP: 120_000, INP: 60_000, CLS: 10 } as const;

const sample = z
  .object({
    name: z.enum(["LCP", "INP", "CLS"]),
    value: z.number().finite().nonnegative(),
    routeClass: z.enum(["overview", "list", "detail", "other"]),
    deviceClass: z.enum(["mobile", "desktop"]),
  })
  .strict()
  .refine((s) => s.value <= CEILINGS[s.name], { path: ["value"], message: "out of range" });

const textBody = express.text({ type: () => true, limit: "1kb" });

export const postVitalsRoute: RequestHandler = (req, res) => {
  textBody(req, res, (error?: unknown) => {
    if (error) {
      // The parser's own status: 413 for a body over the limit. Anything it
      // cannot classify is still the client's malformed request.
      const status = (error as { status?: unknown }).status;
      const code = typeof status === "number" && status >= 400 && status < 500 ? status : 400;
      res.status(code).json({ error: "Unreadable Web Vitals sample." });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof req.body === "string" ? req.body : "");
    } catch {
      res.status(400).json({ error: "Body is not JSON." });
      return;
    }
    const result = sample.safeParse(parsed);
    if (!result.success) {
      res.status(400).json({ error: "Not a Web Vitals sample." });
      return;
    }
    const { name, value, routeClass, deviceClass } = result.data;
    webVitals[name].observe(
      { route_class: routeClass, device_class: deviceClass },
      name === "CLS" ? value : value / 1_000,
    );
    res.status(204).end();
  });
};

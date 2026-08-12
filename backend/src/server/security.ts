import { NextFunction, Request, Response } from "express";

/**
 * The response headers a JSON API needs, set explicitly rather than pulled in
 * with a general-purpose helmet-style dependency. The set is short and static
 * because this server returns JSON and nothing else: no HTML, no scripts, no
 * embedded resources. A library configured down to this same list would add a
 * dependency without adding a header.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // Stops a browser from second-guessing our Content-Type, which is what turns
  // an API response into an executed script.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Nothing here is meant to be framed.
  res.setHeader("X-Frame-Options", "DENY");
  // Addresses and transaction hashes are in our URLs; do not hand them to
  // whatever a reader clicks through to.
  res.setHeader("Referrer-Policy", "no-referrer");
  // An API loads nothing on its own behalf, so the honest policy is "nothing".
  // frame-ancestors repeats X-Frame-Options for browsers that prefer CSP.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  next();
}

/**
 * The wildcard is a fine default for local development and a mistake in
 * production, where it lets any site read this API with a reader's browser.
 *
 * Refusing at boot is the only place it can be caught: a wildcard in a running
 * deployment looks exactly like a working deployment. This is the same lesson
 * as the database that was read for weeks without anyone noticing, applied to
 * a setting that also lives in an untracked .env.
 */
export function resolveCorsOrigin(configured: string, nodeEnv: string): string {
  if (configured === "*" && nodeEnv === "production") {
    throw new Error(
      "CORS_ORIGIN is \"*\" in production. Set it to the single origin the " +
        "explorer is served from, for example https://explorer.example. This " +
        "value is echoed verbatim into Access-Control-Allow-Origin, which " +
        "accepts one origin and not a list.",
    );
  }
  return configured;
}

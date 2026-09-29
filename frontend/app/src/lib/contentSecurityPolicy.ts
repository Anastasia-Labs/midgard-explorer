/** Build the request-scoped browser policy used by `proxy.ts`.
 *
 * Scripts require an unpredictable nonce. Styles retain `unsafe-inline`
 * because the explorer deliberately uses computed style attributes for graph
 * geometry, identicons, and entity hues; CSP nonces cannot authorize style
 * attributes. That exception is confined to styles and must never be copied to
 * `script-src`.
 */
export function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

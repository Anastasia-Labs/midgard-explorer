/** API base URLs, explicit per context (redesign brief: deployment topology).
 * - Browser: NEXT_PUBLIC_API_BASE (inlined at build time; "" = same-origin proxy).
 * - Server Components: API_BASE_SERVER, falling back to the public base.
 */
const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

export const PUBLIC_API_BASE = stripTrailingSlash(
  // The bundled reverse proxy is the default public origin. Reaching 3101
  // directly bypasses shared caching and should be an explicit development
  // choice, not the application's fallback.
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3102",
);

export const apiBase = (): string => {
  if (typeof window !== "undefined") return PUBLIC_API_BASE;
  return stripTrailingSlash(process.env.API_BASE_SERVER ?? PUBLIC_API_BASE);
};

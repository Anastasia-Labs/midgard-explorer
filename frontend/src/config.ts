const env = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env;

// Base URL for the backend API. Empty string = same-origin: the Vite dev proxy
// in development, or a reverse-proxy fronting both apps in production. Set
// VITE_API_BASE_URL to the backend origin for split (cross-origin) deployments.
export const API_BASE = (env?.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

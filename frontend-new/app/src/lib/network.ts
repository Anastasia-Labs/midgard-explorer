/** Network identity is never guessed. A misconfigured deployment that silently
 * claims "Preprod" and links to the wrong Cardanoscan is a trust defect for an
 * explorer, so both values are explicit or absent.
 *
 * Set MG_STRICT_CONFIG=1 in deployment environments to fail the build when
 * either value is missing. Local development renders "Network not configured".
 */
const clean = (s: string | undefined): string | null => {
  const t = s?.trim();
  return t === undefined || t === "" ? null : t;
};

export const NETWORK_LABEL = clean(process.env.NEXT_PUBLIC_NETWORK_LABEL);

const L1_EXPLORER_BASE =
  clean(process.env.NEXT_PUBLIC_L1_EXPLORER_URL)?.replace(/\/+$/, "") ?? null;

export function l1TxUrl(hash: string): string | null {
  return L1_EXPLORER_BASE === null ? null : `${L1_EXPLORER_BASE}/transaction/${hash}`;
}

export function assertNetworkConfigured(): void {
  if (process.env.MG_STRICT_CONFIG !== "1") return;
  const missing: string[] = [];
  if (NETWORK_LABEL === null) missing.push("NEXT_PUBLIC_NETWORK_LABEL");
  if (L1_EXPLORER_BASE === null) missing.push("NEXT_PUBLIC_L1_EXPLORER_URL");
  if (missing.length > 0) {
    throw new Error(`Missing required deployment configuration: ${missing.join(", ")}`);
  }
}

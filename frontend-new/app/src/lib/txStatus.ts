/** Statuses at which a transaction stops changing, so the detail page can stop
 * polling for it. */
export const TERMINAL_TX_STATUSES = new Set(["committed", "rejected"]);

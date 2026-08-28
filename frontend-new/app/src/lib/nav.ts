/** Route data shared by the header, the mobile drawer and the footer.
 *
 * It lives outside NavLinks because that module is a client component: a server
 * component importing a value from it receives a client reference rather than
 * the array itself, which type-checks and then fails at render.
 *
 * Information architecture from the Ledger Redesign template: top-level routes
 * match the domain model, and the three L1↔L2 bridge mechanisms sit together
 * under one Bridge menu instead of crowding the header.
 *
 * These are data domains only. The overview is reached through the brand mark,
 * which is already a labelled home link, so listing it here would be a second
 * control for the same destination sitting beside the first.
 */
export const TOP = [
  { href: "/blocks", label: "Blocks" },
  { href: "/transactions", label: "Transactions" },
  { href: "/assets", label: "Assets" },
  // Midgard's own footprint on Cardano, which is a different data domain from
  // the three above: those read the Midgard ledger, this reads the L1 chain.
  { href: "/l1", label: "Cardano" },
] as const;

export const BRIDGE = [
  {
    href: "/deposits",
    label: "Deposits",
    desc: "L1 funds entering the L2 ledger",
    from: "L1",
    to: "L2",
  },
  {
    href: "/withdrawals",
    label: "Withdrawals",
    desc: "L2 funds exiting back to L1",
    from: "L2",
    to: "L1",
  },
  {
    href: "/forced-transactions",
    label: "Forced transactions",
    desc: "L1-escrowed transactions the operator must include",
    from: "L1",
    to: "L2",
  },
] as const;

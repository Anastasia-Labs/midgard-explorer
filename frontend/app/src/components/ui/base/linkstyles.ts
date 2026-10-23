/** The underlined link style for identifiers and record references. A plain
 * module, not a client one: a string exported from a "use client" file reaches
 * a Server Component as a client reference, not as the string. */
export const ID_LINK_CLASS =
  "inline-flex min-h-9 items-center gap-1 text-text underline decoration-border-strong " +
  "underline-offset-2 transition-colors hover:text-link hover:decoration-link sm:min-h-0";

import { Identicon } from "./identicon";
import { Identifier } from "./identifier";

/**
 * An address, everywhere one appears.
 *
 * One component rather than an `Identifier` per call site, so the generated
 * mark cannot be present in some lists and missing in others. A mark that is
 * only sometimes there is worse than none: a reader learns to scan for it and
 * then finds nothing to scan.
 *
 * The mark is decoration and the text is the fact, which is why the mark is
 * `aria-hidden` and the address is still rendered in full to the clipboard.
 */
export function AddressLink({
  address,
  head = 8,
  tail = 8,
  size = 20,
  href,
  kind,
}: {
  address: string;
  head?: number;
  tail?: number;
  size?: number;
  /** Defaults to the address page. Given explicitly only where a different
   * destination is genuinely meant. */
  href?: string | undefined;
  /** `"Script"` or `"PubKey"` where the payment credential is known. Omitted
   * where it is not: the marker means "this is a script", and its absence must
   * not be read as "this is not one" when nobody checked (4.3.3). */
  kind?: string | undefined;
}) {
  const script = kind === "Script";
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {/* Square corners for a script, rounded for a key: the same shape
          language the UTxO flow uses, so the distinction means one thing
          across the site. */}
      <Identicon seed={address} size={size} className={script ? "rounded-[1px]" : undefined} />
      <Identifier value={address} href={href ?? `/address/${address}`} head={head} tail={tail} />
      {script ? (
        <span className="rounded border border-border bg-surface px-1.5 py-px text-[11px] whitespace-nowrap text-text-3">
          script
        </span>
      ) : null}
    </span>
  );
}

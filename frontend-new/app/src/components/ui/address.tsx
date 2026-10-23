import { Chip } from "./primitives";
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
  external = false,
  externalLabel,
  kind,
  chain = "midgard",
}: {
  address: string;
  head?: number;
  tail?: number;
  size?: number;
  /** The href leaves this site. A Cardano address has no page here, so where a
   * deployment names an external explorer the address becomes a link to it
   * rather than text that can only be copied. */
  external?: boolean;
  externalLabel?: string | undefined;
  /** Defaults to the address page. Given explicitly only where a different
   * destination is genuinely meant. */
  href?: string | undefined;
  /** Which ledger this address belongs to. A Cardano address has no page in a
   * Midgard explorer, so it renders with its mark and no link rather than
   * linking to an address page that would answer "not found". The mark itself
   * is the same either way: it aids recognition and makes no claim, and an
   * address that carried one in one column and not the next would teach a
   * reader to scan for something that is sometimes absent. */
  chain?: "midgard" | "cardano";
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
      <Identifier
        value={address}
        href={chain === "cardano" ? href : (href ?? `/address/${address}`)}
        external={external}
        {...(externalLabel === undefined ? {} : { externalLabel })}
        head={head}
        tail={tail}
      />
      {script ? <Chip className="whitespace-nowrap">script</Chip> : null}
    </span>
  );
}

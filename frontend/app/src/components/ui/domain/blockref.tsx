import Link from "next/link";
import { ID_LINK_CLASS } from "../base/linkstyles";
import { CopyButton, Identifier, ShortId } from "./identifier";

/** A link to a block, the same everywhere: "Block #N" when numbered, else its
 * hash in the site's shortened form. */
export function BlockRef({
  hash,
  height,
  head = 8,
  tail = 6,
  copy = true,
}: {
  hash: string;
  height: number | null;
  head?: number;
  tail?: number;
  copy?: boolean;
}) {
  if (height === null && copy) {
    return <Identifier value={hash} href={`/block/${hash}`} head={head} tail={tail} />;
  }
  if (height === null) {
    return (
      <Link
        href={`/block/${hash}`}
        prefetch={false}
        className={`${ID_LINK_CLASS} whitespace-nowrap font-mono text-sm`}
      >
        <ShortId value={hash} head={head} tail={tail} />
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link
        href={`/block/${hash}`}
        prefetch={false}
        className={`${ID_LINK_CLASS} whitespace-nowrap font-mono text-sm tabular-nums`}
      >
        Block #{height}
      </Link>
      {copy ? <CopyButton value={hash} /> : null}
    </span>
  );
}

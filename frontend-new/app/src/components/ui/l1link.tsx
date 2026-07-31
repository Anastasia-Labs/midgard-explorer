import { CopyButton } from "./identifier";
import { truncateId } from "../../lib/format";
import { l1TxUrl } from "../../lib/network";

export function L1TxLink({ hash }: { hash: string }) {
  const href = l1TxUrl(hash);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="rounded border border-border-strong bg-surface-2 px-1 text-[10px] font-medium uppercase text-text-3"
        title="Cardano layer 1"
      >
        L1
      </span>
      {href === null ? (
        <span
          className="whitespace-nowrap font-mono text-sm"
          title={`${hash}. Set NEXT_PUBLIC_L1_EXPLORER_URL to link L1 hashes.`}
        >
          {truncateId(hash)}
        </span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap font-mono text-sm text-text underline decoration-border-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent"
          title={hash}
        >
          {truncateId(hash)}
        </a>
      )}
      <CopyButton value={hash} />
    </span>
  );
}

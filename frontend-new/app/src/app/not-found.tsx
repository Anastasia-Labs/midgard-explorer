import Image from "next/image";
import Link from "next/link";
import { SearchBox } from "../components/search/SearchOverlay";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-14 text-center">
      <Image src="/midgard-mark.png" alt="" width={44} height={44} className="mx-auto mb-4" />
      <p className="font-mono mg-caption text-text-3">404 · Not found</p>
      <h1 className="mt-2 font-display text-[26px] font-semibold tracking-tight text-text">
        Page not found
      </h1>
      <p className="mt-2 text-[15px] text-text-2">
        No block, transaction, or address matches this path. Try searching for an identifier, or
        return to the overview.
      </p>
      <div className="mx-auto mt-5 max-w-md">
        <SearchBox variant="hero" />
      </div>
      <div className="mt-5 flex justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
        >
          Overview
        </Link>
        <Link
          href="/blocks"
          className="rounded-lg border border-border-strong px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-2"
        >
          Browse blocks
        </Link>
      </div>
    </div>
  );
}

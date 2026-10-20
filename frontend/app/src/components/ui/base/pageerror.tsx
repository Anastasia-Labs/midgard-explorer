"use client";

import { useRouter } from "next/navigation";
import { Icon } from "./icons";

/** `retry={false}` is for an answer this explorer cannot give at all, such as
 * information its configuration does not provide: it is stated in neutral
 * text with no retry, because retrying cannot change it. */
export function PageError({ message, retry = true }: { message: string; retry?: boolean }) {
  const router = useRouter();
  if (!retry) {
    return (
      <section className="overflow-hidden rounded-lg border border-border bg-surface p-8 text-center shadow-(--mg-shadow)">
        <p className="font-medium text-text-2">{message}</p>
      </section>
    );
  }
  return (
    <section
      role="alert"
      className="overflow-hidden rounded-lg border border-danger/40 bg-surface p-8 text-center shadow-(--mg-shadow)"
    >
      <p className="font-medium text-danger">{message}</p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded border border-border-strong px-3 text-sm text-text hover:bg-surface-2"
      >
        <Icon name="refresh" size={14} />
        Retry
      </button>
    </section>
  );
}

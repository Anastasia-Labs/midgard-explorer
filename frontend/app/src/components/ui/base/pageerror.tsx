"use client";

import { useRouter } from "next/navigation";
import { Icon } from "./icons";

export function PageError({ message }: { message: string }) {
  const router = useRouter();
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

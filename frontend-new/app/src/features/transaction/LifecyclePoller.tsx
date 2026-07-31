"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 5_000;

/** Refreshes the server component tree while a transaction is non-terminal.
 * Polling pauses while the tab is hidden and resumes on the way back. */
export function LifecyclePoller() {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return (
    <p aria-live="polite" className="mb-4 text-sm text-text-3">
      Watching for status updates…
    </p>
  );
}

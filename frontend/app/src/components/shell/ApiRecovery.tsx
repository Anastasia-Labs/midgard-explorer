"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useApiHealth } from "./HealthIndicator";

/**
 * Re-renders the page when the API comes back after being down.
 *
 * The frontend starts without the backend, and every page that reads the API
 * shows an inline alert when it cannot. Without this, that alert stays until
 * the reader reloads, even after the backend is up. `router.refresh()` asks the
 * server to render the current route again and swaps the result in, so the
 * records replace the alert in the same document.
 *
 * It acts only on a change from down to up. Refreshing whenever the API is up
 * would re-render every page on every poll, and refreshing while it is down
 * would render the same alert again.
 *
 * The client-side queries need nothing from this: the overview polls on its
 * own, and the health query is the one being watched.
 */
export function ApiRecovery() {
  const up = useApiHealth().data?.up;
  const router = useRouter();
  const wasDown = useRef(false);

  useEffect(() => {
    if (up === false) {
      wasDown.current = true;
    } else if (up === true && wasDown.current) {
      wasDown.current = false;
      router.refresh();
    }
  }, [up, router]);

  return null;
}

"use client";

import { useQuery } from "@tanstack/react-query";

/** Slow while the API answers, because the only question then is whether it
 * stops. Fast while it is down, because someone who has just started the
 * backend is waiting for the page to notice. */
const UP_POLL_MS = 30_000;
const DOWN_POLL_MS = 5_000;

/** Whether the explorer API can serve, as `/api/health` reports it. One query,
 * shared by the indicator and by `ApiRecovery`. */
export function useApiHealth() {
  return useQuery<{ up: boolean }>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) return { up: false };
      return await res.json();
    },
    refetchInterval: (query) => (query.state.data?.up === false ? DOWN_POLL_MS : UP_POLL_MS),
    staleTime: 15_000,
  });
}

export function HealthIndicator() {
  const { data } = useApiHealth();

  const up = data?.up;
  const label = up === undefined ? "API status unknown" : up ? "API reachable" : "API unreachable";

  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <span
        aria-hidden
        className={
          up === undefined
            ? "size-2 rounded-full bg-border-strong"
            : up
              ? "size-2 rounded-full bg-success"
              : "size-2 rounded-full bg-danger"
        }
      />
      {label}
    </span>
  );
}

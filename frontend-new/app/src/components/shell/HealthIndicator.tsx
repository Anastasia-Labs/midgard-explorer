"use client";

import { useQuery } from "@tanstack/react-query";

export function HealthIndicator() {
  const { data } = useQuery<{ up: boolean }>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) return { up: false };
      return await res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

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

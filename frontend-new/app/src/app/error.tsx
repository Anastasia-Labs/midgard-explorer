"use client";

import { ErrorState } from "../components/ui/primitives";

export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="Something went wrong loading this page." onRetry={reset} />;
}

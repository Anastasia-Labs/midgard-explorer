"use client";

import { useRouter } from "next/navigation";
import { RetryButton } from "../../components/ui/base/layout";

/** Retry for a server-rendered page: renders it again with fresh data. */
export function RefreshRetry() {
  const router = useRouter();
  return <RetryButton onRetry={() => router.refresh()} />;
}

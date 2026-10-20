"use client";

import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import type { StateQueueResponse } from "@midgard-explorer/contracts";
import { Card, RetryButton } from "../../components/ui/base/layout";
import { Icon } from "../../components/ui/base/icons";
import { Timestamp } from "../../components/ui/base/timestamp";
import { queueAnnouncement } from "../../lib/stateQueue";
import { QueueTrack } from "./QueueTrack";
import { StateQueueDemo } from "./StateQueueDemo";

const POLL_MS = 5_000;

/** Why a reading failed: a source that cannot read the queue at all, or a
 * failure the next poll may clear. */
class QueueReadError extends Error {
  constructor(readonly unavailable: boolean) {
    super(unavailable ? "state queue unavailable" : "state queue poll failed");
  }
}

async function fetchQueue(): Promise<StateQueueResponse> {
  const res = await fetch("/api/state-queue");
  if (!res.ok) throw new QueueReadError(res.status === 501);
  return (await res.json()) as StateQueueResponse;
}

function summary(q: StateQueueResponse): string {
  const parts = [`${q.depth} waiting to merge`];
  if (q.linked < q.depth) parts.push(`order known for ${q.linked}`);
  if (q.removed > 0) parts.push(`${q.removed} removed`);
  return parts.join(" · ");
}

/**
 * Midgard's state queue, drawn as the linked list it is and kept current.
 *
 * It answers three questions: what is waiting (the cards), what changed (the
 * latest line, which is also what a screen reader hears), and what each block
 * waits for (its badge, and its details on request). It polls every five
 * seconds while the tab is visible and moves only when a reading differs.
 * When a reading fails the last one stays, marked with when it was taken.
 */
export function StateQueue({
  initial,
  unavailable: initiallyUnavailable,
}: {
  initial: StateQueueResponse | null;
  unavailable: boolean;
}) {
  const { data, error, refetch } = useQuery({
    queryKey: ["state-queue"],
    queryFn: fetchQueue,
    ...(initial ? { initialData: initial } : {}),
    staleTime: POLL_MS,
    refetchInterval: (query) =>
      query.state.error instanceof QueueReadError && query.state.error.unavailable
        ? false
        : POLL_MS,
    retry: false,
    enabled: !initiallyUnavailable,
  });
  const [demo, setDemo] = useState(false);

  const [latest, setLatest] = useState<{ said: string; at: string } | null>(null);
  const previous = useRef<StateQueueResponse | undefined>(data);
  useLayoutEffect(() => {
    if (previous.current && data && previous.current !== data) {
      const said = queueAnnouncement(previous.current, data);
      if (said) setLatest({ said, at: data.observedAt });
    }
    previous.current = data;
  }, [data]);

  const unavailable =
    initiallyUnavailable || (error instanceof QueueReadError && error.unavailable);
  const stale = data !== undefined && error !== null && !unavailable;
  const known = data !== undefined && !unavailable;
  const empty = known && data.depth === 0 && data.committing === null && data.linked === data.depth;

  return (
    <>
      <Card className="mb-4" region="state-queue">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text">State queue</h2>
            {known ? <p className="mt-0.5 mg-caption text-text-3">{summary(data)}</p> : null}
            <p aria-live="polite" className="mt-0.5 mg-caption text-text-2">
              {latest ? (
                <>
                  {latest.said} · <Timestamp iso={latest.at} />
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stale ? (
              <span className="flex items-center gap-1.5 mg-caption text-text-3">
                <Icon name="circleHelp" size={14} />
                <span>
                  Last updated <Timestamp iso={data.observedAt} />
                </span>
                <RetryButton onRetry={() => void refetch()} />
              </span>
            ) : null}
            <button
              type="button"
              aria-expanded={demo}
              onClick={() => setDemo((on) => !on)}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-border-strong px-2.5 text-sm text-text hover:bg-surface-2"
            >
              <Icon name="info" size={14} />
              {demo ? "Hide example" : "Show me how it works"}
            </button>
          </div>
        </div>
        {unavailable ? (
          <p className="px-4 py-4 mg-caption text-text-3">Unavailable</p>
        ) : data === undefined ? (
          <div className="flex items-center gap-3 px-4 py-4 mg-caption text-text-3">
            <span>Unavailable</span>
            <RetryButton onRetry={() => void refetch()} />
          </div>
        ) : (
          <div className="px-4 py-4">
            <QueueTrack data={data} label="State queue, confirmed state first" />
            {empty ? (
              <p className="mt-3 mg-caption text-text-3">Nobody in line right now.</p>
            ) : null}
          </div>
        )}
      </Card>
      {demo ? <StateQueueDemo /> : null}
    </>
  );
}

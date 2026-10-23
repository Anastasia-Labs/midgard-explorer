"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Chip } from "../../components/ui/base/layout";
import { demoSteps } from "../../lib/stateQueueDemo";
import { QueueTrack } from "./QueueTrack";
import { DemoBlockAnatomy } from "./DemoBlockAnatomy";

const STEP_MS = 2_600;

const buttonClass =
  "inline-flex h-8 items-center gap-1.5 rounded border border-border-strong px-2.5 text-sm text-text hover:bg-surface-2";

/**
 * "Show me how it works": the queue's story told with made-up blocks, in its
 * own card marked as an example so it can never be mistaken for the live
 * queue. Plays on its own, pauses, steps forward and back; each step says in
 * words what the motion shows, so nothing depends on seeing it move.
 */
export function StateQueueDemo() {
  const [steps] = useState(() => demoSteps(Date.now()));
  const [step, setStep] = useState(0);
  // Each pass round the story is a fresh drawing: going from the last step
  // back to the first is a restart, not a rollback, so nothing animates.
  const [pass, setPass] = useState(0);
  const [playing, setPlaying] = useState(true);

  const advance = useCallback(() => {
    if (step === steps.length - 1) {
      setStep(0);
      setPass((p) => p + 1);
    } else {
      setStep(step + 1);
    }
  }, [step, steps.length]);

  // Restarts only when the step or play state changes. The live card around
  // it re-renders on every poll, which must not stretch a step.
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(advance, STEP_MS);
    return () => clearTimeout(id);
  }, [playing, advance]);

  const current = steps[step]!;
  return (
    <Card className="mb-4" region="state-queue-demo">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-body font-semibold text-text">How the queue works</h2>
          <Chip on="surface" emphasis="strong">
            Example
          </Chip>
        </div>
        <div className="flex items-center gap-2">
          <span className="mg-caption tabular-nums text-text-3">
            {step + 1} of {steps.length}
          </span>
          <button
            type="button"
            className={buttonClass}
            disabled={step === 0}
            onClick={() => {
              // Back redraws the earlier step without motion, so Step can play
              // a merge again; it never plays one in reverse.
              setPlaying(false);
              setStep(Math.max(0, step - 1));
              setPass((p) => p + 1);
            }}
          >
            Back
          </button>
          <button type="button" className={buttonClass} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setPlaying(false);
              advance();
            }}
          >
            Step
          </button>
        </div>
      </div>
      <div className="px-4 py-4">
        <p aria-live="polite" className="mb-3 text-sm text-text">
          {current.caption}
        </p>
        <QueueTrack key={pass} data={current.queue} demo label="Example queue, made-up blocks" />
        <DemoBlockAnatomy queue={current.queue} step={step} />
      </div>
    </Card>
  );
}

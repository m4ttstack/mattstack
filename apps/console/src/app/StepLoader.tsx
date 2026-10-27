import { useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from '@mattstack/app-kit/hooks';

import classes from './StepLoader.module.css';

const TYPE_MS = 16;
/** How long a typed step stays the current one before the next appends. */
const STEP_HOLD_MS = 260;
/** A load shorter than this shows only the cursor, never a step. */
const STEPS_AFTER_MS = 300;
/** Once the load ends, the line being typed finishes and stays this long. */
const READ_MS = 700;

/** The steps for loads that run side by side: the ones done, ticked, then
    the first still running. */
export function loadSteps(
  loads: readonly { step: string; done: boolean }[]
): string[] {
  const pending = loads.find(load => !load.done);
  return [
    ...loads.filter(load => load.done).map(load => load.step),
    ...(pending ? [pending.step] : []),
  ];
}

export type StepLoading = {
  /** Whether the loader is on screen; the content waits while it is. */
  show: boolean;
  /** Spread onto the StepLoader, so it can finish its line and let go. */
  bind: { loading: boolean; onFinished: () => void };
};

/** Drives a StepLoader for `loading`. A load that ends before
    STEPS_AFTER_MS lets go at once, having shown only the cursor; a longer
    one stays until the loader has finished its line and READ_MS on top. */
export function useStepLoading(loading: boolean): StepLoading {
  const [stepsShown, setStepsShown] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setStepsShown(true), STEPS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  const onFinished = useCallback(() => setStepsShown(false), []);
  return {
    show: loading || stepsShown,
    bind: { loading, onFinished },
  };
}

/** The steps a load has reached, as a log: the newest types out while a
    block cursor flashes on the line under it, and each earlier one is ticked.
    For its first STEPS_AFTER_MS it is the cursor alone. Name only steps
    that are really happening; steps that arrive faster than they type wait
    their turn. Driven by useStepLoading's `bind`. */
export function StepLoader({
  steps,
  placement = 'start',
  testId,
  loading = true,
  onFinished,
}: {
  steps: readonly string[];
  /** `start` sits where the content will land; `centre` fills its frame. */
  placement?: 'start' | 'centre';
  testId?: string;
  loading?: boolean;
  /** Called once the load has ended and the last line has been read. */
  onFinished?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [started, setStarted] = useState(false);
  const [at, setAt] = useState({ index: 0, count: 0 });
  const index = Math.min(at.index, Math.max(0, steps.length - 1));
  const current = steps[index] ?? '';
  const count = reduceMotion ? current.length : at.count;
  const typed = count >= current.length;

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), STEPS_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!started) return;
    if (!typed) {
      const timer = setTimeout(
        () => setAt({ index, count: count + 1 }),
        TYPE_MS
      );
      return () => clearTimeout(timer);
    }
    if (!loading) {
      const timer = setTimeout(() => onFinished?.(), READ_MS);
      return () => clearTimeout(timer);
    }
    if (index < steps.length - 1) {
      const timer = setTimeout(
        () => setAt({ index: index + 1, count: 0 }),
        STEP_HOLD_MS
      );
      return () => clearTimeout(timer);
    }
  }, [started, typed, loading, onFinished, count, index, steps.length]);

  const settled = !loading && typed;
  return (
    <div
      className={classes.frame}
      data-placement={placement}
      role="status"
      aria-label={steps.at(-1)}
      data-testid={testId}
    >
      <div className={classes.log} aria-hidden>
        {(started ? steps.slice(0, index + 1) : []).map((step, i) => (
          <div
            key={`${i}:${step}`}
            className={classes.line}
            data-state={i === index && !settled ? 'now' : 'done'}
          >
            {i === index ? step.slice(0, count) : step}
          </div>
        ))}
        <div className={classes.line}>
          <span className={classes.cursor} />
        </div>
      </div>
    </div>
  );
}

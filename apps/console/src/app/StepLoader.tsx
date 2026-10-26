import { useEffect, useState } from 'react';
import { useReducedMotion } from '@mattstack/app-kit/hooks';

import classes from './StepLoader.module.css';

const TYPE_MS = 22;
/** How long a typed step stays the current one before the next appends. */
const STEP_HOLD_MS = 260;
/** A load shorter than this shows only the cursor, never a step. */
const STEPS_AFTER_MS = 300;
/** Once steps show, the log stays at least this long, so it never flashes. */
const MIN_STEPS_MS = 600;

/** Whether to show the loader for `loading`. A load that ends before
    STEPS_AFTER_MS lets go at once, having shown only the cursor; a longer
    one holds the loader MIN_STEPS_MS from when its steps began. */
export function useHeldLoading(loading: boolean): boolean {
  const [stepsAt, setStepsAt] = useState<number | null>(null);
  useEffect(() => {
    if (loading && stepsAt === null) {
      const timer = setTimeout(() => setStepsAt(Date.now()), STEPS_AFTER_MS);
      return () => clearTimeout(timer);
    }
    if (!loading && stepsAt !== null) {
      const left = MIN_STEPS_MS - (Date.now() - stepsAt);
      const timer = setTimeout(() => setStepsAt(null), Math.max(0, left));
      return () => clearTimeout(timer);
    }
  }, [loading, stepsAt]);
  return loading || stepsAt !== null;
}

/** The steps a load has reached, as a log: the newest types out while a
    block cursor flashes on the line under it, and each earlier one is ticked.
    For its first STEPS_AFTER_MS it is the cursor alone. Name only steps
    that are really happening; steps that arrive faster than they type wait
    their turn. Pair it with useHeldLoading. */
export function StepLoader({
  steps,
  placement = 'start',
  testId,
}: {
  steps: readonly string[];
  /** `start` sits where the content will land; `centre` fills its frame. */
  placement?: 'start' | 'centre';
  testId?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [started, setStarted] = useState(false);
  const [at, setAt] = useState({ index: 0, count: 0 });
  const index = Math.min(at.index, Math.max(0, steps.length - 1));
  const current = steps[index] ?? '';
  const count = reduceMotion ? current.length : at.count;

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), STEPS_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!started) return;
    if (count < current.length) {
      const timer = setTimeout(
        () => setAt({ index, count: count + 1 }),
        TYPE_MS
      );
      return () => clearTimeout(timer);
    }
    if (index < steps.length - 1) {
      const timer = setTimeout(
        () => setAt({ index: index + 1, count: 0 }),
        STEP_HOLD_MS
      );
      return () => clearTimeout(timer);
    }
  }, [started, count, current, index, steps.length]);

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
            data-state={i === index ? 'now' : 'done'}
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

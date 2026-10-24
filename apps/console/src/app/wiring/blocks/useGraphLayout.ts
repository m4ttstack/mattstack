import { useCallback, useEffect, useState } from 'react';

import { forgetLayoutEngine, loadLayoutEngine } from './layoutEngine';
import type { LaidOut, LayoutEngine, LayoutInput } from './model/elkGraph';

/** A worker that never loads leaves its layout pending for good, so a
    layout this slow counts as failed. */
export const LAYOUT_TIMEOUT_MS = 10_000;

type Settled = {
  input: LayoutInput;
  attempt: number;
  laidOut: LaidOut | null;
};

export function useGraphLayout(
  input: LayoutInput | null,
  engine: () => Promise<LayoutEngine> = loadLayoutEngine
): {
  state: 'loading' | 'ready' | 'error';
  laidOut: LaidOut | null;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!input) return;
    let live = true;
    const settle = (laidOut: LaidOut | null) => {
      if (!live) return;
      live = false;
      clearTimeout(timer);
      if (!laidOut) forgetLayoutEngine();
      setSettled({ input, attempt, laidOut });
    };
    const timer = setTimeout(() => settle(null), LAYOUT_TIMEOUT_MS);
    engine()
      .then(loaded => loaded.layout(input))
      .then(settle, () => settle(null));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [input, engine, attempt]);

  const retry = useCallback(() => setAttempt(count => count + 1), []);
  const current =
    settled && settled.input === input && settled.attempt === attempt
      ? settled
      : null;
  if (!current) return { state: 'loading', laidOut: null, retry };
  return current.laidOut
    ? { state: 'ready', laidOut: current.laidOut, retry }
    : { state: 'error', laidOut: null, retry };
}

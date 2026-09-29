import { useEffect, useRef, useState } from 'react';

export interface RefreshClock {
  /** Since the refresh started. */
  elapsedMs: number;
  /** Since `key` last changed. */
  idleMs: number;
}

/** Ticks once a second while `active`, timing the run and how long its reading has held. */
export function useRefreshClock(active: boolean, key: string): RefreshClock {
  const startedAt = useRef(0);
  const changedAt = useRef(0);
  const [clock, setClock] = useState<RefreshClock>({ elapsedMs: 0, idleMs: 0 });

  useEffect(() => {
    changedAt.current = Date.now();
    setClock(c => ({ ...c, idleMs: 0 }));
  }, [key]);

  useEffect(() => {
    if (!active) return;
    startedAt.current = Date.now();
    changedAt.current = Date.now();
    setClock({ elapsedMs: 0, idleMs: 0 });
    const timer = setInterval(() => {
      const now = Date.now();
      setClock({
        elapsedMs: now - startedAt.current,
        idleMs: now - changedAt.current,
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [active]);

  return clock;
}

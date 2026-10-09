import type { RunSummary } from '@mattstack/rt-client';

import { isLive, isStale } from '../runs/derive/lanes';

export interface PaletteStatus {
  label: string;
  color: 'bad' | 'accent' | 'ok' | 'gray';
}

/** A palette row's pill: a gate waiting on you first, then where the run
    stands. */
export function paletteStatus(
  run: RunSummary,
  waitingOnYou: ReadonlySet<string>
): PaletteStatus {
  if (waitingOnYou.has(run.id))
    return { label: 'waiting on you', color: 'bad' };
  if (isStale(run)) return { label: 'stale', color: 'gray' };
  if (isLive(run)) return { label: 'running', color: 'accent' };
  if (run.status === 'done') return { label: 'done', color: 'ok' };
  if (run.status === 'failed') return { label: 'failed', color: 'bad' };
  return { label: run.status, color: 'gray' };
}

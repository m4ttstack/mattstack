import type { OutputCard } from './templateModel';

export type StatusTone = 'ok' | 'warn' | 'quiet';

/** The one tone every dot, pill and card draws a skill's status in. `quiet`
    is check saying nothing, which is neither in sync nor drifted. */
export const STATUS_TONE: Record<OutputCard['status'], StatusTone> = {
  'in-sync': 'ok',
  stale: 'warn',
  unsynced: 'warn',
  'never-compiled': 'warn',
  unknown: 'quiet',
};

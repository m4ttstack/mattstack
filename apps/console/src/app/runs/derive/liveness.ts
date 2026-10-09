import type { GateRow, RunSummary } from '@mattstack/rt-client';

import { livenessSpec } from '../LivenessChip';
import { formatDuration } from './duration';

export type HeroTone = 'ok' | 'warn' | 'bad' | 'accent' | 'gray';

export interface HeroLiveness {
  tone: HeroTone;
  label: string;
}

/** What the run page's header chip says: a gate waiting on you or in the
    board comes first, with how long it has waited; otherwise the same ladder
    the runs list reads, in the header's words. */
export function heroLiveness(
  run: RunSummary,
  waiting: { handoff: GateRow | null; mine: GateRow | null },
  now: number
): HeroLiveness {
  const age = (g: GateRow) => formatDuration(now - g.openedAt);
  if (waiting.mine)
    return { tone: 'bad', label: `waiting on you · ${age(waiting.mine)}` };
  if (waiting.handoff)
    return {
      tone: 'warn',
      label: `waiting in the board · ${age(waiting.handoff)}`,
    };
  const spec = livenessSpec(run);
  switch (spec.state) {
    case 'blocked':
      return { tone: 'bad', label: 'waiting on you' };
    case 'failed':
    case 'stale':
      return { tone: 'bad', label: spec.label };
    case 'stranded':
      return { tone: 'warn', label: 'stranded' };
    case 'driven':
      return { tone: 'ok', label: 'agent working' };
    case 'idle':
      return { tone: 'warn', label: 'agent idle' };
    case 'running':
      return { tone: 'accent', label: 'running' };
    case 'done':
      return { tone: 'ok', label: 'done' };
    case 'finished-other':
      return { tone: 'gray', label: run.status };
  }
}

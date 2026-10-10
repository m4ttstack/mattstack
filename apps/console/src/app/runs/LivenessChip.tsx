import type { MantineColor } from '@mattstack/app-kit/core';
import type { RunSummary } from '@mattstack/rt-client';

export type LivenessState =
  | 'blocked'
  | 'failed'
  | 'stale'
  | 'stranded'
  | 'driven'
  | 'idle'
  | 'running'
  | 'done'
  | 'finished-other';

export interface LivenessSpec {
  state: LivenessState;
  color: MantineColor;
  label: string;
}

/**
 * Precedence is a ladder, not independent conditions: `attention.reason`
 * (rt's own predicate) outranks agent status, which outranks the run's own
 * status. Each rung fires on the first match, so a blocked run never falls
 * through to its agent's status even when they'd disagree.
 */
export function livenessSpec(run: RunSummary): LivenessSpec {
  const { attention, agent } = run;

  if (attention.reason === 'blocked') {
    return {
      state: 'blocked',
      color: 'bad',
      label: agent?.pane ? `waiting on you · ${agent.pane}` : 'waiting on you',
    };
  }
  if (attention.reason === 'failed') {
    return { state: 'failed', color: 'bad', label: 'failed' };
  }
  if (attention.reason === 'stale') {
    // Evidence enumerates every rung the liveness ladder checked; a chip
    // only has room for the first.
    const [firstClause] = attention.evidence.split(',');
    return { state: 'stale', color: 'bad', label: `stale · ${firstClause}` };
  }
  if (attention.reason === 'stranded') {
    return { state: 'stranded', color: 'warn', label: 'stranded' };
  }
  if (agent?.status === 'working') {
    return {
      state: 'driven',
      color: 'ok',
      label: '● driven · agent working',
    };
  }
  if (agent?.status === 'idle') {
    return { state: 'idle', color: 'warn', label: '◌ idle' };
  }
  if (run.ended_at == null) {
    return { state: 'running', color: 'accent', label: 'running' };
  }
  // `status` is a free string past this point (done/abandoned/whatever a
  // future pipeline terminal state adds) -- the label carries the specifics
  // while `data-state` stays a closed set consumers can switch on.
  if (run.status === 'done') {
    return { state: 'done', color: 'ok', label: 'done' };
  }
  return { state: 'finished-other', color: 'warn', label: run.status };
}

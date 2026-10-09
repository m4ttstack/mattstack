import type { RunStageRow } from '@mattstack/rt-client';

export interface StageAttempt {
  stage: string;
  attempt: number;
  status: 'running' | 'done' | 'failed' | 'redirected';
  startedAt: number | null;
  endedAt: number | null;
}

const STATUSES = new Set(['running', 'done', 'failed', 'redirected']);

function normalizeStatus(status: string): StageAttempt['status'] {
  return STATUSES.has(status) ? (status as StageAttempt['status']) : 'done';
}

export function stageAttempts(
  stages: RunStageRow[],
  run: { status: string; ended_at: number | null },
  now: number
): StageAttempt[] {
  const finished = run.status !== 'running';
  const ordered = [...stages].sort(
    (a, b) =>
      (a.started_at ?? Infinity) - (b.started_at ?? Infinity) ||
      a.attempt - b.attempt
  );
  return ordered.map((s, i) => {
    const status = normalizeStatus(s.status);
    let endedAt = s.ended_at;
    if (endedAt == null) {
      if (status === 'running') {
        if (finished) endedAt = run.ended_at ?? now;
      } else {
        endedAt = ordered[i + 1]?.started_at ?? null;
      }
    }
    return {
      stage: s.name,
      attempt: s.attempt,
      status,
      startedAt: s.started_at,
      endedAt,
    };
  });
}

export function railStages(
  pipelineStages: string | null,
  attempts: StageAttempt[],
  held: { stage: string; to: number | null }[],
  waitingStage: string | null,
  now: number
) {
  const names = new Set(pipelineStages?.split(/\s+/).filter(Boolean) ?? []);
  for (const a of attempts) names.add(a.stage);
  const endOf = (a: StageAttempt) =>
    a.endedAt ?? (a.status === 'running' ? now : null);
  return [...names].map(name => {
    const own = attempts.filter(a => a.stage === name);
    const last = own.at(-1);
    const settled = own.every(a => a.startedAt != null && endOf(a) != null);
    const durationMs =
      own.length > 0 && settled
        ? own.reduce((sum, a) => sum + (endOf(a)! - a.startedAt!), 0)
        : null;
    let status:
      | 'done'
      | 'running'
      | 'failed'
      | 'redirected'
      | 'held'
      | 'waiting'
      | 'not-started';
    if (waitingStage === name) status = 'waiting';
    else if (held.some(h => h.stage === name && h.to == null)) status = 'held';
    else status = last ? last.status : 'not-started';
    return { name, status, durationMs, attempts: own.length };
  });
}

export type RailStage = ReturnType<typeof railStages>[number];

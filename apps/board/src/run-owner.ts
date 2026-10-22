import type { RunSummary } from '@mattstack/rt-client';

import { normalizeMrUrl } from './gates/run-mr';

export interface RunOwner {
  runId: string;
  session: string;
  stage: string | null;
  name?: string;
}

export type SessionProbe = (session: string) => Promise<{ reachable: boolean; name?: string }>;

/** Query by MR url (own-MR match) and/or by repo slug + branch (pre-ship match). */
export interface OwnerQuery {
  mrUrl?: string;
  repoSlug: string;
  branch: string;
}

const NON_OWNING_WORK_TYPES = new Set(['review', 'receive-review']);

/** The run-field cleared marker. */
const NO_SESSION = '-';

/** Matching work runs, most recently active first. Pure: no liveness. */
export function ownerCandidates(q: OwnerQuery, runs: readonly RunSummary[]): RunOwner[] {
  const wanted = q.mrUrl ? normalizeMrUrl(q.mrUrl) : null;
  return runs
    .filter((run) => {
      if (run.status !== 'running') return false;
      if (!run.session || run.session === NO_SESSION) return false;
      if (NON_OWNING_WORK_TYPES.has(run.work_type)) return false;
      if (run.mr) return wanted !== null && normalizeMrUrl(run.mr) === wanted;
      return run.repo === q.repoSlug && run.branch === q.branch;
    })
    .sort((a, b) => b.last_event_at - a.last_event_at)
    .map((run) => ({
      runId: run.id,
      session: run.session as string,
      stage: run.current_stage,
    }));
}

/** First candidate whose session probes reachable, with the probe's name, or null. */
export async function firstLiveOwner(
  candidates: readonly RunOwner[],
  probe: SessionProbe,
): Promise<RunOwner | null> {
  for (const candidate of candidates) {
    const result = await probe(candidate.session);
    if (result.reachable) {
      return result.name === undefined ? candidate : { ...candidate, name: result.name };
    }
  }
  return null;
}

export type RingFrame =
  | { kind: 'pipeline-red'; iid: number; pipelineId: number | null }
  | { kind: 'needs-rebase'; iid: number; targetBranch: string }
  | {
      kind: 'downstream';
      childIid: number;
      childEdge: 'pipeline-red' | 'needs-rebase';
      pipelineId: number | null;
    };

/** The daemon wraps ring text with this label. */
export const BOARD_RING_LABEL = 'board';

function pipelineRef(id: number | null): string {
  return id === null ? '' : ` (pipeline ${id})`;
}

export function ringText(f: RingFrame): string {
  switch (f.kind) {
    case 'pipeline-red':
      return [
        `CI failed on !${f.iid}${pipelineRef(f.pipelineId)}.`,
        "You're the active work run on this branch, so no doctor was launched.",
        'Fold the fix into your current stage.',
      ].join('\n');
    case 'needs-rebase':
      return [
        `!${f.iid} needs a rebase onto ${f.targetBranch}.`,
        "You're the active work run on this branch, so no doctor was launched.",
        'Rebase before your current stage ends.',
      ].join('\n');
    case 'downstream':
      return f.childEdge === 'pipeline-red'
        ? [
            `!${f.childIid} (stacked on your branch) has failing CI${pipelineRef(f.pipelineId)}.`,
            'No doctor was launched while your run is active. Check whether your change caused it.',
          ].join('\n')
        : [
            `!${f.childIid} (stacked on your branch) needs a rebase.`,
            'No doctor was launched while your run is active; one will rebase it after your run ends.',
          ].join('\n');
  }
}

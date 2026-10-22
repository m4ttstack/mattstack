import type { RunSummary } from '@mattstack/rt-client';
import { normalizeMrUrl } from './gates/run-mr';
import type { OwnMrFacts } from './triage/edge';
import type { Handoff, HandoffKind } from './triage/memory';
import { chainOf } from './triage/stack';

export interface RunOwner {
  runId: string;
  session: string;
  stage: string | null;
  name?: string;
}

export type SessionProbe = (
  session: string
) => Promise<{ reachable: boolean; name?: string }>;

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
export function ownerCandidates(
  q: OwnerQuery,
  runs: readonly RunSummary[]
): RunOwner[] {
  const wanted = q.mrUrl ? normalizeMrUrl(q.mrUrl) : null;
  return runs
    .filter(run => {
      if (run.status !== 'running') return false;
      if (!run.session || run.session === NO_SESSION) return false;
      if (NON_OWNING_WORK_TYPES.has(run.work_type)) return false;
      if (run.mr) return wanted !== null && normalizeMrUrl(run.mr) === wanted;
      return run.repo === q.repoSlug && run.branch === q.branch;
    })
    .sort((a, b) => b.last_event_at - a.last_event_at)
    .map(run => ({
      runId: run.id,
      session: run.session as string,
      stage: run.current_stage,
    }));
}

/** First candidate whose session probes reachable, with the probe's name, or null. */
export async function firstLiveOwner(
  candidates: readonly RunOwner[],
  probe: SessionProbe
): Promise<RunOwner | null> {
  for (const candidate of candidates) {
    const result = await probe(candidate.session);
    if (result.reachable) {
      return result.name === undefined
        ? candidate
        : { ...candidate, name: result.name };
    }
  }
  return null;
}

/** One place an MR's owner may sit. `own` is the MR's own branch; the rest
    are ancestors, and a `viaMr` of null is a parent known only by branch. */
export interface OwnerStep {
  query: OwnerQuery;
  own: boolean;
  viaMr: string | null;
  viaIid?: number;
}

/** The MR's own branch, then each ancestor's (nearest first), then a parent
    branch outside the board's window. Empty when the MR is not in `mrs`. */
export function ownerSteps(
  mrs: OwnMrFacts[],
  mrUrl: string,
  repoSlugForMr: (mrUrl: string) => string
): OwnerStep[] {
  const self = mrs.find(m => m.mrUrl === mrUrl);
  if (!self) return [];
  const steps: OwnerStep[] = [
    {
      query: {
        mrUrl,
        repoSlug: repoSlugForMr(mrUrl),
        branch: self.sourceBranch,
      },
      own: true,
      viaMr: mrUrl,
    },
  ];
  const { ancestors, unresolvedParentBranch } = chainOf(mrs, mrUrl);
  for (const anc of ancestors) {
    steps.push({
      query: {
        mrUrl: anc.mrUrl,
        repoSlug: repoSlugForMr(anc.mrUrl),
        branch: anc.sourceBranch,
      },
      own: false,
      viaMr: anc.mrUrl,
      viaIid: anc.iid,
    });
  }
  if (unresolvedParentBranch !== null) {
    steps.push({
      query: { repoSlug: repoSlugForMr(mrUrl), branch: unresolvedParentBranch },
      own: false,
      viaMr: null,
    });
  }
  return steps;
}

/** The first step with a live owner, walking `steps` in order. */
export async function firstOwnerAlong(
  steps: readonly OwnerStep[],
  runs: readonly RunSummary[],
  probe: SessionProbe
): Promise<{ owner: RunOwner; step: OwnerStep } | null> {
  for (const step of steps) {
    const owner = await firstLiveOwner(
      ownerCandidates(step.query, runs),
      probe
    );
    if (owner) return { owner, step };
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

/** The frame for one edge kind: the MR's own frame when the owner is on its
    branch, else a downstream frame naming the child. */
export function frameFor(
  step: OwnerStep,
  kind: HandoffKind,
  mr: { iid: number; targetBranch: string; pipelineId: number | null }
): RingFrame {
  if (!step.own) {
    return {
      kind: 'downstream',
      childIid: mr.iid,
      childEdge: kind,
      pipelineId: mr.pipelineId,
    };
  }
  return kind === 'pipeline-red'
    ? { kind, iid: mr.iid, pipelineId: mr.pipelineId }
    : { kind, iid: mr.iid, targetBranch: mr.targetBranch };
}

export function handoffFrom(
  owner: RunOwner,
  step: OwnerStep,
  pipelineId: number | null,
  at: number
): Handoff {
  return {
    runId: owner.runId,
    session: owner.session,
    stage: owner.stage,
    pipelineId,
    viaMr: step.viaMr,
    viaBranch: step.query.branch,
    at,
  };
}

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

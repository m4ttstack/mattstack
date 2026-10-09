import type {
  BranchEnrichment,
  GateRow,
  RunFieldRow,
  RunStageRow,
  RunSummary,
} from '@mattstack/rt-client';

import { isMine, isWaiting } from '../../../shared/gate-waiting';
import { waitingHandoff } from '../../../shared/handoff';
import { mrRef } from '../mrRef';
import { repoPath } from '../repoLabel';
import { countCommits, headSha } from './answers';
import { formatClock } from './clock';
import { formatDuration } from './duration';
import { shortPath } from './fields';
import { gateStage } from './gates';
import type { RunKind } from './kind';

const CI_LABEL: Record<string, string> = {
  success: 'CI passed',
  passed: 'CI passed',
  failed: 'CI failed',
  running: 'CI running',
  pending: 'CI pending',
  canceled: 'CI canceled',
};

/** A pipeline status as the side card says it: "CI passed". */
export function ciLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return CI_LABEL[status] ?? `CI ${status.replace(/_/g, ' ')}`;
}

/** How many of the run's gates were placed at each stage. */
export function gateCountsByStage(
  gates: GateRow[],
  stages: RunStageRow[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of gates) {
    const stage = gateStage(g, stages);
    if (stage) counts[stage] = (counts[stage] ?? 0) + 1;
  }
  return counts;
}

/** The run's own gates a person can answer now, oldest first; none once the
    run has ended. */
export function answerableGates(
  gates: GateRow[],
  runId: string,
  live: boolean
): GateRow[] {
  if (!live) return [];
  return gates
    .filter(g => g.subject === `run:${runId}` && isWaiting(g))
    .sort((a, b) => a.openedAt - b.openedAt);
}

/** The ticket's url: enrichment's, else built from the Linear workspace. */
export function ticketUrl(
  ticket: string | null,
  enrichmentUrl: string | null | undefined,
  workspace: string | null
): string | null {
  if (!ticket) return null;
  if (enrichmentUrl) return enrichmentUrl;
  return workspace ? `https://linear.app/${workspace}/issue/${ticket}` : null;
}

/** The Branch fact's second line: the MR author's branch on a review or
    respond run, else the commit count and head sha. */
export function branchSub(handedOff: boolean, commits: string | null): string {
  if (handedOff) return "author's branch";
  const count = countCommits(commits);
  if (count === 0) return 'no commits yet';
  const sha = headSha(commits);
  return `${count} ${count === 1 ? 'commit' : 'commits'}${sha ? ` @ ${sha}` : ''}`;
}

export interface MrFact {
  label: string;
  value: string | null;
  url: string | null;
  sub: string | null;
}

/** The MR fact: the run's own MR (or that it opens at ship), or on a review
    or respond run the MR it reviewed. */
export function mrFact(
  handedOff: boolean,
  run: Pick<RunSummary, 'outcome'>,
  enrichmentMr: BranchEnrichment['mr'] | undefined,
  mrField: string | null
): MrFact {
  const reviewed = run.outcome?.reviewed ?? null;
  const mr = mrRef(enrichmentMr, mrField);
  let value: string | null;
  if (handedOff) {
    value = reviewed
      ? `!${reviewed.iid}`
      : mr?.iid
        ? `!${mr.iid}`
        : (mr?.text ?? null);
  } else {
    value = mr
      ? (mr.text ??
        `${mr.iid ? `!${mr.iid}` : 'MR'}${mr.state ? ` ${mr.state}` : ''}`)
      : null;
  }
  return {
    label: handedOff ? 'Reviewed MR' : 'MR · CI',
    value,
    url: reviewed?.url ?? mr?.webUrl ?? null,
    sub:
      ciLabel(mr?.ciStatus ?? run.outcome?.ci) ??
      (value || handedOff ? null : 'opens at ship'),
  };
}

export interface RunPageInput {
  repo: string;
  runId: string;
  run: RunSummary;
  stages: RunStageRow[];
  fields: RunFieldRow[];
  gates: GateRow[];
  kind: RunKind;
  enrichment: BranchEnrichment | undefined;
  workspace: string | null;
  now: number;
}

/** Everything the run page shows about the run that is not its story: what
    waits in the slot, the hero's ticket line, the side card facts and the
    values the hotkeys copy. */
export function runPageFacts(input: RunPageInput) {
  const { repo, runId, run, stages, fields, gates, kind, enrichment } = input;
  const field = (key: string) => fields.find(f => f.key === key)?.value ?? null;
  const live = run.status === 'running';
  const handedOff = kind === 'review' || kind === 'respond';
  const answerable = answerableGates(gates, runId, live);
  const ticket = run.ticket ?? field('ticket');
  const reviewed = run.outcome?.reviewed ?? null;
  const mr = mrFact(handedOff, run, enrichment?.mr, field('mr'));
  const branch = field('branch') ?? run.branch;
  const worktree = field('worktree');
  const commits = field('commits');
  const url = ticketUrl(ticket, enrichment?.ticket?.url, input.workspace);

  return {
    live,
    handedOff,
    answerable,
    mine: answerable.find(isMine) ?? null,
    handoff: live && handedOff ? waitingHandoff(gates) : null,
    gateCounts: gateCountsByStage(gates, stages),
    hero: {
      ticket: ticket ?? (reviewed ? `!${reviewed.iid}` : null),
      ticketUrl: ticket ? url : (reviewed?.url ?? null),
      ticketHotkey: ticket !== null,
      meta: `${run.pipeline} pipeline · started ${formatClock(run.started_at)} · ${formatDuration((run.ended_at ?? input.now) - run.started_at)}`,
    },
    mr,
    branch: { value: branch, sub: branchSub(handedOff, commits) },
    worktree: {
      value: worktree ? shortPath(worktree) : null,
      path: worktree,
      sub: repoPath(repo),
    },
    copies: {
      ticket,
      branch,
      worktree,
      mr: mr.url ?? mr.value,
      commits,
    },
    canResume: live && !run.agent && Boolean(field('claude-session')),
  };
}

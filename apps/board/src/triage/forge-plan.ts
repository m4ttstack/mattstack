import type { BoardConfig } from '../config.ts';
import type { OwnMrFacts } from './edge.ts';

export interface TriageForgePlan {
  /** 'gitlab-token': resolve from the GitLab token as today.
      { recorded }: own PRs as this username. null: own nothing. */
  identity: 'gitlab-token' | { recorded: string } | null;
  /** The non-peer respond-ask (nudge) and re-review latch passes run. */
  asksAndLatch: boolean;
  /** Logged once per non-peer run, in order. */
  lines: string[];
}

export const GITHUB_ASKS_LATCH_SKIP =
  'triage: respond asks and the re-review latch skip GitHub teams for now';
export const GITHUB_NO_USERNAME =
  'triage: no forge username is recorded for this team, so auto-doctor owns no PRs';

export function triageForgePlan(
  config: Pick<BoardConfig, 'forge'>,
  recordedUsername: () => string | null
): TriageForgePlan {
  if (config.forge.kind !== 'github') {
    return { identity: 'gitlab-token', asksAndLatch: true, lines: [] };
  }
  const username = recordedUsername();
  return {
    identity: username ? { recorded: username } : null,
    asksAndLatch: false,
    lines: username
      ? [GITHUB_ASKS_LATCH_SKIP]
      : [GITHUB_ASKS_LATCH_SKIP, GITHUB_NO_USERNAME],
  };
}

export function unparsedRedLines(mrs: OwnMrFacts[]): string[] {
  return mrs
    .filter(mr => mr.pipelineState === 'failed' && mr.pipelineId === null)
    .map(
      mr =>
        `triage: ${mr.mrUrl} has no workflow run id (commit statuses only), auto-doctor skips it`
    );
}

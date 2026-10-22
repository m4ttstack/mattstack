import {
  inboxProbe,
  inboxRing,
  listRuns,
  type RunSummary,
} from '@mattstack/rt-client';
import { projectPathFromWebUrl, type BoardMR } from './data.ts';
import { boardRepoSlug } from './manifest-bindings.ts';
import { BOARD_RING_LABEL, type SessionProbe } from './run-owner.ts';
import type { OwnMrFacts } from './triage/edge.ts';
import { numericPipelineId } from './triage/run.ts';

export interface OwnerIo {
  /** null = the lookup failed. */
  listRuns(): Promise<RunSummary[] | null>;
  ring(session: string, text: string): Promise<boolean>;
  probe: SessionProbe;
  repoSlugForMr(mrUrl: string): string;
}

/** Run lookups, rings and probes over the rt daemon, as triage and the
    board server both use them. */
export function daemonOwnerIo(gitlabHost: string): OwnerIo {
  return {
    listRuns: async () => {
      try {
        const res = await listRuns();
        return res.ok ? (res.data?.runs ?? null) : null;
      } catch {
        return null;
      }
    },
    ring: async (session, text) => {
      const res = await inboxRing({ session, label: BOARD_RING_LABEL, text });
      return res.ok && res.data?.delivered === true;
    },
    probe: async session => {
      const res = await inboxProbe({ session });
      return {
        reachable: res.ok && res.data?.reachable === true,
        name: res.ok ? res.data?.name : undefined,
      };
    },
    repoSlugForMr: mrUrl =>
      boardRepoSlug(gitlabHost, projectPathFromWebUrl(mrUrl, gitlabHost) ?? ''),
  };
}

export function ownMrFacts(m: BoardMR & { webUrl: string }): OwnMrFacts {
  return {
    mrUrl: m.webUrl,
    iid: m.iid,
    pipelineId: m.pipeline ? numericPipelineId(m.pipeline.id) : null,
    pipelineState: m.pipelineState,
    needsRebase: m.blockers.needsRebase,
    hasConflicts: m.blockers.hasConflicts,
    author: m.author.username,
    sourceBranch: m.sourceBranch,
    targetBranch: m.targetBranch,
    isStacked: !!m.isStacked,
  };
}

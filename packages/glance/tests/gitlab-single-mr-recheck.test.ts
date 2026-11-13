/**
 * fetchSingleMR's REST read of the MR is the one that makes GitLab recheck
 * mergeability (the REST entity calls `check_mergeability(async: true)`; the
 * GraphQL `detailedMergeStatus` field only reads the stored state). Its
 * failure stays non-fatal, but it must be visible, or a merge-readiness poll
 * sits at `unchecked` with nothing saying why.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import type { ForgeLogger } from '../src/logger.ts';

function node() {
  const user = { id: 'gid://gitlab/User/1', username: 'ada', name: 'Ada', avatarUrl: null };
  return {
    id: 'gid://gitlab/MergeRequest/7',
    iid: '7',
    projectId: 42,
    title: 'Add feature',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    detailedMergeStatus: 'UNCHECKED',
    webUrl: 'https://gitlab.example/grp/proj/-/merge_requests/7',
    sourceBranch: 'feat',
    targetBranch: 'main',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
    diffHeadSha: 'abc',
    author: user,
    assignees: { nodes: [] },
    reviewers: { nodes: [] },
    approvedBy: { nodes: [] },
    headPipeline: null,
    mergeabilityChecks: [],
    targetProject: { repository: { rootRef: 'main' } },
  };
}

function provider(show: () => Promise<unknown>) {
  const warnings: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const logger: ForgeLogger = {
    debug() {},
    info() {},
    warn: (msg, meta) => warnings.push({ msg, meta }),
    error() {},
  };
  const p = new GitLabProvider('https://gitlab.example', 't', { logger });
  (p as any).runQuery = async () => ({ project: { mergeRequest: node() } });
  (p as any).gb.MergeRequests.show = show;
  return { p, warnings };
}

describe('fetchSingleMR REST read', () => {
  test('a failed REST read still returns the MR and logs a warning naming the recheck', async () => {
    const { p, warnings } = provider(async () => {
      throw new Error('GitLab rate limit hit on GET projects/grp%2Fproj/merge_requests/7; retry after 41 seconds');
    });
    const pr = await p.fetchSingleMR('grp/proj', 7, null);
    expect(pr?.detailedMergeStatus).toBe('unchecked');
    expect(pr?.divergedCommitsCount ?? null).toBeNull();
    expect(warnings).toEqual([
      {
        msg: 'fetchSingleMR: the REST read of the MR failed, so GitLab was not asked to recheck mergeability',
        meta: {
          projectPath: 'grp/proj',
          mrIid: 7,
          message: 'GitLab rate limit hit on GET projects/grp%2Fproj/merge_requests/7; retry after 41 seconds',
        },
      },
    ]);
  });

  test('a successful REST read logs nothing', async () => {
    const { p, warnings } = provider(async () => ({ diverged_commits_count: 2 }));
    const pr = await p.fetchSingleMR('grp/proj', 7, null);
    expect(pr?.divergedCommitsCount).toBe(2);
    expect(warnings).toEqual([]);
  });
});

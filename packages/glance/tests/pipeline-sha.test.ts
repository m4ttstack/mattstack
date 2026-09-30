#!/usr/bin/env bun
/**
 * Pipeline.sha, Pipeline.ref, Pipeline.mergeRequestEventType, plus the two
 * GitLab-only reads that feed the CI watch: fetchCommitParents (the source
 * sha behind a merged-results or merge-train head pipeline) and
 * fetchPipelineFailedJobs (failed jobs independent of the MR cache's
 * fragment weight).
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider, MR_DASHBOARD_FRAGMENT, MR_LIST_FRAGMENT } from '../src/GitLabProvider.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';

function gitlabNode(over: Record<string, unknown> = {}) {
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
    detailedMergeStatus: 'MERGEABLE',
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
    ...over,
  };
}

describe('GitLab head pipeline sha, ref and event type', () => {
  test('dashboard-weight head pipeline carries sha, ref and lowercased event type', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      project: {
        mergeRequests: {
          nodes: [
            gitlabNode({
              headPipeline: {
                id: 'gid://gitlab/Ci::Pipeline/9',
                status: 'RUNNING',
                createdAt: '2026-09-01T00:00:00Z',
                path: '/grp/proj/-/pipelines/9',
                sha: 'abc123',
                ref: 'refs/merge-requests/4/merge',
                mergeRequestEventType: 'MERGED_RESULT',
                stages: { nodes: [] },
              },
            }),
          ],
        },
      },
    });
    const [pr] = await p.fetchPullRequests({ projectPath: 'grp/proj', iids: [7] });
    expect(pr!.pipeline).toMatchObject({
      sha: 'abc123',
      ref: 'refs/merge-requests/4/merge',
      mergeRequestEventType: 'merged_result',
    });
  });

  test('list-weight head pipeline carries sha and ref too', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      project: {
        mergeRequests: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            gitlabNode({
              headPipeline: {
                id: 'gid://gitlab/Ci::Pipeline/11',
                status: 'SUCCESS',
                sha: 'def456',
                ref: 'feat',
                mergeRequestEventType: null,
              },
            }),
          ],
        },
      },
    });
    const [pr] = await p.fetchPullRequests({ projectPath: 'grp/proj', listWeight: true });
    expect(pr!.pipeline).toMatchObject({ sha: 'def456', ref: 'feat', mergeRequestEventType: null });
  });

  test('missing fields read as null', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      project: {
        mergeRequests: {
          nodes: [
            gitlabNode({
              headPipeline: {
                id: 'gid://gitlab/Ci::Pipeline/12',
                status: 'PENDING',
                createdAt: null,
                path: null,
                stages: { nodes: [] },
              },
            }),
          ],
        },
      },
    });
    const [pr] = await p.fetchPullRequests({ projectPath: 'grp/proj', iids: [7] });
    expect(pr!.pipeline).toMatchObject({ sha: null, ref: null, mergeRequestEventType: null });
  });

  test('both fragments request sha, ref and mergeRequestEventType', () => {
    for (const fragment of [MR_DASHBOARD_FRAGMENT, MR_LIST_FRAGMENT]) {
      expect(fragment).toContain('sha');
      expect(fragment).toContain('ref');
      expect(fragment).toContain('mergeRequestEventType');
    }
  });
});

describe('GitHub pipeline sha and ref', () => {
  test('pipeline sha is the checks head sha and ref is the PR head ref', async () => {
    const p = new GitHubProvider('https://github.com', 't');
    const user = { id: 3, login: 'ada', avatar_url: null, name: 'Ada' };
    const raw = {
      number: 7,
      id: 700,
      node_id: 'PR_700',
      title: 'Add feature',
      body: null,
      merged_at: null,
      html_url: 'https://github.com/o/r/pull/7',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-03T00:00:00Z',
      state: 'open',
      draft: false,
      head: { sha: 'def456', ref: 'feat', repo: { full_name: 'o/r' } },
      base: { ref: 'main', repo: { full_name: 'o/r', default_branch: 'main', id: 9 } },
      user,
      assignees: [],
      requested_reviewers: [],
    };
    const checkRuns = [
      {
        id: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-08-01T00:00:00Z',
        completed_at: '2026-08-01T00:05:00Z',
        html_url: 'https://github.com/o/r/runs/1',
        head_sha: 'def456',
      },
    ];
    const pr = (p as any).toPullRequest(raw, ['author'], [], checkRuns, null);
    expect(pr.pipeline).toMatchObject({ sha: 'def456', ref: 'feat', mergeRequestEventType: null });
  });

  test('no check runs still carries a null pipeline', async () => {
    const p = new GitHubProvider('https://github.com', 't');
    const user = { id: 3, login: 'ada', avatar_url: null, name: 'Ada' };
    const raw = {
      number: 7,
      id: 700,
      node_id: 'PR_700',
      title: 'Add feature',
      body: null,
      merged_at: null,
      html_url: 'https://github.com/o/r/pull/7',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-03T00:00:00Z',
      state: 'open',
      draft: false,
      head: { sha: 'def456', ref: 'feat', repo: { full_name: 'o/r' } },
      base: { ref: 'main', repo: { full_name: 'o/r', default_branch: 'main', id: 9 } },
      user,
      assignees: [],
      requested_reviewers: [],
    };
    const pr = (p as any).toPullRequest(raw, ['author'], [], [], null);
    expect(pr.pipeline).toBeNull();
  });
});

describe('GitLabProvider.fetchCommitParents', () => {
  test('returns parent_ids', async () => {
    const provider = new GitLabProvider('https://gitlab.example.com', 'tok');
    (provider as any).gb.Commits.show = async (projectPath: string, sha: string) => {
      expect(projectPath).toBe('grp/proj');
      expect(sha).toBe('abc123');
      return { id: sha, parent_ids: ['p1', 'p2'] };
    };
    const parents = await provider.fetchCommitParents('grp/proj', 'abc123');
    expect(parents).toEqual(['p1', 'p2']);
  });

  test('a commit with no parents (the repo root) reads as empty', async () => {
    const provider = new GitLabProvider('https://gitlab.example.com', 'tok');
    (provider as any).gb.Commits.show = async () => ({ id: 'root', parent_ids: [] });
    const parents = await provider.fetchCommitParents('grp/proj', 'root');
    expect(parents).toEqual([]);
  });
});

describe('GitLabProvider.fetchPipelineFailedJobs', () => {
  test('maps failed jobs', async () => {
    const provider = new GitLabProvider('https://gitlab.example.com', 'tok');
    (provider as any).gb.Jobs.all = async (projectPath: string, options: any) => {
      expect(projectPath).toBe('grp/proj');
      expect(options.pipelineId).toBe(9);
      expect(options.scope).toEqual(['failed']);
      return [
        { id: 5, name: 'unit', stage: 'test', status: 'failed', allow_failure: false, duration: 3, web_url: 'u' },
      ];
    };
    (provider as any).gb.Jobs.allPipelineBridges = async () => [];
    const jobs = await provider.fetchPipelineFailedJobs('grp/proj', 9);
    expect(jobs).toEqual([
      { id: 'gitlab:job:5', name: 'unit', stage: 'test', status: 'failed', allowFailure: false, duration: 3, webUrl: 'u' },
    ]);
  });

  test('includes failed jobs from bridge downstream pipelines, nested children included', async () => {
    const provider = new GitLabProvider('https://gitlab.example.com', 'tok');
    const failedByPipeline: Record<number, any[]> = {
      9: [],
      20: [{ id: 21, name: 'integration', stage: 'test', status: 'failed', allow_failure: false, duration: 5, web_url: 'c' }],
      30: [{ id: 31, name: 'e2e', stage: 'test', status: 'failed', allow_failure: true, duration: 7, web_url: 'g' }],
    };
    const bridgesByPipeline: Record<number, any[]> = {
      9: [{ id: 12, pipeline: { project_id: 42 }, downstream_pipeline: { id: 20, project_id: 42 } }],
      20: [{ id: 22, pipeline: { project_id: 42 }, downstream_pipeline: { id: 30, project_id: 42 } }],
      30: [{ id: 32, pipeline: { project_id: 42 }, downstream_pipeline: null }],
    };
    (provider as any).gb.Jobs.all = async (_p: string, options: any) => failedByPipeline[options.pipelineId] ?? [];
    (provider as any).gb.Jobs.allPipelineBridges = async (_p: string, pipelineId: number) => bridgesByPipeline[pipelineId] ?? [];
    const jobs = await provider.fetchPipelineFailedJobs('grp/proj', 9);
    expect(jobs.map((j) => j.id)).toEqual(['gitlab:job:21', 'gitlab:job:31']);
    expect(jobs[1]!.allowFailure).toBe(true);
  });

  test('skips a downstream pipeline in another project', async () => {
    const provider = new GitLabProvider('https://gitlab.example.com', 'tok');
    const listed: number[] = [];
    (provider as any).gb.Jobs.all = async (_p: string, options: any) => { listed.push(options.pipelineId); return []; };
    (provider as any).gb.Jobs.allPipelineBridges = async () => [
      { id: 12, pipeline: { project_id: 42 }, downstream_pipeline: { id: 50, project_id: 77 } },
    ];
    await provider.fetchPipelineFailedJobs('grp/proj', 9);
    expect(listed).toEqual([9]);
  });
});

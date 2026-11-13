#!/usr/bin/env bun
/**
 * gitlab.com refuses any query scored over 250. Inside a
 * `mergeRequests(iids: ...)` connection the full dashboard fragment scored
 * 739 there, while the same fragment under `project.mergeRequest(iid:)`
 * (fetchSingleMR) and under the authorUsername, role and project
 * connections passed the live conformance run. So the by-iid read sends the
 * single-MR document once per distinct iid, and the fragment's page sizes
 * stay pinned at the values that passed.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider, MR_DASHBOARD_FRAGMENT } from '../src/GitLabProvider.ts';

interface SentQuery {
  op: string;
  query: string;
  vars: Record<string, unknown>;
}

function gitlabNode(iid: number, over: Record<string, unknown> = {}) {
  const user = { id: 'gid://gitlab/User/1', username: 'ada', name: 'Ada', avatarUrl: null };
  return {
    id: `gid://gitlab/MergeRequest/${iid}`,
    iid: String(iid),
    projectId: 42,
    title: `MR ${iid}`,
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    detailedMergeStatus: 'MERGEABLE',
    webUrl: `https://gitlab.example/g/p/-/merge_requests/${iid}`,
    sourceBranch: `feat-${iid}`,
    targetBranch: 'main',
    createdAt: `2026-08-0${iid}T00:00:00Z`,
    updatedAt: '2026-08-09T00:00:00Z',
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

function recordingProvider(byIid: Record<string, unknown | null>): {
  provider: GitLabProvider;
  sent: SentQuery[];
} {
  const provider = new GitLabProvider('https://gitlab.example', 't');
  const sent: SentQuery[] = [];
  (provider as any).runQuery = async (op: string, query: string, vars: Record<string, unknown>) => {
    sent.push({ op, query, vars });
    const iid = String(vars.iid);
    return { project: { mergeRequest: byIid[iid] ?? null } };
  };
  return { provider, sent };
}

describe('GitLab fetchPullRequests({ iids }) stays under the complexity cap', () => {
  test('sends one single-MR query per distinct iid and never a mergeRequests connection', async () => {
    const { provider, sent } = recordingProvider({ '7': gitlabNode(7), '8': gitlabNode(8) });

    await provider.fetchPullRequests({ projectPath: 'g/p', iids: [7, 8, 7] });

    expect(sent.map((s) => s.vars)).toEqual([
      { projectPath: 'g/p', iid: '7' },
      { projectPath: 'g/p', iid: '8' },
    ]);
    for (const s of sent) {
      expect(s.op).toBe('fetchPullRequests.iids');
      expect(s.query).toContain('query GlanceMRDetail(');
      expect(s.query).toContain('mergeRequest(iid: $iid)');
      expect(s.query).not.toContain('mergeRequests(');
    }
  });

  test('an empty iids list sends nothing', async () => {
    const { provider, sent } = recordingProvider({});

    expect(await provider.fetchPullRequests({ projectPath: 'g/p', iids: [] })).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('drops missing MRs and keeps the requested state only', async () => {
    const { provider } = recordingProvider({
      '1': gitlabNode(1),
      '2': gitlabNode(2, { state: 'merged' }),
      '3': null,
    });

    const opened = await provider.fetchPullRequests({ projectPath: 'g/p', iids: [1, 2, 3] });
    expect(opened.map((pr) => pr.iid)).toEqual([1]);

    const both = await provider.fetchPullRequests({
      projectPath: 'g/p',
      iids: [1, 2, 3],
      state: ['opened', 'merged'],
    });
    expect(both.map((pr) => pr.iid).sort()).toEqual([1, 2]);
  });

  test('an empty state list reads as opened, as in the other modes', async () => {
    const { provider } = recordingProvider({ '1': gitlabNode(1), '2': gitlabNode(2, { state: 'merged' }) });

    const prs = await provider.fetchPullRequests({ projectPath: 'g/p', iids: [1, 2], state: [] });

    expect(prs.map((pr) => pr.iid)).toEqual([1]);
  });

  // GitLab's MergeRequestState lists `locked` as its own filter value beside
  // `opened`, and the old all-states path dropped it client-side, since
  // MRState has no `locked`.
  test('a locked MR is not returned for opened, nor for every MRState', async () => {
    const { provider } = recordingProvider({ '1': gitlabNode(1), '2': gitlabNode(2, { state: 'locked' }) });

    const opened = await provider.fetchPullRequests({ projectPath: 'g/p', iids: [1, 2] });
    const all = await provider.fetchPullRequests({
      projectPath: 'g/p',
      iids: [1, 2],
      state: ['opened', 'merged', 'closed'],
    });

    expect(opened.map((pr) => pr.iid)).toEqual([1]);
    expect(all.map((pr) => pr.iid)).toEqual([1]);
  });

  test('keeps at most 4 single-MR queries in flight and still reads every iid', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    let inFlight = 0;
    let peak = 0;
    const seen: string[] = [];
    (provider as any).runQuery = async (_op: string, _query: string, vars: Record<string, unknown>) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      seen.push(String(vars.iid));
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { project: { mergeRequest: gitlabNode(Number(vars.iid)) } };
    };
    const iids = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    const prs = await provider.fetchPullRequests({ projectPath: 'g/p', iids });

    expect(peak).toBe(4);
    expect(seen.sort()).toEqual(iids.map(String));
    expect(prs.map((pr) => pr.iid)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  test('a failed read rejects the batch and starts no further reads', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const seen: string[] = [];
    (provider as any).runQuery = async (_op: string, _query: string, vars: Record<string, unknown>) => {
      seen.push(String(vars.iid));
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (vars.iid === '1') throw new Error('boom');
      return { project: { mergeRequest: gitlabNode(Number(vars.iid)) } };
    };

    await expect(
      provider.fetchPullRequests({ projectPath: 'g/p', iids: [1, 2, 3, 4, 5, 6, 7, 8, 9] }),
    ).rejects.toThrow('boom');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(seen.length).toBe(4);
  });

  test('returns MRs newest first, the order the mergeRequests connection used', async () => {
    const { provider } = recordingProvider({ '1': gitlabNode(1), '3': gitlabNode(3), '2': gitlabNode(2) });

    const prs = await provider.fetchPullRequests({ projectPath: 'g/p', iids: [1, 3, 2] });

    expect(prs.map((pr) => pr.iid)).toEqual([3, 2, 1]);
  });

  test('the dashboard fragment keeps the page sizes that passed on gitlab.com', () => {
    const pageSizes = [...MR_DASHBOARD_FRAGMENT.matchAll(/(\w+)\(first:\s*(\d+)\)/g)].map(
      ([, field, n]) => `${field}:${n}`,
    );
    expect(pageSizes).toEqual([
      'assignees:20',
      'reviewers:20',
      'approvedBy:20',
      'stages:20',
      'jobs:50',
    ]);
  });
});

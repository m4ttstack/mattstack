#!/usr/bin/env bun
/**
 * GitLab's batched by-branch read answers "which of these branches has an MR"
 * for callers that act on a miss (gitq publish opens an MR for one), so a
 * miss must be a real miss: an unreadable project throws, and more matches
 * than one page holds are paged through rather than dropped.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

function gqlMr(iid: number, sourceBranch: string): Record<string, unknown> {
  const user = { id: 'gid://gitlab/User/1', username: 'dev', name: 'dev', avatarUrl: null };
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
    sourceBranch,
    targetBranch: 'main',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    diffHeadSha: 'abc',
    author: user,
    assignees: { nodes: [] },
    reviewers: { nodes: [] },
    approvedBy: { nodes: [] },
    headPipeline: null,
    mergeabilityChecks: [],
  };
}

describe('GitLabProvider.fetchPullRequestsByBranches', () => {
  test('throws when GitLab reports no project, rather than answering every branch with no MR', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    (provider as any).runQuery = async () => ({ project: null });

    await expect(provider.fetchPullRequestsByBranches('g/missing', ['a', 'b'])).rejects.toThrow('g/missing');
  });

  test('pages past the first page of matches', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const afters: unknown[] = [];
    (provider as any).runQuery = async (_op: string, _query: string, vars: Record<string, unknown>) => {
      afters.push(vars.after ?? null);
      return vars.after
        ? { project: { mergeRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [gqlMr(2, 'b')] } } }
        : { project: { mergeRequests: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [gqlMr(1, 'a')] } } };
    };

    const result = await provider.fetchPullRequestsByBranches('g/p', ['a', 'b']);

    expect(afters).toEqual([null, 'c1']);
    expect(result.get('a')?.iid).toBe(1);
    expect(result.get('b')?.iid).toBe(2);
  });

  test('a branch with several MRs answers with the newest, the first GitLab lists', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    (provider as any).runQuery = async () => ({
      project: {
        mergeRequests: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [gqlMr(20, 'a'), { ...gqlMr(10, 'a'), state: 'closed' }],
        },
      },
    });

    const result = await provider.fetchPullRequestsByBranches('g/p', ['a'], 'all');

    expect(result.get('a')?.iid).toBe(20);
  });

  test('asks GitLab for newest first, the order the first-seen rule depends on', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    let sent = '';
    (provider as any).runQuery = async (_op: string, query: string) => {
      sent = query;
      return { project: { mergeRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
    };

    await provider.fetchPullRequestsByBranches('g/p', ['a']);

    expect(sent).toContain('sort: CREATED_DESC');
  });

  test('stops reading once every branch has its MR', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    let calls = 0;
    (provider as any).runQuery = async () => {
      calls++;
      return {
        project: {
          mergeRequests: { pageInfo: { hasNextPage: true, endCursor: `c${calls}` }, nodes: [gqlMr(1, 'a'), gqlMr(2, 'b')] },
        },
      };
    };

    const result = await provider.fetchPullRequestsByBranches('g/p', ['a', 'b'], 'all');

    expect(calls).toBe(1);
    expect(result.get('b')?.iid).toBe(2);
  });

  test('throws when GitLab says there is another page but gives no cursor for it', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    (provider as any).runQuery = async () => ({
      project: { mergeRequests: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [gqlMr(1, 'a')] } },
    });

    await expect(provider.fetchPullRequestsByBranches('g/p', ['a', 'b'])).rejects.toThrow('non-advancing cursor');
  });

  test('throws when GitLab hands back the same cursor again', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    let calls = 0;
    (provider as any).runQuery = async () => {
      calls++;
      return { project: { mergeRequests: { pageInfo: { hasNextPage: true, endCursor: 'same' }, nodes: [gqlMr(1, 'a')] } } };
    };

    await expect(provider.fetchPullRequestsByBranches('g/p', ['a', 'b'])).rejects.toThrow('non-advancing cursor');
    expect(calls).toBe(2);
  });
});

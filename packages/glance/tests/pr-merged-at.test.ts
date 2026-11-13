#!/usr/bin/env bun
/**
 * PullRequest.mergedAt: both providers populate it, so a consumer windowing
 * on merge time needs no second fetch. Optional on the type because older
 * SDK builds never set it.
 *
 * Labels stay off PullRequest: `labels(first: 50) { nodes { title } }` in the
 * dashboard fragment pushed gitlab.com's query complexity over its cap
 * (255 > 250). Labels ride the metric-grade reads instead
 * (`MergeRequestIndexRow`, `MergeRequestMetrics`), which pull from separate
 * queries that already stay under the cap.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider, MR_DASHBOARD_FRAGMENT, MR_LIST_FRAGMENT } from '../src/GitLabProvider.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { ghNode, stubForge, useForgeStub } from './helpers/gh-fill-fixture.ts';

useForgeStub();

function gitlabNode(over: Record<string, unknown> = {}) {
  const user = { id: 'gid://gitlab/User/1', username: 'ada', name: 'Ada', avatarUrl: null };
  return {
    id: 'gid://gitlab/MergeRequest/7',
    iid: '7',
    projectId: 42,
    title: 'Add feature',
    description: null,
    state: 'merged',
    draft: false,
    conflicts: false,
    detailedMergeStatus: 'MERGEABLE',
    webUrl: 'https://gitlab.example/g/p/-/merge_requests/7',
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

describe('GitLab PullRequest.mergedAt', () => {
  test('maps mergedAt from the fragment', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      project: { mergeRequest: gitlabNode({ mergedAt: '2026-08-02T10:00:00Z' }) },
    });
    const [pr] = await p.fetchPullRequests({ projectPath: 'g/p', iids: [7], state: 'merged' });
    expect(pr!.mergedAt).toBe('2026-08-02T10:00:00Z');
  });

  test('an open MR has a null mergedAt', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      project: { mergeRequest: gitlabNode({ state: 'opened', mergedAt: null }) },
    });
    const [pr] = await p.fetchPullRequests({ projectPath: 'g/p', iids: [7], state: 'opened' });
    expect(pr!.mergedAt).toBeNull();
  });

  test('both fragments request the field', () => {
    for (const fragment of [MR_DASHBOARD_FRAGMENT, MR_LIST_FRAGMENT]) {
      expect(fragment).toContain('mergedAt');
    }
  });
});

describe('GitHub PullRequest.mergedAt', () => {
  test('maps mergedAt from the fill', async () => {
    stubForge({
      fill: () => ({ 7: ghNode({ number: 7, state: 'MERGED', mergedAt: '2026-08-02T10:00:00Z' }) })
    });
    const p = new GitHubProvider('https://github.com', 'tok-merged-at');

    const pr = await p.fetchSingleMR('o/r', 7, null);

    expect(pr!.mergedAt).toBe('2026-08-02T10:00:00Z');
    expect(pr!.state).toBe('merged');
  });

  test('an open filled PR has a null mergedAt', async () => {
    stubForge({ fill: () => ({ 7: ghNode({ number: 7 }) }) });
    const p = new GitHubProvider('https://github.com', 'tok-merged-at-open');

    const pr = await p.fetchSingleMR('o/r', 7, null);

    expect(pr!.mergedAt).toBeNull();
  });
});

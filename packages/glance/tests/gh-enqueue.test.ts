#!/usr/bin/env bun
/** The transport is stubbed; nothing here touches a network. */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';

function providerWith(payload: unknown) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const mutations: Array<{ query: string; variables: Record<string, unknown> }> = [];
  (provider as any).octokit = {
    request: async () => ({ status: 200, headers: {}, data: { number: 5, node_id: 'PR_kwABC' } }),
    graphql: async (query: string, variables: Record<string, unknown>) => {
      mutations.push({ query, variables });
      return payload;
    }
  };
  return { provider, mutations };
}

const QUEUED = { enqueuePullRequest: { mergeQueueEntry: { position: 2, state: 'QUEUED' } } };

describe('fetchMergeQueueStatus', () => {
  test('reads both flags for the pull request', async () => {
    const { provider, mutations } = providerWith({
      repository: { pullRequest: { isMergeQueueEnabled: true, isInMergeQueue: false } }
    });
    expect(await provider.fetchMergeQueueStatus('o/r', 5)).toEqual({ enabled: true, inQueue: false });
    expect(mutations[0]!.variables).toEqual({ owner: 'o', repo: 'r', number: 5 });
  });

  test('a missing pull request is a failure, not a repo with no queue', async () => {
    const { provider } = providerWith({ repository: { pullRequest: null } });
    await expect(provider.fetchMergeQueueStatus('o/r', 5)).rejects.toThrow('no pull request for o/r!5');
  });
});

describe('enqueuePullRequest', () => {
  test('returns the queue entry and pins the expected head', async () => {
    const { provider, mutations } = providerWith(QUEUED);
    const entry = await provider.enqueuePullRequest('o/r', 5, { expectedHeadSha: 'abc' });
    expect(entry).toEqual({ position: 2, state: 'QUEUED' });
    expect(mutations[0]!.query).toContain('enqueuePullRequest');
    expect(mutations[0]!.variables).toEqual({ id: 'PR_kwABC', head: 'abc' });
  });

  test('sends a null head when none is expected', async () => {
    const { provider, mutations } = providerWith(QUEUED);
    await provider.enqueuePullRequest('o/r', 5);
    expect(mutations[0]!.variables.head).toBeNull();
  });

  test('an accepted mutation with no entry is a failure', async () => {
    const { provider } = providerWith({ enqueuePullRequest: { mergeQueueEntry: null } });
    await expect(provider.enqueuePullRequest('o/r', 5)).rejects.toThrow('reported no queue entry on o/r!5');
  });

  test('GitLab leaves it absent and says so in its capabilities', () => {
    const provider = new GitLabProvider('https://gitlab.com', 'tok');
    expect(provider.capabilities.canEnqueue).toBe(false);
    expect((provider as unknown as { enqueuePullRequest?: unknown }).enqueuePullRequest).toBeUndefined();
  });
});

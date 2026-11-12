#!/usr/bin/env bun
/** The transport is stubbed; nothing here touches a network. */
import { describe, expect, test } from 'bun:test';
import { ReadBackFailedError } from '../src/errors.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { mergeContextData } from './helpers/gh-merge-context.ts';

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

describe('mergePullRequest read-back', () => {
  test('a merge whose read-back fails says the write landed', async () => {
    const { provider } = providerWith(mergeContextData());
    (provider as any).fetchSingleMR = async () => {
      throw new Error('502');
    };
    const failure = await provider.mergePullRequest('o/r', 5).catch(e => e);
    expect(failure).toBeInstanceOf(ReadBackFailedError);
    expect(failure.writeApplied).toBe(true);
  });
});

describe('fetchMergeQueueStatus', () => {
  test('reads both flags for the pull request', async () => {
    const { provider, mutations } = providerWith({
      repository: {
        pullRequest: {
          isMergeQueueEnabled: true,
          isInMergeQueue: false,
          state: 'OPEN',
          timelineItems: { nodes: [{ createdAt: '2026-01-01T00:00:00Z', reason: 'failed_checks' }] }
        }
      }
    });
    expect(await provider.fetchMergeQueueStatus('o/r', 5)).toEqual({
      enabled: true,
      inQueue: false,
      merged: false,
      lastRemoval: { at: '2026-01-01T00:00:00Z', reason: 'failed_checks' }
    });
    expect(mutations[0]!.variables).toEqual({ owner: 'o', repo: 'r', number: 5 });
  });

  test('a merged pull request that never left a queue has no removal', async () => {
    const { provider } = providerWith({
      repository: {
        pullRequest: { isMergeQueueEnabled: false, isInMergeQueue: false, state: 'MERGED', timelineItems: { nodes: [] } }
      }
    });
    expect(await provider.fetchMergeQueueStatus('o/r', 5)).toEqual({
      enabled: false,
      inQueue: false,
      merged: true,
      lastRemoval: null
    });
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

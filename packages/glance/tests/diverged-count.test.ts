#!/usr/bin/env bun
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

function stubShow(provider: GitLabProvider, show: (...args: unknown[]) => Promise<unknown>) {
  const calls: unknown[][] = [];
  (provider as any).gb = {
    MergeRequests: {
      show: async (...args: unknown[]) => {
        calls.push(args);
        return show(...args);
      },
    },
  };
  (provider as any).runQuery = async () => {
    throw new Error('fetchDivergedCount must not run a GraphQL query');
  };
  return calls;
}

describe('GitLabProvider.fetchDivergedCount', () => {
  test('asks REST for the count only and returns it', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubShow(provider, async () => ({ diverged_commits_count: 1090 }));

    expect(await provider.fetchDivergedCount('g/p', 12)).toBe(1090);
    expect(calls).toEqual([['g/p', 12, { includeDivergedCommitsCount: true }]]);
  });

  test('a stored zero is a real zero', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    stubShow(provider, async () => ({ diverged_commits_count: 0 }));

    expect(await provider.fetchDivergedCount('g/p', 12)).toBe(0);
  });

  test('a response without the field is null, never zero', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    stubShow(provider, async () => ({}));

    expect(await provider.fetchDivergedCount('g/p', 12)).toBeNull();
  });

  test('a failed request rejects so the caller keeps its stored value', async () => {
    const provider = new GitLabProvider('https://gitlab.example', 't');
    stubShow(provider, async () => {
      throw new Error('502');
    });

    await expect(provider.fetchDivergedCount('g/p', 12)).rejects.toThrow('502');
  });
});

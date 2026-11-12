#!/usr/bin/env bun
/** The transport is stubbed; nothing here touches a network. */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GRAPHQL_READ_MARKER } from '../src/githubClient.ts';
import { pickMergeMethod, type GitHubMergeContext } from '../src/githubMerge.ts';
import type { MergeMethod } from '../src/types.ts';
import { mergeContextData as contextPayload } from './helpers/gh-merge-context.ts';

function allowing(...methods: MergeMethod[]): Record<MergeMethod, boolean> {
  return {
    merge: methods.includes('merge'),
    squash: methods.includes('squash'),
    rebase: methods.includes('rebase')
  };
}

function ctx(
  defaultMethod: MergeMethod | null,
  allowed: Record<MergeMethod, boolean>
): Pick<GitHubMergeContext, 'defaultMethod' | 'allowed'> {
  return { defaultMethod, allowed };
}

describe('pickMergeMethod', () => {
  test("the caller's method, when the repository allows it", () => {
    expect(
      pickMergeMethod('mergePullRequest', 'o/r', ctx('merge', allowing('merge', 'rebase')), {
        mergeMethod: 'rebase'
      })
    ).toBe('rebase');
  });

  test('squash: true gives squash', () => {
    expect(
      pickMergeMethod('mergePullRequest', 'o/r', ctx('merge', allowing('merge', 'squash')), { squash: true })
    ).toBe('squash');
  });

  test('no input on a squash-only repository with a squash default gives squash', () => {
    expect(pickMergeMethod('mergePullRequest', 'o/r', ctx('squash', allowing('squash')))).toBe('squash');
  });

  test('no input, no default, everything allowed gives merge', () => {
    expect(
      pickMergeMethod('mergePullRequest', 'o/r', ctx(null, allowing('merge', 'squash', 'rebase')))
    ).toBe('merge');
  });

  test('no input, no default, only rebase allowed gives rebase', () => {
    expect(pickMergeMethod('mergePullRequest', 'o/r', ctx(null, allowing('rebase')))).toBe('rebase');
  });

  test('a default the repository does not allow falls to the first allowed', () => {
    expect(pickMergeMethod('mergePullRequest', 'o/r', ctx('merge', allowing('squash', 'rebase')))).toBe(
      'squash'
    );
  });

  test('squash: false with a squash default picks merge when merge is allowed', () => {
    expect(
      pickMergeMethod('mergePullRequest', 'o/r', ctx('squash', allowing('merge', 'squash')), { squash: false })
    ).toBe('merge');
  });

  test('squash: false keeps a default that is not squash', () => {
    expect(
      pickMergeMethod('mergePullRequest', 'o/r', ctx('rebase', allowing('merge', 'rebase')), { squash: false })
    ).toBe('rebase');
  });

  test('squash: false on a squash-only repository throws', () => {
    expect(() =>
      pickMergeMethod('mergePullRequest', 'o/r', ctx('squash', allowing('squash')), { squash: false })
    ).toThrow('mergePullRequest failed: o/r does not allow a merge that is not a squash (allowed: squash)');
  });

  test('a caller-named method the repository forbids throws, naming the allowed methods', () => {
    expect(() =>
      pickMergeMethod('mergePullRequest', 'o/r', ctx('squash', allowing('squash')), { mergeMethod: 'merge' })
    ).toThrow('mergePullRequest failed: o/r does not allow merge merges (allowed: squash)');
  });

  test('squash: true on a repository that forbids squash throws', () => {
    expect(() =>
      pickMergeMethod('mergePullRequest', 'o/r', ctx('merge', allowing('merge', 'rebase')), { squash: true })
    ).toThrow('mergePullRequest failed: o/r does not allow squash merges (allowed: merge, rebase)');
  });
});

const AUTO_MERGE_ON = {
  enablePullRequestAutoMerge: {
    pullRequest: { autoMergeRequest: { enabledAt: '2026-11-11T00:00:00Z' } }
  }
};

function providerWith(graphqlResponses: unknown[]) {
  const provider = new GitHubProvider('https://github.com', 'tok');
  const graphql: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const requests: Array<{ route: string; params?: { data?: Record<string, unknown> } }> = [];
  let reads = 0;
  (provider as any).octokit = {
    request: async (route: string, params?: { data?: Record<string, unknown> }) => {
      requests.push({ route, params });
      return { status: 200, headers: {}, data: { merged: true, sha: 'm1' } };
    },
    graphql: async (query: string, variables: Record<string, unknown>) => {
      graphql.push({ query, variables });
      return graphqlResponses.shift();
    }
  };
  (provider as any).fetchSingleMR = async () => {
    reads++;
    return { iid: 9, state: 'merged', sourceBranch: 'feature' };
  };
  return { provider, graphql, requests, reads: () => reads };
}

function putBody(requests: Array<{ route: string; params?: { data?: Record<string, unknown> } }>) {
  const put = requests.find(r => r.route.startsWith('PUT '));
  if (!put) throw new Error('no merge PUT was sent');
  return put.params?.data ?? {};
}

describe('GitHubProvider mergePullRequest method', () => {
  test('merge on a squash-only repo sends merge_method squash', async () => {
    const { provider, requests } = providerWith([
      contextPayload({ viewerDefaultMergeMethod: 'SQUASH', allowed: ['squash'] })
    ]);

    await provider.mergePullRequest('o/r', 9);

    expect(putBody(requests).merge_method).toBe('squash');
  });

  test("merge sends the caller's method and picks its commit message", async () => {
    const { provider, requests } = providerWith([contextPayload()]);

    await provider.mergePullRequest('o/r', 9, {
      mergeMethod: 'squash',
      commitMessage: 'merge message',
      squashCommitMessage: 'squash message'
    });

    const body = putBody(requests);
    expect(body.merge_method).toBe('squash');
    expect(body.commit_title).toBe('squash message');
  });

  test('a forbidden method sends no PUT', async () => {
    const { provider, requests } = providerWith([
      contextPayload({ viewerDefaultMergeMethod: 'SQUASH', allowed: ['squash'] })
    ]);

    await expect(provider.mergePullRequest('o/r', 9, { mergeMethod: 'merge' })).rejects.toThrow(
      'mergePullRequest failed: o/r does not allow merge merges (allowed: squash)'
    );
    expect(requests).toHaveLength(0);
  });

  test('a direct merge costs the context read, the PUT and the read-back', async () => {
    const { provider, graphql, requests, reads } = providerWith([contextPayload()]);

    await provider.mergePullRequest('o/r', 9);

    expect(graphql).toHaveLength(1);
    expect(graphql[0]!.query).toContain('viewerDefaultMergeMethod');
    expect(graphql[0]!.variables).toEqual({
      owner: 'o',
      repo: 'r',
      number: 9,
      request: { [GRAPHQL_READ_MARKER]: true }
    });
    expect(requests.map(r => r.route)).toEqual(['PUT /repos/o/r/pulls/9/merge']);
    expect(reads()).toBe(1);
  });

  test('a missing pull request throws before any write', async () => {
    const { provider, requests } = providerWith([
      { repository: { ...contextPayload().repository!, pullRequest: null } }
    ]);

    await expect(provider.mergePullRequest('o/r', 9)).rejects.toThrow(
      'mergePullRequest failed: GitHub returned no pull request for o/r!9'
    );
    expect(requests).toHaveLength(0);
  });
});

describe('GitHubProvider setAutoMerge method', () => {
  test('setAutoMerge passes the picked method', async () => {
    const { provider, graphql, requests } = providerWith([
      contextPayload({ viewerDefaultMergeMethod: 'SQUASH', allowed: ['squash'] }),
      AUTO_MERGE_ON
    ]);

    await provider.setAutoMerge('o/r', 9);

    expect(graphql).toHaveLength(2);
    expect(graphql[1]!.query).toContain('enablePullRequestAutoMerge');
    expect(graphql[1]!.variables).toEqual({ id: 'PR_node', mergeMethod: 'SQUASH' });
    expect(requests).toHaveLength(0);
  });

  test('setAutoMerge omits mergeMethod on a queue branch', async () => {
    const { provider, graphql } = providerWith([contextPayload({ queueEnabled: true }), AUTO_MERGE_ON]);

    await provider.setAutoMerge('o/r', 9);

    expect(graphql[1]!.variables).toEqual({ id: 'PR_node' });
  });

  test('a missing pull request throws before the mutation', async () => {
    const { provider, graphql } = providerWith([
      { repository: { ...contextPayload().repository!, pullRequest: null } }
    ]);

    await expect(provider.setAutoMerge('o/r', 9)).rejects.toThrow(
      'setAutoMerge failed: GitHub returned no pull request for o/r!9'
    );
    expect(graphql).toHaveLength(1);
  });
});

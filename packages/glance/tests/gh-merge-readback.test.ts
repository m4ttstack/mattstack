#!/usr/bin/env bun
/** The transport is stubbed; nothing here touches a network. */
import { describe, expect, test } from 'bun:test';
import { GraphqlResponseError } from '@octokit/graphql';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GRAPHQL_READ_MARKER } from '../src/githubClient.ts';
import { MergeReadBackFailedError, ReadBackFailedError } from '../src/index.ts';
import { ghNode, jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';
import { isMergeContextQuery, mergeContextData } from './helpers/gh-merge-context.ts';

useForgeStub();
useInstantTimers();

interface Scenario {
  headBranch?: string;
  headRepo?: string | null;
  readBackFails?: boolean;
  del?: () => Response;
  refCheck?: () => Response;
}

/** A merge PUT that lands on o/r#7, with the read-back and the branch cleanup answering as told. */
function landedMerge(scenario: Scenario = {}): { calls: string[] } {
  const calls: string[] = [];
  stubForge({
    graphql: query => {
      if (isMergeContextQuery(query)) {
        calls.push('POST context');
        return mergeContextData({
          headBranch: scenario.headBranch ?? 'feat',
          headRepo: scenario.headRepo === undefined ? 'o/r' : scenario.headRepo
        });
      }
      calls.push('POST fill');
      return scenario.readBackFails ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined;
    },
    fill: numbers =>
      Object.fromEntries(
        numbers.map(n => [n, ghNode({ number: n, state: 'MERGED', mergedAt: '2026-01-03T00:00:00Z' })])
      ),
    rest: (url, method) => {
      const path = new URL(url).pathname;
      calls.push(`${method} ${path}`);
      if (method === 'PUT') return jsonResponse({ merged: true, sha: 'm1' });
      if (method === 'DELETE') return scenario.del?.() ?? new Response(null, { status: 204 });
      if (method === 'GET' && path.includes('/git/ref/heads/')) {
        return scenario.refCheck?.() ?? jsonResponse({ message: 'Not Found' }, 404);
      }
      return undefined;
    }
  });
  return { calls };
}

function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', 'tok');
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e
  );
}

const noPullRead = (calls: string[]) => calls.some(c => c === 'GET /repos/o/r/pulls/7');

describe('GitHubProvider mergePullRequest when the read-back fails', () => {
  test('read-back fails, delete succeeds', async () => {
    const { calls } = landedMerge({ readBackFails: true });

    const err = await rejection(provider().mergePullRequest('o/r', 7, { shouldRemoveSourceBranch: true }));

    expect(err).toBeInstanceOf(MergeReadBackFailedError);
    expect(err).toBeInstanceOf(ReadBackFailedError);
    const e = err as MergeReadBackFailedError;
    expect(e.name).toBe('MergeReadBackFailedError');
    expect(e.writeApplied).toBe(true);
    expect(e.projectPath).toBe('o/r');
    expect(e.iid).toBe(7);
    expect(e.message).toMatch(/^Merged PR #7 but could not verify it afterward: /);
    expect(e.sourceBranchNotDeleted).toBeUndefined();
    expect(calls).toContain('DELETE /repos/o/r/git/refs/heads/feat');
    expect(noPullRead(calls)).toBe(false);
  });

  test('read-back fails, delete refused', async () => {
    landedMerge({
      readBackFails: true,
      del: () => jsonResponse({ message: 'Reference cannot be deleted' }, 422),
      refCheck: () => jsonResponse({ ref: 'refs/heads/feat' })
    });

    const err = await rejection(provider().mergePullRequest('o/r', 7, { shouldRemoveSourceBranch: true }));

    expect(err).toBeInstanceOf(MergeReadBackFailedError);
    expect((err as MergeReadBackFailedError).sourceBranchNotDeleted).toStartWith(
      'The source branch "feat" was not deleted:'
    );
  });

  test('a deleted fork reports why and sends no DELETE', async () => {
    const { calls } = landedMerge({ readBackFails: true, headRepo: null });

    const err = await rejection(provider().mergePullRequest('o/r', 7, { shouldRemoveSourceBranch: true }));

    expect(err).toBeInstanceOf(MergeReadBackFailedError);
    expect((err as MergeReadBackFailedError).sourceBranchNotDeleted).toContain('head repository is unknown');
    expect(calls.some(c => c.startsWith('DELETE'))).toBe(false);
  });

  test('without shouldRemoveSourceBranch a failed read-back still throws MergeReadBackFailedError with no branch field', async () => {
    const { calls } = landedMerge({ readBackFails: true });

    const err = await rejection(provider().mergePullRequest('o/r', 7));

    expect(err).toBeInstanceOf(MergeReadBackFailedError);
    expect('sourceBranchNotDeleted' in (err as object)).toBe(false);
    expect((err as MergeReadBackFailedError).queued).toBeUndefined();
    expect(calls.some(c => c.startsWith('DELETE'))).toBe(false);
  });
});

describe('GitHubProvider mergePullRequest when the read-back succeeds', () => {
  test('a merge with branch removal makes 4 requests and no REST pull request read', async () => {
    const { calls } = landedMerge();

    const pr = await provider().mergePullRequest('o/r', 7, { shouldRemoveSourceBranch: true });

    expect(pr.state).toBe('merged');
    expect(pr.sourceBranchNotDeleted).toBeUndefined();
    expect(calls).toEqual([
      'POST context',
      'PUT /repos/o/r/pulls/7/merge',
      'POST fill',
      'DELETE /repos/o/r/git/refs/heads/feat'
    ]);
  });

  test("a fork PR's DELETE targets the fork", async () => {
    const { calls } = landedMerge({ headRepo: 'fork/r' });

    await provider().mergePullRequest('o/r', 7, { shouldRemoveSourceBranch: true });

    expect(calls).toContain('DELETE /repos/fork/r/git/refs/heads/feat');
    expect(calls.some(c => c.startsWith('DELETE /repos/o/r/'))).toBe(false);
    expect(noPullRead(calls)).toBe(false);
  });

  test('a deleted fork reports why and sends no DELETE', async () => {
    const { calls } = landedMerge({ headRepo: null });

    const pr = await provider().mergePullRequest('o/r', 7, { shouldRemoveSourceBranch: true });

    expect(pr.state).toBe('merged');
    expect(pr.sourceBranchNotDeleted).toBe(
      'The source branch "feat" was not deleted: its head repository is unknown (the fork was likely deleted), so the delete could not be targeted safely'
    );
    expect(calls.some(c => c.startsWith('DELETE'))).toBe(false);
  });
});

describe('a head repository the token cannot see', () => {
  test('the merge lands and reports the branch not deleted, with no DELETE', async () => {
    const calls: string[] = [];
    stubForge({
      graphql: query => {
        if (isMergeContextQuery(query)) {
          return jsonResponse({
            data: mergeContextData({ headBranch: 'feat', headRepo: null }),
            errors: [
              {
                type: 'FORBIDDEN',
                path: ['repository', 'pullRequest', 'headRepository'],
                message: 'Resource not accessible by personal access token'
              }
            ]
          });
        }
        return undefined;
      },
      fill: numbers =>
        Object.fromEntries(
          numbers.map(n => [n, ghNode({ number: n, state: 'MERGED', mergedAt: '2026-01-03T00:00:00Z' })])
        ),
      rest: (url, method) => {
        calls.push(`${method} ${new URL(url).pathname}`);
        if (method === 'PUT') return jsonResponse({ merged: true, sha: 'm1' });
        return undefined;
      }
    });

    const pr = await provider().mergePullRequest('o/r', 7, { shouldRemoveSourceBranch: true });

    expect(pr.state).toBe('merged');
    expect(pr.sourceBranchNotDeleted).toContain('head repository is unknown');
    expect(calls).toContain('PUT /repos/o/r/pulls/7/merge');
    expect(calls.some(c => c.startsWith('DELETE'))).toBe(false);
  });
});

function notFound(): GraphqlResponseError<unknown> {
  return new GraphqlResponseError(
    { method: 'POST', url: 'https://api.github.com/graphql' } as never,
    {} as never,
    {
      data: { repository: { pullRequest: null } },
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['repository', 'pullRequest'],
          message: 'Could not resolve to a PullRequest with the number of 7.'
        }
      ]
    } as never
  );
}

function recordingGraphql(answer: () => unknown) {
  const options: Array<Record<string, unknown>> = [];
  const graphql = async (_query: string, opts: Record<string, unknown>) => {
    options.push(opts);
    const out = answer();
    if (out instanceof Error) throw out;
    return out;
  };
  return { graphql, options };
}

describe('the merge context and rebase head reads are retryable reads', () => {
  test('a missing PR in the merge context read gives the null-PR message', async () => {
    const p = provider();
    const { graphql } = recordingGraphql(notFound);
    (p as any).octokit = { graphql, request: async () => ({ status: 200, headers: {}, data: {} }) };

    await expect(p.mergePullRequest('o/r', 7)).rejects.toThrow(
      'mergePullRequest failed: GitHub returned no pull request for o/r!7'
    );
  });

  test('the merge context read carries the read marker', async () => {
    const p = provider();
    const { graphql, options } = recordingGraphql(notFound);
    (p as any).octokit = { graphql, request: async () => ({ status: 200, headers: {}, data: {} }) };

    await rejection(p.mergePullRequest('o/r', 7));

    expect(options[0]!.request).toEqual({ [GRAPHQL_READ_MARKER]: true });
  });

  test('a merge context read with a PR and errors throws the GraphQL messages', async () => {
    const p = provider();
    const { graphql } = recordingGraphql(
      () =>
        new GraphqlResponseError(
          { method: 'POST', url: 'https://api.github.com/graphql' } as never,
          {} as never,
          { data: mergeContextData(), errors: [{ message: 'one' }, { message: 'two' }] } as never
        )
    );
    (p as any).octokit = { graphql, request: async () => ({ status: 200, headers: {}, data: {} }) };

    await expect(p.mergePullRequest('o/r', 7)).rejects.toThrow(
      'mergePullRequest failed: GitHub GraphQL returned one; two'
    );
  });

  test('a missing PR in the rebase head read gives the null-PR message', async () => {
    const p = provider();
    const { graphql } = recordingGraphql(notFound);
    (p as any).octokit = { graphql, request: async () => ({ status: 200, headers: {}, data: {} }) };

    await expect(p.rebasePullRequest('o/r', 7)).rejects.toThrow(
      'rebasePullRequest failed: GitHub returned no pull request for o/r!7'
    );
  });

  test('the rebase head read carries the read marker and the mutation does not', async () => {
    const p = provider();
    const answers: unknown[] = [
      { repository: { pullRequest: { id: 'PR_node', headRefOid: 'abc123' } } },
      { updatePullRequestBranch: { pullRequest: { headRefOid: 'def456' } } }
    ];
    const { graphql, options } = recordingGraphql(() => answers.shift());
    (p as any).octokit = { graphql, request: async () => ({ status: 200, headers: {}, data: {} }) };

    await p.rebasePullRequest('o/r', 7);

    expect(options[0]!.request).toEqual({ [GRAPHQL_READ_MARKER]: true });
    expect(options[1]!.request).toBeUndefined();
  });
});

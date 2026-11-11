/**
 * Unit tests for unresolved review-thread counts on GitHub PRs (MAT-14).
 *
 * `toPullRequest` used to hardcode `unresolvedThreadCount: 0`, which reads as
 * "nothing outstanding" and silenced gitq's pre-rebase warning. The count now
 * comes from the fill's `reviewThreads { totalCount nodes { isResolved } }`,
 * read in the same request as the rest of the PR, and is null (unknown) when
 * the first page does not hold every thread.
 *
 * The transport is stubbed at `fetch` (`stubForge`); no network is involved.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { GHFillNode } from '../src/githubFill.ts';
import { ghNode, jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

let tokens = 0;

function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-threads-${++tokens}`);
}

function threads(resolved: boolean[], totalCount = resolved.length): GHFillNode['reviewThreads'] {
  return { totalCount, nodes: resolved.map((isResolved) => ({ isResolved })) };
}

/**
 * Lists `nodes` through the repository listing and answers the fill with
 * them. Returns the PR numbers each fill request asked for.
 */
function listing(nodes: GHFillNode[]): { filled: number[][] } {
  const filled: number[][] = [];
  stubForge({
    rest: (url) =>
      url.includes('/repos/acme/repo/pulls?')
        ? jsonResponse(
            nodes.map((n) => ({
              number: n.number,
              state: 'open',
              merged_at: null,
              updated_at: n.updatedAt,
              base: { ref: 'main', repo: { id: 1, full_name: 'acme/repo', default_branch: 'main' } }
            }))
          )
        : undefined,
    fill: (numbers) => {
      filled.push(numbers);
      return Object.fromEntries(nodes.filter((n) => numbers.includes(n.number)).map((n) => [n.number, n]));
    }
  });
  return { filled };
}

async function listed(): Promise<Awaited<ReturnType<GitHubProvider['fetchPullRequests']>>> {
  return provider().fetchPullRequests({ projectPath: 'acme/repo' });
}

describe('GitHubProvider unresolved review threads', () => {
  test('a PR with unresolved threads reports how many are open', async () => {
    listing([ghNode({ number: 1, reviewThreads: threads([false, true, false]) })]);

    const prs = await listed();

    expect(prs[0]?.unresolvedThreadCount).toBe(2);
  });

  test('a PR whose threads are all resolved reports zero', async () => {
    listing([ghNode({ number: 1, reviewThreads: threads([true, true]) })]);

    const prs = await listed();

    expect(prs[0]?.unresolvedThreadCount).toBe(0);
  });

  test('a PR with no review threads reports zero', async () => {
    listing([ghNode({ number: 1, reviewThreads: threads([]) })]);

    const prs = await listed();

    expect(prs[0]?.unresolvedThreadCount).toBe(0);
  });

  test('a PR with more threads than one page is unknown, not undercounted', async () => {
    listing([ghNode({ number: 1, reviewThreads: threads([false], 101) })]);

    const prs = await listed();

    expect(prs[0]?.unresolvedThreadCount).toBeNull();
  });

  test('counts for a whole listing come from one fill request', async () => {
    const { filled } = listing([1, 2, 3].map((number) => ghNode({ number, reviewThreads: threads([false]) })));

    const prs = await listed();

    expect(prs.map((p) => p.unresolvedThreadCount)).toEqual([1, 1, 1]);
    expect(filled).toEqual([[1, 2, 3]]);
  });

  test('fetchSingleMR carries the count too, read from the fill', async () => {
    stubForge({
      fill: () => ({
        4: ghNode({
          number: 4,
          reviewThreads: {
            totalCount: 3,
            nodes: [{ isResolved: false }, { isResolved: false }, { isResolved: true }]
          }
        })
      })
    });

    const pr = await provider().fetchSingleMR('acme/repo', 4, null);

    expect(pr?.unresolvedThreadCount).toBe(2);
  });

  test('fetchSingleMR reads more than 100 threads as unknown, not as a count', async () => {
    stubForge({
      fill: () => ({
        4: ghNode({
          number: 4,
          reviewThreads: {
            totalCount: 101,
            nodes: Array.from({ length: 100 }, () => ({ isResolved: true }))
          }
        })
      })
    });

    const pr = await provider().fetchSingleMR('acme/repo', 4, null);

    expect(pr?.unresolvedThreadCount).toBeNull();
  });

  test('detailedMergeStatus stays null on GitHub (GitLab-only field)', async () => {
    listing([ghNode({ number: 1 })]);

    const prs = await listed();

    expect(prs[0]?.detailedMergeStatus).toBeNull();
  });
});

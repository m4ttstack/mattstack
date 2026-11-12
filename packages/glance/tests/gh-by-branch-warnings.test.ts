/**
 * GitHub's by-branch reads report a failed list request, a fallback scan
 * that hit its 500-PR cap, and a found PR whose fill failed through
 * `onWarning`, while still resolving to the same null a confirmed miss does.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { warningTarget, type FetchPullRequestsWarning } from '../src/GitProvider.ts';
import type { GHFillNode } from '../src/githubFill.ts';
import { ghNode, jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

let providers = 0;

function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-by-branch-warn-${++providers}`);
}

function listed(number: number, ref: string) {
  return { number, head: { ref }, base: { ref: 'main' }, updated_at: '2026-01-01T00:00:00Z' };
}

function page(count: number, start: number) {
  return Array.from({ length: count }, (_, i) => listed(start + i, `other-${start + i}`));
}

function nodeFor(n: number, over: Parameters<typeof ghNode>[0] = {}): GHFillNode {
  return ghNode({ number: n, databaseId: 1000 + n, url: `https://github.com/o/r/pull/${n}`, ...over });
}

function failedFill(n: number, others: Record<string, GHFillNode> = {}): Response {
  return jsonResponse({
    data: { repository: { ...others, [`p${n}`]: null } },
    errors: [{ type: 'INTERNAL', path: ['repository', `p${n}`], message: 'boom' }]
  });
}

function nodeWithMoreContexts(n: number): GHFillNode {
  const contexts = Array.from({ length: 100 }, (_, i) => ({
    __typename: 'CheckRun' as const,
    databaseId: i + 1,
    name: `check-${i + 1}`,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    startedAt: '2026-01-02T00:00:00Z',
    completedAt: '2026-01-02T00:01:00Z',
    detailsUrl: null,
    isRequired: true,
    checkSuite: { workflowRun: { databaseId: 77, runNumber: 5, workflow: { name: 'CI' } } }
  }));
  return nodeFor(n, {
    commits: {
      nodes: [
        {
          commit: {
            oid: 'abc123',
            statusCheckRollup: {
              state: 'PENDING',
              contexts: { totalCount: 150, pageInfo: { hasNextPage: true, endCursor: 'CUR1' }, nodes: contexts }
            }
          }
        }
      ]
    }
  });
}

function rest(answer: (url: string) => Response): void {
  stubForge({
    rest: (url) => (url.includes('/rules/branches/') ? jsonResponse([]) : answer(url)),
    fill: (numbers) => Object.fromEntries(numbers.map((n) => [n, nodeFor(n)]))
  });
}

function collect(): { warnings: FetchPullRequestsWarning[]; onWarning: (w: FetchPullRequestsWarning) => void } {
  const warnings: FetchPullRequestsWarning[] = [];
  return { warnings, onWarning: (w) => warnings.push(w) };
}

/** Answers the batch lookup with `numberFor` per branch; other GraphQL goes to `other`. */
function batchStub(
  numberFor: (branch: string) => number | undefined,
  fill: (numbers: number[]) => Record<number, GHFillNode | null>,
  other: (query: string) => Response | undefined = () => undefined
): void {
  stubForge({
    rest: (url) => (url.includes('/rules/branches/') ? jsonResponse([]) : undefined),
    graphql: (query, variables) => {
      if (!query.includes('GlancePullRequestsByBranches')) return other(query);
      const repository: Record<string, { nodes: Array<{ number: number }> }> = {};
      for (const [key, value] of Object.entries(variables)) {
        if (!/^h\d+$/.test(key)) continue;
        const number = numberFor(value as string);
        repository[`b${key.slice(1)}`] = { nodes: number == null ? [] : [{ number }] };
      }
      return { repository };
    },
    fill
  });
}

describe('GitHubProvider.fetchPullRequestByBranch warnings', () => {
  test('a failed fast-path list warns request-failed/list with its status', async () => {
    rest(() => jsonResponse({ message: 'Bad Gateway' }, 502));
    const { warnings, onWarning } = collect();

    const pr = await provider().fetchPullRequestByBranch('o/r', 'feat', 'opened', { onWarning });

    expect(pr).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'list',
      status: 502,
      target: 'o/r',
      branch: 'feat'
    });
  });

  test('a failed fallback page warns request-failed/list', async () => {
    rest((url) => (url.includes('head=') ? jsonResponse([]) : jsonResponse({ message: 'Bad Gateway' }, 502)));
    const { warnings, onWarning } = collect();

    const pr = await provider().fetchPullRequestByBranch('o/r', 'feat', 'opened', { onWarning });

    expect(pr).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'list',
      status: 502,
      target: 'o/r',
      branch: 'feat'
    });
  });

  test('a scan that hits the 500-PR cap warns page-cap/list', async () => {
    rest((url) => {
      if (url.includes('head=')) return jsonResponse([]);
      const n = Number(/page=(\d+)/.exec(url)![1]);
      return jsonResponse(page(100, n * 1000));
    });
    const { warnings, onWarning } = collect();

    const pr = await provider().fetchPullRequestByBranch('o/r', 'feat', 'opened', { onWarning });

    expect(pr).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'page-cap', source: 'list', target: 'o/r', branch: 'feat' });
  });

  test('a found PR whose fill fails warns request-failed/fill', async () => {
    stubForge({
      rest: (url) => (url.includes('head=') ? jsonResponse([listed(12, 'feat')]) : jsonResponse([])),
      graphql: () => failedFill(12)
    });
    const { warnings, onWarning } = collect();

    const pr = await provider().fetchPullRequestByBranch('o/r', 'feat', 'opened', { onWarning });

    expect(pr).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'fill',
      target: warningTarget('o/r', 12),
      branch: 'feat'
    });
  });

  test('a confirmed miss warns nothing', async () => {
    rest((url) => (url.includes('head=') ? jsonResponse([]) : jsonResponse(page(3, 1))));
    const { warnings, onWarning } = collect();

    const pr = await provider().fetchPullRequestByBranch('o/r', 'feat', 'opened', { onWarning });

    expect(pr).toBeNull();
    expect(warnings).toEqual([]);
  });

  test('a throwing onWarning is ignored', async () => {
    rest(() => jsonResponse({ message: 'Bad Gateway' }, 502));

    const pr = await provider().fetchPullRequestByBranch('o/r', 'feat', 'opened', {
      onWarning: () => {
        throw new Error('listener broke');
      }
    });

    expect(pr).toBeNull();
  });
});

describe('GitHubProvider.fetchPullRequestsByBranches warnings', () => {
  test('the batch warns fill for a found but unfilled PR and keeps null', async () => {
    batchStub(
      (branch) => (branch === 'a' ? 12 : branch === 'b' ? 7 : undefined),
      (numbers) => Object.fromEntries(numbers.map((n) => [n, nodeFor(n)])),
      (query) => (query.includes('p12:') ? failedFill(12, { p7: nodeFor(7) }) : undefined)
    );
    const { warnings, onWarning } = collect();

    const result = await provider().fetchPullRequestsByBranches('o/r', ['a', 'b', 'c'], 'opened', { onWarning });

    expect(result.get('a')).toBeNull();
    expect(result.get('b')?.iid).toBe(7);
    expect(result.get('c')).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'fill',
      target: warningTarget('o/r', 12),
      branch: 'a'
    });
  });

  test('the batch forwards a contexts warning with branch and keeps the PR', async () => {
    batchStub(
      (branch) => (branch === 'a' ? 1 : undefined),
      () => ({ 1: nodeWithMoreContexts(1) }),
      (query) => (query.includes('after:') ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined)
    );
    const { warnings, onWarning } = collect();

    const result = await provider().fetchPullRequestsByBranches('o/r', ['a'], 'opened', { onWarning });

    expect(result.get('a')?.pipeline?.status).toBe('pending');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'contexts',
      target: warningTarget('o/r', 1),
      branch: 'a'
    });
  });

  test('a throwing onWarning is ignored', async () => {
    batchStub(
      (branch) => (branch === 'a' ? 12 : undefined),
      () => ({}),
      () => failedFill(12)
    );

    const result = await provider().fetchPullRequestsByBranches('o/r', ['a'], 'opened', {
      onWarning: () => {
        throw new Error('listener broke');
      }
    });

    expect(result.get('a')).toBeNull();
  });
});

test('capability flags', () => {
  expect(provider().capabilities.canReportIncompleteBranchReads).toBe(true);
  expect(new GitLabProvider('https://gitlab.com', 'tok').capabilities.canReportIncompleteBranchReads).toBe(false);
});

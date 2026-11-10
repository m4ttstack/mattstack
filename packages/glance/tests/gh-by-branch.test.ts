/**
 * Unit tests for GitHubProvider.fetchPullRequestByBranch:
 *  - fork PR fallback when the head-filtered fast path (base-owner scoped)
 *    finds nothing
 *  - MRState -> GitHub `state` query param mapping
 *  - the 2-arg call shape still works (default state 'opened')
 *
 * `fetch` is stubbed (`stubForge`) so no network is involved: REST answers
 * the lookups, and the PR found is read through the GraphQL fill, whose
 * requested numbers are recorded.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { ForgeLogger } from '../src/logger.ts';
import { ghNode, jsonResponse, stubForge, useForgeStub } from './helpers/gh-fill-fixture.ts';

useForgeStub();

/**
 * Answers REST from `answer` and the fill with a node per number. Returns the
 * REST URLs seen and the numbers the fill was asked for.
 */
function stubRequest(answer: (url: string) => unknown): { calls: string[]; filled: number[] } {
  const calls: string[] = [];
  const filled: number[] = [];
  stubForge({
    rest: (url) => {
      if (url.includes('/rules/branches/')) return jsonResponse([]);
      calls.push(url);
      return jsonResponse(answer(url));
    },
    fill: (numbers) => {
      filled.push(...numbers);
      return Object.fromEntries(numbers.map((n) => [n, ghNode({ number: n })]));
    }
  });
  return { calls, filled };
}

let tokens = 0;

/**
 * A fresh token per provider: GraphQL POSTs share a throttling group keyed by
 * token with a real 1s spacing, and a token other files used carries their
 * backlog.
 */
function freshToken(): string {
  return `tok-by-branch-${++tokens}`;
}

function forkPR(number: number, headRef: string) {
  return {
    id: number,
    number,
    title: `PR ${number}`,
    body: null,
    state: 'open',
    draft: false,
    merged_at: null,
    html_url: `https://github.com/acme/repo/pull/${number}`,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    head: { sha: 'abc123', ref: headRef },
    base: { ref: 'main', repo: { id: 1, full_name: 'acme/repo' } },
    user: { id: 999, login: 'forker', avatar_url: '' },
    assignees: [],
    requested_reviewers: [],
    labels: []
  };
}

function nonMatchingPage(count: number, startId: number) {
  return Array.from({ length: count }, (_, i) => forkPR(startId + i, `unrelated-${startId + i}`));
}

function fakeLogger(): ForgeLogger & { calls: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> } {
  const calls: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
  return {
    calls,
    debug(msg, meta) {
      calls.push({ level: 'debug', msg, meta });
    },
    info(msg, meta) {
      calls.push({ level: 'info', msg, meta });
    },
    warn(msg, meta) {
      calls.push({ level: 'warn', msg, meta });
    },
    error(msg, meta) {
      calls.push({ level: 'error', msg, meta });
    }
  };
}

describe('GitHubProvider.fetchPullRequestByBranch', () => {
  test('falls back to listing + client-side head.ref match when the head-filtered query is empty (fork PR)', async () => {
    const provider = new GitHubProvider('https://github.com', freshToken());
    const fork = forkPR(42, 'feature/fork-branch');

    const { calls, filled } = stubRequest((path) => {
      if (path.includes('head=')) {
        return []; // fast path: no match (fork PR)
      }
      if (path.includes('/pulls?state=')) {
        return [forkPR(1, 'unrelated'), fork];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await provider.fetchPullRequestByBranch(
      'acme/repo',
      'feature/fork-branch'
    );

    expect(calls.some((c) => c.includes('head='))).toBe(true);
    expect(calls.some((c) => c.includes('/pulls?state='))).toBe(true);
    expect(filled).toEqual([42]);
    expect(result?.iid).toBe(42);
  });

  test("state 'merged' maps to state=closed in the fallback list request", async () => {
    const provider = new GitHubProvider('https://github.com', freshToken());

    const { calls } = stubRequest(() => []);

    await provider.fetchPullRequestByBranch('acme/repo', 'some-branch', 'merged');

    const headCall = calls.find((c) => c.includes('head='));
    const listCall = calls.find((c) => c.includes('/pulls?state='));
    expect(headCall).toBeDefined();
    expect(headCall).toContain('state=closed');
    expect(listCall).toBeDefined();
    expect(listCall).toContain('state=closed');
  });

  test('2-arg call still works: default state is opened -> state=open in the URL', async () => {
    const provider = new GitHubProvider('https://github.com', freshToken());

    const { calls } = stubRequest(() => []);

    await provider.fetchPullRequestByBranch('acme/repo', 'some-branch');

    const headCall = calls.find((c) => c.includes('head='));
    expect(headCall).toBeDefined();
    expect(headCall).toContain('state=open');
    expect(headCall).not.toContain('state=opened');
  });

  test('fallback paginates past page 1: a match on page 2 is found', async () => {
    const provider = new GitHubProvider('https://github.com', freshToken());
    const match = forkPR(9999, 'feature/deep-fork-branch');

    const { calls, filled } = stubRequest((path) => {
      if (path.includes('head=')) {
        return []; // fast path: no match
      }
      if (path.includes('page=2')) {
        return [...nonMatchingPage(5, 5000), match];
      }
      if (path.includes('/pulls?state=')) {
        // page 1 (or unspecified page=1): full page, no match -> forces page 2
        return nonMatchingPage(100, 1);
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await provider.fetchPullRequestByBranch(
      'acme/repo',
      'feature/deep-fork-branch'
    );

    const listCalls = calls.filter((c) => c.includes('/pulls?state='));
    expect(listCalls.some((c) => c.includes('page=2'))).toBe(true);
    expect(filled).toEqual([9999]);
    expect(result?.iid).toBe(9999);
  });

  test('fallback stops after 5 full pages with no match, returns null, and warns about the page limit', async () => {
    const logger = fakeLogger();
    const provider = new GitHubProvider('https://github.com', freshToken(), { logger });

    const { calls, filled } = stubRequest((path) => {
      if (path.includes('head=')) {
        return [];
      }
      if (path.includes('/pulls?state=')) {
        // Every page is a full, non-matching page of 100.
        return nonMatchingPage(100, 1);
      }
      throw new Error(`unexpected path: ${path}`);
    });


    const result = await provider.fetchPullRequestByBranch(
      'acme/repo',
      'never-found-branch'
    );

    const listCalls = calls.filter((c) => c.includes('/pulls?state='));
    expect(listCalls.length).toBe(5);
    expect(filled).toEqual([]);
    expect(result).toBeNull();

    const warnCall = logger.calls.find(
      (c) => c.level === 'warn' && c.msg.includes('fetchPullRequestByBranch: fallback scan hit page limit')
    );
    expect(warnCall).toBeDefined();
    expect(warnCall?.meta).toEqual({
      projectPath: 'acme/repo',
      sourceBranch: 'never-found-branch'
    });
  });
});

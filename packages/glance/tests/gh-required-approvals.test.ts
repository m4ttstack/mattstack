import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { RateLimitedError } from '../src/errors.ts';
import type { GHFillNode } from '../src/githubFill.ts';
import {
  ghNode,
  jsonResponse,
  stubForge,
  useForgeStub,
  useInstantTimers
} from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

const RULES_CACHE_MS = 600_000;

let providers = 0;

function provider(now?: () => number): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-rules-${++providers}`, { now });
}

/** No classic protection and an unmet review decision, so only the rulesets can answer. */
function unprotected(n: number, baseRefName = 'main'): GHFillNode {
  return ghNode({
    number: n,
    databaseId: 1000 + n,
    url: `https://github.com/o/r/pull/${n}`,
    baseRefName,
    reviewDecision: 'REVIEW_REQUIRED',
    baseRef: { branchProtectionRule: null },
    latestReviews: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] }
  });
}

const pullRequestRule = (count: number) => ({
  type: 'pull_request',
  parameters: { required_approving_review_count: count }
});

const rulesCalls = (urls: string[]) => urls.filter((u) => u.includes('/rules/branches/')).length;

describe('required approvals from rulesets', () => {
  test('largest pull_request rule wins', async () => {
    stubForge({
      fill: (numbers) => Object.fromEntries(numbers.map((n) => [n, unprotected(n)])),
      rest: (url) =>
        url.includes('/rules/branches/main')
          ? jsonResponse([pullRequestRule(1), pullRequestRule(3), { type: 'deletion' }])
          : undefined
    });

    const pr = await provider().fetchSingleMR('o/r', 1, null);

    expect(pr!.approvalsRequired).toBe(3);
  });

  test('the larger of classic protection and rulesets wins', async () => {
    stubForge({
      fill: () => ({
        1: ghNode({
          number: 1,
          baseRef: { branchProtectionRule: { requiredApprovingReviewCount: 2 } },
          reviewDecision: 'REVIEW_REQUIRED'
        })
      }),
      rest: (url) => (url.includes('/rules/branches/') ? jsonResponse([pullRequestRule(1)]) : undefined)
    });

    expect((await provider().fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBe(2);
  });

  test('no rules gives null', async () => {
    stubForge({
      fill: () => ({ 1: unprotected(1) }),
      rest: (url) => (url.includes('/rules/branches/') ? jsonResponse([{ type: 'deletion' }]) : undefined)
    });

    expect((await provider().fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBeNull();
  });

  test('cached for 10 minutes per repo and branch', async () => {
    let clock = 1_000_000;
    const { urls } = stubForge({
      fill: (numbers) =>
        Object.fromEntries(numbers.map((n) => [n, unprotected(n, n === 3 ? 'release' : 'main')])),
      rest: (url) => (url.includes('/rules/branches/') ? jsonResponse([pullRequestRule(2)]) : undefined)
    });
    const p = provider(() => clock);

    await p.fetchSingleMR('o/r', 1, null);
    await p.fetchSingleMR('o/r', 2, null);
    expect(rulesCalls(urls)).toBe(1);

    await p.fetchSingleMR('o/r', 3, null);
    expect(rulesCalls(urls)).toBe(2);

    clock += RULES_CACHE_MS - 1;
    await p.fetchSingleMR('o/r', 1, null);
    expect(rulesCalls(urls)).toBe(2);

    clock += 2;
    await p.fetchSingleMR('o/r', 1, null);
    expect(rulesCalls(urls)).toBe(3);
  });

  test('a batch asks once per distinct base branch', async () => {
    const { urls } = stubForge({
      fill: (numbers) =>
        Object.fromEntries(numbers.map((n) => [n, unprotected(n, n % 2 === 0 ? 'release' : 'main')])),
      rest: (url) => (url.includes('/rules/branches/') ? jsonResponse([pullRequestRule(1)]) : undefined)
    });

    const prs = await provider().fetchPullRequests({ projectPath: 'o/r', iids: [1, 2, 3, 4, 5] });

    expect(prs).toHaveLength(5);
    expect(rulesCalls(urls)).toBe(2);
  });

  test('a 403 or 404 is cached as null', async () => {
    for (const status of [403, 404]) {
      const { urls } = stubForge({
        fill: () => ({ 1: unprotected(1) }),
        rest: (url) =>
          url.includes('/rules/branches/') ? jsonResponse({ message: 'nope' }, status) : undefined
      });
      const p = provider();

      expect((await p.fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBeNull();
      expect((await p.fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBeNull();
      expect(rulesCalls(urls)).toBe(1);
    }
  });

  test('a 5xx is not cached', async () => {
    let healthy = false;
    const { urls } = stubForge({
      fill: () => ({ 1: unprotected(1) }),
      rest: (url) =>
        url.includes('/rules/branches/')
          ? healthy
            ? jsonResponse([pullRequestRule(2)])
            : jsonResponse({ message: 'Bad Gateway' }, 502)
          : undefined
    });
    const p = provider();

    expect((await p.fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBeNull();
    const failed = rulesCalls(urls);

    healthy = true;
    expect((await p.fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBe(2);
    expect(rulesCalls(urls)).toBeGreaterThan(failed);
  });

  test('a 502 costs exactly one rules request per fill, and the next fill tries again', async () => {
    const { urls } = stubForge({
      fill: () => ({ 1: unprotected(1) }),
      rest: (url) =>
        url.includes('/rules/branches/') ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined
    });
    const p = provider();

    expect((await p.fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBeNull();
    expect(rulesCalls(urls)).toBe(1);

    expect((await p.fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBeNull();
    expect(rulesCalls(urls)).toBe(2);
  });

  test('a transport failure is not cached and leaves the count null', async () => {
    let healthy = false;
    stubForge({ fill: () => ({ 1: unprotected(1) }) });
    const fill = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/rules/branches/')) {
        if (!healthy) throw new TypeError('fetch failed');
        return jsonResponse([pullRequestRule(2)]);
      }
      return fill(input, init);
    }) as typeof fetch;
    const p = provider();

    expect((await p.fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBeNull();
    healthy = true;
    expect((await p.fetchSingleMR('o/r', 1, null))!.approvalsRequired).toBe(2);
  });

  test('a rate-limited rules read throws RateLimitedError', async () => {
    stubForge({
      fill: () => ({ 1: unprotected(1) }),
      rest: (url) =>
        url.includes('/rules/branches/')
          ? jsonResponse({ message: 'API rate limit exceeded' }, 403, {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
            })
          : undefined
    });

    await expect(provider().fetchSingleMR('o/r', 1, null)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

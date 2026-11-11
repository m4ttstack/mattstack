import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { RateLimitedError } from '../src/errors.ts';
import { jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

let providers = 0;
function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-summaries-${++providers}`);
}

function node(n: number, over: Record<string, unknown> = {}) {
  return {
    number: n,
    title: `pr ${n}`,
    state: 'OPEN',
    merged: false,
    isDraft: false,
    headRefName: `feat/${n}`,
    baseRefName: 'main',
    author: { login: 'octo' },
    url: `https://github.com/o/r/pull/${n}`,
    mergedAt: null,
    ...over
  };
}

const nodes = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => node(from + i));

function listPage(items: unknown[], hasNextPage = false) {
  return { repository: { pullRequests: { nodes: items, pageInfo: { hasNextPage, endCursor: 'c1' } } } };
}

function searchPage(items: unknown[], hasNextPage = false) {
  return { search: { nodes: items, pageInfo: { hasNextPage, endCursor: 'c1' } } };
}

/** Records each GraphQL call's query text and variables. */
function capture(respond: (query: string, vars: Record<string, unknown>) => unknown) {
  const calls: Array<{ query: string; vars: Record<string, unknown> }> = [];
  stubForge({
    graphql: (query, vars) => {
      calls.push({ query, vars });
      return respond(query, vars);
    }
  });
  return calls;
}

describe('fetchPullRequestSummaries', () => {
  test('no author or search: list connection with state and branch variables', async () => {
    const calls = capture(() => listPage([node(1)]));
    const out = await provider().fetchPullRequestSummaries!('o/r', {
      state: 'opened',
      sourceBranch: 'feat/1',
      targetBranch: 'main',
      limit: 10
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain('pullRequests(');
    expect(calls[0]!.query).toContain('UPDATED_AT');
    expect(calls[0]!.vars).toMatchObject({
      owner: 'o',
      name: 'r',
      states: ['OPEN'],
      head: 'feat/1',
      base: 'main'
    });
    expect(out.rows[0]).toEqual({
      iid: 1,
      title: 'pr 1',
      state: 'opened',
      draft: false,
      sourceBranch: 'feat/1',
      targetBranch: 'main',
      author: 'octo',
      webUrl: 'https://github.com/o/r/pull/1',
      detailedMergeStatus: null,
      mergedAt: null
    });
  });

  test('state all sends every state; closed and merged send one each', async () => {
    const calls = capture(() => listPage([]));
    await provider().fetchPullRequestSummaries!('o/r', { state: 'all', limit: 5 });
    await provider().fetchPullRequestSummaries!('o/r', { state: 'closed', limit: 5 });
    await provider().fetchPullRequestSummaries!('o/r', { state: 'merged', limit: 5 });
    expect(calls.map((c) => c.vars.states)).toEqual([
      ['OPEN', 'CLOSED', 'MERGED'],
      ['CLOSED'],
      ['MERGED']
    ]);
  });

  test('a merged PR maps to merged with mergedAt', async () => {
    capture(() =>
      listPage([node(7, { state: 'MERGED', merged: true, mergedAt: '2026-01-03T00:00:00Z' })])
    );
    const out = await provider().fetchPullRequestSummaries!('o/r', { state: 'all', limit: 5 });
    expect(out.rows[0]).toMatchObject({ state: 'merged', mergedAt: '2026-01-03T00:00:00Z' });
  });

  test('a draft PR with no author and a closed state maps through', async () => {
    capture(() => listPage([node(2, { isDraft: true, author: null, state: 'CLOSED' })]));
    const out = await provider().fetchPullRequestSummaries!('o/r', { state: 'all', limit: 5 });
    expect(out.rows[0]).toMatchObject({ draft: true, author: null, state: 'closed' });
  });

  test('101 nodes with limit 100 returns 100 rows and truncated', async () => {
    capture(() => listPage(nodes(1, 101)));
    const out = await provider().fetchPullRequestSummaries!('o/r', { state: 'all', limit: 100 });
    expect(out.rows).toHaveLength(100);
    expect(out.truncated).toBe(true);
  });

  test('exactly limit rows with no next page is not truncated', async () => {
    capture(() => listPage(nodes(1, 100)));
    const out = await provider().fetchPullRequestSummaries!('o/r', { state: 'all', limit: 100 });
    expect(out.rows).toHaveLength(100);
    expect(out.truncated).toBe(false);
  });

  test('an empty author or search is absent: the list connection, no bare qualifier', async () => {
    const calls = capture(() => listPage([node(1)]));
    await provider().fetchPullRequestSummaries!('o/r', { state: 'opened', author: '', search: '', limit: 10 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain('pullRequests(');
    expect(calls[0]!.vars.q).toBeUndefined();
  });

  test('author "me" searches with @me and the state qualifier', async () => {
    const calls = capture(() => searchPage([node(1)]));
    await provider().fetchPullRequestSummaries!('o/r', {
      state: 'opened',
      author: 'me',
      sourceBranch: 'feat/1',
      targetBranch: 'main',
      limit: 10
    });
    expect(calls[0]!.query).toContain('search(');
    expect(calls[0]!.vars.q).toBe('repo:o/r is:pr is:open author:@me head:feat/1 base:main sort:updated-desc');
  });

  test('state qualifiers for closed, merged and all', async () => {
    const calls = capture(() => searchPage([]));
    for (const state of ['closed', 'merged', 'all'] as const) {
      await provider().fetchPullRequestSummaries!('o/r', { state, author: 'octo', limit: 5 });
    }
    expect(calls.map((c) => c.vars.q)).toEqual([
      'repo:o/r is:pr is:closed -is:merged author:octo sort:updated-desc',
      'repo:o/r is:pr is:merged author:octo sort:updated-desc',
      'repo:o/r is:pr author:octo sort:updated-desc'
    ]);
  });

  test('search text is a quoted phrase', async () => {
    const calls = capture(() => searchPage([]));
    await provider().fetchPullRequestSummaries!('o/r', { state: 'all', search: 'fix login', limit: 5 });
    expect(calls[0]!.vars.q).toBe('repo:o/r is:pr "fix login" sort:updated-desc');
  });

  test('a value with whitespace cannot add qualifiers', async () => {
    const calls = capture(() => searchPage([]));
    await provider().fetchPullRequestSummaries!('o/r', {
      state: 'all',
      author: 'bob label:secret',
      search: 'x is:closed',
      limit: 5
    });
    expect(calls[0]!.vars.q).toBe('repo:o/r is:pr author:"bob label:secret" "x is:closed" sort:updated-desc');
  });

  test('a value with a quote or backslash is rejected before any request', async () => {
    const calls = capture(() => searchPage([]));
    const bad = [
      { author: 'a" label:x' },
      { search: 'a" -label:x' },
      { author: 'x', sourceBranch: 'b"c' },
      { author: 'a\\' }
    ];
    for (const extra of bad) {
      await expect(
        provider().fetchPullRequestSummaries!('o/r', { state: 'all', limit: 5, ...extra })
      ).rejects.toThrow(/quote|backslash|newline/i);
    }
    expect(calls).toHaveLength(0);
  });

  test('search pages with the cursor until limit + 1', async () => {
    const calls = capture((_q, vars) =>
      vars.after ? searchPage(nodes(101, 50)) : searchPage(nodes(1, 100), true)
    );
    const out = await provider().fetchPullRequestSummaries!('o/r', {
      state: 'all',
      author: 'octo',
      limit: 120
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.vars.after).toBe('c1');
    expect(out.rows).toHaveLength(120);
    expect(out.truncated).toBe(true);
  });

  test('the page cap reached with more pages left is truncated', async () => {
    const calls = capture(() => listPage(nodes(1, 100), true));
    const out = await provider().fetchPullRequestSummaries!('o/r', { state: 'all', limit: 2000 });
    expect(calls).toHaveLength(20);
    expect(out.rows).toHaveLength(2000);
    expect(out.truncated).toBe(true);
  });

  test('search stopping at its 1000 ceiling with a larger issueCount is truncated', async () => {
    const calls = capture((_q, vars) => {
      const page = Number(String(vars.after ?? 'c0').slice(1));
      return { search: { issueCount: 1500, nodes: nodes(page * 100 + 1, 100), pageInfo: { hasNextPage: page < 9, endCursor: `c${page + 1}` } } };
    });
    const out = await provider().fetchPullRequestSummaries!('o/r', {
      state: 'all',
      author: 'octo',
      limit: 2000
    });
    expect(calls).toHaveLength(10);
    expect(out.rows).toHaveLength(1000);
    expect(out.truncated).toBe(true);
  });

  test('search whose issueCount equals the rows returned is complete', async () => {
    capture(() => ({ search: { issueCount: 3, nodes: nodes(1, 3), pageInfo: { hasNextPage: false, endCursor: null } } }));
    const out = await provider().fetchPullRequestSummaries!('o/r', { state: 'all', author: 'octo', limit: 50 });
    expect(out.truncated).toBe(false);
  });

  test('a GraphQL RATE_LIMITED error rejects with RateLimitedError', async () => {
    stubForge({
      graphql: () =>
        jsonResponse(
          { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] },
          200,
          {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600)
          }
        )
    });
    await expect(
      provider().fetchPullRequestSummaries!('o/r', { state: 'all', limit: 5 })
    ).rejects.toBeInstanceOf(RateLimitedError);
  });
});

/**
 * Unit tests for GitHubProvider.fetchPullRequests (MAT-13).
 *
 * The method used to take no parameter at all, so every FetchPullRequestsOptions
 * a caller passed was discarded and `is:open` was hardcoded. These cover each
 * option field: state (single and multi), iids, authorUsernames, projectPath,
 * updatedAfter, listWeight.
 *
 * Discovery (the `/pulls` listing and `/search/issues`) stays REST and every
 * PR's data comes from the batched GraphQL fill, so the stub answers both
 * through the real Octokit transport (`stubForge`): REST by path, the fill
 * by the PR numbers each query aliases.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { FetchPullRequestsWarning } from '../src/GitProvider.ts';
import { warningTarget } from '../src/GitProvider.ts';
import { fetchDashboardBatch } from '../src/MRDashboard.ts';
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

const API = 'https://api.github.com';

let tokens = 0;

/**
 * A fresh token per provider: GraphQL POSTs and searches share throttling
 * groups keyed by token, and a token other tests used carries their backlog.
 */
function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-fetch-prs-${++tokens}`);
}

type FakePR = ReturnType<typeof ghPR>;

function ghPR(
  number: number,
  over: Partial<{
    state: string;
    merged_at: string | null;
    updated_at: string;
    login: string;
    base: {
      ref: string;
      repo: { id: number; full_name: string; default_branch?: string };
    };
  }> = {}
) {
  return {
    number,
    state: over.state ?? 'open',
    merged_at: over.merged_at ?? null,
    updated_at: over.updated_at ?? '2026-07-10T00:00:00Z',
    login: over.login ?? 'octocat',
    base: over.base ?? { ref: 'main', repo: { id: 1, full_name: 'acme/repo', default_branch: 'main' } }
  };
}

/** The `/pulls` listing entry for `pr`: only what discovery reads. */
function listed(pr: FakePR) {
  return {
    number: pr.number,
    state: pr.state,
    merged_at: pr.merged_at,
    updated_at: pr.updated_at,
    base: pr.base
  };
}

function searchItem(pr: FakePR) {
  return {
    number: pr.number,
    state: pr.state,
    updated_at: pr.updated_at,
    repository_url: `${API}/repos/acme/repo`,
    pull_request: { url: '', merged_at: pr.merged_at }
  };
}

/** The fill node GitHub would answer for `pr`. */
function nodeOf(pr: FakePR): GHFillNode {
  return ghNode({
    number: pr.number,
    databaseId: pr.number * 10,
    url: `https://github.com/acme/repo/pull/${pr.number}`,
    state: pr.merged_at ? 'MERGED' : pr.state === 'open' ? 'OPEN' : 'CLOSED',
    mergedAt: pr.merged_at,
    updatedAt: pr.updated_at,
    baseRefName: pr.base.ref,
    baseRepository: {
      databaseId: pr.base.repo.id,
      nameWithOwner: pr.base.repo.full_name,
      defaultBranchRef: pr.base.repo.default_branch ? { name: pr.base.repo.default_branch } : null
    },
    author: { __typename: 'User', login: pr.login, avatarUrl: null, databaseId: 999, name: null }
  });
}

/** `/repos/...` and `/search/...` paths, the way the assertions read them. */
function pathsOf(urls: string[]): string[] {
  return urls.filter((u) => u.startsWith(API) && !u.endsWith('/graphql')).map((u) => u.slice(API.length));
}

/**
 * Route discovery at `prs` and the fill at their nodes. Search returns every
 * PR on page 1 regardless of qualifiers, so the client-side filtering is what
 * the state assertions actually exercise.
 */
function install(
  prs: FakePR[],
  over: { searchPage?: (page: number) => unknown[]; listPage?: (page: number) => unknown[] } = {}
): { calls: string[]; filled: number[][] } {
  const filled: number[][] = [];
  const pageOf = (url: string) => Number(new URL(url).searchParams.get('page') ?? '1');
  const { urls } = stubForge({
    rest: (url) => {
      if (url.includes('/search/issues')) {
        const page = pageOf(url);
        return jsonResponse({
          items: over.searchPage ? over.searchPage(page) : page === 1 ? prs.map(searchItem) : []
        });
      }
      if (/\/repos\/[^/]+\/[^/]+\/pulls\?/.test(url)) {
        const page = pageOf(url);
        return jsonResponse(over.listPage ? over.listPage(page) : page === 1 ? prs.map(listed) : []);
      }
      return undefined;
    },
    fill: (numbers) => {
      filled.push(numbers);
      const out: Record<number, GHFillNode | null> = {};
      for (const n of numbers) {
        const pr = prs.find((p) => p.number === n);
        if (pr) out[n] = nodeOf(pr);
      }
      return out;
    }
  });
  return { calls: urls, filled };
}

function searchQueries(calls: string[]): string[] {
  return pathsOf(calls)
    .filter((c) => c.startsWith('/search/issues'))
    .map((c) => decodeURIComponent(c));
}

describe('GitHubProvider.fetchPullRequests: state', () => {
  test('no options: open PRs only, is:open on every search', async () => {
    const { calls } = install([ghPR(1)]);

    const prs = await provider().fetchPullRequests();

    expect(prs.map((p) => p.iid)).toEqual([1]);
    const queries = searchQueries(calls);
    expect(queries.length).toBe(4);
    expect(queries.every((q) => q.includes('is:open is:pr'))).toBe(true);
  });

  test("state 'merged' searches is:closed and drops closed-unmerged PRs", async () => {
    const merged = ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' });
    const closed = ghPR(3, { state: 'closed' });
    const { calls } = install([merged, closed]);

    const prs = await provider().fetchPullRequests({ state: 'merged' });

    expect(prs.map((p) => p.iid)).toEqual([2]);
    expect(prs[0]?.state).toBe('merged');
    expect(searchQueries(calls).every((q) => q.includes('is:closed'))).toBe(true);
  });

  test("state ['opened','merged'] runs one search per qualifier, never an unqualified one", async () => {
    const open = ghPR(1);
    const merged = ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' });
    const closed = ghPR(3, { state: 'closed' });
    const { calls } = install([open, merged, closed]);

    const prs = await provider().fetchPullRequests({ state: ['opened', 'merged'] });

    expect(prs.map((p) => p.iid).sort()).toEqual([1, 2]);
    expect(prs.find((p) => p.iid === 2)?.state).toBe('merged');

    // `is:open is:closed` would AND to nothing, so the two states are two
    // searches. Dropping the qualifier instead (what this used to do) matches
    // every PR the user ever authored, all time.
    const queries = searchQueries(calls);
    expect(queries.length).toBe(8);
    expect(queries.filter((q) => q.includes('is:open is:pr')).length).toBe(4);
    expect(queries.filter((q) => q.includes('is:closed is:pr')).length).toBe(4);
    expect(queries.every((q) => q.includes('is:open') || q.includes('is:closed'))).toBe(true);
    for (const involvement of ['author:@me', 'review-requested:@me', 'reviewed-by:@me', 'assignee:@me']) {
      expect(queries.filter((q) => q.includes(involvement)).length).toBe(2);
    }
  });

  test('a closed-unmerged PR is excluded from a merged-only request', async () => {
    install([ghPR(3, { state: 'closed' })]);

    expect(await provider().fetchPullRequests({ state: 'merged' })).toEqual([]);
    expect(
      (await provider().fetchPullRequests({ state: 'closed' })).map((p) => p.iid)
    ).toEqual([3]);
  });
});

describe('GitHubProvider.fetchPullRequests: repository modes', () => {
  test('iids + projectPath fills those PRs by number and skips search', async () => {
    const { calls, filled } = install([ghPR(7)]);

    const prs = await provider().fetchPullRequests({
      iids: [7],
      projectPath: 'acme/repo'
    });

    expect(prs.map((p) => p.iid)).toEqual([7]);
    expect(calls.some((u) => u.includes('/search/'))).toBe(false);
    expect(filled).toEqual([[7]]);
  });

  test('an empty iids list asks for nothing, not for the whole repository', async () => {
    const { calls } = install([ghPR(1)]);

    const prs = await provider().fetchPullRequests({
      iids: [],
      projectPath: 'acme/repo'
    });

    expect(prs).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('iids without projectPath throws instead of silently ignoring it', async () => {
    install([ghPR(1)]);

    await expect(provider().fetchPullRequests({ iids: [1] })).rejects.toThrow(
      /`iids` requires `projectPath`/
    );
  });

  test('authorUsernames + projectPath searches once per author', async () => {
    const { calls } = install([ghPR(1)]);

    const prs = await provider().fetchPullRequests({
      authorUsernames: ['ada', 'grace'],
      projectPath: 'acme/repo'
    });

    // Both searches return PR 1; the result is deduped.
    expect(prs.map((p) => p.iid)).toEqual([1]);
    const queries = searchQueries(calls);
    expect(queries.length).toBe(2);
    expect(queries.some((q) => q.includes('repo:acme/repo author:ada'))).toBe(true);
    expect(queries.some((q) => q.includes('repo:acme/repo author:grace'))).toBe(true);
  });

  test('authorUsernames without projectPath throws', async () => {
    install([ghPR(1)]);

    await expect(
      provider().fetchPullRequests({ authorUsernames: ['ada'] })
    ).rejects.toThrow(/`authorUsernames` requires `projectPath`/);
  });

  test('projectPath alone lists the repository instead of searching', async () => {
    const { calls } = install([ghPR(1), ghPR(2)]);

    const prs = await provider().fetchPullRequests({ projectPath: 'acme/repo' });

    expect(prs.map((p) => p.iid)).toEqual([1, 2]);
    expect(searchQueries(calls)).toEqual([]);
    const listCall = pathsOf(calls).find((c) => c.startsWith('/repos/acme/repo/pulls?'));
    expect(listCall).toContain('state=open');
    expect(listCall).toContain('per_page=100');
  });

  test('projectPath with multiple states lists state=all', async () => {
    const { calls } = install([
      ghPR(1),
      ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' })
    ]);

    const prs = await provider().fetchPullRequests({
      projectPath: 'acme/repo',
      state: ['opened', 'merged']
    });

    expect(prs.map((p) => p.iid)).toEqual([1, 2]);
    expect(pathsOf(calls).find((c) => c.startsWith('/repos/acme/repo/pulls?'))).toContain(
      'state=all'
    );
  });

  test('excludeTargetBranches drops PRs into the listed base branches', async () => {
    const deploy = { ref: 'deployments/qa', repo: { id: 1, full_name: 'acme/repo', default_branch: 'main' } };
    install([ghPR(1), ghPR(2, { base: deploy })]);

    const prs = await provider().fetchPullRequests({
      projectPath: 'acme/repo',
      excludeTargetBranches: ['deployments/qa']
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
  });

  test('excludeTargetBranches applies to the author mode too', async () => {
    const deploy = { ref: 'deployments/qa', repo: { id: 1, full_name: 'acme/repo', default_branch: 'main' } };
    install([ghPR(1), ghPR(2, { base: deploy })]);

    const prs = await provider().fetchPullRequests({
      projectPath: 'acme/repo',
      authorUsernames: ['octocat'],
      excludeTargetBranches: ['deployments/qa']
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
  });
});

describe('GitHubProvider.fetchPullRequests: updatedAfter and listWeight', () => {
  test('updatedAfter drops older PRs and narrows the search', async () => {
    const fresh = ghPR(1, { updated_at: '2026-07-20T00:00:00Z' });
    const stale = ghPR(2, { updated_at: '2026-06-01T00:00:00Z' });
    const { calls } = install([fresh, stale]);

    const prs = await provider().fetchPullRequests({
      updatedAfter: '2026-07-15T00:00:00Z'
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(searchQueries(calls).every((q) => q.includes('updated:>=2026-07-15'))).toBe(true);
  });

  test('updatedAfter stops the listing at the first full page that ends before the cutoff', async () => {
    // Every page is full, so only the early stop ends the walk before the cap.
    const updated = (page: number) => (page === 1 ? '2026-07-20T00:00:00Z' : '2026-06-01T00:00:00Z');
    const { calls, filled } = install([], {
      listPage: (page) =>
        Array.from({ length: 100 }, (_, i) =>
          listed(ghPR(page * 1000 + i, { updated_at: updated(page) }))
        )
    });

    await provider().fetchPullRequests({
      projectPath: 'acme/repo',
      updatedAfter: '2026-07-15T00:00:00Z'
    });

    const pages = pathsOf(calls).filter((c) => c.startsWith('/repos/acme/repo/pulls?'));
    expect(pages.length).toBe(2);
    expect(filled.flat()).toHaveLength(100);
  });

  test('a non-ISO updatedAfter is rejected rather than ignored', async () => {
    install([ghPR(1)]);

    await expect(provider().fetchPullRequests({ updatedAfter: 'last tuesday' })).rejects.toThrow(
      /updatedAfter must be an ISO-8601 instant/
    );
  });

  test('listWeight keeps the checks and drops only the body', async () => {
    let query = '';
    stubForge({
      rest: (url) => (url.includes('/search/issues') ? jsonResponse({ items: [searchItem(ghPR(1))] }) : undefined),
      fill: (_numbers, q) => {
        query = q;
        return { 1: nodeOf(ghPR(1)) };
      }
    });

    const prs = await provider().fetchPullRequests({ listWeight: true });

    expect(prs[0]?.pipeline).not.toBeNull();
    expect(query).not.toMatch(/\bbody\b/);
  });

  test('without listWeight the fill reads the body too', async () => {
    let query = '';
    stubForge({
      rest: (url) => (url.includes('/search/issues') ? jsonResponse({ items: [searchItem(ghPR(1))] }) : undefined),
      fill: (_numbers, q) => {
        query = q;
        return { 1: nodeOf(ghPR(1)) };
      }
    });

    const prs = await provider().fetchPullRequests();

    expect(prs[0]?.description).toBe('Body');
    expect(query).toMatch(/\bbody\b/);
  });
});

describe('GitHubProvider.fetchPullRequests: request cost', () => {
  test('a PR that every involvement search matches is filled once', async () => {
    // `install` answers every search with every PR, so all four involvement
    // searches match all three PRs: 12 hits, 3 unique.
    const { filled } = install([ghPR(1), ghPR(2), ghPR(3)]);

    const prs = await provider().fetchPullRequests();

    expect(prs.map((p) => p.iid).sort()).toEqual([1, 2, 3]);
    expect(filled).toEqual([[1, 2, 3]]);
  });

  test('roles still accumulate across the searches the dedupe collapsed', async () => {
    install([ghPR(1)]);

    const prs = await provider().fetchPullRequests();

    expect(prs[0]?.roles.sort()).toEqual(['assignee', 'author', 'reviewer']);
  });

  test('a mixed-state request still fills each unique PR once', async () => {
    const open = ghPR(1);
    const merged = ghPR(2, { state: 'closed', merged_at: '2026-07-09T00:00:00Z' });
    const { calls, filled } = install([open, merged]);

    await provider().fetchPullRequests({ state: ['opened', 'merged'] });

    // 8 searches over 2 matching PRs, and one fill naming each once.
    expect(searchQueries(calls).length).toBe(8);
    expect(filled).toEqual([[1, 2]]);
  });

  test('authorUsernames dedupes across authors before the fill', async () => {
    const { calls, filled } = install([ghPR(1), ghPR(2)]);

    const prs = await provider().fetchPullRequests({
      authorUsernames: ['ada', 'grace', 'linus'],
      projectPath: 'acme/repo'
    });

    expect(prs.map((p) => p.iid)).toEqual([1, 2]);
    expect(searchQueries(calls).length).toBe(3);
    expect(filled).toEqual([[1, 2]]);
  });
});

/** Searches that never run out: every page is a full 100 items cycling `prs`. */
function installFullSearchPages(prs: FakePR[]): { calls: string[] } {
  return install(prs, {
    searchPage: () => Array.from({ length: 100 }, (_, i) => searchItem(prs[i % prs.length]!))
  });
}

describe('GitHubProvider.fetchPullRequests: truncation and failures are observable', () => {
  test('the search page cap reaches the caller, not just the logger', async () => {
    const { calls } = installFullSearchPages([ghPR(1), ghPR(2)]);
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      onWarning: (w) => warnings.push(w)
    });

    // 4 involvement searches, 5 pages each, and the same 2 PRs throughout.
    expect(searchQueries(calls).length).toBe(20);
    expect(prs.map((p) => p.iid)).toEqual([1, 2]);

    const capped = warnings.filter((w) => w.kind === 'page-cap');
    expect(capped.length).toBe(4);
    expect(capped[0]?.source).toBe('search');
    expect(capped[0]?.message).toContain('5-page cap');
  });

  test('a quiet fetch means nothing was truncated', async () => {
    install([ghPR(1)]);
    const warnings: FetchPullRequestsWarning[] = [];

    await provider().fetchPullRequests({ onWarning: (w) => warnings.push(w) });

    expect(warnings).toEqual([]);
  });

  test('the repository listing page cap reaches the caller', async () => {
    // One open PR per page and 99 closed ones: the walk continues because
    // the page is full, not because the caller wanted more.
    const pagePRs = (page: number) => [
      ghPR(page * 1000),
      ...Array.from({ length: 99 }, (_, i) => ghPR(page * 1000 + i + 1, { state: 'closed' }))
    ];
    const open = Array.from({ length: 20 }, (_, i) => ghPR((i + 1) * 1000));
    const { calls } = install(open, { listPage: (page) => pagePRs(page).map(listed) });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      projectPath: 'acme/repo',
      onWarning: (w) => warnings.push(w)
    });

    expect(pathsOf(calls).filter((c) => c.startsWith('/repos/acme/repo/pulls?')).length).toBe(20);
    expect(prs.length).toBe(20);
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.kind).toBe('page-cap');
    expect(warnings[0]?.source).toBe('list');
    expect(warnings[0]?.target).toBe('acme/repo');
  });

  test('a PR whose fill failed is reported instead of vanishing, and the others stay', async () => {
    stubForge({
      rest: (url) =>
        url.includes('/search/issues')
          ? jsonResponse({ items: [searchItem(ghPR(1)), searchItem(ghPR(2))] })
          : undefined,
      graphql: () =>
        jsonResponse({
          data: { repository: { p1: nodeOf(ghPR(1)), p2: null } },
          errors: [{ type: 'INTERNAL', path: ['repository', 'p2'], message: 'Something went wrong' }]
        })
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      onWarning: (w) => warnings.push(w)
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'fill',
      target: warningTarget('acme/repo', 2)
    });
  });

  test('a whole failed fill batch warns once per PR, with the status', async () => {
    stubForge({
      rest: (url) =>
        url.includes('/search/issues')
          ? jsonResponse({ items: [searchItem(ghPR(1)), searchItem(ghPR(2))] })
          : undefined,
      graphql: () => jsonResponse({ message: 'Bad Gateway' }, 502)
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      onWarning: (w) => warnings.push(w)
    });

    expect(prs).toEqual([]);
    expect(warnings.map((w) => [w.source, w.status, w.target])).toEqual([
      ['fill', 502, 'acme/repo#1'],
      ['fill', 502, 'acme/repo#2']
    ]);
  });

  test('an unread checks page keeps the PR, pending, and says so', async () => {
    const node2 = nodeOf(ghPR(2));
    node2.commits.nodes[0]!.commit.statusCheckRollup!.contexts.pageInfo = {
      hasNextPage: true,
      endCursor: 'CUR'
    };
    stubForge({
      rest: (url) =>
        url.includes('/search/issues')
          ? jsonResponse({ items: [searchItem(ghPR(1)), searchItem(ghPR(2))] })
          : undefined,
      graphql: (query) => (query.includes('after:') ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined),
      fill: () => ({ 1: nodeOf(ghPR(1)), 2: node2 })
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      onWarning: (w) => warnings.push(w)
    });

    expect(prs.map((p) => p.iid).sort()).toEqual([1, 2]);
    expect(prs.find((p) => p.iid === 2)?.pipeline?.status).toBe('pending');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'request-failed',
      source: 'contexts',
      target: warningTarget('acme/repo', 2)
    });
  });

  test('a PR GitHub says is gone is not reported as a failure', async () => {
    // Search matches PR 9, which the fill answers with a null alias.
    install([ghPR(1)], { searchPage: (page) => (page === 1 ? [searchItem(ghPR(9))] : []) });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      onWarning: (w) => warnings.push(w)
    });

    expect(prs).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('an onWarning that throws does not fail the fetch', async () => {
    installFullSearchPages([ghPR(1)]);

    const prs = await provider().fetchPullRequests({
      onWarning: () => {
        throw new Error('consumer bug');
      }
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
  });
});

/**
 * MAT-143 review round 4: `MRDashboard.ts`'s `fetchDashboardBatch` is the
 * only real consumer of `FetchPullRequestsWarning.target`, and every test
 * that had verified a warning reaches it up to this point did so against a
 * hand-rolled fake `GitProvider` whose fixtures had to invent a `target`
 * shape by hand. For `checks`, that invented shape (`owner/repo#number`)
 * happened to be the correct one -- but the real `fetchCheckRuns` at the
 * time emitted `owner/repo@sha`, a value that can never match
 * `fetchDashboardBatch`'s lookup, and no test caught it because none of
 * them drove the real provider through the real consumer together. These
 * do: a real `GitHubProvider`, stubbed only at the transport seam this file
 * already uses, piped straight into `fetchDashboardBatch`, with no fixture
 * standing in for either side's actual `target`.
 */
describe('fetchDashboardBatch against the real GitHubProvider, not a fake (MAT-143 review round 4)', () => {
  /** PR 2 has more than 100 checks, so its second page is a separate request. */
  function moreChecks(n: number) {
    return ghNode({
      number: n,
      commits: {
        nodes: [
          {
            commit: {
              oid: 'abc123',
              statusCheckRollup: {
                state: 'SUCCESS',
                contexts: {
                  totalCount: 101,
                  pageInfo: { hasNextPage: true, endCursor: 'CUR' },
                  nodes: []
                }
              }
            }
          }
        ]
      }
    });
  }

  test('a real contexts failure lands in `degraded`, keyed by the target GitHubProvider actually emits', async () => {
    stubForge({
      graphql: (query) =>
        query.includes('after:') ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined,
      fill: () => ({ 1: ghNode({ number: 1 }), 2: moreChecks(2) })
    });

    const { prs, degraded } = await fetchDashboardBatch(provider(), 'acme/repo', [1, 2]);

    // Present, not dropped: an unread checks page leaves the pipeline
    // pending, it does not exclude the PR the way a failed fill does.
    expect(prs.has(2)).toBe(true);
    expect(degraded.get(2)?.source).toBe('contexts');
    expect(degraded.has(1)).toBe(false);
  });

  test('a real fill failure drops the PR from `prs` but still lands in `degraded`', async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p1: ghNode({ number: 1 }), p2: null } },
          errors: [{ type: 'INTERNAL', path: ['repository', 'p2'], message: 'Something went wrong' }]
        })
    });

    const { prs, degraded } = await fetchDashboardBatch(provider(), 'acme/repo', [1, 2]);

    expect(prs.has(1)).toBe(true);
    expect(prs.has(2)).toBe(false);
    expect(degraded.get(2)?.source).toBe('fill');
  });
});

describe('GitHubProvider.fetchPullRequests: isStacked', () => {
  test('isStacked derives from the base branch vs the default branch', async () => {
    const stacked = ghPR(7, {
      base: {
        ref: 'feat-parent',
        repo: { id: 1, full_name: 'acme/repo', default_branch: 'main' }
      }
    });
    const plain = ghPR(8);
    const missingDefaultBranch = ghPR(9, {
      base: { ref: 'feat-x', repo: { id: 1, full_name: 'acme/repo' } }
    });
    install([stacked, plain, missingDefaultBranch]);

    const prs = await provider().fetchPullRequests({});

    expect(prs.find((p) => p.iid === 7)?.isStacked).toBe(true);
    expect(prs.find((p) => p.iid === 8)?.isStacked).toBe(false);
    expect(prs.find((p) => p.iid === 9)?.isStacked).toBe(false);
  });
});

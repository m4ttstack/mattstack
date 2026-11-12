import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { GHFillContext, GHFillNode } from '../src/githubFill.ts';
import type { RequestInfo } from '../src/instrumentation.ts';
import { isMergeContextQuery, mergeContextData } from './helpers/gh-merge-context.ts';
import {
  ghNode,
  jsonResponse,
  stubForge,
  useForgeStub,
  useInstantTimers
} from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

/** Request counts are a contract: the daemon runs these reads on a loop. */
let providers = 0;

/**
 * A fresh token per provider: GraphQL POSTs share a throttling group keyed by
 * token with a real 1s spacing, and a token other files used carries their
 * backlog.
 */
function counted(): { provider: GitHubProvider; requests: RequestInfo[] } {
  const requests: RequestInfo[] = [];
  const provider = new GitHubProvider('https://github.com', `tok-cost-${++providers}`, {
    onRequest: (info) => requests.push(info)
  });
  return { provider, requests };
}

function byTransport(requests: RequestInfo[]): { graphql: number; rest: number } {
  return {
    graphql: requests.filter((r) => r.transport === 'graphql').length,
    rest: requests.filter((r) => r.transport === 'rest').length
  };
}

/** REST split by what it was for, so a stray per-PR call shows up as `other`. */
function byKind(requests: RequestInfo[]): Record<'graphql' | 'list' | 'search' | 'rules' | 'other', number> {
  const out = { graphql: 0, list: 0, search: 0, rules: 0, other: 0 };
  for (const r of requests) {
    if (r.transport === 'graphql') out.graphql++;
    else if (r.path.includes('/search/issues')) out.search++;
    else if (r.path.includes('/rules/branches/')) out.rules++;
    else if (/\/pulls\?/.test(r.path)) out.list++;
    else out.other++;
  }
  return out;
}

function listed(n: number) {
  return {
    number: n,
    state: 'open',
    merged_at: null,
    updated_at: '2026-01-02T00:00:00Z',
    base: { ref: 'main', repo: { id: 500, full_name: 'o/r', default_branch: 'main' } }
  };
}

function hits(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    state: 'open',
    updated_at: '2026-01-02T00:00:00Z',
    repository_url: 'https://api.github.com/repos/o/r',
    pull_request: { url: '', merged_at: null }
  }));
}

function nodeFor(n: number, over: Parameters<typeof ghNode>[0] = {}): GHFillNode {
  return ghNode({ number: n, databaseId: 1000 + n, url: `https://github.com/o/r/pull/${n}`, ...over });
}

const allNodes = (numbers: number[]) => Object.fromEntries(numbers.map((n) => [n, nodeFor(n)]));

/** The ruleset lookup is answered empty so it can be counted. */
const rules = (url: string) => (url.includes('/rules/branches/') ? jsonResponse([]) : undefined);

function checkRun(id: number): GHFillContext {
  return {
    __typename: 'CheckRun',
    databaseId: id,
    name: `check-${id}`,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    startedAt: null,
    completedAt: null,
    detailsUrl: null,
    isRequired: true,
    checkSuite: null
  };
}

describe('GitHub read cost', () => {
  test('fetchSingleMR: 1 GraphQL + 1 REST cold, 1 GraphQL warm', async () => {
    stubForge({ fill: allNodes, rest: rules });
    const { provider, requests } = counted();

    expect(await provider.fetchSingleMR('o/r', 1, null)).not.toBeNull();
    expect(byTransport(requests)).toEqual({ graphql: 1, rest: 1 });

    requests.length = 0;
    expect(await provider.fetchSingleMR('o/r', 1, null)).not.toBeNull();
    expect(byTransport(requests)).toEqual({ graphql: 1, rest: 0 });
  });

  test('iids x20: 1 GraphQL + 1 REST', async () => {
    stubForge({ fill: allNodes, rest: rules });
    const { provider, requests } = counted();
    const iids = Array.from({ length: 20 }, (_, i) => i + 1);

    const prs = await provider.fetchPullRequests({ projectPath: 'o/r', iids });

    expect(prs).toHaveLength(20);
    expect(byTransport(requests)).toEqual({ graphql: 1, rest: 1 });
  });

  test('byBranches x20: 2 GraphQL + 1 REST', async () => {
    const branches = Array.from({ length: 20 }, (_, i) => `feat/${i + 1}`);
    stubForge({
      graphql: (query, variables) => {
        if (!query.includes('GlancePullRequestsByBranches')) return undefined;
        const repository: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(variables)) {
          if (!/^h\d+$/.test(k)) continue;
          repository[`b${k.slice(1)}`] = { nodes: [{ number: Number(String(v).slice(5)) }] };
        }
        return { repository };
      },
      fill: allNodes,
      rest: rules
    });
    const { provider, requests } = counted();

    const map = await provider.fetchPullRequestsByBranches!('o/r', branches);

    expect([...map.values()].filter((v) => v !== null)).toHaveLength(20);
    expect(byTransport(requests)).toEqual({ graphql: 2, rest: 1 });
  });

  test('byBranch: 2 REST + 1 GraphQL', async () => {
    stubForge({
      rest: (url) =>
        url.includes('/pulls?head=') ? jsonResponse([{ number: 5, head: { ref: 'feature' } }]) : rules(url),
      fill: allNodes
    });
    const { provider, requests } = counted();

    expect(await provider.fetchPullRequestByBranch('o/r', 'feature')).not.toBeNull();

    expect(byTransport(requests)).toEqual({ graphql: 1, rest: 2 });
  });

  for (const listWeight of [false, true]) {
    test(`project list: 1 REST page + 1 GraphQL for 20 PRs, at listWeight ${listWeight}`, async () => {
      const listing = Array.from({ length: 20 }, (_, i) => listed(i + 1));
      stubForge({
        rest: (url) => (url.includes('/repos/o/r/pulls?') ? jsonResponse(listing) : rules(url)),
        fill: allNodes
      });
      const { provider, requests } = counted();

      const prs = await provider.fetchPullRequests({ projectPath: 'o/r', listWeight });

      expect(prs).toHaveLength(20);
      expect(prs.every((pr) => pr.pipeline !== null)).toBe(true);
      expect(byKind(requests)).toEqual({ graphql: 1, list: 1, search: 0, rules: 1, other: 0 });
    });
  }

  test('authorUsernames x20: 1 search page + 1 GraphQL', async () => {
    stubForge({
      rest: (url) => (url.includes('/search/issues') ? jsonResponse({ items: hits(20) }) : rules(url)),
      fill: allNodes
    });
    const { provider, requests } = counted();

    const prs = await provider.fetchPullRequests({ projectPath: 'o/r', authorUsernames: ['ada'] });

    expect(prs).toHaveLength(20);
    expect(byKind(requests)).toEqual({ graphql: 1, list: 0, search: 1, rules: 1, other: 0 });
  });

  test('involvement x20 in one repo: 4 search pages + 1 GraphQL', async () => {
    stubForge({
      rest: (url) => (url.includes('/search/issues') ? jsonResponse({ items: hits(20) }) : rules(url)),
      fill: allNodes
    });
    const { provider, requests } = counted();

    const prs = await provider.fetchPullRequests();

    expect(prs).toHaveLength(20);
    expect(byKind(requests)).toEqual({ graphql: 1, list: 0, search: 4, rules: 1, other: 0 });
  });

  test('requestReReview with no usernames: 1 GraphQL + the POST, no rulesets read', async () => {
    stubForge({
      rest: (url, method) =>
        method === 'POST' && url.endsWith('/requested_reviewers') ? jsonResponse({}) : rules(url),
      fill: allNodes
    });
    const { provider, requests } = counted();

    await provider.requestReReview('o/r', 1);

    expect(byKind(requests)).toEqual({ graphql: 1, list: 0, search: 0, rules: 0, other: 1 });
  });

  const threadsAnswer = (query: string) =>
    query.includes('GlancePullRequestThreads')
      ? {
          repository: {
            pullRequest: {
              reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] }
            }
          }
        }
      : undefined;

  test('fetchMRDiscussions with one review comment: 4 REST + 1 GraphQL', async () => {
    const reviewComment = {
      id: 1,
      body: 'b',
      user: { id: 7, login: 'ada', name: null, avatar_url: null, type: 'User' },
      created_at: '2026-01-01T00:00:00Z',
      path: 'a.ts',
      line: 1,
      side: 'RIGHT'
    };
    stubForge({
      graphql: threadsAnswer,
      rest: (url) => jsonResponse(url.includes('/pulls/1/comments') ? [reviewComment] : [])
    });
    const { provider, requests } = counted();

    await provider.fetchMRDiscussions('github:o/r', 1);

    expect(byTransport(requests)).toEqual({ graphql: 1, rest: 4 });
  });

  test('fetchMRDiscussions with no review comments: 3 REST, no GraphQL', async () => {
    stubForge({ graphql: threadsAnswer, rest: () => jsonResponse([]) });
    const { provider, requests } = counted();

    await provider.fetchMRDiscussions('github:o/r', 1);

    expect(byTransport(requests)).toEqual({ graphql: 0, rest: 3 });
  });

  test('150 contexts: 2 GraphQL + 1 REST', async () => {
    const first = Array.from({ length: 100 }, (_, i) => checkRun(i + 1));
    const rest = Array.from({ length: 50 }, (_, i) => checkRun(i + 101));
    const page = (nodes: GHFillContext[], hasNextPage: boolean) => ({
      totalCount: 150,
      pageInfo: { hasNextPage, endCursor: hasNextPage ? 'CUR1' : null },
      nodes
    });
    stubForge({
      graphql: (query) =>
        query.includes('after:')
          ? {
              repository: {
                p1: { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: page(rest, false) } } }] } }
              }
            }
          : undefined,
      fill: () => ({
        1: nodeFor(1, {
          commits: {
            nodes: [{ commit: { oid: 'abc123', statusCheckRollup: { state: 'SUCCESS', contexts: page(first, true) } } }]
          }
        })
      }),
      rest: rules
    });
    const { provider, requests } = counted();

    const pr = await provider.fetchSingleMR('o/r', 1, null);

    expect(pr!.pipeline!.jobs).toHaveLength(150);
    expect(byTransport(requests)).toEqual({ graphql: 2, rest: 1 });
  });
});

describe('GraphQL 5xx retry', () => {
  const sentGraphQL = (urls: string[]) => urls.filter((u) => /\/graphql(\?|$)/.test(u)).length;

  test('a fill answered 502 then 200 succeeds on the second GraphQL request', async () => {
    let calls = 0;
    const { urls } = stubForge({
      graphql: () => (++calls === 1 ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined),
      fill: allNodes,
      rest: rules
    });
    const { provider } = counted();

    const pr = await provider.fetchSingleMR('o/r', 1, null);

    expect(pr).not.toBeNull();
    expect(pr!.iid).toBe(1);
    expect(sentGraphQL(urls)).toBe(2);
  });

  test('a GraphQL mutation answered 502 is sent once', async () => {
    const { urls } = stubForge({
      graphql: (query) =>
        isMergeContextQuery(query) ? mergeContextData() : jsonResponse({ message: 'Bad Gateway' }, 502)
    });
    const { provider } = counted();

    await expect(provider.setAutoMerge('o/r', 1)).rejects.toThrow(/^setAutoMerge failed: 502/);
    // The context read, then the mutation once.
    expect(sentGraphQL(urls)).toBe(2);
  });

  test('a merge context read answered 502 then 200 is retried', async () => {
    let calls = 0;
    const { urls } = stubForge({
      graphql: (query) => {
        if (!isMergeContextQuery(query)) {
          return { enablePullRequestAutoMerge: { pullRequest: { autoMergeRequest: { enabledAt: 'x' } } } };
        }
        return ++calls === 1 ? jsonResponse({ message: 'Bad Gateway' }, 502) : mergeContextData();
      }
    });
    const { provider } = counted();

    await provider.setAutoMerge('o/r', 1);

    expect(sentGraphQL(urls)).toBe(3);
  });

  test('fetchProjectLabels: 1 request per 100 labels', async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `l${i}`, description: null, color: 'fff' }));
    stubForge({
      rest: (url) => {
        if ((new URL(url).searchParams.get('page') ?? '1') === '1') {
          return jsonResponse(page(100), 200, {
            link: '<https://api.github.com/repos/o/r/labels?per_page=100&page=2>; rel="next"'
          });
        }
        return jsonResponse(page(30));
      }
    });
    const { provider, requests } = counted();

    const out = await provider.fetchProjectLabels!('o/r');

    expect(out.labels).toHaveLength(130);
    expect(byTransport(requests)).toEqual({ graphql: 0, rest: 2 });
  });

  test('fetchCommitParents: 1 request', async () => {
    stubForge({ rest: () => jsonResponse({ parents: [{ sha: 'p1' }] }) });
    const { provider, requests } = counted();

    await provider.fetchCommitParents!('o/r', 'c');

    expect(byTransport(requests)).toEqual({ graphql: 0, rest: 1 });
  });

  test('fetchPipelineFailedJobs: 1 request per 100 jobs', async () => {
    const jobs = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: from + i,
        run_id: 77,
        name: 'j',
        status: 'completed',
        conclusion: 'failure',
        started_at: null,
        completed_at: null,
        html_url: null
      }));
    stubForge({
      rest: (url) => {
        if ((new URL(url).searchParams.get('page') ?? '1') === '1') {
          return jsonResponse({ total_count: 150, jobs: jobs(1, 100) }, 200, {
            link: '<https://api.github.com/repos/o/r/actions/runs/77/jobs?per_page=100&page=2>; rel="next"'
          });
        }
        return jsonResponse({ total_count: 150, jobs: jobs(101, 50) });
      }
    });
    const { provider, requests } = counted();

    const out = await provider.fetchPipelineFailedJobs!('o/r', 77);

    expect(out).toHaveLength(150);
    expect(byTransport(requests)).toEqual({ graphql: 0, rest: 2 });
  });

  test('fetchPipelineList: 1 request, 2 with iid', async () => {
    stubForge({
      rest: (url) =>
        url.includes('/pulls/') ? jsonResponse({ head: { sha: 's' } }) : jsonResponse({ workflow_runs: [] })
    });
    const a = counted();
    await a.provider.fetchPipelineList!('o/r', { limit: 5 });
    expect(byTransport(a.requests)).toEqual({ graphql: 0, rest: 1 });

    const b = counted();
    await b.provider.fetchPipelineList!('o/r', { iid: 3, limit: 5 });
    expect(byTransport(b.requests)).toEqual({ graphql: 0, rest: 2 });
  });

  test('fetchPullRequestSummaries: 50 rows is 1 GraphQL, 150 rows is 2, no REST', async () => {
    const row = (n: number) => ({
      number: n,
      title: 't',
      state: 'OPEN',
      merged: false,
      isDraft: false,
      headRefName: 'h',
      baseRefName: 'main',
      author: null,
      url: null,
      mergedAt: null
    });
    const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => row(from + i));
    const page = (nodes: unknown[], hasNextPage: boolean) => ({
      repository: { pullRequests: { nodes, pageInfo: { hasNextPage, endCursor: 'c' } } }
    });

    stubForge({ graphql: () => page(rows(1, 50), false) });
    const a = counted();
    expect((await a.provider.fetchPullRequestSummaries!('o/r', { state: 'all', limit: 200 })).rows).toHaveLength(50);
    expect(byTransport(a.requests)).toEqual({ graphql: 1, rest: 0 });

    stubForge({
      graphql: (_q, vars) => (vars.after ? page(rows(101, 50), false) : page(rows(1, 100), true))
    });
    const b = counted();
    expect((await b.provider.fetchPullRequestSummaries!('o/r', { state: 'all', limit: 200 })).rows).toHaveLength(150);
    expect(byTransport(b.requests)).toEqual({ graphql: 2, rest: 0 });
  });
});

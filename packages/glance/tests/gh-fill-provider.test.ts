import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { FetchPullRequestsWarning } from '../src/GitProvider.ts';
import { RateLimitedError, ReadBackFailedError } from '../src/errors.ts';
import {
  buildFillQuery,
  toPullRequestFromNode,
  type GHFillContext,
  type GHFillNode
} from '../src/githubFill.ts';
import {
  ghNode,
  jsonResponse,
  stubForge,
  useForgeStub,
  useInstantTimers
} from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

let providers = 0;

/**
 * A fresh token per provider: GraphQL POSTs share a throttling group keyed by
 * token with a real 1s spacing, and a token other files used carries their
 * backlog.
 */
function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', `tok-fill-${++providers}`);
}

function nodeFor(n: number, over: Parameters<typeof ghNode>[0] = {}): GHFillNode {
  return ghNode({ number: n, databaseId: 1000 + n, url: `https://github.com/o/r/pull/${n}`, ...over });
}

function checkRun(id: number, conclusion: string, isRequired = true): GHFillContext {
  return {
    __typename: 'CheckRun',
    databaseId: id,
    name: `check-${id}`,
    status: 'COMPLETED',
    conclusion,
    startedAt: '2026-01-02T00:00:00Z',
    completedAt: '2026-01-02T00:01:00Z',
    detailsUrl: null,
    isRequired,
    checkSuite: { workflowRun: { databaseId: 77, runNumber: 5, workflow: { name: 'CI' } } }
  };
}

/** A node whose first contexts page holds 100 green checks and says more follow. */
function nodeWithMoreContexts(n: number): GHFillNode {
  const contexts = Array.from({ length: 100 }, (_, i) => checkRun(i + 1, 'SUCCESS'));
  return nodeFor(n, {
    commits: {
      nodes: [
        {
          commit: {
            oid: 'abc123',
            statusCheckRollup: {
              state: 'PENDING',
              contexts: {
                totalCount: 150,
                pageInfo: { hasNextPage: true, endCursor: 'CUR1' },
                nodes: contexts
              }
            }
          }
        }
      ]
    }
  });
}

function contextsPage(n: number, nodes: GHFillContext[]): Record<string, unknown> {
  return {
    repository: {
      [`p${n}`]: {
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    totalCount: 150,
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes
                  }
                }
              }
            }
          ]
        }
      }
    }
  };
}

describe('GitHubProvider known-number reads through the fill', () => {
  test('fetchSingleMR returns the mapped PR', async () => {
    stubForge({ fill: () => ({ 1: nodeFor(1) }) });

    const pr = await provider().fetchSingleMR('o/r', 1, null);

    expect(pr).not.toBeNull();
    expect(pr!.readiness).toEqual({ state: 'ready', reasons: [] });
    expect(pr!.reviewers.map((r) => [r.username, r.reviewState])).toEqual([['bob', 'APPROVED']]);
    expect(pr!.pipeline!.id).toBe('github:run:77');
    expect(pr!.approvalsRequired).toBe(1);
    expect(pr!.iid).toBe(1);
    expect(pr!.id).toBe('github:pr:1001');
  });

  test('fetchSingleMR returns null with a fill warning when the fill fails', async () => {
    stubForge({ graphql: () => jsonResponse({ message: 'Bad Gateway' }, 502) });
    const warnings: FetchPullRequestsWarning[] = [];

    const pr = await provider().fetchSingleMR('o/r', 1, null, (w) => warnings.push(w));

    expect(pr).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'request-failed', source: 'fill', target: 'o/r#1' });
  });

  test('a null alias is a missing PR', async () => {
    stubForge({ fill: () => ({}) });
    const warnings: FetchPullRequestsWarning[] = [];

    expect(await provider().fetchSingleMR('o/r', 1, null, (w) => warnings.push(w))).toBeNull();
    expect(warnings).toEqual([]);

    stubForge({ fill: () => ({ 1: nodeFor(1) }) });
    const prs = await provider().fetchPullRequests({
      projectPath: 'o/r',
      iids: [1, 2],
      onWarning: (w) => warnings.push(w)
    });
    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(warnings).toEqual([]);
  });

  test("GitHub's NOT_FOUND error beside a null alias is still a missing PR, not a failure", async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p1: nodeFor(1), p2: null } },
          errors: [
            {
              type: 'NOT_FOUND',
              path: ['repository', 'p2'],
              message: 'Could not resolve to a PullRequest with the number of 2.'
            }
          ]
        })
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      projectPath: 'o/r',
      iids: [1, 2],
      onWarning: (w) => warnings.push(w)
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(warnings).toEqual([]);
  });

  test('partial GraphQL response keeps resolved PRs', async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p1: nodeFor(1), p2: null } },
          errors: [{ type: 'INTERNAL', path: ['repository', 'p2'], message: 'Something went wrong' }]
        })
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      projectPath: 'o/r',
      iids: [1, 2],
      onWarning: (w) => warnings.push(w)
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'request-failed', source: 'fill', target: 'o/r#2' });
  });

  test('an error under baseRef.branchProtectionRule reads as no classic count and keeps the PR', async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p1: nodeFor(1, { baseRef: { branchProtectionRule: null } }) } },
          errors: [
            {
              type: 'FORBIDDEN',
              path: ['repository', 'p1', 'baseRef', 'branchProtectionRule'],
              message: 'Resource not accessible by personal access token'
            }
          ]
        })
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const pr = await provider().fetchSingleMR('o/r', 1, null, (w) => warnings.push(w));

    expect(pr).not.toBeNull();
    expect(warnings).toEqual([]);
  });

  test('any other error under a resolved alias still drops the PR with a fill warning', async () => {
    stubForge({
      graphql: () =>
        jsonResponse({
          data: { repository: { p1: nodeFor(1) } },
          errors: [
            {
              type: 'INTERNAL',
              path: ['repository', 'p1', 'reviewThreads'],
              message: 'Something went wrong'
            }
          ]
        })
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const pr = await provider().fetchSingleMR('o/r', 1, null, (w) => warnings.push(w));

    expect(pr).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'request-failed', source: 'fill', target: 'o/r#1' });
  });

  test('30 numbers make two fill requests of 25 then 5', async () => {
    const batches: number[][] = [];
    stubForge({
      fill: (numbers) => {
        batches.push(numbers);
        return Object.fromEntries(numbers.map((n) => [n, nodeFor(n)]));
      }
    });
    const iids = Array.from({ length: 30 }, (_, i) => i + 1);

    const prs = await provider().fetchPullRequests({ projectPath: 'o/r', iids });

    expect(batches).toEqual([iids.slice(0, 25), iids.slice(25)]);
    expect(prs).toHaveLength(30);
  });

  test('150 contexts fetch one more page', async () => {
    stubForge({
      graphql: (query) =>
        query.includes('after:')
          ? contextsPage(1, [
              ...Array.from({ length: 49 }, (_, i) => checkRun(200 + i, 'SUCCESS')),
              checkRun(300, 'FAILURE')
            ])
          : undefined,
      fill: () => ({ 1: nodeWithMoreContexts(1) })
    });

    const pr = await provider().fetchSingleMR('o/r', 1, null);

    expect(pr!.pipeline!.jobs).toHaveLength(150);
    expect(pr!.pipeline!.status).toBe('failed');
  });

  test('failed contexts page reads checking', async () => {
    stubForge({
      graphql: (query) =>
        query.includes('after:') ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined,
      fill: () => ({ 1: nodeWithMoreContexts(1) })
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const pr = await provider().fetchSingleMR('o/r', 1, null, (w) => warnings.push(w));

    expect(pr!.pipeline!.status).toBe('pending');
    expect(pr!.readiness!.state).toBe('checking');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'request-failed', source: 'contexts', target: 'o/r#1' });
  });

  test('byBranches resolves through the fill, not fetchSingleMR', async () => {
    const filled: number[][] = [];
    stubForge({
      graphql: (query, variables) => {
        if (!query.includes('GlancePullRequestsByBranches')) return undefined;
        const hits: Record<string, number> = { 'feat/a': 1, 'feat/c': 3 };
        const repository: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(variables)) {
          if (!/^h\d+$/.test(k)) continue;
          const n = hits[v as string];
          repository[`b${k.slice(1)}`] = { nodes: n ? [{ number: n }] : [] };
        }
        return { repository };
      },
      fill: (numbers) => {
        filled.push(numbers);
        return { 1: nodeFor(1, { headRefName: 'feat/a' }), 3: nodeFor(3, { headRefName: 'feat/c' }) };
      }
    });
    const p = provider();
    let singleCalls = 0;
    const real = p.fetchSingleMR.bind(p);
    p.fetchSingleMR = (...args) => {
      singleCalls++;
      return real(...args);
    };

    const map = await p.fetchPullRequestsByBranches!('o/r', ['feat/a', 'feat/b', 'feat/c']);

    expect([...map.keys()]).toEqual(['feat/a', 'feat/b', 'feat/c']);
    expect(map.get('feat/b')).toBeNull();
    const hits = [...map.values()].filter((v) => v !== null);
    expect(hits).toHaveLength(2);
    expect(map.get('feat/a')!.iid).toBe(1);
    expect(map.get('feat/a')!.readiness).toEqual({ state: 'ready', reasons: [] });
    expect(map.get('feat/c')!.pipeline!.id).toBe('github:run:77');
    expect(filled).toEqual([[1, 3]]);
    expect(singleCalls).toBe(0);
  });

  test('byBranch keeps the REST head filter', async () => {
    const filled: number[][] = [];
    const { urls } = stubForge({
      rest: (url) =>
        url.includes('/pulls?head=') ? jsonResponse([{ number: 5, head: { ref: 'feature' } }]) : undefined,
      fill: (numbers) => {
        filled.push(numbers);
        return { 5: nodeFor(5) };
      }
    });

    const pr = await provider().fetchPullRequestByBranch('o/r', 'feature');

    expect(pr!.iid).toBe(5);
    expect(urls.filter((u) => u.includes('/pulls?head='))).toHaveLength(1);
    const beyondRules = urls.filter((u) => !u.includes('/rules/branches/'));
    expect(beyondRules).toHaveLength(2);
    expect(beyondRules[1]).toMatch(/\/graphql$/);
    expect(filled).toEqual([[5]]);
  });

  test('a rate-limited fill throws, not a short list', async () => {
    const resetSeconds = Math.floor(Date.now() / 1000) + 600;
    stubForge({
      graphql: (query) =>
        query.includes('p26: pullRequest')
          ? jsonResponse(
              { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] },
              200,
              { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetSeconds) }
            )
          : undefined,
      fill: (numbers) => Object.fromEntries(numbers.map((n) => [n, nodeFor(n)]))
    });

    const read = provider().fetchPullRequests({
      projectPath: 'o/r',
      iids: Array.from({ length: 30 }, (_, i) => i + 1)
    });

    const err = await read.then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).resetAt).toBe(new Date(resetSeconds * 1000).toISOString());
  });

  test('a rate-limited fill throws from fetchSingleMR and fetchPullRequestsByBranches too', async () => {
    const limited = () =>
      jsonResponse({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] });
    stubForge({
      graphql: (query) =>
        query.includes('GlancePullRequestsByBranches')
          ? { repository: { b0: { nodes: [{ number: 1 }] } } }
          : limited()
    });

    await expect(provider().fetchSingleMR('o/r', 1, null)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(provider().fetchPullRequestsByBranches!('o/r', ['feat/a'])).rejects.toBeInstanceOf(
      RateLimitedError
    );
  });

  test('a failed fill leaves byBranches hits null rather than throwing', async () => {
    stubForge({
      graphql: (query) =>
        query.includes('GlancePullRequestsByBranches')
          ? { repository: { b0: { nodes: [{ number: 1 }] } } }
          : jsonResponse({ message: 'Bad Gateway' }, 502)
    });

    const map = await provider().fetchPullRequestsByBranches!('o/r', ['feat/a']);

    expect(map.get('feat/a')).toBeNull();
  });

  test('fetchSingleMRAfterMutation keeps its message', async () => {
    stubForge({
      rest: (url, method) =>
        method === 'PUT' && url.endsWith('/pulls/9/merge')
          ? jsonResponse({ merged: true, sha: 'm1' })
          : undefined,
      graphql: () => jsonResponse({ message: 'Bad Gateway' }, 502)
    });

    const err = await provider()
      .mergePullRequest('o/r', 9)
      .then(
        () => null,
        (e: unknown) => e
      );

    expect(err).toBeInstanceOf(ReadBackFailedError);
    expect((err as ReadBackFailedError).writeApplied).toBe(true);
    expect((err as Error).message).toMatch(
      /^Merged PR #9 but could not verify it afterward: GitHub could not read o\/r#9 \(.*502.*\); it is missing from this result\.$/
    );
  });

  test('roles come from the viewer the fill reads, at no extra request', async () => {
    const { urls } = stubForge({
      viewer: { databaseId: 12, login: 'bob' },
      fill: () => ({
        1: nodeFor(1, {
          assignees: { nodes: [{ login: 'bob', databaseId: 12, name: 'Bob', avatarUrl: null }] }
        })
      })
    });

    const pr = await provider().fetchSingleMR('o/r', 1, null);

    expect(pr!.roles).toEqual(['assignee', 'reviewer']);
    expect(urls.filter((u) => !u.includes('/rules/branches/'))).toHaveLength(1);
  });

  test('iids honours the state and updatedAfter filters', async () => {
    stubForge({
      fill: () => ({
        1: nodeFor(1),
        2: nodeFor(2, { state: 'MERGED', mergedAt: '2026-01-03T00:00:00Z' }),
        3: nodeFor(3, { updatedAt: '2025-01-01T00:00:00Z' })
      })
    });

    const prs = await provider().fetchPullRequests({
      projectPath: 'o/r',
      iids: [1, 2, 3],
      updatedAfter: '2026-01-01T00:00:00Z'
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
  });
});

describe('toPullRequestFromNode', () => {
  const ctx = (node: GHFillNode) => ({
    roles: ['author'],
    contexts: node.commits.nodes[0]!.commit.statusCheckRollup!.contexts.nodes,
    contextsComplete: true,
    rulesRequired: null
  });

  test('conflicts, behind, stacked, diff stats and auto-merge come from the node', () => {
    const node = nodeFor(4, {
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'BEHIND',
      baseRefName: 'release',
      autoMergeRequest: {
        mergeMethod: 'SQUASH',
        enabledBy: { __typename: 'User', login: 'bob', avatarUrl: null, databaseId: 12, name: 'Bob' }
      }
    });

    const pr = toPullRequestFromNode(node, ctx(node));

    expect(pr.conflicts).toBe(true);
    expect(pr.shouldBeRebased).toBe(true);
    expect(pr.isStacked).toBe(true);
    expect(pr.diffStats).toEqual({ additions: 10, deletions: 2, filesChanged: 3 });
    expect(pr.autoMergeEnabled).toBe(true);
    expect(pr.autoMergeStrategy).toBe('squash');
    expect(pr.mergeUser?.id).toBe('github:user:12');
    expect(pr.repositoryId).toBe('github:500');
    expect(pr.sha).toBe('abc123');
    expect(pr.state).toBe('opened');
  });

  test('a DIRTY merge state is a conflict even when mergeable is unknown', () => {
    const node = nodeFor(4, { mergeable: 'UNKNOWN', mergeStateStatus: 'DIRTY' });

    expect(toPullRequestFromNode(node, ctx(node)).conflicts).toBe(true);
  });
});

describe('buildFillQuery reads the viewer and the auto-merge enabler', () => {
  test('one free viewer field, and the enabler as a full actor', () => {
    const q = buildFillQuery('o', 'r', [1], { listWeight: false });
    expect(q).toContain('viewer { databaseId login }');
    expect(q).toMatch(/autoMergeRequest \{ mergeMethod enabledBy \{ __typename login avatarUrl/);
  });
});

/** A `/pulls` listing entry: only the fields discovery reads. */
function listed(
  n: number,
  over: { state?: string; merged_at?: string | null; updated_at?: string; base?: string } = {}
) {
  return {
    number: n,
    state: over.state ?? 'open',
    merged_at: over.merged_at ?? null,
    updated_at: over.updated_at ?? '2026-01-02T00:00:00Z',
    base: { ref: over.base ?? 'main', repo: { id: 500, full_name: 'o/r', default_branch: 'main' } }
  };
}

/** A `/search/issues` PR item. */
function searchHit(n: number, repo = 'o/r') {
  return {
    number: n,
    state: 'open',
    updated_at: '2026-01-02T00:00:00Z',
    repository_url: `https://api.github.com/repos/${repo}`,
    pull_request: { url: '', merged_at: null }
  };
}

const fillAll = (numbers: number[]) => Object.fromEntries(numbers.map((n) => [n, nodeFor(n)]));

/** Answers search pages by the decoded query; every other URL falls through. */
function searchBy(answer: (q: string) => ReturnType<typeof searchHit>[]) {
  return (url: string) => {
    if (!url.includes('/search/issues')) return undefined;
    const q = new URL(url).searchParams.get('q') ?? '';
    return jsonResponse({ items: answer(q) });
  };
}

function rateLimited(): Response {
  return jsonResponse({ message: 'API rate limit exceeded' }, 403, {
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
  });
}

const limitedFill = () =>
  jsonResponse({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] });

describe('GitHubProvider list and search reads through the fill', () => {
  test('project list fills every listed PR in one request', async () => {
    const filled: number[][] = [];
    const { urls } = stubForge({
      rest: (url) =>
        url.includes('/repos/o/r/pulls?') ? jsonResponse([listed(1), listed(2), listed(3)]) : undefined,
      fill: (numbers) => {
        filled.push(numbers);
        return fillAll(numbers);
      }
    });

    const prs = await provider().fetchPullRequests({ projectPath: 'o/r' });

    expect(prs.map((p) => p.iid)).toEqual([1, 2, 3]);
    expect(filled).toEqual([[1, 2, 3]]);
    expect(prs[0]!.readiness).toEqual({ state: 'ready', reasons: [] });
    expect(prs[0]!.diffStats).toEqual({ additions: 10, deletions: 2, filesChanged: 3 });
    expect(urls.some((u) => /\/pulls\/\d+($|\/)/.test(u))).toBe(false);
  });

  test('listWeight keeps CI', async () => {
    let query = '';
    stubForge({
      rest: (url) => (url.includes('/repos/o/r/pulls?') ? jsonResponse([listed(1)]) : undefined),
      fill: (numbers, q) => {
        query = q;
        // GitHub answers only the fields asked for.
        const { body: _body, ...node } = nodeFor(1);
        return /\bbody\b/.test(q) ? fillAll(numbers) : { 1: node };
      }
    });

    const [pr] = await provider().fetchPullRequests({ projectPath: 'o/r', listWeight: true });

    expect(pr!.pipeline).not.toBeNull();
    expect(pr!.pipeline!.status).toBe('success');
    expect(pr!.description).toBeNull();
    expect(query).not.toMatch(/\bbody\b/);
  });

  test('excludeTargetBranches drops listed PRs before the fill', async () => {
    const filled: number[][] = [];
    stubForge({
      rest: (url) =>
        url.includes('/repos/o/r/pulls?')
          ? jsonResponse([listed(1), listed(2, { base: 'deployments/qa' })])
          : undefined,
      fill: (numbers) => {
        filled.push(numbers);
        return fillAll(numbers);
      }
    });

    const prs = await provider().fetchPullRequests({
      projectPath: 'o/r',
      excludeTargetBranches: ['deployments/qa']
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(filled).toEqual([[1]]);
  });

  test('authorUsernames fills the hits once and drops excluded target branches', async () => {
    const filled: number[][] = [];
    stubForge({
      rest: searchBy(() => [searchHit(1), searchHit(2)]),
      fill: (numbers) => {
        filled.push(numbers);
        return { 1: nodeFor(1), 2: nodeFor(2, { baseRefName: 'deployments/qa' }) };
      }
    });

    const prs = await provider().fetchPullRequests({
      projectPath: 'o/r',
      authorUsernames: ['ada', 'grace'],
      excludeTargetBranches: ['deployments/qa']
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(filled).toEqual([[1, 2]]);
  });

  test('a PR I reviewed stays in my list', async () => {
    stubForge({
      rest: searchBy((q) => (q.includes('reviewed-by:@me') ? [searchHit(9)] : [])),
      fill: fillAll
    });

    const prs = await provider().fetchPullRequests();

    expect(prs.map((p) => p.iid)).toEqual([9]);
    expect(prs[0]!.roles).toContain('reviewer');
  });

  test('the involvement search merges roles and fills each repository once', async () => {
    const filled: Array<{ repo: string; numbers: number[] }> = [];
    stubForge({
      rest: searchBy((q) => {
        if (q.includes('author:@me')) return [searchHit(1), searchHit(4, 'o/other')];
        if (q.includes('assignee:@me')) return [searchHit(1), searchHit(2)];
        return [];
      }),
      fill: (numbers, q) => {
        filled.push({ repo: /name: "([^"]+)"/.exec(q)![1]!, numbers });
        return fillAll(numbers);
      }
    });

    const prs = await provider().fetchPullRequests();

    expect(prs.map((p) => p.iid)).toEqual([1, 4, 2]);
    expect(prs[0]!.roles.sort()).toEqual(['assignee', 'author']);
    expect(filled).toEqual([
      { repo: 'r', numbers: [1, 2] },
      { repo: 'other', numbers: [4] }
    ]);
  });

  test('a list fill that fails for one PR keeps the rest and warns for that PR', async () => {
    stubForge({
      rest: (url) =>
        url.includes('/repos/o/r/pulls?') ? jsonResponse([listed(1), listed(2)]) : undefined,
      graphql: () =>
        jsonResponse({
          data: { repository: { p1: nodeFor(1), p2: null } },
          errors: [{ type: 'INTERNAL', path: ['repository', 'p2'], message: 'Something went wrong' }]
        })
    });
    const warnings: FetchPullRequestsWarning[] = [];

    const prs = await provider().fetchPullRequests({
      projectPath: 'o/r',
      onWarning: (w) => warnings.push(w)
    });

    expect(prs.map((p) => p.iid)).toEqual([1]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'request-failed', source: 'fill', target: 'o/r#2' });
  });

  test('a rate-limited list fill throws, not a short list', async () => {
    stubForge({
      rest: (url) => (url.includes('/repos/o/r/pulls?') ? jsonResponse([listed(1)]) : undefined),
      graphql: limitedFill
    });

    await expect(provider().fetchPullRequests({ projectPath: 'o/r' })).rejects.toBeInstanceOf(
      RateLimitedError
    );
  });

  test('a rate-limited search page throws, not a short list', async () => {
    stubForge({
      rest: (url) => (url.includes('/search/issues') ? rateLimited() : undefined),
      fill: fillAll
    });

    await expect(provider().fetchPullRequests()).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      provider().fetchPullRequests({ projectPath: 'o/r', authorUsernames: ['ada'] })
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  test('a rate-limited search fill throws too', async () => {
    stubForge({ rest: searchBy(() => [searchHit(1)]), graphql: limitedFill });

    await expect(provider().fetchPullRequests()).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe('GitHubProvider re-request and merge cleanup', () => {
  /** Records the reviewers each re-request POST asked for. */
  function recordReRequests(node: GHFillNode): { posted: string[][]; urls: string[] } {
    const posted: string[][] = [];
    const { urls } = stubForge({
      fill: () => ({ 3: node }),
      rest: (url, method, body) => {
        if (method === 'POST' && url.endsWith('/pulls/3/requested_reviewers')) {
          posted.push((JSON.parse(body ?? '{}') as { reviewers: string[] }).reviewers);
          return jsonResponse({});
        }
        return undefined;
      }
    });
    return { posted, urls };
  }

  test('requestReReview reaches past reviewers', async () => {
    const { posted, urls } = recordReRequests(nodeFor(3));

    await provider().requestReReview('o/r', 3);

    expect(posted).toEqual([['bob']]);
    expect(urls.some((u) => /\/pulls\/3$/.test(u))).toBe(false);
    expect(urls.some((u) => u.includes('/rules/branches/'))).toBe(false);
  });

  test('requestReReview keeps pending requests and skips bots and deleted accounts', async () => {
    const { posted } = recordReRequests(
      nodeFor(3, {
        reviewRequests: {
          nodes: [
            { requestedReviewer: { login: 'carol', databaseId: 13, name: 'Carol', avatarUrl: null } }
          ]
        },
        latestReviews: {
          nodes: [
            {
              state: 'COMMENTED',
              submittedAt: null,
              author: { __typename: 'Bot', login: 'coderabbitai', avatarUrl: null, databaseId: 99 }
            },
            { state: 'APPROVED', submittedAt: null, author: null },
            {
              state: 'APPROVED',
              submittedAt: null,
              author: { __typename: 'User', login: 'bob', avatarUrl: null, databaseId: 12, name: 'Bob' }
            }
          ]
        }
      })
    );

    await provider().requestReReview('o/r', 3);

    expect(posted).toEqual([['carol', 'bob']]);
  });

  test('requestReReview with nobody to ask still throws', async () => {
    const { posted } = recordReRequests(
      nodeFor(3, { latestReviews: { nodes: [] }, latestOpinionatedReviews: { nodes: [] } })
    );

    await expect(provider().requestReReview('o/r', 3)).rejects.toThrow(
      'requestReReview: nothing to re-request -- no reviewerUsernames given and the PR has no existing reviewers'
    );
    expect(posted).toEqual([]);
  });

  test('requestReReview names a failed read instead of re-requesting nobody', async () => {
    stubForge({ graphql: () => jsonResponse({ message: 'Bad Gateway' }, 502) });

    await expect(provider().requestReReview('o/r', 3)).rejects.toThrow(
      /^requestReReview: failed to fetch PR: 502/
    );
  });

  test('a rate-limited head repository read after a merge throws RateLimitedError', async () => {
    stubForge({
      fill: fillAll,
      rest: (url, method) => {
        if (method === 'PUT') return jsonResponse({ merged: true, sha: 'm1' });
        if (method === 'GET' && /\/pulls\/9$/.test(url)) return rateLimited();
        return undefined;
      }
    });

    await expect(
      provider().mergePullRequest('o/r', 9, { shouldRemoveSourceBranch: true })
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  test('a failed head repository read after a merge says so, not "head repository unknown"', async () => {
    stubForge({
      fill: fillAll,
      rest: (url, method) => {
        if (method === 'PUT') return jsonResponse({ merged: true, sha: 'm1' });
        if (method === 'GET' && /\/pulls\/9$/.test(url)) {
          return jsonResponse({ message: 'Forbidden' }, 403);
        }
        return undefined;
      }
    });

    const err = await provider()
      .mergePullRequest('o/r', 9, { shouldRemoveSourceBranch: true })
      .then(
        () => null,
        (e: unknown) => e as Error
      );

    expect(err?.message).toMatch(
      /^mergePullRequest merged but could not delete source branch "feature": reading the PR failed: 403/
    );
  });
});

import { afterEach, beforeEach } from 'bun:test';
import { parseFillAliases, type GHFillNode } from '../../src/githubFill.ts';

export type DeepPartial<T> = T extends Array<infer U>
  ? Array<DeepPartial<U>> | U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

const realFetch = globalThis.fetch;

/**
 * Call once at the top level of every test file that uses `stubForge`: bun
 * scopes hooks to the file that registers them, and this module is cached, so
 * an import-time hook would cover only the first importing file.
 */
export function useForgeStub(): void {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
}

const realSetTimeout = globalThis.setTimeout;

/**
 * Collapses every `setTimeout` in the file's tests to the next tick.
 * `@octokit/plugin-throttling` spaces GraphQL POSTs a real second apart per
 * token, so a read that makes two GraphQL requests otherwise costs a second
 * of wall clock per test. Call once at the top level, beside `useForgeStub()`.
 */
export function useInstantTimers(): void {
  beforeEach(() => {
    globalThis.setTimeout = ((
      callback: (...args: unknown[]) => void,
      _ms?: number,
      ...args: unknown[]
    ) => realSetTimeout(callback, 0, ...args)) as typeof setTimeout;
  });
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
  });
}

function merge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (
    over === null ||
    Array.isArray(over) ||
    typeof over !== 'object' ||
    base === null ||
    typeof base !== 'object' ||
    Array.isArray(base)
  ) {
    return over;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = merge(out[k], v);
  return out;
}

const USER = {
  __typename: 'User' as const,
  login: 'alice',
  avatarUrl: 'https://avatars.example/alice',
  databaseId: 11,
  name: 'Alice'
};

const approval = {
  state: 'APPROVED',
  submittedAt: '2026-01-02T00:00:00Z',
  author: { ...USER, login: 'bob', databaseId: 12, name: 'Bob' }
};

/** Arrays in `over` replace the defaults wholesale; objects merge. */
export function ghNode(over: DeepPartial<GHFillNode> = {}): GHFillNode {
  const base: GHFillNode = {
    id: 'PR_node1',
    databaseId: 1001,
    number: 1,
    title: 'Add thing',
    body: 'Body',
    state: 'OPEN',
    isDraft: false,
    url: 'https://github.com/o/r/pull/1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    mergedAt: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    headRefName: 'feature',
    headRefOid: 'abc123',
    baseRefName: 'main',
    baseRepository: {
      databaseId: 500,
      nameWithOwner: 'o/r',
      defaultBranchRef: { name: 'main' }
    },
    baseRef: { branchProtectionRule: { requiredApprovingReviewCount: 1 } },
    author: USER,
    assignees: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [approval] },
    latestOpinionatedReviews: { nodes: [approval] },
    reviewThreads: { totalCount: 0, nodes: [] },
    autoMergeRequest: null,
    commits: {
      nodes: [
        {
          commit: {
            oid: 'abc123',
            statusCheckRollup: {
              state: 'SUCCESS',
              contexts: {
                totalCount: 1,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    __typename: 'CheckRun',
                    databaseId: 9001,
                    name: 'build',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                    startedAt: '2026-01-02T00:00:00Z',
                    completedAt: '2026-01-02T00:05:00Z',
                    detailsUrl: 'https://github.com/o/r/actions/runs/77/job/9001',
                    isRequired: true,
                    checkSuite: {
                      workflowRun: {
                        databaseId: 77,
                        runNumber: 5,
                        workflow: { name: 'CI' }
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  };
  return merge(base, over) as GHFillNode;
}

export interface StubForgeHandlers {
  fill?: (numbers: number[], query: string) => Record<number, GHFillNode | null>;
  /**
   * Consulted before `fill` for every GraphQL POST. A `Response` is served as
   * is (failures, partial data with `errors`); any other value is served as
   * `{ data: value }`; `undefined` falls through to `fill`.
   */
  graphql?: (query: string, variables: Record<string, unknown>) => unknown;
  /** The token user, served as `data.viewer` beside a fill. */
  viewer?: { databaseId: number; login: string };
  rest?: (url: string, method: string) => Response | undefined;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

/** Installs the fetch stub for the current test; `useForgeStub()` in the test file restores the real fetch. */
export function stubForge(handlers: StubForgeHandlers): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (/\/graphql(\?|$)/.test(url) && method === 'POST') {
      const { query, variables } = JSON.parse(String(init?.body)) as {
        query: string;
        variables?: Record<string, unknown>;
      };
      const custom = handlers.graphql?.(query, variables ?? {});
      if (custom instanceof Response) return custom;
      if (custom !== undefined) return jsonResponse({ data: custom });
      const numbers = parseFillAliases(query);
      const out = handlers.fill?.(numbers, query) ?? {};
      const repository: Record<string, GHFillNode | null> = {};
      for (const n of numbers) repository[`p${n}`] = out[n] ?? null;
      return jsonResponse({
        data: handlers.viewer ? { viewer: handlers.viewer, repository } : { repository }
      });
    }
    return (
      handlers.rest?.(url, method) ??
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      })
    );
  }) as typeof fetch;
  return { urls };
}

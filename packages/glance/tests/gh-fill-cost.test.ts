import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import type { GHFillContext, GHFillNode } from '../src/githubFill.ts';
import type { RequestInfo } from '../src/instrumentation.ts';
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

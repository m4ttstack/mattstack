import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { ReadBackFailedError } from '../src/errors.ts';
import type { GHFillContext, GHFillNode } from '../src/githubFill.ts';
import type { RequestInfo } from '../src/instrumentation.ts';
import { createDashboard } from '../src/MRDashboard.ts';
import type { WatcherStatus } from '../src/RealtimeWatcher.ts';
import type { MRDashboardProps, PullRequest } from '../src/types.ts';
import {
  ghNode,
  jsonResponse,
  stubForge,
  useForgeStub,
  useInstantTimers
} from './helpers/gh-fill-fixture.ts';

const realSetTimeout = globalThis.setTimeout;

useForgeStub();
useInstantTimers();

let providers = 0;

/**
 * A fresh token per provider: GraphQL POSTs share a throttling group keyed by
 * token with a real 1s spacing, and a token other files used carries their
 * backlog.
 */
function counted(): { provider: GitHubProvider; requests: RequestInfo[] } {
  const requests: RequestInfo[] = [];
  const provider = new GitHubProvider('https://github.com', `tok-watch-${++providers}`, {
    onRequest: (info) => requests.push(info)
  });
  return { provider, requests };
}

function nodeFor(n: number, over: Parameters<typeof ghNode>[0] = {}): GHFillNode {
  return ghNode({ number: n, databaseId: 1000 + n, url: `https://github.com/o/r/pull/${n}`, ...over });
}

const rules = (url: string) => (url.includes('/rules/branches/') ? jsonResponse([]) : undefined);

function checkRun(id: number): GHFillContext {
  return {
    __typename: 'CheckRun',
    databaseId: id,
    name: `check-${id}`,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    startedAt: '2026-01-02T00:00:00Z',
    completedAt: '2026-01-02T00:01:00Z',
    detailsUrl: null,
    isRequired: true,
    checkSuite: { workflowRun: { databaseId: 77, runNumber: 5, workflow: { name: 'CI' } } }
  };
}

function nodeWithMoreContexts(n: number): GHFillNode {
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
                nodes: Array.from({ length: 100 }, (_, i) => checkRun(i + 1))
              }
            }
          }
        }
      ]
    }
  });
}

async function waitFor(pred: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (pred()) return;
    await new Promise<void>((resolve) => realSetTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Stubs `octokit` directly: the recording setTimeout never runs the real client's throttled requests. */
function directProvider(): GitHubProvider {
  const provider = new GitHubProvider('https://github.com', `tok-watch-${++providers}`);
  (provider as any).octokit = {
    request: async () => ({ status: 200, headers: {}, data: [] }),
    graphql: async () => ({ repository: { p1: nodeFor(1) } })
  };
  return provider;
}

async function capturedPollDelay(pollIntervalMs?: number): Promise<{ delay: number; updates: number }> {
  const delays: number[] = [];
  globalThis.setTimeout = ((_fn: () => unknown, ms?: number) => {
    delays.push(ms ?? 0);
    return realSetTimeout(() => {}, 0);
  }) as unknown as typeof setTimeout;
  let updates = 0;
  // Timers left running by other files land in the recorder too, so only the
  // first one scheduled after the update is the watcher's next poll.
  let afterUpdate = -1;
  const dispose = directProvider().watchMR(
    'o/r',
    1,
    null,
    () => {
      updates++;
      afterUpdate = delays.length;
    },
    pollIntervalMs === undefined ? undefined : { pollIntervalMs }
  );
  try {
    await waitFor(() => afterUpdate >= 0 && delays.length > afterUpdate, 'the next poll to be scheduled');
  } finally {
    dispose();
  }
  return { delay: delays[afterUpdate]!, updates };
}

describe('GitHubProvider.watchMR', () => {
  test('watchMR does not throw and delivers the PR from one GraphQL fill per poll', async () => {
    stubForge({ fill: (numbers) => Object.fromEntries(numbers.map((n) => [n, nodeFor(n)])), rest: rules });
    const { provider, requests } = counted();
    const seen: Array<{ iid: number; graphql: number; rest: number }> = [];

    const dispose = provider.watchMR('o/r', 1, null, (pr) => {
      seen.push({
        iid: pr.iid,
        graphql: requests.filter((r) => r.transport === 'graphql').length,
        rest: requests.filter((r) => r.transport === 'rest').length
      });
    });
    try {
      await waitFor(() => seen.length >= 2, 'two polls');
    } finally {
      dispose();
    }

    expect(seen[0]).toEqual({ iid: 1, graphql: 1, rest: 1 });
    expect(seen[1]).toEqual({ iid: 1, graphql: 2, rest: 1 });
  });

  test('default interval is 60s', async () => {
    const { delay, updates } = await capturedPollDelay();
    expect(updates).toBe(1);
    expect(delay).toBeGreaterThanOrEqual(54_000);
    expect(delay).toBeLessThanOrEqual(66_000);
  });

  test('pollIntervalMs overrides it', async () => {
    const { delay, updates } = await capturedPollDelay(5_000);
    expect(updates).toBe(1);
    expect(delay).toBeGreaterThanOrEqual(4_500);
    expect(delay).toBeLessThanOrEqual(5_500);
  });

  test('a fill warning reports reconnecting with its message', async () => {
    stubForge({ graphql: () => jsonResponse({ message: 'Bad Gateway' }, 502) });
    const { provider } = counted();
    const statuses: WatcherStatus[] = [];
    let updates = 0;

    const dispose = provider.watchMR('o/r', 1, null, () => updates++, {
      onStatusChange: (s) => statuses.push(s)
    });
    try {
      await waitFor(() => statuses.some((s) => s.connection === 'reconnecting'), 'reconnecting');
    } finally {
      dispose();
    }

    const failed = statuses.find((s) => s.connection === 'reconnecting')!;
    expect(updates).toBe(0);
    expect(failed.lastError).toBeInstanceOf(ReadBackFailedError);
    const err = failed.lastError as ReadBackFailedError;
    expect(err.writeApplied).toBe(false);
    expect(err.operation).toBe('watchMR');
    expect(err.projectPath).toBe('o/r');
    expect(err.iid).toBe(1);
    expect(err.message.length).toBeGreaterThan(0);
  });

  test('a contexts warning still delivers the PR', async () => {
    stubForge({
      graphql: (query) =>
        query.includes('after:') ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined,
      fill: () => ({ 1: nodeWithMoreContexts(1) }),
      rest: rules
    });
    const { provider } = counted();
    const delivered: PullRequest[] = [];
    const statuses: WatcherStatus[] = [];

    const dispose = provider.watchMR('o/r', 1, null, (pr) => delivered.push(pr), {
      onStatusChange: (s) => statuses.push(s)
    });
    try {
      await waitFor(() => delivered.length > 0, 'a delivered PR');
    } finally {
      dispose();
    }

    expect(delivered[0]!.iid).toBe(1);
    expect(delivered[0]!.pipeline!.status).toBe('pending');
    expect(statuses[0]!.connection).toBe('polling');
  });

  test('createDashboard({ mrIid }) on GitHub delivers connection polling', async () => {
    stubForge({ fill: () => ({ 1: nodeFor(1) }), rest: rules });
    const { provider } = counted();
    const dashboard = createDashboard({ provider, projectPath: 'o/r', mrIid: 1, userId: null });
    const props: MRDashboardProps[] = [];

    dashboard.subscribe((mr) => props.push(mr));
    try {
      await waitFor(() => props.length > 0, 'a dashboard update');
    } finally {
      dashboard.dispose();
    }

    expect(props[0]!.connection).toBe('polling');
  });
});

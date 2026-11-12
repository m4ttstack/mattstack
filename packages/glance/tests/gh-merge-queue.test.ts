#!/usr/bin/env bun
/** The transport is stubbed; nothing here touches a network. */
import { describe, expect, test } from 'bun:test';
import { GraphqlResponseError } from '@octokit/graphql';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { createDashboard } from '../src/MRDashboard.ts';
import { MergeReadBackFailedError } from '../src/index.ts';
import type { MergePullRequestInput, MergeQueueEntry } from '../src/types.ts';
import { ghNode, jsonResponse, stubForge, useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';
import { isMergeContextQuery, mergeContextData } from './helpers/gh-merge-context.ts';

useForgeStub();
useInstantTimers();

interface Scenario {
  inQueue?: boolean;
  queueEntry?: MergeQueueEntry | null;
  readBackFails?: boolean;
}

interface Recorded {
  calls: string[];
  enqueues: Array<Record<string, unknown>>;
}

/** o/r#7 on a base with a merge queue; the enqueue answers position 3, AWAITING_CHECKS. */
function queueBase(scenario: Scenario = {}): Recorded {
  const recorded: Recorded = { calls: [], enqueues: [] };
  stubForge({
    graphql: (query, variables) => {
      if (isMergeContextQuery(query)) {
        recorded.calls.push('POST context');
        return mergeContextData({
          queueEnabled: true,
          nodeId: 'PR_ctx',
          inQueue: scenario.inQueue ?? false,
          queueEntry: scenario.queueEntry ?? null
        });
      }
      if (query.includes('GlanceEnqueue')) {
        recorded.calls.push('POST enqueue');
        recorded.enqueues.push(variables);
        return { enqueuePullRequest: { mergeQueueEntry: { position: 3, state: 'AWAITING_CHECKS' } } };
      }
      recorded.calls.push('POST fill');
      return scenario.readBackFails ? jsonResponse({ message: 'Bad Gateway' }, 502) : undefined;
    },
    fill: numbers => Object.fromEntries(numbers.map(n => [n, ghNode({ number: n, state: 'OPEN' })])),
    rest: (url, method) => {
      recorded.calls.push(`${method} ${new URL(url).pathname}`);
      return undefined;
    }
  });
  return recorded;
}

function provider(): GitHubProvider {
  return new GitHubProvider('https://github.com', 'tok');
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e
  );
}

const posts = (calls: string[]) => calls.filter(c => c.startsWith('POST '));
const writesOrPullReads = (calls: string[]) =>
  calls.filter(c => c.startsWith('PUT ') || c.startsWith('DELETE ') || c === 'GET /repos/o/r/pulls/7');

describe('GitHubProvider mergePullRequest on a merge queue base', () => {
  test("a queue branch enqueues with the context's node id", async () => {
    const { calls, enqueues } = queueBase();

    const result = await provider().mergePullRequest('o/r', 7);

    expect(result.queued).toEqual({ position: 3, state: 'AWAITING_CHECKS' });
    expect(result.state).toBe('opened');
    expect(enqueues).toEqual([{ id: 'PR_ctx', head: null }]);
    expect(posts(calls)).toEqual(['POST context', 'POST enqueue', 'POST fill']);
    expect(writesOrPullReads(calls)).toEqual([]);
  });

  test('input.sha becomes expectedHeadOid', async () => {
    const { enqueues } = queueBase();

    await provider().mergePullRequest('o/r', 7, { sha: 'deadbeef' });

    expect(enqueues).toEqual([{ id: 'PR_ctx', head: 'deadbeef' }]);
  });

  test('a PR the queue dropped is enqueued again', async () => {
    const { enqueues } = queueBase({ inQueue: false, queueEntry: null });

    const result = await provider().mergePullRequest('o/r', 7);

    expect(enqueues).toHaveLength(1);
    expect(result.queued).toEqual({ position: 3, state: 'AWAITING_CHECKS' });
  });

  test('already in the queue makes no write', async () => {
    const entry = { position: 1, state: 'MERGEABLE' };
    const { calls, enqueues } = queueBase({ inQueue: true, queueEntry: entry });

    const result = await provider().mergePullRequest('o/r', 7);

    expect(enqueues).toEqual([]);
    expect(result.queued).toEqual(entry);
    expect(posts(calls)).toEqual(['POST context', 'POST fill']);
    expect(writesOrPullReads(calls)).toEqual([]);
  });

  const refused: Array<[keyof MergePullRequestInput, MergePullRequestInput]> = [
    ['mergeMethod', { mergeMethod: 'merge' }],
    ['squash', { squash: false }],
    ['commitMessage', { commitMessage: 'msg' }],
    ['squashCommitMessage', { squashCommitMessage: 'msg' }],
    ['shouldRemoveSourceBranch', { shouldRemoveSourceBranch: false }]
  ];
  for (const [field, input] of refused) {
    test(`queue-incompatible input is refused before any write: ${field}`, async () => {
      const { calls, enqueues } = queueBase();

      const err = await rejection(provider().mergePullRequest('o/r', 7, input));

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(field);
      expect((err as Error).message).toStartWith('mergePullRequest failed:');
      expect(enqueues).toEqual([]);
      expect(calls).toEqual(['POST context']);
    });
  }

  test('read-back failure after enqueue', async () => {
    queueBase({ readBackFails: true });

    const err = await rejection(provider().mergePullRequest('o/r', 7));

    expect(err).toBeInstanceOf(MergeReadBackFailedError);
    const e = err as MergeReadBackFailedError;
    expect(e.writeApplied).toBe(true);
    expect(e.queued).toEqual({ position: 3, state: 'AWAITING_CHECKS' });
    expect(e.message).toMatch(/^Queued PR #7 but could not verify it afterward: /);
    expect(e.operation).toBe('fetchSingleMR after Queued');
    expect(e.sourceBranchNotDeleted).toBeUndefined();
  });

  test('read-back failure when already queued', async () => {
    const entry = { position: 1, state: 'MERGEABLE' };
    const { enqueues } = queueBase({ inQueue: true, queueEntry: entry, readBackFails: true });

    const err = await rejection(provider().mergePullRequest('o/r', 7));

    expect(err).toBeInstanceOf(MergeReadBackFailedError);
    const e = err as MergeReadBackFailedError;
    expect(e.writeApplied).toBe(false);
    expect(e.queued).toEqual(entry);
    expect(enqueues).toEqual([]);
  });

  test('the dashboard merge action returns the queued result', async () => {
    queueBase();
    const dashboard = createDashboard({ provider: provider(), projectPath: 'o/r', mrIid: 7, userId: null });
    try {
      const result = await dashboard.actions.merge();
      expect(result.queued).toEqual({ position: 3, state: 'AWAITING_CHECKS' });
    } finally {
      dashboard.dispose();
    }
  });
});

function forbidden(): GraphqlResponseError<unknown> {
  return new GraphqlResponseError(
    { method: 'POST', url: 'https://api.github.com/graphql' } as never,
    {} as never,
    {
      data: { repository: null },
      errors: [
        {
          type: 'FORBIDDEN',
          path: ['repository'],
          message: 'Resource protected by organization SAML enforcement.'
        }
      ]
    } as never
  );
}

function providerAnswering(answer: () => unknown): GitHubProvider {
  const p = provider();
  (p as any).octokit = {
    graphql: async () => {
      const out = answer();
      if (out instanceof Error) throw out;
      return out;
    },
    request: async () => ({ status: 200, headers: {}, data: {} })
  };
  return p;
}

describe('a null pull request with a non-NOT_FOUND error reports the error', () => {
  test('the merge context read', async () => {
    await expect(providerAnswering(forbidden).mergePullRequest('o/r', 7)).rejects.toThrow(
      'mergePullRequest failed: GitHub GraphQL returned Resource protected by organization SAML enforcement.'
    );
  });

  test('the rebase head read', async () => {
    await expect(providerAnswering(forbidden).rebasePullRequest('o/r', 7)).rejects.toThrow(
      'rebasePullRequest failed: GitHub GraphQL returned Resource protected by organization SAML enforcement.'
    );
  });
});

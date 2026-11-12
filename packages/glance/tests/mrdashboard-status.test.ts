import { describe, expect, test } from 'bun:test';
import { createDashboard } from '../src/MRDashboard.ts';
import type { ByBranchReadOptions, GitProvider } from '../src/GitProvider.ts';
import {
  createRealtimeWatcher,
  type RealtimeWatcherOptions,
  type WatcherStatus,
  type WatcherSubscribeCallbacks,
} from '../src/RealtimeWatcher.ts';
import type { ProviderCapabilities, PullRequest } from '../src/types.ts';

function stubPR(iid: number): PullRequest {
  return {
    id: `gitlab:mr:${iid}`,
    iid,
    repositoryId: 'gitlab:1',
    title: `MR ${iid}`,
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: null,
    sourceBranch: `feat/${iid}`,
    targetBranch: 'main',
    createdAt: null,
    updatedAt: null,
    sha: null,
    author: { id: 'gitlab:user:1', username: 'author', name: 'author', avatarUrl: null },
    assignees: [],
    reviewers: [],
    roles: ['author'],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 0,
    approved: false,
    approvedBy: [],
    diffStats: null,
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 0,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
  };
}

/**
 * A provider whose `watchMR` drives the real watcher the way
 * `GitLabProvider.watchMR` does (caller options spread through), with the
 * shared cable replaced by callbacks the test fires by hand.
 */
function cableProvider(): { provider: GitProvider; cable: () => WatcherSubscribeCallbacks } {
  let callbacks: WatcherSubscribeCallbacks | null = null;
  const provider = {
    providerName: 'gitlab',
    baseURL: 'https://gitlab.example',
    capabilities: {} as ProviderCapabilities,
    watchMR(
      _projectPath: string,
      mrIid: number,
      _userId: number | null,
      onUpdate: (pr: PullRequest) => void,
      options?: RealtimeWatcherOptions
    ) {
      return createRealtimeWatcher<PullRequest>({
        fetch: async () => stubPR(mrIid),
        subscribe: (cbs) => {
          callbacks = cbs;
          return () => {};
        },
        onUpdate,
        options: { ...options, logContext: 'test' },
      });
    },
  } as unknown as GitProvider;
  return {
    provider,
    cable: () => {
      if (!callbacks) throw new Error('watcher never subscribed');
      return callbacks;
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('createRealtimeWatcher status callback', () => {
  test('the params callback wins: an options callback set alongside it never fires', async () => {
    const cable: { cbs?: WatcherSubscribeCallbacks } = {};
    const fromParams: string[] = [];
    const fromOptions: string[] = [];
    const dispose = createRealtimeWatcher<number>({
      fetch: async () => 1,
      subscribe: (c) => {
        cable.cbs = c;
        return () => {};
      },
      onUpdate: () => {},
      onStatusChange: (s) => fromParams.push(s.connection),
      options: { onStatusChange: (s) => fromOptions.push(s.connection) },
    });
    await settle();

    try {
      cable.cbs!.onConnected();
      expect(fromParams).toEqual(['connected']);
      expect(fromOptions).toEqual([]);
    } finally {
      dispose();
    }
  });
});

describe('single MR dashboard connection state', () => {
  test('reports connected after the cable connects and disconnected after it drops', async () => {
    const { provider, cable } = cableProvider();
    const dashboard = createDashboard({ provider, projectPath: 'g/p', mrIid: 7, userId: null });
    const statuses: WatcherStatus['connection'][] = [];
    dashboard.onStatusChange((s) => statuses.push(s.connection));
    dashboard.subscribe(() => {});
    await settle();

    try {
      cable().onConnected();
      expect(statuses.at(-1)).toBe('connected');

      cable().onDisconnected();
      expect(statuses.at(-1)).toBe('disconnected');

      cable().onConnected();
      expect(statuses.at(-1)).toBe('connected');
    } finally {
      dashboard.dispose();
    }
  });

  test('an MR update after connecting carries connection: connected', async () => {
    const { provider, cable } = cableProvider();
    const dashboard = createDashboard({ provider, projectPath: 'g/p', mrIid: 7, userId: null });
    const connections: string[] = [];
    dashboard.subscribe((mr) => connections.push(mr.connection));
    await settle();

    try {
      cable().onConnected();
      cable().onEvent();
      await new Promise((r) => setTimeout(r, 200));
      expect(connections.at(-1)).toBe('connected');
    } finally {
      dashboard.dispose();
    }
  });
});

/** A provider that only answers the dashboards' plain reads; no watchMR. */
function readOnlyProvider(withPush: boolean): GitProvider {
  const provider: Record<string, unknown> = {
    providerName: withPush ? 'gitlab' : 'github',
    baseURL: 'https://forge.example',
    capabilities: {} as ProviderCapabilities,
    fetchPullRequestByBranch: async () => stubPR(7),
    fetchPullRequests: async () => [stubPR(1), stubPR(2)],
  };
  if (withPush) provider.subscribePullRequestEvents = () => () => {};
  return provider as unknown as GitProvider;
}

describe('dashboards without a push channel', () => {
  test('branch dashboard without subscribePullRequestEvents reports polling', async () => {
    const dashboard = createDashboard({
      provider: readOnlyProvider(false),
      projectPath: 'o/r',
      branch: 'feat/7',
      userId: null,
    });
    const statuses: string[] = [];
    const connections: string[] = [];
    dashboard.onStatusChange((s) => statuses.push(s.connection));
    dashboard.subscribe((mr) => connections.push(mr.connection));
    await settle();

    try {
      expect(statuses.at(-1)).toBe('polling');
      expect(connections).toEqual(['polling']);
    } finally {
      dashboard.dispose();
    }
  });

  test('branch dashboard whose by-branch read warns of a failed list reports reconnecting, not polling', async () => {
    const provider = {
      ...(readOnlyProvider(false) as unknown as Record<string, unknown>),
      fetchPullRequestByBranch: async (
        _path: string,
        branch: string,
        _state: unknown,
        options?: ByBranchReadOptions
      ) => {
        options?.onWarning?.({
          kind: 'request-failed',
          source: 'list',
          status: 502,
          target: 'o/r',
          branch,
          message: 'GitHub could not list PRs in o/r (HTTP 502); whether branch feat/7 has a PR is unknown.'
        });
        return null;
      },
    } as unknown as GitProvider;
    const dashboard = createDashboard({ provider, projectPath: 'o/r', branch: 'feat/7', userId: null });
    const statuses: WatcherStatus[] = [];
    dashboard.onStatusChange((s) => statuses.push(s));
    dashboard.subscribe(() => {});
    await settle();

    try {
      expect(statuses.map((s) => s.connection)).not.toContain('polling');
      expect(statuses.at(-1)?.connection).toBe('reconnecting');
      expect(statuses.at(-1)?.lastError?.message).toContain('could not list PRs');
    } finally {
      dashboard.dispose();
    }
  });

  test('branch dashboard whose by-branch read warns only of contexts still reports polling', async () => {
    const provider = {
      ...(readOnlyProvider(false) as unknown as Record<string, unknown>),
      fetchPullRequestByBranch: async (
        _path: string,
        branch: string,
        _state: unknown,
        options?: ByBranchReadOptions
      ) => {
        options?.onWarning?.({
          kind: 'request-failed',
          source: 'contexts',
          target: 'o/r#7',
          branch,
          message: 'Some checks could not be read.'
        });
        return stubPR(7);
      },
    } as unknown as GitProvider;
    const dashboard = createDashboard({ provider, projectPath: 'o/r', branch: 'feat/7', userId: null });
    const statuses: string[] = [];
    dashboard.onStatusChange((s) => statuses.push(s.connection));
    dashboard.subscribe(() => {});
    await settle();

    try {
      expect(statuses.at(-1)).toBe('polling');
    } finally {
      dashboard.dispose();
    }
  });

  test('group dashboard without subscribePullRequestEvents reports polling', async () => {
    const group = createDashboard({
      provider: readOnlyProvider(false),
      projectPath: 'o/r',
      mrIid: [1, 2],
      userId: null,
    });
    const statuses: string[] = [];
    const connections: string[][] = [];
    group.onStatusChange((s) => statuses.push(s.connection));
    group.subscribe((mrs) => connections.push([...mrs.values()].map((m) => m.connection)));
    await settle();

    try {
      expect(statuses.at(-1)).toBe('polling');
      expect(connections).toEqual([['polling', 'polling']]);
    } finally {
      group.dispose();
    }
  });

  test('branch dashboard with subscribePullRequestEvents still reports connected', async () => {
    const dashboard = createDashboard({
      provider: readOnlyProvider(true),
      projectPath: 'g/p',
      branch: 'feat/7',
      userId: null,
    });
    const statuses: string[] = [];
    dashboard.onStatusChange((s) => statuses.push(s.connection));
    dashboard.subscribe(() => {});
    await settle();

    try {
      expect(statuses.at(-1)).toBe('connected');
    } finally {
      dashboard.dispose();
    }
  });
});

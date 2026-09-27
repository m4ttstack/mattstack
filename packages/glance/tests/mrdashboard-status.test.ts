import { describe, expect, test } from 'bun:test';
import { createDashboard } from '../src/MRDashboard.ts';
import type { GitProvider } from '../src/GitProvider.ts';
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

import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { createDashboard } from '../src/MRDashboard.ts';
import type { FetchPullRequestsOptions, GitProvider } from '../src/GitProvider.ts';
import type { WatcherStatus, WatcherSubscribeCallbacks } from '../src/RealtimeWatcher.ts';
import type { ProviderCapabilities, PullRequest } from '../src/types.ts';

function stubPR(iid: number): PullRequest {
  return {
    id: `gitlab:mr:${iid * 100}`,
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

interface CableProvider {
  provider: GitProvider;
  fetches: number[][];
  watchMRCalls: number;
  subscriptions: Array<Array<Pick<PullRequest, 'id' | 'iid'>>>;
  cable: WatcherSubscribeCallbacks | null;
  /** Subscriptions attached and not yet disposed. */
  live: number;
  /** iids the fake leaves out of its answer, as a row-level failure would. */
  omit: Set<number>;
}

/** A provider whose push seam hands the test the shared cable's callbacks. */
function cableProvider(): CableProvider {
  const rec: CableProvider = {
    provider: null as unknown as GitProvider,
    fetches: [],
    watchMRCalls: 0,
    subscriptions: [],
    cable: null,
    live: 0,
    omit: new Set(),
  };
  rec.provider = {
    providerName: 'gitlab',
    baseURL: 'https://gitlab.example',
    capabilities: {} as ProviderCapabilities,
    async fetchPullRequests(options?: FetchPullRequestsOptions) {
      const iids = options?.iids ?? [];
      rec.fetches.push([...iids]);
      return iids.filter((iid) => !rec.omit.has(iid)).map(stubPR);
    },
    watchMR() {
      rec.watchMRCalls++;
      return () => {};
    },
    subscribePullRequestEvents(
      _projectPath: string,
      prs: Array<Pick<PullRequest, 'id' | 'iid'>>,
      callbacks: WatcherSubscribeCallbacks
    ) {
      rec.subscriptions.push(prs.map(({ id, iid }) => ({ id, iid })));
      rec.cable = callbacks;
      rec.live++;
      return () => {
        rec.live--;
        if (rec.cable === callbacks) rec.cable = null;
      };
    },
  } as unknown as GitProvider;
  return rec;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const pastDebounce = () => new Promise((r) => setTimeout(r, 200));

describe('group dashboard over the shared cable', () => {
  test('one batched fetch and one push subscription for the whole group, no per-MR watchers', async () => {
    const rec = cableProvider();
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: [1, 2, 3], userId: null });
    group.subscribe(() => {});
    await settle();

    try {
      expect(rec.watchMRCalls).toBe(0);
      expect(rec.fetches).toEqual([[1, 2, 3]]);
      expect(rec.subscriptions).toEqual([
        [
          { id: 'gitlab:mr:100', iid: 1 },
          { id: 'gitlab:mr:200', iid: 2 },
          { id: 'gitlab:mr:300', iid: 3 },
        ],
      ]);
    } finally {
      group.dispose();
    }
  });

  test('a cable event for any MR in the group triggers exactly one group refetch', async () => {
    const rec = cableProvider();
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: [1, 2, 3], userId: null });
    let updates = 0;
    group.subscribe(() => updates++);
    await settle();

    try {
      rec.cable?.onConnected();
      const before = rec.fetches.length;
      const updatesBefore = updates;
      rec.cable?.onEvent();
      await pastDebounce();
      expect(rec.fetches.length - before).toBe(1);
      expect(rec.fetches.at(-1)).toEqual([1, 2, 3]);
      expect(updates - updatesBefore).toBe(1);
    } finally {
      group.dispose();
    }
  });

  test('connect and disconnect on the shared cable move the group connection state', async () => {
    const rec = cableProvider();
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: [1, 2], userId: null });
    const statuses: WatcherStatus['connection'][] = [];
    const rowConnections: string[] = [];
    group.onStatusChange((s) => statuses.push(s.connection));
    group.subscribe((mrs) => rowConnections.push(mrs.get(1)?.connection ?? 'missing'));
    await settle();

    try {
      rec.cable?.onConnected();
      expect(statuses.at(-1)).toBe('connected');
      rec.cable?.onEvent();
      await pastDebounce();
      expect(rowConnections.at(-1)).toBe('connected');

      rec.cable?.onDisconnected();
      expect(statuses.at(-1)).toBe('disconnected');
    } finally {
      group.dispose();
    }
  });

  test('a burst of events from different MRs inside the debounce window gives one refetch', async () => {
    const rec = cableProvider();
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: [1, 2, 3], userId: null });
    group.subscribe(() => {});
    await settle();

    try {
      rec.cable?.onConnected();
      const before = rec.fetches.length;
      rec.cable?.onEvent();
      rec.cable?.onEvent();
      rec.cable?.onEvent();
      await pastDebounce();
      expect(rec.fetches.length - before).toBe(1);
    } finally {
      group.dispose();
    }
  });

  test('an MR missing from the init fetch arrives on the next refresh and is then subscribed for push', async () => {
    const rec = cableProvider();
    rec.omit.add(3);
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: [1, 2, 3], userId: null });
    let latest = new Map<number, unknown>();
    group.subscribe((mrs) => (latest = new Map(mrs)));
    await settle();

    try {
      expect(rec.subscriptions.at(-1)?.map((p) => p.iid)).toEqual([1, 2]);
      expect(latest.has(3)).toBe(false);

      rec.omit.clear();
      rec.cable?.onConnected();
      rec.cable?.onEvent();
      await pastDebounce();
      expect(rec.fetches.at(-1)).toEqual([1, 2, 3]);
      expect(latest.has(3)).toBe(true);
      expect(rec.subscriptions.at(-1)?.map((p) => p.iid)).toEqual([3]);
      expect(rec.live).toBe(2);

      const before = rec.fetches.length;
      rec.cable?.onEvent();
      await pastDebounce();
      expect(rec.fetches.length - before).toBe(1);
    } finally {
      group.dispose();
    }
    expect(rec.live).toBe(0);
  });
});

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.OPEN;
  sent: Array<{ command: string; identifier: string }> = [];
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {
    this.closed = true;
  }
  deliver(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  identifiers(command: string, gid: string): string[] {
    return this.sent
      .filter((c) => c.command === command && c.identifier.includes(`"${gid}\\"`))
      .map((c) => c.identifier);
  }
}

describe('group dashboard over the real GitLab shared cable', () => {
  const realWebSocket = globalThis.WebSocket;
  afterEach(() => {
    globalThis.WebSocket = realWebSocket;
    FakeSocket.instances = [];
  });

  test('a late MR joins push without costing the MRs already subscribed theirs', async () => {
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const gitlab = new GitLabProvider('https://gitlab.example', 'tok');
    const omit = new Set([3]);
    let fetches = 0;
    (gitlab as unknown as { fetchPullRequests: GitProvider['fetchPullRequests'] }).fetchPullRequests = async (
      options?: FetchPullRequestsOptions
    ) => {
      fetches++;
      return (options?.iids ?? []).filter((iid) => !omit.has(iid)).map(stubPR);
    };
    const group = createDashboard({ provider: gitlab, projectPath: 'g/p', mrIid: [1, 2, 3], userId: null });
    group.subscribe(() => {});
    await settle();

    try {
      const sock = FakeSocket.instances[0]!;
      sock.deliver({ type: 'welcome' });
      const mr1 = sock.identifiers('subscribe', 'gid://gitlab/MergeRequest/100');
      expect(mr1).toHaveLength(3);

      omit.clear();
      sock.deliver({ identifier: mr1[0], message: {} });
      await pastDebounce();
      const mr3 = sock.identifiers('subscribe', 'gid://gitlab/MergeRequest/300');
      expect(mr3).toHaveLength(3);
      expect(sock.identifiers('unsubscribe', 'gid://gitlab/MergeRequest/100')).toEqual([]);

      let before = fetches;
      sock.deliver({ identifier: mr1[1], message: {} });
      await pastDebounce();
      expect(fetches - before).toBe(1);

      before = fetches;
      sock.deliver({ identifier: mr3[0], message: {} });
      await pastDebounce();
      expect(fetches - before).toBe(1);
    } finally {
      group.dispose();
    }
    expect(FakeSocket.instances[0]!.closed).toBe(true);
  });
});

#!/usr/bin/env bun
/**
 * GitLab reads a dashboard group one request per iid, and gitlab.com allows a
 * Free-plan user 100 requests a minute. A group's poll therefore spends at
 * most 20 GitLab requests in any 60 s window, however many iids it watches:
 * iids are spread across polls, oldest-refreshed first, and an iid a push
 * event names goes ahead of the rest. GitHub reads the group in one request
 * per poll and is not budgeted.
 */
import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';
import { createDashboard } from '../src/MRDashboard.ts';
import * as glance from '../src/index.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import type { FetchPullRequestsOptions, GitProvider } from '../src/GitProvider.ts';
import type { WatcherSubscribeCallbacks } from '../src/RealtimeWatcher.ts';
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

interface Fetch {
  at: number;
  iids: number[];
}

interface ProviderBehaviour {
  /** Batches to reject before answering normally. */
  failBatches?: number;
  /** For the first batch only, the time each wave of 4 in-flight requests takes, as a forge slow for a moment would answer. */
  firstBatchWaveMs?: number;
}

function recordingProvider(providerName: 'gitlab' | 'github', behaviour: ProviderBehaviour = {}) {
  const rec = {
    fetches: [] as Fetch[],
    /** One entry per request the forge saw, at the time it was sent. */
    requests: [] as number[],
    subs: [] as number[][],
    cable: null as WatcherSubscribeCallbacks | null,
    provider: null as unknown as GitProvider,
  };
  let failures = behaviour.failBatches ?? 0;
  rec.provider = {
    providerName,
    baseURL: 'https://forge.example',
    capabilities: {} as ProviderCapabilities,
    async fetchPullRequests(options?: FetchPullRequestsOptions) {
      const iids = options?.iids ?? [];
      rec.fetches.push({ at: Date.now(), iids: [...iids] });
      const waveMs = rec.fetches.length === 1 ? (behaviour.firstBatchWaveMs ?? 0) : 0;
      for (let i = 0; i < iids.length; i += 4) {
        for (const _ of iids.slice(i, i + 4)) rec.requests.push(Date.now());
        if (waveMs > 0) await new Promise((resolve) => setTimeout(resolve, waveMs));
      }
      if (failures > 0) {
        failures--;
        throw new Error('forge refused the batch');
      }
      return iids.map(stubPR);
    },
    watchMR() {
      return () => {};
    },
    subscribePullRequestEvents(_p: string, prs: Array<{ iid: number }>, callbacks: WatcherSubscribeCallbacks) {
      rec.subs.push(prs.map((pr) => pr.iid));
      rec.cable ??= callbacks;
      return () => {};
    },
  } as unknown as GitProvider;
  return rec;
}

/** First time each iid came back from a fetch that did not fail. */
function firstRead(rec: { fetches: Fetch[] }, iid: number, failed: number): number | undefined {
  return rec.fetches.slice(failed).find((f) => f.iids.includes(iid))?.at;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Advances fake time a second at a time, letting each fetch settle. */
async function advance(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    jest.advanceTimersByTime(Math.min(1000, ms - elapsed));
    await flush();
  }
}

function requestTimes(fetches: Fetch[]): number[] {
  return fetches.flatMap((f) => f.iids.map(() => f.at));
}

function maxInAnyMinute(times: number[]): number {
  let max = 0;
  for (const start of times) {
    max = Math.max(max, times.filter((t) => t >= start && t < start + 60_000).length);
  }
  return max;
}

/** Longest stretch, from `from` to `until`, in which `iid` was not requested. */
function longestGap(fetches: Fetch[], iid: number, from: number, until: number): number {
  let last = from;
  let gap = 0;
  for (const f of fetches) {
    if (!f.iids.includes(iid)) continue;
    gap = Math.max(gap, f.at - last);
    last = f.at;
  }
  return Math.max(gap, until - last);
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('GitLab dashboard group poll budget', () => {
  test('30 iids with the websocket down: at most 20 requests in any minute, every iid within 142 s', async () => {
    const rec = recordingProvider('gitlab');
    const start = Date.now();
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onDisconnected();

    await advance(10 * 60_000);
    group.dispose();

    expect(maxInAnyMinute(requestTimes(rec.fetches))).toBeLessThanOrEqual(20);
    const end = Date.now();
    for (const iid of range(30)) {
      expect(longestGap(rec.fetches, iid, start, end)).toBeLessThanOrEqual(142_000);
    }
  });

  test('30 iids with the websocket up: polls hold 5 of the 20 back, every iid within 186 s', async () => {
    const rec = recordingProvider('gitlab');
    const start = Date.now();
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onConnected();

    await advance(10 * 60_000);
    group.dispose();

    const times = requestTimes(rec.fetches.slice(1));
    expect(maxInAnyMinute(times)).toBeLessThanOrEqual(15);
    expect(maxInAnyMinute(requestTimes(rec.fetches))).toBeLessThanOrEqual(20);
    const end = Date.now();
    for (const iid of range(30)) {
      expect(longestGap(rec.fetches, iid, start, end)).toBeLessThanOrEqual(186_000);
    }
  });

  test('an iid a push event names is read within a second, ahead of the others', async () => {
    const rec = recordingProvider('gitlab');
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onConnected();
    await advance(5 * 60_000);

    const before = rec.fetches.length;
    const at = Date.now();
    rec.cable?.onEvent(17);
    await advance(1000);
    group.dispose();

    const next = rec.fetches.slice(before);
    expect(next.length).toBe(1);
    expect(next[0]!.iids[0]).toBe(17);
    expect(next[0]!.at - at).toBeLessThan(1000);
    expect(maxInAnyMinute(requestTimes(rec.fetches))).toBeLessThanOrEqual(20);
  });

  test('3 iids with the websocket down are all read on every poll, as before', async () => {
    spyOn(Math, 'random').mockReturnValue(0.5);
    const rec = recordingProvider('gitlab');
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: [1, 2, 3], userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onDisconnected();

    await advance(5 * 60_000);
    group.dispose();
    (Math.random as unknown as { mockRestore(): void }).mockRestore();

    expect(rec.fetches.length).toBe(31);
    for (const f of rec.fetches) expect(f.iids).toEqual([1, 2, 3]);
  });

  test('GitHub reads all 30 iids on every poll, unbudgeted', async () => {
    spyOn(Math, 'random').mockReturnValue(0.5);
    const rec = recordingProvider('github');
    const group = createDashboard({ provider: rec.provider, projectPath: 'o/r', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onDisconnected();

    await advance(2 * 60_000);
    group.dispose();
    (Math.random as unknown as { mockRestore(): void }).mockRestore();

    expect(rec.fetches.length).toBe(13);
    for (const f of rec.fetches) expect(f.iids).toEqual(range(30));
  });
});

describe('GitLab dashboard group budget under failure, flaps, storms and restarts', () => {
  test('a failed batch does not count as a read: its iids go first once the window frees', async () => {
    const rec = recordingProvider('gitlab', { failBatches: 1 });
    const start = Date.now();
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(40), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onDisconnected();

    await advance(3 * 60_000);
    group.dispose();

    const failedBatch = rec.fetches[0]!.iids;
    for (const iid of failedBatch) {
      expect(firstRead(rec, iid, 1)! - start).toBeLessThanOrEqual(72_000);
    }
  });

  test('a push right after the cable connects is read within a second', async () => {
    const rec = recordingProvider('gitlab');
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onConnected();
    await advance(5000);

    const at = Date.now();
    rec.cable?.onEvent(25);
    await advance(1000);
    group.dispose();

    const read = rec.fetches.find((f) => f.at >= at && f.iids.includes(25));
    expect(read).toBeDefined();
    expect(read!.at - at).toBeLessThan(1000);
  });

  // Polls spend the whole window while the cable is down, since no push can
  // arrive; a push right after the reconnect waits at most for it to free.
  test('a push right after the cable reconnects is read within 61 s, and within a second when the window has room', async () => {
    const rec = recordingProvider('gitlab');
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onConnected();
    await advance(3 * 60_000);
    rec.cable?.onDisconnected();
    await advance(70_000);
    rec.cable?.onConnected();
    await flush();

    const at = Date.now();
    rec.cable?.onEvent(12);
    await advance(62_000);
    group.dispose();

    const read = rec.fetches.find((f) => f.at >= at && f.iids.includes(12));
    expect(read).toBeDefined();
    expect(read!.at - at).toBeLessThanOrEqual(61_000);
    expect(maxInAnyMinute(requestTimes(rec.fetches))).toBeLessThanOrEqual(20);
  });

  test('a push named while the window is full is read as soon as it frees, not at the next poll', async () => {
    const rec = recordingProvider('gitlab');
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onConnected();
    for (const iid of range(5)) rec.cable?.onEvent(iid + 15);
    await advance(1000);

    const at = Date.now();
    rec.cable?.onEvent(29);
    await advance(2 * 60_000);
    group.dispose();

    const firstFull = rec.fetches[0]!.at;
    const read = rec.fetches.find((f) => f.at >= at && f.iids.includes(29));
    expect(read).toBeDefined();
    expect(read!.at - firstFull).toBeLessThanOrEqual(61_000);
    expect(maxInAnyMinute(requestTimes(rec.fetches))).toBeLessThanOrEqual(20);
  });

  test('a storm of push events on 25 iids still reads every iid within 186 s', async () => {
    const rec = recordingProvider('gitlab');
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(40), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onConnected();

    for (let second = 0; second < 600; second++) {
      for (const iid of range(25)) rec.cable?.onEvent(iid);
      await advance(1000);
    }
    group.dispose();

    const start = rec.fetches[0]!.at;
    for (const iid of range(40)) {
      expect(longestGap(rec.fetches, iid, start, start + 600_000)).toBeLessThanOrEqual(186_000);
    }
    expect(maxInAnyMinute(requestTimes(rec.fetches))).toBeLessThanOrEqual(20);
  });

  test('an updateIids restart with a full window keeps push on the MRs already read', async () => {
    const rec = recordingProvider('gitlab');
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onConnected();
    await advance(2000);
    const subsBefore = rec.subs.length;

    group.updateIids(range(31));
    await advance(2000);
    group.dispose();

    const resubscribed = rec.subs.slice(subsBefore).flat();
    expect(resubscribed.length).toBeGreaterThan(0);
    expect(new Set(resubscribed)).toEqual(new Set(rec.fetches[0]!.iids));
  });

  test('a slow forge never sees more than 20 requests in any minute', async () => {
    const rec = recordingProvider('gitlab', { firstBatchWaveMs: 16_000 });
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: range(30), userId: null });
    group.subscribe(() => {});
    await flush();
    rec.cable?.onConnected();

    for (let second = 0; second < 600; second++) {
      if (second % 2 === 0) rec.cable?.onEvent((second % 30) + 1);
      await advance(1000);
    }
    group.dispose();

    expect(maxInAnyMinute(rec.requests)).toBeLessThanOrEqual(20);
  });

  test('duplicate iids in the initial list are read once', async () => {
    const rec = recordingProvider('gitlab');
    const group = createDashboard({ provider: rec.provider, projectPath: 'g/p', mrIid: [1, 2, 2, 3, 3, 3], userId: null });
    group.subscribe(() => {});
    await flush();
    group.dispose();

    expect(rec.fetches[0]!.iids).toEqual([1, 2, 3]);
  });
});

describe('the budget is part of the package API', () => {
  test('the package entry exports the request budget and the push reserve', () => {
    const entry = glance as Record<string, unknown>;
    expect(entry.GITLAB_GROUP_REQUESTS_PER_MINUTE).toBe(20);
    expect(entry.GITLAB_GROUP_PUSH_RESERVE).toBe(5);
  });
});

describe('GitLab push events name their MR', () => {
  test('a cable message for an MR channel calls onEvent with that MR iid', () => {
    jest.useRealTimers();
    const p = new GitLabProvider('https://gitlab.example', 't');
    const internals = p as unknown as {
      sharedCable: unknown;
      cableUp: boolean;
      cableWatcherCount: number;
      cableEventHandlers: Map<string, () => void>;
    };
    internals.sharedCable = { subscribe() {}, unsubscribe() {}, disconnect() {} };
    internals.cableUp = true;
    internals.cableWatcherCount = 1;
    const seen: Array<number | undefined> = [];

    const dispose = p.subscribePullRequestEvents(
      'g/p',
      [
        { id: 'gitlab:mr:700', iid: 7 },
        { id: 'gitlab:mr:800', iid: 8 },
      ],
      { onConnected() {}, onDisconnected() {}, onEvent: (iid) => seen.push(iid) },
    );
    for (const [id, handler] of internals.cableEventHandlers) {
      if (id.includes('MergeRequest/800')) {
        handler();
        break;
      }
    }
    dispose();

    expect(seen).toEqual([8]);
  });
});

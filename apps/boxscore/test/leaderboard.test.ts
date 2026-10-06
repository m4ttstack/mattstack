import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import type {
  FetchMergeRequestIndexOptions,
  MergeRequestIndexRow,
} from '@mattstack/glance';
import { __setSettingReader } from '../src/server/config/index.js';
import type {
  GitProvider,
  SourceProvider,
} from '../src/server/source/index.js';
import {
  baseWindow,
  customWindow,
  priorWindow,
  resolvePreset,
} from '../src/server/util/window.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-leaderboard-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getLeaderboard, getUserDetail, ColdCacheError } =
  await import('../src/server/leaderboard.js');
const { getStore, __resetStore } = await import('../src/server/store/index.js');
const { __setProviderFactory } = await import('../src/server/source/index.js');
const { __setCurrentUser, __resetCurrentUser } =
  await import('../src/server/config/current-user.js');
const { __setTeamReader } = await import('../src/server/config/team.js');
const { ViewerForbiddenError } = await import('../src/server/viewer-scope.js');

const PROJECT = 'acme/app';
const SETTINGS: Record<string, unknown> = {
  'boxscore.projects': [PROJECT],
  'mattstack.roster': [{ username: 'alice' }],
  'mattstack.integrations': { forge: { host: 'gl.example' } },
};

/** A provider that answers every fetch with nothing and records each project scan's options. */
function fakeProvider(
  scan: (
    options: FetchMergeRequestIndexOptions
  ) => Promise<MergeRequestIndexRow[]> = async () => []
) {
  const scans: FetchMergeRequestIndexOptions[] = [];
  const provider: SourceProvider = {
    async fetchMergeRequestIndex(options) {
      scans.push(options);
      return scan(options);
    },
    async fetchMergeRequestMetrics() {
      return null;
    },
    async fetchProject(projectPath) {
      return { id: `gitlab:${projectPath}`, fullPath: projectPath };
    },
    async fetchProjectPipelines() {
      return [];
    },
    async fetchUserEvents() {
      return [];
    },
    async restRequest() {
      return new Response('[]', { status: 200 });
    },
  };
  __setProviderFactory(() => provider as unknown as GitProvider);
  return { scans };
}

beforeAll(() => {
  __setSettingReader(<T>(k: string) => SETTINGS[k] as T | undefined);
  // resolveEnv() reads GITLAB_TOKEN through the env-first secrets seam.
  process.env.GITLAB_TOKEN = 'test-token';
});
afterAll(() => {
  __setSettingReader(null);
  __setProviderFactory(null);
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => getStore().clear());

describe('getLeaderboard: refresh warnings', () => {
  it("a failed project scan's warning reaches the built response, not just runRefresh's return", async () => {
    fakeProvider(async () => {
      throw new Error('scan boom');
    });

    const res = await getLeaderboard({
      window: resolvePreset('30d', new Date()),
      refresh: true,
      trend: false,
    });

    expect(res.fromCache).toBe(false);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({
        code: 'mr_fetch_failed',
        message: expect.stringContaining('scan boom'),
      })
    );
  });
});

describe('getLeaderboard: the refresh window', () => {
  it('a preset refresh scans the 90-day base window, not the requested range', async () => {
    const { scans } = fakeProvider();
    const now = new Date();

    await getLeaderboard({
      window: resolvePreset('30d', now),
      refresh: true,
      trend: false,
    });

    const base = baseWindow(false, now);
    expect(scans.map(s => s.updatedAfter)).toEqual([base.start]);
    expect(getStore().scanFloor(PROJECT)).toBe(base.start);
  });

  it('with trend on, a preset refresh scans the 180-day base window', async () => {
    const { scans } = fakeProvider();
    const now = new Date();

    await getLeaderboard({
      window: resolvePreset('7d', now),
      refresh: true,
      trend: true,
    });

    expect(scans.map(s => s.updatedAfter)).toEqual([
      baseWindow(true, now).start,
    ]);
  });

  it('a custom range the base cannot cover is fetched as itself', async () => {
    const { scans } = fakeProvider();
    const window = customWindow(
      '2026-03-01T00:00:00.000Z',
      '2026-07-07T00:00:00.000Z'
    );

    await getLeaderboard({ window, refresh: true, trend: false });

    expect(scans.map(s => s.updatedAfter)).toEqual([window.start]);
  });

  it("a custom range the base cannot cover, with trend on, is fetched from its prior window's start", async () => {
    const { scans } = fakeProvider();
    const window = customWindow(
      '2026-03-01T00:00:00.000Z',
      '2026-07-07T00:00:00.000Z'
    );

    await getLeaderboard({ window, refresh: true, trend: true });

    expect(scans.map(s => s.updatedAfter)).toEqual([priorWindow(window).start]);
  });
});

describe('getLeaderboard: cacheOnly against the scan floor', () => {
  it('after a non-trend refresh, a 90d request with trend is cold: its prior window precedes the floor', async () => {
    fakeProvider();
    const now = new Date();
    await getLeaderboard({
      window: resolvePreset('30d', now),
      refresh: true,
      trend: false,
    });

    await expect(
      getLeaderboard({
        window: resolvePreset('90d', now),
        refresh: false,
        trend: true,
        cacheOnly: true,
      })
    ).rejects.toBeInstanceOf(ColdCacheError);
  });

  it('after a non-trend refresh, a 30d request with trend is warm: 60 days sits inside the 90-day floor', async () => {
    fakeProvider();
    const now = new Date();
    await getLeaderboard({
      window: resolvePreset('30d', now),
      refresh: true,
      trend: false,
    });

    const res = await getLeaderboard({
      window: resolvePreset('30d', now),
      refresh: false,
      trend: true,
      cacheOnly: true,
    });

    expect(res.fromCache).toBe(true);
    expect(res.hasTrend).toBe(true);
  });

  it('a trend refresh lowers the floor to 180 days, so the 90d-with-trend request is then warm', async () => {
    fakeProvider();
    const now = new Date();
    await getLeaderboard({
      window: resolvePreset('30d', now),
      refresh: true,
      trend: true,
    });

    const res = await getLeaderboard({
      window: resolvePreset('90d', now),
      refresh: false,
      trend: true,
      cacheOnly: true,
    });

    expect(res.hasTrend).toBe(true);
  });
});

describe('viewer roles', () => {
  const ROLES_SETTINGS: Record<string, unknown> = {
    ...SETTINGS,
    'mattstack.roster': [{ username: 'alice' }, { username: 'bob' }],
    'boxscore.hiddenMembers': ['alice'],
  };
  const window = resolvePreset('30d', new Date('2026-06-01T00:00:00Z'));

  beforeEach(() => {
    __setSettingReader(<T>(k: string) => ROLES_SETTINGS[k] as T | undefined);
    fakeProvider();
    __setTeamReader(() => ({ joined: true }));
    __setCurrentUser({ username: 'Alice', name: null });
  });
  afterEach(() => {
    __setTeamReader(null);
    __resetCurrentUser();
    __setSettingReader(<T>(k: string) => SETTINGS[k] as T | undefined);
  });

  it('serves an unlisted member only their own unranked row, even when they hid themselves', async () => {
    const res = await getLeaderboard({ window, refresh: false, trend: false });
    expect(res.viewer).toEqual({ username: 'alice', role: 'self' });
    expect(res.users.map(u => u.username)).toEqual(['alice']);
    expect(res.leaders).toEqual({});
    expect(res.users[0]!.metrics.mrsMerged.rank).toBeNull();
  });

  it('serves the full board to a member granted team', async () => {
    ROLES_SETTINGS['boxscore.roles'] = { alice: 'team' };
    try {
      const res = await getLeaderboard({
        window,
        refresh: false,
        trend: false,
      });
      expect(res.viewer.role).toBe('team');
      expect(res.users.map(u => u.username)).toEqual(['bob']);
    } finally {
      delete ROLES_SETTINGS['boxscore.roles'];
    }
  });

  it("refuses a Self viewer someone else's detail", async () => {
    await expect(
      getUserDetail({ window, refresh: false, trend: false, user: 'bob' })
    ).rejects.toBeInstanceOf(ViewerForbiddenError);
  });

  it('serves a Self viewer their own detail with ranks blanked, any case', async () => {
    const res = await getUserDetail({
      window,
      refresh: false,
      trend: false,
      user: 'ALICE',
    });
    expect(res.user.username).toBe('alice');
    expect(res.user.metrics.mrsMerged.rank).toBeNull();
  });

  it('locks a viewer the lookup could not identify', async () => {
    __resetCurrentUser();
    const res = await getLeaderboard({ window, refresh: false, trend: false });
    expect(res.viewer).toEqual({ username: null, role: 'self' });
    expect(res.users).toEqual([]);
  });
});

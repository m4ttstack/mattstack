import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  MergeRequestIndexRow,
  MRDetail,
  PullRequest,
} from '@mattstack/glance';
import type { Env } from '../src/server/config/index.js';
import {
  __setRosterReader,
  __setSettingReader,
} from '../src/server/config/index.js';
import type {
  GitHubSourceProvider,
  GitProvider,
} from '../src/server/source/index.js';
import { resolvePreset } from '../src/server/util/window.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-leaderboard-github-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getLeaderboard, getUserDetail } =
  await import('../src/server/leaderboard.js');
const { __resetStore } = await import('../src/server/store/index.js');
const { __setProviderFactory } = await import('../src/server/source/index.js');
const { __setCurrentUser, __resetCurrentUser } =
  await import('../src/server/config/current-user.js');
const { __setTeamReader } = await import('../src/server/config/team.js');
const { __setGitHubTokenDeps } =
  await import('../src/server/config/github-token.js');

const REPO = 'o/r';
const GITLAB_SECRET = 'gl-secret-e2e';
const GITHUB_SECRET = 'gh-tkn-e2e';
const SETTINGS: Record<string, unknown> = {
  'boxscore.projects': [REPO],
  'mattstack.integrations': {
    forge: { host: 'github.com', provider: 'github' },
  },
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const at = (daysAgo: number, hours = 0): string =>
  new Date(NOW - daysAgo * DAY + hours * HOUR).toISOString();

interface FakePr {
  iid: number;
  title: string;
  author: string;
  createdAt: string;
  mergedAt: string;
  files: { filename: string; additions: number; deletions: number }[];
  commits: { login: string; date: string }[];
  approvedBy: string[];
  notes: { author: string; createdAt: string; inline: boolean }[];
}

const PR1_TITLE = 'Add the billing export';
const PRS: FakePr[] = [
  {
    iid: 1,
    title: PR1_TITLE,
    author: 'ada',
    createdAt: at(10),
    mergedAt: at(9),
    files: [{ filename: 'src/export.ts', additions: 30, deletions: 10 }],
    commits: [
      { login: 'ada', date: at(11) },
      { login: 'Ada', date: at(10) },
    ],
    approvedBy: ['bob'],
    notes: [
      { author: 'dependabot[bot]', createdAt: at(10, 0.1), inline: false },
      { author: 'bob', createdAt: at(10, 3), inline: true },
      { author: 'bob', createdAt: at(10, 4), inline: false },
    ],
  },
  {
    iid: 2,
    title: 'Page the export list',
    author: 'ada',
    createdAt: at(8),
    mergedAt: at(7),
    files: [{ filename: 'src/list.ts', additions: 20, deletions: 5 }],
    commits: [{ login: 'ada', date: at(8, 1) }],
    approvedBy: ['bob'],
    notes: [
      { author: 'dependabot[bot]', createdAt: at(8, 0.05), inline: false },
      { author: 'bob', createdAt: at(8, 2), inline: true },
    ],
  },
  {
    iid: 3,
    title: `Revert "${PR1_TITLE}"`,
    author: 'bob',
    createdAt: at(8, -2),
    mergedAt: at(8),
    files: [{ filename: 'src/export.ts', additions: 10, deletions: 30 }],
    commits: [{ login: 'bob', date: at(8, -2) }],
    approvedBy: [],
    notes: [{ author: 'ada', createdAt: at(8, -1), inline: false }],
  },
];

const RUNS: Record<string, { id: number; created_at: string }[]> = {
  ada: [
    { id: 101, created_at: at(10, 1) },
    { id: 102, created_at: at(8, 1) },
  ],
  bob: [],
};

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const prOf = (iid: number): FakePr => {
  const pr = PRS.find(p => p.iid === iid);
  if (!pr) throw new Error(`no fake PR ${iid}`);
  return pr;
};

/** Every call the fake answers, so the test can prove nothing went anywhere else. */
const calls: { method: string; args: string }[] = [];
const envs: Env[] = [];
const offFake: string[] = [];

function makeProvider(): GitHubSourceProvider {
  const record = (method: string, ...args: unknown[]) =>
    calls.push({ method, args: JSON.stringify(args) });
  return {
    async fetchUser(username) {
      record('fetchUser', username);
      return {
        id: `github:user:${username === 'ada' ? 1 : 2}`,
        username,
        name: username,
        avatarUrl: null,
      };
    },
    async fetchMergeRequestIndex(options) {
      record('fetchMergeRequestIndex', options.projectPaths);
      return PRS.map((p): MergeRequestIndexRow => ({
        iid: p.iid,
        projectPath: REPO,
        title: p.title,
        state: 'merged',
        createdAt: p.createdAt,
        updatedAt: p.mergedAt,
        mergedAt: p.mergedAt,
        authorUsername: p.author,
        sourceBranch: `feat/${p.iid}`,
        labels: [],
      }));
    },
    async fetchSingleMR(projectPath, iid) {
      record('fetchSingleMR', projectPath, iid);
      const p = prOf(iid);
      const additions = p.files.reduce((n, f) => n + f.additions, 0);
      const deletions = p.files.reduce((n, f) => n + f.deletions, 0);
      return {
        description: `body of #${iid}`,
        diffStats: { additions, deletions, filesChanged: p.files.length },
        approvedBy: p.approvedBy.map(username => ({ username })),
      } as unknown as PullRequest;
    },
    async fetchMRDiscussions(repositoryId, iid) {
      record('fetchMRDiscussions', repositoryId, iid);
      const notes = prOf(iid).notes.map((n, i) => ({
        id: iid * 100 + i,
        body: 'looks good',
        author: { username: n.author },
        createdAt: n.createdAt,
        system: false,
        type: n.inline ? 'DiffNote' : null,
        resolvable: null,
        resolved: null,
        position: null,
      }));
      return {
        mrIid: iid,
        repositoryId,
        discussions: [
          { id: `d${iid}`, resolvable: null, resolved: null, notes },
        ],
      } as unknown as MRDetail;
    },
    async restRequest(method, path) {
      record('restRequest', method, path);
      const url = new URL(path, 'https://api.github.com');
      if (!path.startsWith('/repos/')) offFake.push(path);
      const pull = url.pathname.match(/^\/repos\/o\/r\/pulls\/(\d+)\/(\w+)$/);
      if (pull) {
        const p = prOf(Number(pull[1]));
        if (pull[2] === 'files') return json(p.files);
        if (pull[2] === 'commits') {
          return json(
            p.commits.map(c => ({
              author: { login: c.login },
              commit: { author: { date: c.date } },
            }))
          );
        }
      }
      if (url.pathname === '/repos/o/r/actions/runs') {
        const actor = url.searchParams.get('actor') ?? '';
        const runs = (RUNS[actor] ?? []).map(r => ({
          ...r,
          actor: { login: actor },
          status: 'completed',
          conclusion: 'success',
        }));
        return json({ total_count: runs.length, workflow_runs: runs });
      }
      offFake.push(path);
      return new Response('not found', { status: 404 });
    },
  };
}

const globalFetches: string[] = [];

beforeAll(() => {
  process.env.GITLAB_TOKEN = GITLAB_SECRET;
  __setSettingReader(<T>(k: string) => SETTINGS[k] as T | undefined);
  __setRosterReader(() => [{ username: 'ada' }, { username: 'bob' }]);
  __setGitHubTokenDeps({ env: { GITHUB_TOKEN: GITHUB_SECRET } });
  __setTeamReader(() => ({ seesTeam: true }));
  __setCurrentUser({ username: 'ada', name: null });
  const provider = makeProvider();
  __setProviderFactory(env => {
    envs.push(env);
    return provider as unknown as GitProvider;
  });
  vi.stubGlobal('fetch', (async (url: string | URL | Request) => {
    globalFetches.push(String(url));
    throw new Error('no network in this test');
  }) as unknown as typeof fetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
  __setSettingReader(null);
  __setRosterReader(null);
  __setGitHubTokenDeps(null);
  __setTeamReader(null);
  __setProviderFactory(null);
  __resetCurrentUser();
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});

describe('a GitHub team end to end', () => {
  const window = resolvePreset('30d', new Date(NOW));

  it('refreshes from GitHub and scores every metric the team earned', async () => {
    const res = await getLeaderboard({ window, refresh: true, trend: false });

    expect(res.forge).toBe('github');
    expect(res.baseUrl).toBe('https://github.com');
    expect(res.users.map(u => u.username).sort()).toEqual(['ada', 'bob']);

    const ada = res.users.find(u => u.username === 'ada')!.metrics;
    expect(ada.mrsMerged.value).toBe(2);
    expect(ada.additions.value).toBe(50);
    expect(ada.deletions.value).toBe(15);
    expect(ada.codingDays.value).toBe(3);
    expect(ada.pipelines.value).toBe(2);
    expect(ada.reviewLatencyHours.p50).not.toBeNull();
    expect(ada.longestStreak.value).toBeGreaterThan(0);
    expect(ada.sizeHealthPct.value).toBeGreaterThan(0);
    expect(ada.revertedCount.value).toBe(1);
    expect(ada.revertRate.value).toBeGreaterThan(0);

    const bob = res.users.find(u => u.username === 'bob')!.metrics;
    expect(bob.mrsReviewed.value).toBe(2);
    expect(bob.reviewDepth.value).toBeGreaterThan(0);
    expect(bob.responseLatencyHours.p50).not.toBeNull();
  });

  it("dependabot is no row, and its early comments never start ada's review clock", async () => {
    const res = await getLeaderboard({ window, refresh: false, trend: false });

    expect(res.users.map(u => u.username)).not.toContain('dependabot[bot]');
    const ada = res.users.find(u => u.username === 'ada')!.metrics;
    // bob first touched the PRs 3h and 2h after they opened; dependabot within minutes.
    expect(ada.reviewLatencyHours.p50).toBeGreaterThanOrEqual(2);
  });

  it('every request went to the fake, with the GitHub token only', () => {
    expect(calls.length).toBeGreaterThan(0);
    expect(offFake).toEqual([]);
    expect(globalFetches).toEqual([]);
    expect(envs.length).toBeGreaterThan(0);
    for (const env of envs) {
      expect(env.forge).toBe('github');
      expect(env.baseUrl).toBe('https://github.com');
      expect(env.token).toBe(GITHUB_SECRET);
    }
  });

  it('the empty-projects hint names owner/repo', async () => {
    const projects = SETTINGS['boxscore.projects'];
    SETTINGS['boxscore.projects'] = [];
    try {
      await expect(
        getLeaderboard({ window, refresh: false, trend: false })
      ).rejects.toThrow(
        'boxscore.projects is empty: add at least one "owner/repo" (rt settings).'
      );
    } finally {
      SETTINGS['boxscore.projects'] = projects;
    }
  });

  it('a roster spelling that differs in case from the stored logins still gets the credit', async () => {
    __setRosterReader(() => [{ username: 'ADA' }, { username: 'Bob' }]);
    try {
      const res = await getLeaderboard({
        window,
        refresh: false,
        trend: false,
      });

      const ada = res.users.find(u => u.username === 'ADA')!.metrics;
      expect(ada.mrsMerged.value).toBe(2);
      expect(ada.codingDays.value).toBe(3);
      expect(ada.pipelines.value).toBe(2);
      const bob = res.users.find(u => u.username === 'Bob')!.metrics;
      expect(bob.mrsReviewed.value).toBe(2);
      expect(res.users.find(u => u.username === 'ADA')!.resolved).toBe(true);
      expect(res.users.find(u => u.username === 'Bob')!.resolved).toBe(true);

      const detail = await getUserDetail({
        window,
        refresh: false,
        trend: false,
        user: 'ADA',
      });
      expect(detail.evidence.mrsMerged!.rows).toHaveLength(2);
    } finally {
      __setRosterReader(() => [{ username: 'ada' }, { username: 'bob' }]);
    }
  });

  it("the detail response links ada's merged rows to GitHub pull requests", async () => {
    const res = await getUserDetail({
      window,
      refresh: false,
      trend: false,
      user: 'ada',
    });

    expect(res.forge).toBe('github');
    const hrefs = res.evidence.mrsMerged!.rows.map(r => r.href).sort();
    expect(hrefs).toEqual([
      'https://github.com/o/r/pull/1',
      'https://github.com/o/r/pull/2',
    ]);
  });
});

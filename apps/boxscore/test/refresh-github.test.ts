import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { MergeRequestIndexRow, PullRequest } from '@mattstack/glance';
import type { BoxscoreSettings, Env } from '../src/server/config/index.js';
import type {
  ForgeSource,
  GitHubSourceProvider,
  GitProvider,
} from '../src/server/source/index.js';
import type { RefreshProgress, TimeWindow } from '../src/shared/types.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-refresh-github-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getStore, mrKey, __resetStore } =
  await import('../src/server/store/index.js');
const { runRefresh } = await import('../src/server/refresh/run.js');
const { githubSource } = await import('../src/server/source/index.js');

beforeEach(() => getStore().clear());
afterAll(() => {
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});

const WINDOW: TimeWindow = {
  start: '2026-05-01T00:00:00.000Z',
  end: '2026-05-31T00:00:00.000Z',
  key: 'custom',
};
const ENV: Env = {
  forge: 'github',
  baseUrl: 'https://github.com',
  token: 'tkn',
};

function settings(over: Partial<BoxscoreSettings> = {}): BoxscoreSettings {
  const roster = over.roster ?? [{ username: 'ada' }];
  return {
    forge: 'github',
    projects: ['o/r'],
    roster,
    orgRoster: roster,
    hiddenMembers: [],
    users: roster.map(r => r.username),
    doneStates: [],
    sizeBand: { tooSmall: 10, tooLarge: 400 },
    excludeFilePatterns: [],
    ignoredMrs: [],
    botPatterns: [],
    defaultRange: '30d',
    baseUrl: 'https://github.com',
    declaredHost: 'github.com',
    roles: {},
    ...over,
  };
}

/** Records any call runRefresh makes on the GitLab-shaped provider; a GitHub refresh makes none. */
function makeGitLabSpy() {
  const calls: string[] = [];
  const record = (method: string) => async () => {
    calls.push(method);
    return method === 'restRequest' ? new Response('[]') : [];
  };
  const provider = {
    fetchMergeRequestIndex: record('fetchMergeRequestIndex'),
    fetchMergeRequestMetrics: record('fetchMergeRequestMetrics'),
    fetchProject: record('fetchProject'),
    fetchProjectPipelines: record('fetchProjectPipelines'),
    fetchUserEvents: record('fetchUserEvents'),
    restRequest: record('restRequest'),
  };
  return { provider: provider as unknown as GitProvider, calls };
}

const indexRow = (
  over: Partial<MergeRequestIndexRow> = {}
): MergeRequestIndexRow => ({
  iid: 7,
  projectPath: 'o/r',
  title: 'T',
  state: 'merged',
  createdAt: '2026-05-02T00:00:00Z',
  updatedAt: '2026-05-05T00:00:00Z',
  mergedAt: '2026-05-05T00:00:00Z',
  authorUsername: 'ada',
  sourceBranch: 'feat',
  labels: ['bug'],
  ...over,
});

const pr = (): PullRequest =>
  ({
    description: 'b',
    diffStats: { additions: 10, deletions: 2, filesChanged: 1 },
    approvedBy: [],
  }) as unknown as PullRequest;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

interface GitHubFakeOptions {
  index?: MergeRequestIndexRow[];
  emptyFor?: number[];
}

function makeGitHubFake(opts: GitHubFakeOptions = {}) {
  const provider: GitHubSourceProvider = {
    async fetchUser(username) {
      return {
        id: 'github:user:5',
        username,
        name: username,
        avatarUrl: null,
      };
    },
    async fetchMergeRequestIndex() {
      return opts.index ?? [indexRow()];
    },
    async fetchSingleMR(_projectPath, iid) {
      return opts.emptyFor?.includes(iid) ? null : pr();
    },
    async fetchMRDiscussions(repositoryId, iid) {
      return { mrIid: iid, repositoryId, discussions: [] };
    },
    async restRequest(_method, path) {
      const { pathname } = new URL(path, 'https://api.github.com');
      if (pathname.endsWith('/files')) {
        return json([{ filename: 'a.ts', additions: 10, deletions: 2 }]);
      }
      if (pathname.endsWith('/commits')) {
        return json([
          {
            author: { login: 'Ada' },
            commit: { author: { date: '2026-05-03T10:00:00Z' } },
          },
        ]);
      }
      if (pathname.endsWith('/actions/runs')) {
        return json({
          total_count: 1,
          workflow_runs: [
            {
              id: 9,
              actor: { login: 'ada' },
              status: 'completed',
              conclusion: 'success',
              created_at: '2026-05-04T00:00:00Z',
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    },
  };
  return githubSource(provider, { knownLogins: ['ada'] });
}

describe('runRefresh through a GitHub source', () => {
  it('github refresh stores metrics, commits and runs', async () => {
    const store = getStore();
    const { provider } = makeGitLabSpy();

    await runRefresh({
      store,
      provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      source: makeGitHubFake(),
    });

    expect(store.pushEventsBetween(WINDOW.start, WINDOW.end)).toEqual([
      {
        username: 'ada',
        createdAt: '2026-05-03T10:00:00Z',
        repositoryId: 'github:o/r',
      },
    ]);
    const [stored] = store.metricsByKeys([mrKey('o/r', 7)]);
    expect(stored).toMatchObject({
      projectPath: 'o/r',
      iid: 7,
      description: 'b',
      fileStats: [{ path: 'a.ts', additions: 10, deletions: 2 }],
      labels: ['bug'],
    });
    expect(store.pipelinesBetween(WINDOW.start, WINDOW.end)).toEqual([
      {
        id: 'github:run:9',
        projectPath: 'o/r',
        username: 'ada',
        status: 'success',
        createdAt: '2026-05-04T00:00:00Z',
      },
    ]);
  });

  it('github refresh skips the project id and push event phases', async () => {
    const { provider, calls } = makeGitLabSpy();
    const phases = new Set<string>();

    await runRefresh({
      store: getStore(),
      provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      source: makeGitHubFake(),
      onProgress: (p: Omit<RefreshProgress, 'window'>) => phases.add(p.phase),
    });

    expect(phases.has('pipelines')).toBe(true);
    expect(phases.has('pushes')).toBe(false);
    expect(calls).not.toContain('fetchProject');
    expect(calls).not.toContain('fetchUserEvents');
  });

  it('a failed detail counts in mr_detail_partial', async () => {
    const { provider } = makeGitLabSpy();

    const warnings = await runRefresh({
      store: getStore(),
      provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      source: makeGitHubFake({
        index: [indexRow({ iid: 7 }), indexRow({ iid: 8 })],
        emptyFor: [8],
      }),
    });

    const partial = warnings.filter(w => w.code === 'mr_detail_partial');
    expect(partial).toHaveLength(1);
    expect(partial[0]!.message).toContain('1/2');
  });

  it('source warnings reach the returned warnings', async () => {
    const { provider } = makeGitLabSpy();
    let pending = [
      { code: 'pipeline_fetch_failed' as const, message: 'capped' },
    ];
    const source: ForgeSource = {
      resolveIdentity: async username => ({
        username,
        name: username,
        resolved: true,
        userId: 5,
        fetchedAt: new Date().toISOString(),
      }),
      scanProject: async () => [],
      fetchDetail: async () => null,
      fetchPipelines: async () => [],
      readsPushEvents: false,
      takeWarnings() {
        const taken = pending;
        pending = [];
        return taken;
      },
    };

    const warnings = await runRefresh({
      store: getStore(),
      provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      source,
    });

    expect(warnings.filter(w => w.code === 'pipeline_fetch_failed')).toEqual([
      { code: 'pipeline_fetch_failed', message: 'capped' },
    ]);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { MergeRequestIndexRow, PullRequest } from '@mattstack/glance';
import type { BoxscoreSettings, Env } from '../src/server/config/index.js';
import type {
  ForgeSource,
  GitHubSourceProvider,
  GitProvider,
} from '../src/server/source/index.js';
import type {
  LeaderboardWarning,
  RefreshProgress,
  TimeWindow,
} from '../src/shared/types.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-refresh-github-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getStore, mrKey, __resetStore } =
  await import('../src/server/store/index.js');
const { runRefresh } = await import('../src/server/refresh/run.js');
const { githubSource, sourceFor } =
  await import('../src/server/source/index.js');
const { toIndexRow } = await import('../src/server/source/mrs.js');

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
    if (method === 'restRequest') return new Response('[]');
    return method === 'fetchProject' ? null : [];
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
  runsTotal?: number;
}

function makeGitHubProvider(opts: GitHubFakeOptions = {}) {
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
          total_count: opts.runsTotal ?? 1,
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
  return provider;
}

const makeGitHubFake = (opts: GitHubFakeOptions = {}) =>
  githubSource(makeGitHubProvider(opts), { knownLogins: ['ada'] });

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

  it('reports the detail phase and its partial warning in PR copy', async () => {
    const { provider } = makeGitLabSpy();
    const labels: string[] = [];

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
      onProgress: (p: Omit<RefreshProgress, 'window'>) => {
        if (p.phase === 'mrs-detail') labels.push(p.label);
      },
    });

    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toBe('Fetching PR details');
    const partial = warnings.find(w => w.code === 'mr_detail_partial')!;
    expect(partial.message).toMatch(/^Detail fetch failed for 1\/2 PRs /);
    expect(partial.message).not.toMatch(/\bMRs?\b/);
  });

  it('says comments, not notes, in the github partial detail warning', async () => {
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

    const partial = warnings.find(w => w.code === 'mr_detail_partial')!;
    expect(partial.message).toMatch(
      /; those count with zeroed diff\/comments\.$/
    );
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
      detailConcurrency: 2,
      reusesFreshSnapshots: 'any',
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
  it('a pipeline cap warning is returned once', async () => {
    const { provider } = makeGitLabSpy();

    const warnings = await runRefresh({
      store: getStore(),
      provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      source: makeGitHubFake({ runsTotal: 1001 }),
    });

    expect(
      warnings.filter(w => w.code === 'pipeline_fetch_failed')
    ).toHaveLength(1);
  });

  it('source warnings from the pipelines step precede later steps', async () => {
    const { provider } = makeGitLabSpy();
    let pending: LeaderboardWarning[] = [];
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
      fetchPipelines: async () => {
        pending.push({ code: 'pipeline_fetch_failed', message: 'capped' });
        return [];
      },
      readsPushEvents: true,
      detailConcurrency: 6,
      reusesFreshSnapshots: 'merged',
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

    const codes = warnings.map(w => w.code);
    expect(codes.filter(c => c === 'pipeline_fetch_failed')).toHaveLength(1);
    expect(codes).toContain('project_id_failed');
    expect(codes.indexOf('pipeline_fetch_failed')).toBeLessThan(
      codes.indexOf('project_id_failed')
    );
  });
});

describe('sourceFor', () => {
  it('github canonicalizes a login known only from the org roster', async () => {
    const provider = makeGitHubProvider({
      index: [indexRow({ authorUsername: 'Eve' })],
    }) as unknown as GitProvider;
    const source = sourceFor(
      ENV,
      provider,
      settings({
        roster: [{ username: 'ada' }],
        orgRoster: [{ username: 'ada' }, { username: 'eve' }],
      })
    );

    expect(source.readsPushEvents).toBe(false);
    const rows = await source.scanProject('o/r', WINDOW.start, {});
    expect(rows.map(r => r.authorUsername)).toEqual(['eve']);
  });

  it('github takes the team roster spelling over the org roster spelling', async () => {
    const provider = makeGitHubProvider({
      index: [indexRow({ authorUsername: 'ADA' })],
    }) as unknown as GitProvider;
    const source = sourceFor(
      ENV,
      provider,
      settings({
        roster: [{ username: 'Ada' }],
        orgRoster: [{ username: 'ada' }],
      })
    );

    const rows = await source.scanProject('o/r', WINDOW.start, {});
    expect(rows.map(r => r.authorUsername)).toEqual(['Ada']);
  });

  it('gitlab or an absent forge reads push events', () => {
    const { provider } = makeGitLabSpy();
    const gitlabEnv: Env = { baseUrl: 'https://gl.example', token: 'tkn' };

    expect(sourceFor(gitlabEnv, provider, settings()).readsPushEvents).toBe(
      true
    );
    expect(
      sourceFor({ ...gitlabEnv, forge: 'gitlab' }, provider, settings())
        .readsPushEvents
    ).toBe(true);
  });
});

describe('warm refresh re-reads only PRs whose updatedAt moved', () => {
  const ROWS = [
    indexRow({ iid: 1, state: 'opened', mergedAt: null }),
    indexRow({ iid: 2, state: 'closed', mergedAt: null }),
    indexRow({ iid: 3, state: 'merged' }),
  ];

  function countingGitHub(index: () => MergeRequestIndexRow[]) {
    const fetched: number[] = [];
    const provider = makeGitHubProvider();
    provider.fetchMergeRequestIndex = async () => index();
    const read = provider.fetchSingleMR.bind(provider);
    provider.fetchSingleMR = async (projectPath, iid, me, onWarning) => {
      fetched.push(iid);
      return read(projectPath, iid, me, onWarning);
    };
    return { provider, fetched };
  }

  const refresh = (provider: GitHubSourceProvider) =>
    runRefresh({
      store: getStore(),
      provider: makeGitLabSpy().provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      source: sourceFor(ENV, provider as unknown as GitProvider, settings()),
    });

  it('github skips a fresh open, closed or merged PR on the next refresh', async () => {
    const { provider, fetched } = countingGitHub(() => ROWS);

    await refresh(provider);
    expect(fetched.sort()).toEqual([1, 2, 3]);

    fetched.length = 0;
    await refresh(provider);
    expect(fetched).toEqual([]);
  });

  it('github re-reads a PR whose updatedAt moved past its snapshot', async () => {
    let rows = ROWS;
    const { provider, fetched } = countingGitHub(() => rows);
    await refresh(provider);

    rows = ROWS.map(r =>
      r.iid === 2 ? { ...r, updatedAt: '2026-05-09T00:00:00Z' } : r
    );
    fetched.length = 0;
    await refresh(provider);
    expect(fetched).toEqual([2]);
  });

  it('gitlab still re-reads a fresh open MR', async () => {
    const gitlabEnv: Env = { baseUrl: 'https://gl.example', token: 'tkn' };
    const fetched: number[] = [];
    const glRow = indexRow({
      iid: 4,
      projectPath: 'g/p',
      state: 'opened',
      mergedAt: null,
    });
    const provider = {
      ...makeGitLabSpy().provider,
      fetchMergeRequestIndex: async () => [glRow],
      fetchMergeRequestMetrics: async (projectPath: string, iid: number) => {
        fetched.push(iid);
        return {
          projectPath,
          iid,
          description: '',
          diffStats: null,
          fileStats: [],
          labels: [],
          approvedByUsernames: [],
          notes: [],
        };
      },
    } as unknown as GitProvider;
    const glSettings = settings({
      forge: undefined,
      projects: ['g/p'],
      baseUrl: 'https://gl.example',
      declaredHost: 'gl.example',
    });
    const run = () =>
      runRefresh({
        store: getStore(),
        provider,
        settings: glSettings,
        env: gitlabEnv,
        window: WINDOW,
      });

    await run();
    await run();
    expect(fetched).toEqual([4, 4]);
  });
});

describe('detail eligibility reads stored authors through the current roster', () => {
  const storedRow = (projectPath: string) =>
    toIndexRow(
      indexRow({ iid: 7, projectPath, authorUsername: 'ADA' }),
      '2026-05-06T00:00:00Z'
    );

  it('github reads a PR whose stored author differs in case from the roster', async () => {
    getStore().upsertIndexRows([storedRow('o/r')]);
    const fetched: number[] = [];
    const provider = makeGitHubProvider({ index: [] });
    const read = provider.fetchSingleMR.bind(provider);
    provider.fetchSingleMR = async (projectPath, iid, me, onWarning) => {
      fetched.push(iid);
      return read(projectPath, iid, me, onWarning);
    };

    await runRefresh({
      store: getStore(),
      provider: makeGitLabSpy().provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      source: sourceFor(ENV, provider as unknown as GitProvider, settings()),
    });

    expect(fetched).toEqual([7]);
  });

  it('gitlab keeps exact author matching for detail eligibility', async () => {
    getStore().upsertIndexRows([storedRow('g/p')]);
    const { provider, calls } = makeGitLabSpy();

    await runRefresh({
      store: getStore(),
      provider,
      settings: settings({
        forge: undefined,
        projects: ['g/p'],
        baseUrl: 'https://gl.example',
        declaredHost: 'gl.example',
      }),
      env: { baseUrl: 'https://gl.example', token: 'tkn' },
      window: WINDOW,
    });

    expect(calls).not.toContain('fetchMergeRequestMetrics');
  });
});

describe('Linear credit through a GitHub refresh', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('credits a roster author whose attached PR is stored under another case', async () => {
    const stored = (iid: number, author: string, mergedAt: string) =>
      toIndexRow(
        indexRow({
          iid,
          authorUsername: author,
          createdAt: '2026-04-01T00:00:00Z',
          updatedAt: mergedAt,
          mergedAt,
        }),
        '2026-04-05T00:00:00Z'
      );
    getStore().upsertIndexRows([
      stored(10, 'zed', '2026-04-02T00:00:00Z'),
      stored(11, 'ADA', '2026-04-03T00:00:00Z'),
    ]);
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body ?? '{}')) as {
        query: string;
      };
      const ids = [...query.matchAll(/issue\(id: "([^"]+)"\)/g)].map(
        m => m[1]!
      );
      return Response.json({
        data: Object.fromEntries(
          ids.map((id, i) => [
            `_${i}`,
            {
              id: `uuid-${id}`,
              identifier: id,
              title: `Ticket ${id}`,
              url: `https://linear.app/acme/issue/${id}`,
              state: { type: 'completed', name: 'Done' },
              attachments: {
                nodes: [10, 11].map(n => ({
                  url: `https://github.com/o/r/pull/${n}`,
                  sourceType: 'github',
                })),
              },
            },
          ])
        ),
      });
    });
    const provider = makeGitHubProvider({
      index: [indexRow({ iid: 7, title: 'ACME-1 cleanup' })],
    });

    await runRefresh({
      store: getStore(),
      provider: makeGitLabSpy().provider,
      settings: settings(),
      env: { ...ENV, linearApiKey: 'key' },
      window: WINDOW,
      source: sourceFor(ENV, provider as unknown as GitProvider, settings()),
    });

    const issue = getStore()
      .allLinearIssues()
      .find(i => i.identifier === 'ACME-1');
    expect(issue?.creditedUser).toBe('ada');
  });
});

describe('PR detail concurrency', () => {
  const many = Array.from({ length: 12 }, (_, i) => indexRow({ iid: i + 1 }));
  const tick = () => new Promise(r => setTimeout(r, 5));

  it('github never has more than 2 detail reads in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = makeGitHubProvider({ index: many });
    const read = provider.fetchSingleMR.bind(provider);
    provider.fetchSingleMR = async (...args) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return read(...args);
    };

    await runRefresh({
      store: getStore(),
      provider: makeGitLabSpy().provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      source: sourceFor(ENV, provider as unknown as GitProvider, settings()),
    });

    expect(peak).toBe(2);
  });

  it('gitlab keeps 6 detail reads in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = {
      ...makeGitLabSpy().provider,
      fetchMergeRequestIndex: async () =>
        many.map(r => ({ ...r, projectPath: 'g/p' })),
      fetchMergeRequestMetrics: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
        return null;
      },
    } as unknown as GitProvider;

    await runRefresh({
      store: getStore(),
      provider,
      settings: settings({
        forge: undefined,
        projects: ['g/p'],
        baseUrl: 'https://gl.example',
        declaredHost: 'gl.example',
      }),
      env: { baseUrl: 'https://gl.example', token: 'tkn' },
      window: WINDOW,
    });

    expect(peak).toBe(6);
  });
});

import { describe, expect, it } from 'vitest';

import type {
  FetchMergeRequestIndexOptions,
  FetchPullRequestsWarning,
  MergeRequestIndexRow,
  MergeRequestMetrics,
  MRDetail,
  Note,
  PullRequest,
  UserRef,
} from '@mattstack/glance';
import { gitlabSource } from '../src/server/source/forge-source.js';
import {
  githubSource,
  type GitHubSourceProvider,
} from '../src/server/source/github.js';
import type { SourceProvider } from '../src/server/source/provider.js';
import type { IndexRow } from '../src/server/store/index.js';
import type { TimeWindow } from '../src/shared/types.js';

interface Call {
  method: string;
  args: unknown[];
}

interface CannedPage {
  body: unknown;
  next?: boolean;
  status?: number;
}

interface FakeOptions {
  user?: UserRef | null;
  index?: MergeRequestIndexRow[];
  fill?: (
    onWarning?: (w: FetchPullRequestsWarning) => void
  ) => PullRequest | null;
  discussions?: MRDetail;
  rest?: Record<string, CannedPage>;
}

/** A hand-rolled fake: records every call and serves canned JSON for REST by exact path. */
function makeFake(opts: FakeOptions = {}) {
  const calls: Call[] = [];
  const provider: GitHubSourceProvider = {
    async fetchUser(username: string) {
      calls.push({ method: 'fetchUser', args: [username] });
      return opts.user ?? null;
    },
    async fetchMergeRequestIndex(o: FetchMergeRequestIndexOptions) {
      calls.push({ method: 'fetchMergeRequestIndex', args: [o] });
      return opts.index ?? [];
    },
    async fetchSingleMR(projectPath, iid, me, onWarning) {
      calls.push({ method: 'fetchSingleMR', args: [projectPath, iid, me] });
      return opts.fill ? opts.fill(onWarning) : pr();
    },
    async fetchMRDiscussions(repositoryId: string, iid: number) {
      calls.push({ method: 'fetchMRDiscussions', args: [repositoryId, iid] });
      return opts.discussions ?? { mrIid: iid, repositoryId, discussions: [] };
    },
    async restRequest(method: string, path: string) {
      calls.push({ method: 'restRequest', args: [method, path] });
      const page = opts.rest?.[path];
      if (!page) return new Response('not found', { status: 404 });
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (page.next) {
        headers.Link =
          '<https://api.github.com/repos/o/r/next?page=2>; rel="next", <https://api.github.com/repos/o/r/next?page=9>; rel="last"';
      }
      return new Response(JSON.stringify(page.body), {
        status: page.status ?? 200,
        headers,
      });
    },
  };
  return { provider, calls };
}

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    description: 'b',
    diffStats: { additions: 10, deletions: 2, filesChanged: 1 },
    approvedBy: [],
    ...over,
  } as unknown as PullRequest;
}

function note(username: string, over: Partial<Note> = {}): Note {
  return {
    id: 1,
    body: 'x',
    author: {
      id: `github:user:${username}`,
      username,
      name: username,
      avatarUrl: null,
    },
    createdAt: '2026-05-02T10:00:00Z',
    system: false,
    type: null,
    resolvable: null,
    resolved: null,
    position: null,
    ...over,
  };
}

const row: IndexRow = {
  projectPath: 'o/r',
  iid: 7,
  title: 'T',
  state: 'merged',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-05T00:00:00Z',
  mergedAt: '2026-05-05T00:00:00Z',
  authorUsername: 'ada',
  sourceBranch: 'feat',
  labels: ['bug'],
  scannedAt: '2026-05-06T00:00:00Z',
};

const FILES = (page: number) =>
  `/repos/o/r/pulls/7/files?per_page=100&page=${page}`;
const COMMITS = (page: number) =>
  `/repos/o/r/pulls/7/commits?per_page=100&page=${page}`;

const emptyLists: Record<string, CannedPage> = {
  [FILES(1)]: { body: [] },
  [COMMITS(1)]: { body: [] },
};

const commit = (login: string | null, date: string) => ({
  author: login === null ? null : { login },
  commit: { author: { date } },
});

const window: TimeWindow = {
  start: '2026-05-01T00:00:00.000Z',
  end: '2026-05-31T00:00:00.000Z',
  key: '30d',
};

const RUNS =
  '/repos/o/r/actions/runs?actor=ada&created=2026-05-01T00:00:00Z..2026-05-31T00:00:00Z&per_page=100&page=1';

const run = (id: number, conclusion: string | null, status = 'completed') => ({
  id,
  actor: { login: 'Ada' },
  status,
  conclusion,
  created_at: 'x',
});

describe('githubSource', () => {
  it('resolveIdentity maps fetchUser', async () => {
    const { provider } = makeFake({
      user: {
        id: 'github:user:42',
        username: 'Ada',
        name: 'Ada',
        avatarUrl: null,
      },
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const identity = await source.resolveIdentity('ada', {});
    expect(identity).toMatchObject({
      username: 'ada',
      name: 'Ada',
      resolved: true,
      userId: 42,
    });
  });

  it('resolveIdentity of an unknown user is unresolved', async () => {
    const { provider } = makeFake({ user: null });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const identity = await source.resolveIdentity('ada', {});
    expect(identity).toMatchObject({
      username: 'ada',
      resolved: false,
      userId: null,
    });
  });

  it('scanProject rewrites the author to the roster spelling', async () => {
    const { provider, calls } = makeFake({
      index: [
        {
          iid: 7,
          projectPath: 'o/r',
          title: 'T',
          state: 'merged',
          createdAt: 'c',
          updatedAt: 'u',
          mergedAt: 'm',
          authorUsername: 'Ada',
          sourceBranch: 'feat',
          labels: ['bug'],
        },
      ],
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const rows = await source.scanProject('o/r', '2026-05-01T00:00:00Z', {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.authorUsername).toBe('ada');
    expect(rows[0]?.labels).toEqual(['bug']);
    expect(calls[0]?.args[0]).toMatchObject({
      projectPaths: ['o/r'],
      updatedAfter: '2026-05-01T00:00:00Z',
    });
  });

  it('fetchDetail composes the reads', async () => {
    const { provider, calls } = makeFake({
      fill: () =>
        pr({
          approvedBy: [
            {
              id: 'github:user:2',
              username: 'Bob',
              name: 'Bob',
              avatarUrl: null,
            },
          ],
        }),
      discussions: {
        mrIid: 7,
        repositoryId: 'github:o/r',
        discussions: [
          {
            id: 'd1',
            resolvable: true,
            resolved: false,
            notes: [
              note('bob', {
                type: 'DiffNote',
                createdAt: '2026-05-02T10:00:00Z',
              }),
            ],
          },
          {
            id: 'd2',
            resolvable: null,
            resolved: null,
            notes: [note('ada', { createdAt: '2026-05-02T11:00:00Z' })],
          },
        ],
      },
      rest: {
        [FILES(1)]: {
          body: [{ filename: 'a.ts', additions: 10, deletions: 2 }],
        },
        [COMMITS(1)]: {
          body: [
            commit('Ada', '2026-05-03T10:00:00Z'),
            commit(null, '2026-05-04T10:00:00Z'),
          ],
        },
      },
    });
    const source = githubSource(provider, { knownLogins: ['ada', 'bob'] });
    const detail = await source.fetchDetail(row, {});
    expect(detail).not.toBeNull();
    expect(detail?.metrics).toEqual({
      projectPath: 'o/r',
      iid: 7,
      description: 'b',
      diffStats: { additions: 10, deletions: 2, filesChanged: 1 },
      fileStats: [{ path: 'a.ts', additions: 10, deletions: 2 }],
      labels: ['bug'],
      approvedByUsernames: ['bob'],
      notes: [
        {
          authorUsername: 'bob',
          createdAt: '2026-05-02T10:00:00Z',
          system: false,
          inline: true,
        },
        {
          authorUsername: 'ada',
          createdAt: '2026-05-02T11:00:00Z',
          system: false,
          inline: false,
        },
      ],
    });
    expect(detail?.commits).toEqual([
      {
        username: 'ada',
        createdAt: '2026-05-03T10:00:00Z',
        repositoryId: 'github:o/r',
      },
    ]);
    expect(calls.find(c => c.method === 'fetchMRDiscussions')?.args).toEqual([
      'github:o/r',
      7,
    ]);
    expect(calls.map(c => c.method)).toEqual([
      'fetchSingleMR',
      'fetchMRDiscussions',
      'restRequest',
      'restRequest',
    ]);
  });

  it('a note with a position is inline', async () => {
    const { provider } = makeFake({
      discussions: {
        mrIid: 7,
        repositoryId: 'github:o/r',
        discussions: [
          {
            id: 'd1',
            resolvable: true,
            resolved: false,
            notes: [
              note('bob', {
                position: {
                  newPath: 'a.ts',
                  oldPath: 'a.ts',
                  newLine: 1,
                  oldLine: null,
                  positionType: 'text',
                },
              }),
            ],
          },
        ],
      },
      rest: emptyLists,
    });
    const source = githubSource(provider, { knownLogins: ['bob'] });
    const detail = await source.fetchDetail(row, {});
    expect(detail?.metrics.notes[0]?.inline).toBe(true);
  });

  it('paging follows Link rel=next for files and commits', async () => {
    const { provider, calls } = makeFake({
      rest: {
        [FILES(1)]: {
          body: [{ filename: 'a.ts', additions: 1, deletions: 0 }],
          next: true,
        },
        [FILES(2)]: {
          body: [{ filename: 'b.ts', additions: 2, deletions: 1 }],
        },
        [COMMITS(1)]: {
          body: [commit('ada', '2026-05-03T10:00:00Z')],
          next: true,
        },
        [COMMITS(2)]: { body: [commit('ada', '2026-05-04T10:00:00Z')] },
      },
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const detail = await source.fetchDetail(row, {});
    expect(detail?.metrics.fileStats.map(f => f.path)).toEqual([
      'a.ts',
      'b.ts',
    ]);
    expect(detail?.commits.map(c => c.createdAt)).toEqual([
      '2026-05-03T10:00:00Z',
      '2026-05-04T10:00:00Z',
    ]);
    expect(
      calls.filter(c => c.method === 'restRequest').map(c => c.args[1])
    ).toEqual([FILES(1), FILES(2), COMMITS(1), COMMITS(2)]);
  });

  it('a null fill throws', async () => {
    const { provider } = makeFake({ fill: () => null, rest: emptyLists });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    await expect(source.fetchDetail(row, {})).rejects.toThrow('o/r#7');
  });

  it('a fill warning throws', async () => {
    const { provider } = makeFake({
      fill: onWarning => {
        onWarning?.({
          kind: 'request-failed',
          source: 'fill',
          message: 'boom',
        });
        return pr();
      },
      rest: emptyLists,
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    await expect(source.fetchDetail(row, {})).rejects.toThrow('boom');
  });

  it('a contexts warning does not fail the PR', async () => {
    const { provider } = makeFake({
      fill: onWarning => {
        onWarning?.({
          kind: 'request-failed',
          source: 'contexts',
          message: 'boom',
        });
        return pr();
      },
      rest: emptyLists,
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const detail = await source.fetchDetail(row, {});
    expect(detail?.metrics.description).toBe('b');
  });

  it('a non-ok REST page throws naming the path and status', async () => {
    const { provider } = makeFake({
      rest: { [FILES(1)]: { body: { message: 'nope' }, status: 502 } },
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const err = await source.fetchDetail(row, {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(FILES(1));
    expect((err as Error).message).toContain('502');
  });

  it('250 commits adds a warning', async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        commit('ada', `2026-05-03T10:00:${String(i % 60).padStart(2, '0')}Z`)
      );
    const { provider } = makeFake({
      rest: {
        [FILES(1)]: { body: [] },
        [COMMITS(1)]: { body: many(100), next: true },
        [COMMITS(2)]: { body: many(100), next: true },
        [COMMITS(3)]: { body: many(50) },
      },
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const detail = await source.fetchDetail(row, {});
    expect(detail?.commits).toHaveLength(250);
    const warnings = source.takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('mr_detail_partial');
    expect(warnings[0]?.message).toContain('o/r#7');
    expect(warnings[0]?.message).toContain('capped at 250');
    expect(source.takeWarnings()).toEqual([]);
  });

  it('fetchPipelines lists Actions runs per user', async () => {
    const { provider, calls } = makeFake({
      rest: {
        [RUNS]: {
          body: {
            total_count: 5,
            workflow_runs: [
              run(9, 'failure'),
              run(10, 'success'),
              run(11, 'cancelled'),
              run(12, 'timed_out'),
              run(13, null, 'in_progress'),
            ],
          },
        },
      },
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const rows = await source.fetchPipelines('o/r', 'ada', window, {});
    expect(calls.map(c => c.args[1])).toEqual([RUNS]);
    expect(rows[0]).toEqual({
      id: 'github:run:9',
      projectPath: 'o/r',
      username: 'ada',
      status: 'failed',
      createdAt: 'x',
    });
    expect(rows.map(r => r.status)).toEqual([
      'failed',
      'success',
      'canceled',
      'timed_out',
      'in_progress',
    ]);
    expect(source.takeWarnings()).toEqual([]);
  });

  it('more than 1000 runs warns', async () => {
    const { provider } = makeFake({
      rest: {
        [RUNS]: {
          body: { total_count: 1001, workflow_runs: [run(9, 'success')] },
        },
      },
    });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    await source.fetchPipelines('o/r', 'ada', window, {});
    const warnings = source.takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('pipeline_fetch_failed');
    expect(warnings[0]?.message).toContain('o/r');
    expect(warnings[0]?.message).toContain('ada');
  });

  it('checks the signal before each provider call', async () => {
    const { provider, calls } = makeFake({ rest: emptyLists });
    const source = githubSource(provider, { knownLogins: ['ada'] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      source.fetchDetail(row, { signal: controller.signal })
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('readsPushEvents is false', () => {
    const { provider } = makeFake();
    expect(githubSource(provider, { knownLogins: [] }).readsPushEvents).toBe(
      false
    );
  });
});

describe('gitlabSource', () => {
  function gitlabFake(metrics: MergeRequestMetrics | null) {
    const calls: Call[] = [];
    const provider = {
      async fetchMergeRequestMetrics(projectPath: string, iid: number) {
        calls.push({
          method: 'fetchMergeRequestMetrics',
          args: [projectPath, iid],
        });
        return metrics;
      },
    } as unknown as SourceProvider;
    return { provider, calls };
  }

  it('fetchDetail wraps fetchMetrics with no commits', async () => {
    const { provider, calls } = gitlabFake({
      projectPath: 'g/p',
      iid: 3,
      description: 'd',
      diffStats: null,
      fileStats: [],
      labels: ['l'],
      approvedByUsernames: ['bob'],
      notes: [],
    } as unknown as MergeRequestMetrics);
    const source = gitlabSource(provider);
    const detail = await source.fetchDetail(
      { ...row, projectPath: 'g/p', iid: 3 },
      {}
    );
    expect(calls).toEqual([
      { method: 'fetchMergeRequestMetrics', args: ['g/p', 3] },
    ]);
    expect(detail?.commits).toEqual([]);
    expect(detail?.metrics).toMatchObject({
      projectPath: 'g/p',
      iid: 3,
      description: 'd',
      approvedByUsernames: ['bob'],
    });
  });

  it('a null metrics read stays null', async () => {
    const source = gitlabSource(gitlabFake(null).provider);
    expect(await source.fetchDetail(row, {})).toBeNull();
  });

  it('reads push events and raises no warnings', () => {
    const source = gitlabSource(gitlabFake(null).provider);
    expect(source.readsPushEvents).toBe(true);
    expect(source.takeWarnings()).toEqual([]);
  });
});

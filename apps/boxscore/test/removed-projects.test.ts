import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __setRosterReader,
  __setSettingReader,
} from '../src/server/config/index.js';
import type { IndexRow, StoredMetrics } from '../src/server/store/index.js';
import { resolvePreset } from '../src/server/util/window.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-removed-projects-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getLeaderboard, getUserDetail } =
  await import('../src/server/leaderboard.js');
const { getStore, __resetStore } = await import('../src/server/store/index.js');
const { buildFetchResult } = await import('../src/server/store/query.js');
const { __setCurrentUser, __resetCurrentUser } =
  await import('../src/server/config/current-user.js');
const { __setGitHubTokenDeps } =
  await import('../src/server/config/github-token.js');

const NOW = new Date();
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();
const WINDOW = resolvePreset('30d', NOW);

interface ForgeCase {
  forge: 'gitlab' | 'github';
  kept: string;
  gone: string;
  settings: Record<string, unknown>;
  /** A push event's repository id for a project, as that forge's refresh stores it. */
  repoId: (projectPath: string) => string;
  /** What the GitLab refresh records so a stored push can be traced to its project. */
  recordIds: () => void;
}

const GITLAB: ForgeCase = {
  forge: 'gitlab',
  kept: 'acme/app',
  gone: 'acme/old',
  settings: {
    'mattstack.integrations': { forge: { host: 'gl.example' } },
    'rt.integrations': { forgeHost: 'gl.example' },
  },
  repoId: p => (p === 'acme/app' ? 'gitlab:11' : 'gitlab:22'),
  recordIds: () =>
    getStore().recordProjectIds([
      { projectPath: 'acme/app', id: 'gitlab:11' },
      { projectPath: 'acme/old', id: 'gitlab:22' },
    ]),
};

const GITHUB: ForgeCase = {
  forge: 'github',
  kept: 'o/kept',
  gone: 'o/gone',
  settings: {
    'mattstack.integrations': {
      forge: { host: 'github.com', provider: 'github' },
    },
  },
  repoId: p => `github:${p}`,
  recordIds: () => {},
};

const indexRow = (projectPath: string, iid: number, at: string): IndexRow => ({
  projectPath,
  iid,
  title: `Change ${iid}`,
  state: 'merged',
  createdAt: at,
  updatedAt: at,
  mergedAt: at,
  authorUsername: 'alice',
  sourceBranch: `feat/${iid}`,
  labels: [],
  scannedAt: at,
});

const reviewedByBob = (projectPath: string, iid: number): StoredMetrics => ({
  projectPath,
  iid,
  description: '',
  diffStats: { additions: 10, deletions: 2, filesChanged: 1 },
  fileStats: [],
  labels: [],
  approvedByUsernames: ['bob'],
  notes: [
    {
      authorUsername: 'bob',
      createdAt: daysAgo(4),
      system: false,
      inline: true,
    },
  ],
});

/** alice merges one change in each project; every kind of credit points at both. */
function seed(c: ForgeCase): void {
  const store = getStore();
  store.upsertIndexRows([
    indexRow(c.kept, 1, daysAgo(5)),
    indexRow(c.gone, 2, daysAgo(4)),
  ]);
  store.upsertMrMetrics([
    reviewedByBob(c.kept, 1),
    reviewedByBob(c.gone, 2),
  ]);
  store.upsertPipelines([
    {
      id: `${c.forge}:pipeline:1`,
      projectPath: c.kept,
      username: 'alice',
      status: 'success',
      createdAt: daysAgo(5),
    },
    {
      id: `${c.forge}:pipeline:2`,
      projectPath: c.gone,
      username: 'alice',
      status: 'success',
      createdAt: daysAgo(4),
    },
  ]);
  store.upsertPushEvents([
    { username: 'alice', createdAt: daysAgo(6), repositoryId: c.repoId(c.kept) },
    { username: 'alice', createdAt: daysAgo(3), repositoryId: c.repoId(c.gone) },
  ]);
  c.recordIds();
  const issue = (
    n: number,
    projectPath: string,
    iid: number,
    via: 'attachment' | 'closing'
  ) => ({
    id: `issue-${n}`,
    identifier: `ACME-${n}`,
    title: `Ticket ${n}`,
    url: `https://linear.app/acme/issue/ACME-${n}`,
    creditedUser: 'alice',
    linkedMrs: [{ projectPath, iid, via }],
    closedAt: daysAgo(projectPath === c.kept ? 5 : 4),
    stateType: 'completed',
    stateName: 'Done',
  });
  store.upsertLinearIssues([
    issue(1, c.kept, 1, 'attachment'),
    issue(2, c.gone, 2, 'attachment'),
    issue(3, c.gone, 2, 'closing'),
  ]);
}

afterEach(() => {
  __setSettingReader(null);
  __setRosterReader(null);
  __setGitHubTokenDeps(null);
  __resetCurrentUser();
});
afterAll(() => {
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});

describe.each([GITLAB, GITHUB])('a project removed on $forge', c => {
  const configure = (projects: string[]) => {
    const settings: Record<string, unknown> = {
      ...c.settings,
      'boxscore.projects': projects,
    };
    __setSettingReader(<T>(k: string) => settings[k] as T | undefined);
  };

  beforeEach(() => {
    process.env.GITLAB_TOKEN = 'test-token';
    __setGitHubTokenDeps({ env: { GITHUB_TOKEN: 'gh-tkn' } });
    __setRosterReader(() => [{ username: 'alice' }, { username: 'bob' }]);
    __setCurrentUser({ username: 'alice', name: null });
    getStore().clear();
    seed(c);
  });

  const read = async () => {
    const board = await getLeaderboard({
      window: WINDOW,
      refresh: false,
      trend: false,
    });
    const metric = (user: string) =>
      board.users.find(u => u.username === user)!.metrics;
    const detail = await getUserDetail({
      window: WINDOW,
      refresh: false,
      trend: false,
      user: 'alice',
    });
    return { alice: metric('alice'), bob: metric('bob'), detail };
  };

  it('earns no credit through any path once removed', async () => {
    configure([c.kept]);
    const { alice, bob, detail } = await read();

    expect(alice.mrsMerged.value).toBe(1);
    expect(bob.mrsReviewed.value).toBe(1);
    expect(alice.pipelines.value).toBe(1);
    expect(alice.codingDays.value).toBe(1);
    expect(alice.issuesCompleted.value).toBe(1);
    expect(detail.evidence.mrsMerged!.rows).toHaveLength(1);
    expect(detail.evidence.codingDays!.rows).toHaveLength(1);
    expect(
      detail.evidence.issuesCompleted!.rows.map(r => r.cells[0])
    ).toEqual(['ACME-1']);
  });

  it('gets its credit back once re-added, each change counted once', async () => {
    configure([c.kept]);
    await read();
    configure([c.kept, c.gone]);
    const { alice, bob, detail } = await read();

    expect(alice.mrsMerged.value).toBe(2);
    expect(bob.mrsReviewed.value).toBe(2);
    expect(alice.pipelines.value).toBe(2);
    expect(alice.codingDays.value).toBe(2);
    expect(alice.issuesCompleted.value).toBe(3);
    expect(detail.evidence.mrsMerged!.rows).toHaveLength(2);
    expect(
      detail.evidence.issuesCompleted!.rows.map(r => r.cells[0]).sort()
    ).toEqual(['ACME-1', 'ACME-2', 'ACME-3']);
  });
});

describe('a ticket linked to a kept and a removed project', () => {
  beforeEach(() => getStore().clear());

  const ticket = (
    linkedMrs: {
      projectPath: string;
      iid: number;
      via: 'attachment' | 'closing';
    }[],
    creditedUser: string | null
  ) => ({
    id: 'issue-9',
    identifier: 'ACME-9',
    title: 'Ticket 9',
    url: 'https://linear.app/acme/issue/ACME-9',
    creditedUser,
    linkedMrs,
    closedAt: daysAgo(3),
    stateType: 'completed',
    stateName: 'Done',
  });

  const issueAfterRemoval = () =>
    buildFetchResult(
      getStore(),
      WINDOW,
      ['alice', 'bob'],
      undefined,
      ['acme/app']
    ).linearIssues[0]!;

  it("credits the kept project's change once the earlier one is removed", () => {
    getStore().upsertIndexRows([
      indexRow('acme/old', 2, daysAgo(4)),
      { ...indexRow('acme/app', 5, daysAgo(3)), authorUsername: 'bob' },
    ]);
    getStore().upsertLinearIssues([
      ticket(
        [
          { projectPath: 'acme/old', iid: 2, via: 'closing' },
          { projectPath: 'acme/app', iid: 5, via: 'closing' },
        ],
        'alice'
      ),
    ]);

    expect(issueAfterRemoval()).toMatchObject({
      creditedUser: 'bob',
      closedAt: daysAgo(3),
      linkedMrs: [{ projectPath: 'acme/app', iid: 5 }],
    });
  });

  it("keeps the attachment grade a removed project's attachment gave", () => {
    getStore().upsertIndexRows([
      indexRow('acme/old', 2, daysAgo(4)),
      { ...indexRow('acme/app', 5, daysAgo(3)), authorUsername: 'bob' },
    ]);
    getStore().upsertLinearIssues([
      ticket(
        [
          { projectPath: 'acme/old', iid: 2, via: 'attachment' },
          { projectPath: 'acme/app', iid: 5, via: 'closing' },
        ],
        'alice'
      ),
    ]);

    expect(issueAfterRemoval().creditedUser).toBeNull();
  });

  it('never credits a ticket that had no credit', () => {
    getStore().upsertIndexRows([
      { ...indexRow('acme/app', 5, daysAgo(3)), authorUsername: 'bob' },
    ]);
    getStore().upsertLinearIssues([
      ticket(
        [
          { projectPath: 'acme/old', iid: 2, via: 'closing' },
          { projectPath: 'acme/app', iid: 5, via: 'closing' },
        ],
        null
      ),
    ]);

    expect(issueAfterRemoval().creditedUser).toBeNull();
  });
});

describe('GitLab pushes stored before project ids were recorded', () => {
  beforeEach(() => {
    getStore().clear();
    getStore().upsertPushEvents([
      { username: 'alice', createdAt: daysAgo(6), repositoryId: 'gitlab:11' },
      { username: 'alice', createdAt: daysAgo(3), repositoryId: 'gitlab:22' },
    ]);
  });

  const pushDays = () =>
    buildFetchResult(getStore(), WINDOW, ['alice'], undefined, [
      'acme/app',
    ]).pushEvents.map(e => e.createdAt);

  it('still count while a configured project has no recorded id', () => {
    expect(pushDays()).toHaveLength(2);
  });

  it("count only a configured project's once every one has an id", () => {
    getStore().recordProjectIds([{ projectPath: 'acme/app', id: 'gitlab:11' }]);
    expect(pushDays()).toEqual([daysAgo(6)]);
  });
});

describe('a project configured in another case', () => {
  beforeEach(() => {
    getStore().clear();
    getStore().upsertIndexRows([indexRow('acme/app', 1, daysAgo(5))]);
    getStore().upsertLinearIssues([
      {
        id: 'issue-1',
        identifier: 'ACME-1',
        title: 'Ticket 1',
        url: 'https://linear.app/acme/issue/ACME-1',
        creditedUser: 'alice',
        linkedMrs: [{ projectPath: 'acme/app', iid: 1, via: 'closing' }],
        closedAt: daysAgo(5),
        stateType: 'completed',
        stateName: 'Done',
      },
    ]);
  });

  it('still counts rows the forge stored under its own spelling', () => {
    const fetched = buildFetchResult(
      getStore(),
      WINDOW,
      ['alice'],
      undefined,
      ['Acme/App']
    );
    expect(fetched.mrs).toHaveLength(1);
    expect(fetched.linearIssues[0]!.creditedUser).toBe('alice');
  });
});

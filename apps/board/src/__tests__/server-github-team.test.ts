/** A GitHub team's board: it boots the real board, lists the team's PRs with
    their gates from the daemon store, and refuses the GitLab-only writes
    with one sentence before anything reaches the daemon or a forge. The
    env keeps a GitLab token set, so no refusal here leans on a missing one. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, test } from 'bun:test';

import { readDrafts, writeDraft } from '../draft-state.ts';
import { openStateDb } from '../state/db.ts';
import { readMemory, writeMemory } from '../triage/memory-store.ts';
import { bootBoardServer } from './board-server.ts';

const HOST = 'https://github.test';
const prUrl = (iid: number) => `${HOST}/o/r/pull/${iid}`;

const ALICE = { id: 'github:1', username: 'alice', name: 'Alice' };
const BOB = { id: 'github:2', username: 'bob', name: 'Bob' };

function fakePr(iid: number, author: Record<string, unknown>) {
  return {
    id: `github:${iid}`,
    iid,
    provider: 'github',
    repositoryId: 'github:9',
    title: 'A PR',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: prUrl(iid),
    sourceBranch: `feat/${iid}`,
    targetBranch: 'main',
    isStacked: false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
    sha: null,
    author,
    assignees: [],
    reviewers: [],
    roles: [],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 1,
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
    approvalsRequired: 1,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
  };
}

const reviewGate = {
  id: 'review-20',
  subject: `mr:${prUrl(20)}`,
  kind: 'review-post',
  questions: [{ id: 'q', label: 'Go ahead?', options: ['yes', 'no'] }],
  meta: null,
  status: 'open',
  answer: null,
  openedAt: Date.now(),
  parkedAt: null,
  closedAt: null,
  closedReason: null,
  supersededBy: null,
  agent: null,
  pane: null,
  nudge: null,
  delivery: null,
  released: false,
  consumedAt: null,
  owner: null,
  escalatedAt: null,
};

const home = mkdtempSync(join(tmpdir(), 'board-github-team-'));

const teamDir = join(
  home,
  '.mattstack',
  'orgs',
  'testteam',
  'mattstack',
  'org'
);
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.org.jsonc'),
  JSON.stringify({
    'mattstack.integrations': {
      forge: { provider: 'github', host: 'github.test' },
    },
    'board.projects': ['o/r'],
    'mattstack.roster': [{ username: 'alice' }, { username: 'bob' }],
    'mattstack.directory': {
      teams: {
        web: { slack: { channels: [{ name: 'code-review', kind: 'review' }] } },
      },
    },
  })
);
const webTeamDir = join(teamDir, '..', 'teams', 'web');
mkdirSync(webTeamDir, { recursive: true });
writeFileSync(join(webTeamDir, 'settings.team.jsonc'), '{}');
const userDir = join(home, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({
    'mattstack.activeTeam': 'web',
    'board.defaultMember': 'alice',
  })
);
writeFileSync(join(home, '.mattstack', 'machine-key'), 'testmachine');
const machineDir = join(home, '.mattstack', 'user', 'local', 'testmachine');
mkdirSync(machineDir, { recursive: true });
writeFileSync(
  join(machineDir, 'settings.local.jsonc'),
  JSON.stringify({ 'board.cwds': { review: home } })
);

const dbPath = join(home, 'state.db');
const db = openStateDb(dbPath);
writeMemory(
  {
    ...readMemory(db),
    identity: { username: 'alice', fetchedAt: Date.now() },
  },
  db
);

const prs = [fakePr(7, ALICE), fakePr(20, BOB)];
const daemonSeen: string[] = [];
const rtDir = join(home, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const daemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const cmd = new URL(req.url).pathname.slice(1);
    const body =
      req.method === 'POST' ? await req.json().catch(() => null) : null;
    daemonSeen.push(cmd);
    if (cmd === 'project-mrs:read') {
      const byId: Record<string, unknown> = {};
      for (const pr of prs)
        byId[pr.id] = { pr, fetchedAt: Date.now(), codeownerSections: [] };
      return Response.json({
        ok: true,
        data: {
          mrs: byId,
          listSyncedAt: Date.now(),
          source: 'poll',
          syncedAt: Date.now(),
        },
      });
    }
    if (cmd === 'gate:list') {
      const prefix = (body as { subjectPrefix?: string } | null)?.subjectPrefix;
      return Response.json({
        ok: true,
        data: { gates: prefix === 'mr:' ? [reviewGate] : [], cursor: 0 },
      });
    }
    return Response.json({ ok: false, error: 'not implemented' });
  },
});

const server = bootBoardServer({
  preload: join(import.meta.dir, 'slack-api-mock-preload.ts'),
  env: {
    HOME: home,
    CLAUDE_BIN: join(home, 'no-claude-here'),
    BOARD_APP_ROOT: home,
    BOARD_STATE_DB: dbPath,
    GITLAB_TOKEN: 'fake-gitlab-token',
    SLACK_TOKEN: 'fake-slack-token',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

afterAll(() => {
  daemon.stop(true);
});

const base = () => `http://127.0.0.1:${server.port}`;

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const held = (iid: number) =>
  writeDraft(
    prUrl(iid),
    'ci-note',
    { mrUrl: prUrl(iid), iid, body: 'the cache key changed', status: 'held' },
    1000,
    db
  );

const READS = new Set([
  'project-mrs:read',
  'gate:list',
  'events:head',
  'discussions:read',
  'chat:slack-avatars',
  'reconciler:status',
  'runs:list',
  'runs:get',
  'secrets:read',
]);
const isRead = (cmd: string) => READS.has(cmd);

type Row = {
  webUrl: string;
  provider: string;
  gates: Array<{ gateId: string }>;
};

describe('a GitHub team', () => {
  test('boots the real board, not the setup page', async () => {
    const res = await fetch(`${base()}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('/data.json lists the GitHub PRs with their gate', async () => {
    let rows: Row[] = [];
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const data = (await (await fetch(`${base()}/data.json`)).json()) as {
        mrs: Row[];
      };
      rows = data.mrs;
      if (rows.find(r => r.webUrl === prUrl(20))?.gates.length) break;
      await Bun.sleep(200);
    }
    expect(rows.map(r => r.webUrl).sort()).toEqual([prUrl(20), prUrl(7)]);
    expect(rows.every(r => r.provider === 'github')).toBe(true);
    expect(
      rows.find(r => r.webUrl === prUrl(20))?.gates.map(g => g.gateId)
    ).toEqual(['review-20']);
    expect(rows.find(r => r.webUrl === prUrl(7))?.gates).toEqual([]);
  }, 15_000);

  test('merge, draft and held-draft post refuse a GitHub PR', async () => {
    held(7);
    const daemonBefore = daemonSeen.length;
    const responses = await Promise.all([
      post('/mr/action', { mrUrl: prUrl(7), iid: 7, action: 'merge' }),
      post('/draft', { mrUrl: prUrl(7), iid: 7, draft: true }),
      post('/drafts', { mrUrl: prUrl(7), kind: 'ci-note', action: 'post' }),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('Not available on GitHub yet');
    }
    expect(daemonSeen.slice(daemonBefore).filter(c => !isRead(c))).toEqual([]);
    expect(readDrafts(db).find(d => d.mrUrl === prUrl(7))?.status).toBe('held');
  }, 15_000);

  test('dismissing a held draft still works on a GitHub team', async () => {
    held(7);
    const res = await post('/drafts', {
      mrUrl: prUrl(7),
      kind: 'ci-note',
      action: 'dismiss',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dismissed: true });
  }, 15_000);
});

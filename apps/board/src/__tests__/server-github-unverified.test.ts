/** A GitHub board whose team record carries no forge username owns nothing:
    the seat in settings is alice, yet she is not verified as the signed-in
    forge user, so every author write is refused before the daemon hears of it
    and /data.json says the seat is unverified. A finished review waiting in
    the fake journal from boot reaches no latch verb either. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { readDrafts, writeDraft } from '../draft-state.ts';
import { openStateDb } from '../state/db.ts';
import { setKvValue } from '../state/kv-blob.ts';
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

const home = mkdtempSync(join(tmpdir(), 'board-github-unverified-'));

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
    'mattstack.roster': [
      { username: 'alice', teams: ['web'] },
      { username: 'bob', teams: ['web'] },
    ],
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

const rtDir = join(home, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const dbPath = join(home, 'state.db');
const db = openStateDb(dbPath);

const prs = [fakePr(7, ALICE)];
const writes: Array<{ cmd: string; body: Record<string, unknown> }> = [];
const latchCalls: string[] = [];
const LATCH_VERBS = new Set([
  'forge:self',
  'mr:attach-upload',
  'mr:comment-file',
  'discussions:resolve',
]);
const journal = [
  {
    id: 1,
    topic: 'board/agent-status/review',
    payload: {
      mrUrl: prUrl(7),
      iid: 7,
      kind: 'review',
      status: 'done',
      outcome: 'comment',
      appRoot: home,
    },
    emittedAt: Date.now(),
  },
];
setKvValue('agent-status', 'cursor', 0, db);
let daemon: ReturnType<typeof Bun.serve> | undefined;
beforeAll(() => {
  daemon = Bun.serve({
    unix: join(rtDir, 'rt.sock'),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      const body =
        req.method === 'POST' ? await req.json().catch(() => null) : null;
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
      if (cmd === 'gate:list')
        return Response.json({ ok: true, data: { gates: [], cursor: 0 } });
      if (cmd === 'mr:action' || cmd === 'mr:comment') {
        writes.push({ cmd, body: (body ?? {}) as Record<string, unknown> });
        return Response.json({ ok: true });
      }
      if (cmd === 'events:head')
        return Response.json({ ok: true, data: { cursor: journal.length } });
      if (cmd === 'events:list') {
        const after = (body as { after?: number } | null)?.after ?? 0;
        return Response.json({
          ok: true,
          data: {
            events: journal.filter(e => e.id > after),
            cursor: journal.length,
          },
        });
      }
      if (cmd === 'discussions:read')
        return Response.json({
          ok: true,
          data: { discussions: [], fetchedAt: Date.now() },
        });
      if (LATCH_VERBS.has(cmd)) {
        latchCalls.push(cmd);
        return Response.json({ ok: false, error: 'not expected' });
      }
      return Response.json({ ok: false, error: 'not implemented' });
    },
  });
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
  daemon?.stop(true);
});

const base = () => `http://127.0.0.1:${server.port}`;
const send = async (path: string, body: unknown) => {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
};

describe('a GitHub board with no recorded forge username', () => {
  test('/data.json lists the PR and says the seat is unverified', async () => {
    let data: { mrs: unknown[]; seatUnverified?: boolean; tokenUser: unknown } =
      { mrs: [], tokenUser: null };
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      data = (await (await fetch(`${base()}/data.json`)).json()) as typeof data;
      if (data.mrs.length) break;
      await Bun.sleep(200);
    }
    expect(data.mrs).toHaveLength(1);
    expect(data.tokenUser).toBeNull();
    expect(data.seatUnverified).toBe(true);
  }, 15_000);

  test('merge, auto-merge, draft and a note post are refused before any write', async () => {
    writeDraft(
      prUrl(7),
      'ci-note',
      { mrUrl: prUrl(7), iid: 7, body: 'a note', status: 'held' },
      1000,
      db
    );
    const from = writes.length;
    const answers = [
      await send('/mr/action', { mrUrl: prUrl(7), iid: 7, action: 'merge' }),
      await send('/mr/action', {
        mrUrl: prUrl(7),
        iid: 7,
        action: 'setAutoMerge',
      }),
      await send('/draft', { mrUrl: prUrl(7), iid: 7, draft: true }),
      await send('/drafts', {
        mrUrl: prUrl(7),
        kind: 'ci-note',
        action: 'post',
      }),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(403);
      expect(answer.text).toBe('not your PR');
    }
    expect(writes.slice(from)).toEqual([]);
    expect(readDrafts(db).find(d => d.mrUrl === prUrl(7))?.status).toBe('held');
  }, 15_000);

  test('a finished review sends no latch verb and logs one line', async () => {
    const line = `latch step skipped for ${prUrl(7)}`;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !server.output().includes(line))
      await Bun.sleep(100);
    const lines = server
      .output()
      .split('\n')
      .filter(l => l.includes(line));
    expect(lines).toEqual([
      `${line}: no forge username is recorded for this team`,
    ]);
    expect(latchCalls).toEqual([]);
  }, 30_000);
});

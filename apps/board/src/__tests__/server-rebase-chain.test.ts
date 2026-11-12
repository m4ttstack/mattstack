/** /doctor rebase mode runs the forge-first chain: the MR's own forge
    first, then the local sync, then a doctor only when the tab has one.
    The board's GitLab answers 404 to everything, so a GitLab forge step
    always fails and drops to the sync; GitHub rows go through the fake
    daemon's mr:get and mr:action. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { readDoctorStates, writeDoctorState } from '../doctor-state.ts';
import { mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';
import { readMemory, writeMemory } from '../triage/memory-store.ts';
import { bootBoardServer } from './board-server.ts';

const ALICE = { id: 'gitlab:1', username: 'alice', name: 'Alice' };

function fakePr(
  host: string,
  iid: number,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `gitlab:${iid}`,
    iid,
    repositoryId: 'gitlab:42',
    title: 'An MR',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: `${host}/g/p/-/merge_requests/${iid}`,
    sourceBranch: `feat/${iid}`,
    targetBranch: 'main',
    isStacked: false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
    sha: null,
    author: ALICE,
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
    ...extra,
  };
}

const github = (host: string, iid: number) =>
  fakePr(host, iid, {
    id: `github:${iid}`,
    repositoryId: 'github:9',
    provider: 'github',
  });

/** 7 syncs clean, 9 pauses on a conflict, 8 is a row a restart cut off,
    30 is a GitHub PR the forge rebases, 31 one whose forge read hangs,
    32 one whose forge read fails once the rebase is sent. */
const CLEAN = 7;
const ORPHAN = 8;
const CONFLICT = 9;
const GH_REBASED = 30;
const GH_HANGS = 31;
const GH_READ_FAILS = 32;

const home = mkdtempSync(join(tmpdir(), 'board-rebase-chain-'));
const gitlab = Bun.serve({
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/v4/user')
      return Response.json({
        id: 1,
        username: 'alice',
        name: 'Seat',
        avatar_url: null,
      });
    return Response.json({ message: '404 Not Found' }, { status: 404 });
  },
});
const host = `http://127.0.0.1:${gitlab.port}`;
const url = (iid: number) => `${host}/g/p/-/merge_requests/${iid}`;

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
    'board.gitlabHost': host,
    'board.projects': ['g/p'],
    'mattstack.roster': [{ username: 'alice' }],
    'mattstack.directory': { teams: { web: {} } },
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
  { ...readMemory(db), identity: { username: 'alice', fetchedAt: Date.now() } },
  db
);
// The server mints its handles off its own state root, the db's folder.
writeDoctorState(
  mintHandle('doctor', url(ORPHAN), home),
  {
    mrUrl: url(ORPHAN),
    iid: ORPHAN,
    status: 'forge-rebasing',
    forge: { forge: 'gitlab', state: 'running' },
  },
  1,
  db
);

const prs = [
  fakePr(host, CLEAN),
  fakePr(host, ORPHAN),
  fakePr(host, CONFLICT),
  github(host, GH_REBASED),
  github(host, GH_HANGS),
  github(host, GH_READ_FAILS),
];

const daemonSeen: Array<{ cmd: string; body: Record<string, unknown> }> = [];
const rebasedOnForge = new Set<number>();
const rtDir = join(home, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const daemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const cmd = new URL(req.url).pathname.slice(1);
    const body = ((req.method === 'POST'
      ? await req.json().catch(() => null)
      : null) ?? {}) as Record<string, unknown>;
    daemonSeen.push({ cmd, body });
    const iid = (body.iid as number | undefined) ?? 0;
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
    if (cmd === 'mr:action') {
      rebasedOnForge.add(iid);
      return Response.json({ ok: true, data: {} });
    }
    if (cmd === 'mr:get') {
      if (iid === GH_HANGS && rebasedOnForge.has(iid))
        return new Promise<Response>(() => {});
      if (iid === GH_READ_FAILS && rebasedOnForge.has(iid))
        return Response.json({ ok: false, error: 'daemon read failed' });
      const sha = rebasedOnForge.has(iid) ? 'after' : 'before';
      return Response.json({
        ok: true,
        data: { mr: { ...github(host, iid), sha } },
      });
    }
    if (cmd === 'worktree:sync') {
      const branch = body.branch;
      if (branch === `feat/${CONFLICT}`)
        return Response.json({
          ok: true,
          data: { kind: 'conflict', path: '/trees/x', log: ['conflict'] },
        });
      return Response.json({
        ok: true,
        data: { kind: 'synced', pushed: true, log: ['pushed'] },
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
  gitlab.stop(true);
});

const post = (path: string, body: unknown) =>
  fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const rebase = (iid: number) =>
  post('/doctor', { mrUrl: url(iid), iid, mode: 'rebase' });

const row = (iid: number) => readDoctorStates(db).get(url(iid));

const seenSince = (before: number) => daemonSeen.slice(before);

test('rebase mode with no doctor skill no longer refuses up front', async () => {
  const res = await rebase(CLEAN);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, synced: 'rebased and pushed' });
  expect(row(CLEAN)).toMatchObject({
    status: 'synced',
    forge: { forge: 'gitlab', state: 'failed' },
    syncLog: ['pushed'],
  });
}, 30_000);

test('no doctor skill stops at the paused tree', async () => {
  const before = daemonSeen.length;
  const res = await rebase(CONFLICT);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    stopped: 'paused in /trees/x; no doctor on this tab',
  });
  expect(row(CONFLICT)).toMatchObject({
    status: 'sync-stopped',
    pausedTree: '/trees/x',
  });
  expect(seenSince(before).some(s => s.cmd.startsWith('agent:'))).toBe(false);
}, 30_000);

test('cancel with nothing running', async () => {
  const res = await post('/rebase/cancel', { mrUrl: url(CLEAN) });
  expect(await res.json()).toEqual({ ok: true, cancelled: false });
});

test('cancel aborts a running forge wait', async () => {
  const pending = rebase(GH_HANGS);
  const deadline = Date.now() + 10_000;
  while (!(
    row(GH_HANGS)?.status === 'forge-rebasing' && rebasedOnForge.has(GH_HANGS)
  )) {
    if (Date.now() > deadline) throw new Error('the forge wait never started');
    await Bun.sleep(50);
  }
  const cancel = await post('/rebase/cancel', { mrUrl: url(GH_HANGS) });
  expect(await cancel.json()).toEqual({ ok: true, cancelled: true });
  const res = await pending;
  expect(await res.json()).toEqual({ ok: true, cancelled: true });
  expect(row(GH_HANGS)).toMatchObject({
    status: 'sync-stopped',
    message: 'cancelled; the forge may still be rebasing',
    forge: { forge: 'github', state: 'failed', detail: 'cancelled' },
  });
}, 30_000);

test('a failed read during the forge wait shows on the step, which keeps running', async () => {
  const pending = rebase(GH_READ_FAILS);
  const deadline = Date.now() + 10_000;
  while (row(GH_READ_FAILS)?.forge?.detail !== 'daemon read failed') {
    if (Date.now() > deadline) throw new Error('the read error never showed');
    await Bun.sleep(50);
  }
  expect(row(GH_READ_FAILS)).toMatchObject({
    status: 'forge-rebasing',
    forge: { forge: 'github', state: 'running', detail: 'daemon read failed' },
  });
  await post('/rebase/cancel', { mrUrl: url(GH_READ_FAILS) });
  expect(await (await pending).json()).toEqual({ ok: true, cancelled: true });
  expect(row(GH_READ_FAILS)?.status).toBe('sync-stopped');
}, 30_000);

test('a GitHub MR is not refused on rebase mode', async () => {
  const res = await rebase(GH_REBASED);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, synced: 'rebased on GitHub' });
  expect(row(GH_REBASED)).toMatchObject({
    status: 'synced',
    forge: { forge: 'github', state: 'done', detail: 'rebased' },
  });
}, 30_000);

test('a GitHub forge rebase re-reads the PR', async () => {
  const forGh = daemonSeen.filter(
    s =>
      (s.cmd === 'mr:get' || s.cmd === 'mr:action') && s.body.iid === GH_REBASED
  );
  const action = forGh.findIndex(s => s.cmd === 'mr:action');
  expect(forGh[action]!.body).toMatchObject({ action: 'rebase' });
  expect(
    forGh.slice(action + 1).some(s => s.cmd === 'mr:get' && s.body.refresh)
  ).toBe(true);

  const reads = daemonSeen.filter(s => s.cmd === 'project-mrs:read').length;
  await fetch(`http://127.0.0.1:${server.port}/data.json`);
  expect(daemonSeen.filter(s => s.cmd === 'project-mrs:read').length).toBe(
    reads + 1
  );
}, 30_000);

test('server start fails an orphaned forge-rebasing row', async () => {
  await fetch(`http://127.0.0.1:${server.port}/data.json`);
  expect(row(ORPHAN)).toMatchObject({
    status: 'sync-stopped',
    message: 'the board restarted during the rebase; run rebase again',
    forge: {
      forge: 'gitlab',
      state: 'failed',
      detail: 'the board restarted during the rebase; run rebase again',
    },
  });
}, 30_000);

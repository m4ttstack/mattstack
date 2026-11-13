/** The rebase chain's lock holds through its doctor hand-off: while the
    hand-off's launch is out, the row has no tabId, so only the lock stops
    an ordinary /doctor from starting a second doctor on the paused tree.
    The board's GitLab answers 404, so the forge step fails, the fake sync
    pauses on a conflict, and the doctor skill binds through a fake claude. */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { readDoctorStates } from '../doctor-state.ts';
import { openStateDb } from '../state/db.ts';
import { readMemory, writeMemory } from '../triage/memory-store.ts';
import { bootBoardServer } from './board-server.ts';

const ALICE = { id: 'gitlab:1', username: 'alice', name: 'Alice' };
const IID = 9;

const home = mkdtempSync(join(tmpdir(), 'board-rebase-handoff-'));
const gitlab = Bun.serve({
  port: 0,
  fetch(req) {
    if (new URL(req.url).pathname === '/api/v4/user')
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
const url = `${host}/g/p/-/merge_requests/${IID}`;

const pluginDir = join(home, 'plugin');
mkdirSync(join(pluginDir, 'skills', 'doctor'), { recursive: true });
writeFileSync(
  join(pluginDir, 'skills', 'doctor', 'SKILL.md'),
  '---\nname: doctor\ndescription: test\n---\n'
);
const claudeBin = join(home, 'fake-claude.sh');
writeFileSync(
  claudeBin,
  `#!/bin/sh\nprintf '%s' ${JSON.stringify(
    JSON.stringify([
      { id: 'acme@local', enabled: true, installPath: pluginDir },
    ])
  )}\n`
);
chmodSync(claudeBin, 0o755);

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
    'board.doctorSkill': 'acme:doctor',
    'mattstack.roster': [{ username: 'alice' }],
  })
);
const userDir = join(home, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'board.defaultMember': 'alice' })
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

const pr = {
  id: `gitlab:${IID}`,
  iid: IID,
  repositoryId: 'gitlab:42',
  title: 'An MR',
  description: null,
  state: 'opened',
  draft: false,
  conflicts: false,
  webUrl: url,
  sourceBranch: `feat/${IID}`,
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
};

/** The first agent:start (the hand-off's) waits for the test, then fails. */
let starts = 0;
let reachHandOff: () => void = () => {};
const handOffReached = new Promise<void>(r => (reachHandOff = r));
let releaseHandOff: () => void = () => {};
const handOffReleased = new Promise<void>(r => (releaseHandOff = r));

const rtDir = join(home, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const daemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const cmd = new URL(req.url).pathname.slice(1);
    if (req.method === 'POST') await req.json().catch(() => null);
    if (cmd === 'project-mrs:read')
      return Response.json({
        ok: true,
        data: {
          mrs: {
            [pr.id]: { pr, fetchedAt: Date.now(), codeownerSections: [] },
          },
          listSyncedAt: Date.now(),
          source: 'poll',
          syncedAt: Date.now(),
        },
      });
    if (cmd === 'gate:list')
      return Response.json({ ok: true, data: { gates: [], cursor: 0 } });
    if (cmd === 'worktree:sync')
      return Response.json({
        ok: true,
        data: { kind: 'conflict', path: '/trees/x', log: ['conflict'] },
      });
    if (cmd === 'agent:start') {
      if (++starts === 1) {
        reachHandOff();
        await handOffReleased;
        return Response.json({ ok: false, error: 'herdr is not running' });
      }
      return Response.json({
        ok: true,
        data: {
          id: 'agent-2',
          sessionId: 'sess-2',
          paneId: 'p2',
          tabId: 't2',
          workspaceId: 'w2',
        },
      });
    }
    return Response.json({ ok: false, error: 'not implemented' });
  },
});

const server = bootBoardServer({
  preload: join(import.meta.dir, 'slack-api-mock-preload.ts'),
  env: {
    HOME: home,
    CLAUDE_BIN: claudeBin,
    BOARD_APP_ROOT: home,
    BOARD_STATE_DB: dbPath,
    GITLAB_TOKEN: 'fake-gitlab-token',
    SLACK_TOKEN: 'fake-slack-token',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

afterAll(() => {
  releaseHandOff();
  daemon.stop(true);
  gitlab.stop(true);
});

const post = (body: Record<string, unknown>) =>
  fetch(`http://127.0.0.1:${server.port}/doctor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mrUrl: url, iid: IID, ...body }),
  });

const row = () => readDoctorStates(db).get(url);

test('an ordinary doctor waits out the rebase hand-off, then may launch', async () => {
  const rebase = await post({ mode: 'rebase' });
  expect(rebase.status).toBe(200);
  expect(await rebase.json()).toEqual({ ok: true });
  await handOffReached;
  expect(row()?.status).toBe('queued');
  expect(row()?.tabId).toBeFalsy();

  const during = await post({});
  expect(during.status).toBe(409);
  expect(await during.text()).toBe('a sync is already running on this MR');
  expect(starts).toBe(1);

  releaseHandOff();
  const deadline = Date.now() + 10_000;
  while (row()?.status !== 'error') {
    if (Date.now() > deadline) throw new Error('the hand-off never settled');
    await Bun.sleep(50);
  }

  const after = await post({});
  expect(after.status).toBe(200);
  expect(await after.json()).toEqual({ ok: true });
}, 30_000);

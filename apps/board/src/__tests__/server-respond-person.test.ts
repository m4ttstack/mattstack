/** /respond for one person: the server checks the person has feedback on the
    MR, records that person's round only when a launch will actually start, and
    hands the pane `--person`. A focus or a refusal never writes a round. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, test } from 'bun:test';

import { readRespondRounds, recordRespondRound } from '../respond-rounds.ts';
import {
  readRespondStates,
  respondFilePath,
  writeRespondState,
} from '../respond-state.ts';
import { openStateDb } from '../state/db.ts';
import { readMemory, writeMemory } from '../triage/memory-store.ts';

const ALICE = { id: 'gitlab:1', username: 'alice', name: 'Alice' };

function fakePr(host: string, iid: number, author: Record<string, unknown>) {
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

function glanceNote(id: number, username: string) {
  return {
    id,
    body: `note ${id}`,
    author: { id: `u:${username}`, username, name: username, avatarUrl: null },
    createdAt: '2026-09-20T00:00:00Z',
    system: false,
    type: 'DiscussionNote',
    resolvable: true,
    resolved: false,
    position: null,
  };
}

/** Bob opened one thread on each of alice's MRs, and nobody has answered. */
const DISCUSSIONS: Record<number, unknown[]> = {
  7: [
    {
      id: 't7-bob',
      resolvable: true,
      resolved: false,
      notes: [glanceNote(1, 'bob')],
    },
  ],
  8: [
    {
      id: 't8-bob',
      resolvable: true,
      resolved: false,
      notes: [glanceNote(1, 'bob')],
    },
  ],
  10: [
    {
      id: 't10-bob',
      resolvable: true,
      resolved: false,
      notes: [glanceNote(1, 'bob')],
    },
  ],
};

const PORT = 47969;
const home = mkdtempSync(join(tmpdir(), 'board-respond-person-'));
const gitlab = Bun.serve({
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/v4/user')
      return Response.json({
        id: 1,
        username: 'alice',
        name: 'Alice',
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
  { ...readMemory(db), identity: { username: 'alice', fetchedAt: Date.now() } },
  db
);

const prs = [
  fakePr(host, 7, ALICE),
  fakePr(host, 8, ALICE),
  fakePr(host, 9, ALICE),
  fakePr(host, 10, ALICE),
];
/** The daemon refuses agent:start for this MR, so its launch fails. */
const FAILING_IID = 10;
const daemonSeen: Array<{ cmd: string; body: unknown }> = [];
const rtDir = join(home, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const daemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const cmd = new URL(req.url).pathname.slice(1);
    const body =
      req.method === 'POST' ? await req.json().catch(() => null) : null;
    daemonSeen.push({ cmd, body });
    const iid = (body as { iid?: number } | null)?.iid ?? 0;
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
    if (cmd === 'agent:start')
      return JSON.stringify(body).includes(`merge_requests/${FAILING_IID}`)
        ? Response.json({ ok: false, error: 'herdr is not running' })
        : Response.json({
            ok: true,
            data: {
              id: `agent-${Date.now()}`,
              sessionId: 's1',
              paneId: 'p1',
              tabId: 'w1:t1',
              workspaceId: 'w1',
            },
          });
    if (cmd === 'gate:list')
      return Response.json({ ok: true, data: { gates: [], cursor: 0 } });
    if (cmd === 'discussions:read')
      return Response.json({
        ok: true,
        data: { fetchedAt: 1, discussions: DISCUSSIONS[iid] ?? [] },
      });
    return Response.json({ ok: false, error: 'not implemented' });
  },
});

const { HERDR_SOCKET_PATH: _socket, ...childEnv } = process.env;
const proc = Bun.spawn(
  [
    'bun',
    'run',
    '--preload',
    join(import.meta.dir, 'slack-api-mock-preload.ts'),
    join(import.meta.dir, '..', 'server.ts'),
  ],
  {
    env: {
      ...childEnv,
      // A focus must never reach a live herdr: the binary is missing and the
      // socket is not inherited.
      HERDR_BIN: join(home, 'no-such-herdr'),
      HOME: home,
      BOARD_APP_ROOT: home,
      BOARD_STATE_DB: dbPath,
      PORT: String(PORT),
      GITLAB_TOKEN: 'fake-gitlab-token',
      SLACK_TOKEN: 'fake-slack-token',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  }
);

afterAll(() => {
  proc.kill();
  daemon.stop(true);
  gitlab.stop(true);
});

async function ready(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server never came up');
}

async function post(body: unknown): Promise<Response> {
  await ready();
  return fetch(`http://127.0.0.1:${PORT}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const rounds = (iid: number) => readRespondRounds(db).get(url(iid)) ?? {};
const launches = (iid: number) =>
  daemonSeen.filter(
    s =>
      s.cmd.startsWith('agent:') &&
      JSON.stringify(s.body).includes(`merge_requests/${iid}`)
  );

describe('/respond for a person', () => {
  test('a person with no feedback is refused', async () => {
    const res = await post({ mrUrl: url(7), iid: 7, person: 'carol' });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('person "carol" has no feedback on this MR');
    await new Promise(r => setTimeout(r, 200));
    expect(launches(7)).toHaveLength(0);
    expect(rounds(7)).toEqual({});
  }, 15_000);

  test('a person with feedback launches at round 1 with --person', async () => {
    const res = await post({ mrUrl: url(7), iid: 7, person: 'bob' });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 300));
    expect(rounds(7)).toEqual({ bob: 1 });
    const prompt = JSON.stringify(launches(7)[0]?.body);
    expect(prompt).toContain('--round 1');
    expect(prompt).toContain('--person bob');
  }, 15_000);

  test('a focus on a running response records no round', async () => {
    writeRespondState(
      respondFilePath(url(8)),
      {
        mrUrl: url(8),
        iid: 8,
        status: 'drafting',
        tabId: 'w1:t1',
        person: 'bob',
        responseRound: 1,
      },
      1000,
      db
    );
    const res = await post({
      mrUrl: url(8),
      iid: 8,
      person: 'bob',
      focus: true,
    });
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('pane is gone');
    await new Promise(r => setTimeout(r, 200));
    expect(rounds(8)).toEqual({});
    expect(launches(8)).toHaveLength(0);
  }, 15_000);

  test('a person with prior rounds but nothing open is answered again', async () => {
    recordRespondRound(url(9), 'dana', 1000, db);
    const res = await post({ mrUrl: url(9), iid: 9, person: 'dana' });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 300));
    expect(rounds(9)).toEqual({ dana: 2 });
    expect(readRespondStates(db).get(url(9))).toMatchObject({
      person: 'dana',
      responseRound: 2,
    });
    expect(JSON.stringify(launches(9)[0]?.body)).toContain('--round 2');
  }, 15_000);

  test('a failed launch takes back the round it recorded', async () => {
    const res = await post({ mrUrl: url(10), iid: 10, person: 'bob' });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 300));
    expect(launches(10)).toHaveLength(1);
    expect(readRespondStates(db).get(url(10))?.status).toBe('error');
    expect(rounds(10)).toEqual({});
  }, 15_000);

  test('a launch for everyone forgets the person the last run answered', async () => {
    expect(readRespondStates(db).get(url(7))).toMatchObject({
      person: 'bob',
      responseRound: 1,
    });
    const res = await post({ mrUrl: url(7), iid: 7 });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 300));
    const state = readRespondStates(db).get(url(7));
    expect(state?.person).toBeUndefined();
    expect(state?.responseRound).toBeUndefined();
    expect(rounds(7)).toEqual({ bob: 1 });
  }, 15_000);
});

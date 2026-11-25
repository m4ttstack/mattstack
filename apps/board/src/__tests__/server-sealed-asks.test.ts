/** POST /nudge and POST /asks/decline on a peering board: what reaches the
    relay, and what the person who clicked is told. A fake relay and a fake rt
    daemon, so the tests see every byte that leaves. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, expect, test } from 'bun:test';

import type { SealResult } from '@mattstack/rt-client';
import { readNudges, readSentNudges, writeNudge } from '../peer/nudges.ts';
import { askBinding, outcomeBinding } from '../peer/sealed.ts';
import { openStateDb } from '../state/db.ts';
import { bootBoardServer } from './board-server.ts';

const home = mkdtempSync(join(tmpdir(), 'board-sealed-asks-'));
const HOST = 'https://gitlab.example.com';
const MR = `${HOST}/g/p/-/merge_requests/7`;

const orgDir = join(home, '.mattstack', 'orgs', 'testteam', 'mattstack', 'org');
mkdirSync(orgDir, { recursive: true });
writeFileSync(
  join(orgDir, 'settings.org.jsonc'),
  JSON.stringify({
    'board.gitlabHost': HOST,
    'board.projects': ['g/p'],
    'mattstack.roster': [{ username: 'alice' }, { username: 'bob' }],
  })
);
const userDir = join(home, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'board.defaultMember': 'alice' })
);
const rtDir = join(home, '.mattstack', 'rt');
mkdirSync(join(rtDir, 'teams'), { recursive: true });
writeFileSync(
  join(rtDir, 'teams', 'testteam.json'),
  JSON.stringify({ forgeUsername: 'alice' })
);

const pr = {
  id: 'gitlab:7',
  iid: 7,
  repositoryId: 'gitlab:42',
  title: 'SECRET title',
  description: null,
  state: 'opened',
  draft: false,
  conflicts: false,
  webUrl: MR,
  sourceBranch: 'SECRET-branch',
  targetBranch: 'main',
  isStacked: false,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: new Date().toISOString(),
  sha: null,
  author: { id: 'gitlab:1', username: 'alice', name: 'Alice' },
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

let seal: SealResult | 'down';
const seals: unknown[] = [];
const daemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const cmd = new URL(req.url).pathname.slice(1);
    const body =
      req.method === 'POST' ? await req.json().catch(() => null) : null;
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
    if (cmd === 'text:seal') {
      seals.push(body);
      return seal === 'down'
        ? Response.json({ ok: false, error: 'unknown command: text:seal' })
        : Response.json({ ok: true, data: seal });
    }
    return Response.json({ ok: false, error: 'not implemented' });
  },
});

interface Posted {
  id: string;
  to: string;
  type: string;
  payload: Record<string, unknown>;
}
let posted: Posted[] = [];
const relay = Bun.serve({
  port: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/envelopes') {
      posted.push((await req.json()) as Posted);
      return Response.json({ ok: true, delivered: 1 });
    }
    if (pathname === '/inbox') return Response.json({ envelopes: [] });
    return Response.json({ ok: true });
  },
});

const dbPath = join(home, 'state.db');
const db = openStateDb(dbPath);
const board = bootBoardServer({
  env: {
    HOME: home,
    BOARD_APP_ROOT: home,
    BOARD_STATE_DB: dbPath,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: 'board-token',
    SWITCHBOARD_ADMIN_TOKEN: '',
    RT_SWITCHBOARD_URL: `http://127.0.0.1:${relay.port}`,
  },
});

afterAll(() => {
  daemon.stop(true);
  relay.stop(true);
});

beforeEach(() => {
  seal = { ok: true, sealed: 'YWdl', unreachable: [] };
  seals.length = 0;
  posted = [];
});

const post = (path: string, body: unknown) =>
  fetch(`${board.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Peering starts once the token loads, a moment after the port answers. */
async function nudge(body: object = {}): Promise<Record<string, unknown>> {
  for (let i = 0; ; i++) {
    const res = await post('/nudge', {
      mrUrl: MR,
      iid: 7,
      reviewer: 'bob',
      kind: 'review',
      ...body,
    });
    if (res.status === 400 && i < 100) {
      await Bun.sleep(50);
      continue;
    }
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }
}

async function until(what: string, cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await Bun.sleep(25);
  if (!cond()) throw new Error(`never happened: ${what}`);
}

const asks = () => posted.filter(e => e.type === 'review-request');
const outcomes = () => posted.filter(e => e.type === 'nudge-outcome');

test('an ask leaves with its address, its number and its sealed text alone', async () => {
  expect(await nudge({ note: 'SECRET note' })).toEqual({ ok: true });
  const [ask] = asks();
  expect(ask!.payload).toEqual({ mrUrl: MR, iid: 7, sealed: 'YWdl' });
  expect(seals).toEqual([
    {
      to: ['bob'],
      binding: askBinding(
        { type: 'review-request', from: 'alice', id: ask!.id },
        MR
      ),
      fields: {
        title: 'SECRET title',
        sourceBranch: 'SECRET-branch',
        note: 'SECRET note',
      },
    },
  ]);
  expect(readSentNudges(db).get(MR)!.nudgeId).toBe(ask!.id);
}, 30_000);

test('an ask whose note cannot be sealed goes without it, and the sender is told', async () => {
  for (const [reply, why] of [
    [{ ok: false, reason: 'no-recipients' }, 'no-key'],
    [{ ok: false, reason: 'unavailable' }, 'unavailable'],
    ['down', 'unavailable'],
  ] as [SealResult | 'down', string][]) {
    seal = reply;
    posted = [];
    expect(await nudge({ note: 'SECRET note' })).toEqual({
      ok: true,
      noteSent: false,
      noteReason: why,
    });
    expect(asks()).toHaveLength(1);
    expect(asks()[0]!.payload).toEqual({ mrUrl: MR, iid: 7 });
  }
}, 30_000);

test('an ask with no note says nothing about one', async () => {
  seal = 'down';
  expect(await nudge()).toEqual({ ok: true });
  expect(asks()[0]!.payload).toEqual({ mrUrl: MR, iid: 7 });
}, 30_000);

test('a decline keeps its fixed reason readable and seals its note', async () => {
  await nudge();
  writeNudge(
    { id: 'n1', mrUrl: MR, iid: 7, from: 'bob', receivedAt: Date.now() },
    db
  );
  const res = await post('/asks/decline', {
    id: 'n1',
    reason: 'busy',
    note: 'SECRET note',
  });
  expect(await res.json()).toEqual({ ok: true });
  await until('the outcome leaves', () => outcomes().length === 1);
  expect(outcomes()[0]!.payload).toEqual({
    mrUrl: MR,
    iid: 7,
    nudgeId: 'n1',
    result: 'rejected',
    declined: true,
    reason: 'busy right now',
    sealed: 'YWdl',
  });
  expect(seals.at(-1)).toEqual({
    to: ['bob'],
    binding: outcomeBinding('alice', MR, 'n1'),
    fields: { declineNote: 'SECRET note' },
  });
  expect(readNudges(db).find(n => n.id === 'n1')!.handled).toMatchObject({
    note: 'SECRET note',
  });
}, 30_000);

test('a decline whose note cannot be sealed still goes, and says so', async () => {
  for (const [id, reply, why] of [
    ['n2', { ok: false, reason: 'no-recipients' }, 'no-key'],
    ['n3', 'down', 'unavailable'],
  ] as [string, SealResult | 'down', string][]) {
    seal = reply;
    posted = [];
    writeNudge(
      { id, mrUrl: MR, iid: 7, from: 'bob', receivedAt: Date.now() },
      db
    );
    const res = await post('/asks/decline', { id, note: 'SECRET note' });
    expect(await res.json()).toEqual({
      ok: true,
      noteSent: false,
      noteReason: why,
    });
    await until('the outcome leaves', () => outcomes().length === 1);
    expect(outcomes()[0]!.payload).toEqual({
      mrUrl: MR,
      iid: 7,
      nudgeId: id,
      result: 'rejected',
      declined: true,
    });
  }
}, 30_000);

test('a decline with no note says nothing about one', async () => {
  seal = 'down';
  writeNudge(
    { id: 'n4', mrUrl: MR, iid: 7, from: 'bob', receivedAt: Date.now() },
    db
  );
  const res = await post('/asks/decline', { id: 'n4', reason: 'later' });
  expect(await res.json()).toEqual({ ok: true });
}, 30_000);

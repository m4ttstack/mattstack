/** POST /asks/decline and the asks block on /data.json, against a real state
    db. Minimal boot, same recipe as server-dismiss.test.ts. */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { readNudges, writeNudge } from '../peer/nudges.ts';
import { openStateDb } from '../state/db.ts';
import { bootBoardServer } from './board-server.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-asks-'));

const teamDir = join(
  fakeHome,
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
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'mattstack.roster': [{ username: 'mira' }],
  })
);

const MR = 'https://gitlab.example.com/g/p/-/merge_requests/7';
const dbPath = join(fakeHome, 'state.db');
const db = openStateDb(dbPath);
writeNudge(
  { id: 'n1', mrUrl: MR, iid: 7, from: 'rae', receivedAt: Date.now() },
  db
);

const board = bootBoardServer({
  env: {
    HOME: fakeHome,
    BOARD_APP_ROOT: fakeHome,
    BOARD_STATE_DB: dbPath,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

const EDGES: Record<string, string>[] = [
  { 'x-mattstack-edge': 'public' },
  { 'cf-connecting-ip': '203.0.113.9' },
  { 'tailscale-funnel-request': '?1' },
  { 'x-forwarded-for': '203.0.113.9' },
];

function postTo(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return fetch(`${board.origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'board.mattstack',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function decline(body: unknown, contentType = 'application/json') {
  return fetch(`${board.origin}/asks/decline`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: JSON.stringify(body),
  });
}

test('declining answers 200 once, 409 after, and records the chip words', async () => {
  const res = await decline({ id: 'n1', reason: 'busy' });
  expect(res.status).toBe(200);
  expect(readNudges(db)[0]!.handled).toMatchObject({
    result: 'rejected',
    reason: 'busy right now',
    declined: true,
  });
  expect((await decline({ id: 'n1', reason: 'busy' })).status).toBe(409);
}, 15_000);

test('an unknown reason is 400 and a non-JSON body is 415', async () => {
  expect((await decline({ id: 'n1', reason: 'whatever' })).status).toBe(400);
  expect((await decline({ id: 'n1' }, 'text/plain')).status).toBe(415);
}, 15_000);

test('data.json carries the handled ask in the history', async () => {
  const res = await fetch(`${board.origin}/data.json`);
  const body = (await res.json()) as {
    asks: { history: Array<{ id: string }>; pending: unknown[] };
  };
  expect(body.asks.history[0]!.id).toBe('n1');
  expect(body.asks.pending).toEqual([]);
}, 15_000);

test('an accept that does not go through saves no always-allow', async () => {
  const res = await postTo('/asks/accept', { id: 'n1', alwaysAllow: true });
  expect(res.status).toBe(409);
  const body = (await (await fetch(`${board.origin}/data.json`)).json()) as {
    asks: { alwaysAllow: string[] };
  };
  expect(body.asks.alwaysAllow).toEqual([]);
}, 15_000);

test('always-allow answers a plain 500 when the setting cannot be saved', async () => {
  const userDir = join(fakeHome, '.mattstack', 'user');
  mkdirSync(userDir, { recursive: true });
  chmodSync(userDir, 0o500);
  try {
    const res = await postTo('/asks/always-allow', {
      username: 'rae',
      allow: true,
    });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('could not save always-allow');
  } finally {
    chmodSync(userDir, 0o700);
  }
}, 15_000);

test('the ask routes refuse every public edge marker', async () => {
  for (const path of ['/asks/accept', '/asks/decline', '/asks/always-allow']) {
    for (const edge of EDGES) {
      const res = await postTo(
        path,
        { id: 'n1', username: 'rae', allow: true },
        edge
      );
      expect({ path, edge, status: res.status }).toEqual({
        path,
        edge,
        status: 403,
      });
    }
  }
}, 15_000);

test('always-allow refuses a malformed body', async () => {
  const res = await postTo('/asks/always-allow', { username: 'rae' });
  expect(res.status).toBe(400);
}, 15_000);

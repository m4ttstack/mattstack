/** Local-only routes refuse anything that came in over a public edge, even
    when the Host it carries is a local one. Same minimal boot as
    server-note.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { bootBoardServer } from './board-server.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-locality-'));

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
    'mattstack.roster': [{ username: 'alice' }],
  })
);

const MR = 'https://gitlab.example.com/g/p/-/merge_requests/7';

const board = bootBoardServer({
  env: {
    HOME: fakeHome,
    BOARD_APP_ROOT: fakeHome,
    BOARD_STATE_DB: join(fakeHome, 'state.db'),
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

function post(path: string, headers: Record<string, string>, body: unknown) {
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

const EDGES: Record<string, string>[] = [
  { 'x-mattstack-edge': 'public' },
  { 'cf-connecting-ip': '203.0.113.9' },
  { 'tailscale-funnel-request': '?1' },
  { 'x-forwarded-for': '203.0.113.9' },
];

test('a local-only route accepts a local request', async () => {
  const res = await post('/note', {}, { mrUrl: MR, text: 'hi' });
  expect(res.status).toBe(200);
}, 15_000);

test('a local-only route refuses every public edge marker', async () => {
  for (const edge of EDGES) {
    const res = await post('/note', edge, { mrUrl: MR, text: 'hi' });
    expect({ edge, status: res.status }).toEqual({ edge, status: 403 });
  }
}, 15_000);

test('settings writes refuse every public edge marker', async () => {
  for (const edge of EDGES) {
    const res = await post('/api/settings/set', edge, {
      key: 'board.projects',
      scope: 'team',
      value: ['g/q'],
    });
    expect({ edge, status: res.status }).toEqual({ edge, status: 403 });
  }
}, 15_000);

test('member check-in/out refuses every public edge marker', async () => {
  for (const edge of EDGES) {
    const res = await post('/settings', edge, {
      username: 'alice',
      hidden: true,
    });
    expect({ edge, status: res.status }).toEqual({ edge, status: 403 });
  }
}, 15_000);

test('member check-in/out still accepts a local request', async () => {
  const res = await post('/settings', {}, { username: 'alice', hidden: false });
  expect(res.status).not.toBe(403);
  expect(res.ok).toBe(true);
}, 15_000);

test('a forced slack sweep refuses a cross-origin page', async () => {
  const res = await fetch(`${board.origin}/slack/refresh`, {
    method: 'POST',
    headers: { host: 'board.mattstack', origin: 'https://evil.example.dev' },
  });
  expect(res.status).toBe(403);
}, 15_000);

test('a forced slack sweep passes the gate from its own origin', async () => {
  const res = await fetch(`${board.origin}/slack/refresh`, {
    method: 'POST',
    headers: { host: 'board.mattstack', origin: 'https://board.mattstack' },
  });
  expect(res.status).toBe(400);
}, 15_000);

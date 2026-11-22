import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { boardBuildId, readStyleOr } from '../client-assets.ts';
import styleCss from '../style.css' with { type: 'text' };
import { startBoardServer } from './board-server.ts';

// A real boot whose rt daemon accepts and never answers: a route behind the
// board-secret round trip would hang, so an answer proves it sits ahead of it.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-host-signal-'));
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
const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
writeFileSync(join(rtDir, 'api-token'), 'fake-token\n');

let wedgedDaemon: ReturnType<typeof Bun.serve> | undefined;
const board = startBoardServer({
  env: {
    HOME: fakeHome,
    BOARD_APP_ROOT: fakeHome,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

beforeAll(async () => {
  wedgedDaemon = Bun.serve({
    unix: join(rtDir, 'rt.sock'),
    fetch: () => new Promise<Response>(() => {}),
  });
  await board.ready();
}, 65_000);

afterAll(async () => {
  await board.stop();
  wedgedDaemon?.stop(true);
});

const quick = { signal: AbortSignal.timeout(5_000) };

test('the board answers /style.css after its source file becomes unreadable', async () => {
  const res = await fetch(`${board.origin}/style.css`, quick);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe(styleCss);

  const dir = mkdtempSync(join(tmpdir(), 'board-style-'));
  const path = join(dir, 'style.css');
  writeFileSync(path, 'body { color: red }');
  expect(readStyleOr(path, 'last good')).toBe('body { color: red }');
  chmodSync(path, 0o000);
  expect(readStyleOr(path, 'last good')).toBe('last good');
});

test('/api/health answers without the board secret, with bootId and buildId', async () => {
  const res = await fetch(`${board.origin}/api/health`, {
    signal: AbortSignal.timeout(5_000),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ ok: true, name: 'board' });
  expect(typeof body.version).toBe('string');
  expect(body.bootId).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.buildId).toMatch(/^[0-9a-f]{16}$/);
});

test('the shell carries the host signal script', async () => {
  const html = await (
    await fetch(`${board.origin}/`, { signal: AbortSignal.timeout(5_000) })
  ).text();
  expect(html).toContain('__mattstackHost');
  const health = (await (
    await fetch(`${board.origin}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    })
  ).json()) as { buildId: string };
  expect(html).toContain(JSON.stringify(health.buildId));
});

test('the build id changes when the stylesheet changes', () => {
  const assets = { appJs: 'js', appCss: 'css' };
  expect(boardBuildId(assets, 'a {}')).not.toBe(boardBuildId(assets, 'b {}'));
  expect(boardBuildId(assets, 'a {}')).toBe(boardBuildId(assets, 'a {}'));
});

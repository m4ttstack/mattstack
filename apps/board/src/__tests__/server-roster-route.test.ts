import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

// Boots the real server against a fake $HOME whose team store owns
// mattstack.roster, then drives POST /roster. Proves the route's three
// actions land in the suite key and that a rename
// survives the write, without touching the real ~/.mattstack or the real
// apps/board checkout's config.json.
//
// board.defaultMember is a "user"-scoped key (registry-defs.ts), so it is
// seeded into the fake HOME's user store, not the team store -- a team-store
// entry for it is warned-and-skipped by the resolver and config.defaultMember
// would silently fall back to "all".
const fakeHome = mkdtempSync(join(tmpdir(), 'board-roster-route-'));

const teamDir = join(
  fakeHome,
  '.mattstack',
  'teams',
  'testteam',
  'mattstack',
  'org'
);
mkdirSync(teamDir, { recursive: true });
const storePath = join(teamDir, 'settings.org.jsonc');
writeFileSync(
  storePath,
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'mattstack.org': { admins: ['dev1'], teams: {} },
    'mattstack.roster': [{ username: 'ann' }, { username: 'bo' }],
  })
);

const userDir = join(fakeHome, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'board.defaultMember': 'ann' })
);

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
writeFileSync(join(rtDir, 'api-token'), 'fake-token\n');
const localTeams = join(rtDir, 'teams');
mkdirSync(localTeams, { recursive: true });
writeFileSync(
  join(localTeams, 'testteam.json'),
  JSON.stringify({ forgeUsername: 'dev1' })
);

const PORT = 47951;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      PORT: String(PORT),
      // A token inherited from the developer's shell would make the
      // post-edit void refreshMemberNames() reach real gitlab.example.com.
      GITLAB_TOKEN: '',
      SLACK_TOKEN: '',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  }
);

afterAll(() => proc.kill());

// A cold server boot can outlast a test's default 5s.
beforeAll(() => waitForBoot(), 30_000);

async function waitForBoot(): Promise<void> {
  for (let i = 0; i < 300; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await Bun.sleep(100);
  }
  throw new Error('server never became healthy');
}

async function roster(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/roster`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function stored(): Array<{
  username: string;
  name?: string;
  agePublicKey?: string;
}> {
  return JSON.parse(readFileSync(storePath, 'utf8'))['mattstack.roster'];
}

test('add with a name writes mattstack.roster', async () => {
  const res = await roster({ action: 'add', username: 'cy', name: 'Cy Park' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'cy', name: 'Cy Park' });
});

test('rename sets a name on an existing member', async () => {
  const res = await roster({
    action: 'rename',
    username: 'bo',
    name: 'Bo Chen',
  });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'bo', name: 'Bo Chen' });
});

test('rename to blank clears the name', async () => {
  const res = await roster({ action: 'rename', username: 'bo', name: '' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'bo' });
});

test('rename of an unknown member is a 400', async () => {
  const res = await roster({ action: 'rename', username: 'zed', name: 'Z' });
  expect(res.status).toBe(400);
  expect(await res.text()).toBe('unknown member "zed"');
});

test('an unknown action is a 400 naming all three', async () => {
  const res = await roster({ action: 'promote', username: 'bo' });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('rename');
});

test('dropping yourself is refused', async () => {
  const res = await roster({ action: 'remove', username: 'ann' });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('this board runs as you');
});

// The team store owns mattstack.roster here and config.json is never
// written into fakeHome, so /settings exercises the same store-owned-roster
// path the config.ts unit tests cover: an unknown username must surface as
// a 400, and a known one must persist to the user store rather than a dead
// file.
async function settings(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function storedUser(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(userDir, 'settings.user.jsonc'), 'utf8'));
}

test('hiding a roster member writes board.hiddenMembers to the user store', async () => {
  const res = await settings({ username: 'cy', hidden: true });
  expect(res.status).toBe(200);
  expect(storedUser()['board.hiddenMembers']).toContain('cy');
});

test('hiding an unknown username is a 400, not a 500', async () => {
  const res = await settings({ username: 'zed', hidden: true });
  expect(res.status).toBe(400);
  expect(await res.text()).toBe('unknown member "zed"');
});

test('an edit applies to the roster as stored now: writes made after boot survive it', async () => {
  const onDisk = JSON.parse(readFileSync(storePath, 'utf8'));
  onDisk['mattstack.roster'] = [
    ...onDisk['mattstack.roster'].map((m: { username: string }) =>
      m.username === 'bo' ? { ...m, agePublicKey: 'age1rerecorded' } : m
    ),
    { username: 'late', agePublicKey: 'age1late' },
  ];
  writeFileSync(storePath, JSON.stringify(onDisk));
  const res = await roster({ action: 'rename', username: 'bo', name: 'Bo C' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({
    username: 'bo',
    name: 'Bo C',
    agePublicKey: 'age1rerecorded',
  });
  expect(stored()).toContainEqual({
    username: 'late',
    agePublicKey: 'age1late',
  });
});

/** POST /discussions/reply and /discussions/resolve: the drawer's thread
    writes, proxied onto the daemon's `discussions:reply` / `discussions:resolve`
    with the repo label resolved to its identity, answered with the drawer's
    re-summarized threads. Fake daemon recipe from
    server-reconciler-clear.test.ts: the request pathname is the command name. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-thread-write-'));

const teamDir = join(fakeHome, '.mattstack', 'teams', 'testteam', 'mattstack');
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.team.jsonc'),
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'board.members': [{ username: 'alice' }, { username: 'reviewer' }],
  })
);

// The seat resolves only threads it started; "reviewer" opens abc123 below.
const userDir = join(fakeHome, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'board.defaultMember': 'reviewer' })
);

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
writeFileSync(join(rtDir, 'api-token'), 'fake-token\n');

const REPO = 'gitlab.example.com/g/p';
const REPO_IDENTITY = 'remote:gitlab.example.com%2Fg%2Fp';

function glanceNote(id: number, username: string, resolved: boolean) {
  return {
    id,
    body: `note ${id}`,
    author: { id: `u:${username}`, username, name: username, avatarUrl: null },
    createdAt: `2026-09-2${id}T00:00:00Z`,
    system: false,
    type: 'DiscussionNote',
    resolvable: true,
    resolved,
    position: null,
  };
}

const seen: Array<{ cmd: string; body: unknown }> = [];
let outcome: 'ok' | 'fail' = 'ok';
const rtDaemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const cmd = new URL(req.url).pathname.slice(1);
    const body =
      req.method === 'POST' ? await req.json().catch(() => null) : null;
    seen.push({ cmd, body });
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), {
        headers: { 'content-type': 'application/json' },
      });
    if (
      cmd !== 'discussions:read' &&
      cmd !== 'discussions:reply' &&
      cmd !== 'discussions:resolve'
    )
      return json({ ok: false, error: 'not implemented' });
    if (outcome === 'fail' && cmd !== 'discussions:read')
      return json({ ok: false, error: '403 Forbidden' });
    const resolved = cmd === 'discussions:resolve';
    return json({
      ok: true,
      data: {
        fetchedAt: 1,
        discussions: [
          {
            id: 'abc123',
            resolvable: true,
            resolved,
            notes: [
              glanceNote(1, 'reviewer', resolved),
              glanceNote(2, 'alice', resolved),
            ],
          },
          {
            id: 'def456',
            resolvable: true,
            resolved: false,
            notes: [
              glanceNote(3, 'alice', false),
              glanceNote(4, 'reviewer', false),
            ],
          },
        ],
      },
    });
  },
});

const PORT = 47964;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      PORT: String(PORT),
      GITLAB_TOKEN: '',
      SLACK_TOKEN: '',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  }
);

afterAll(() => {
  proc.kill();
  rtDaemon.stop(true);
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

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const target = { repo: REPO, iid: 7, discussionId: 'abc123', author: 'alice' };

test('a reply reaches the daemon under the repo identity and answers with the refreshed threads', async () => {
  await ready();
  const res = await post('/discussions/reply', { ...target, body: 'done' });
  expect(res.status).toBe(200);
  expect(seen.find(s => s.cmd === 'discussions:reply')?.body).toEqual({
    repoName: REPO_IDENTITY,
    iid: 7,
    discussionId: 'abc123',
    body: 'done',
  });
  const out = (await res.json()) as {
    threads: Array<{ discussionId: string; status: string }>;
    comments: unknown[];
  };
  expect(out.threads.map(t => [t.discussionId, t.status])).toEqual([
    ['def456', 'awaiting'],
    ['abc123', 'replied'],
  ]);
  expect(out.comments).toEqual([]);
}, 15_000);

test('an unresolve reaches the daemon as resolved: false', async () => {
  await ready();
  const res = await post('/discussions/resolve', {
    ...target,
    resolved: false,
  });
  expect(res.status).toBe(200);
  expect(seen.find(s => s.cmd === 'discussions:resolve')?.body).toEqual({
    repoName: REPO_IDENTITY,
    iid: 7,
    discussionId: 'abc123',
    resolved: false,
  });
}, 15_000);

test("a daemon refusal is a 502 carrying the daemon's error", async () => {
  await ready();
  outcome = 'fail';
  try {
    const res = await post('/discussions/resolve', {
      ...target,
      resolved: true,
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: '403 Forbidden' });
  } finally {
    outcome = 'ok';
  }
}, 15_000);

test('both routes are POST-only and refuse a malformed body or an unknown repo', async () => {
  await ready();
  for (const path of ['/discussions/reply', '/discussions/resolve']) {
    expect((await fetch(`http://127.0.0.1:${PORT}${path}`)).status).toBe(405);
    expect((await post(path, { iid: 7 })).status).toBe(400);
  }
  expect(
    (await post('/discussions/reply', { ...target, body: '   ' })).status
  ).toBe(400);
  expect(
    (
      await post('/discussions/resolve', {
        ...target,
        repo: '::',
        resolved: true,
      })
    ).status
  ).toBe(400);
}, 15_000);

test('resolving a thread someone else started is refused before the daemon hears of it', async () => {
  await ready();
  seen.length = 0;
  const res = await post('/discussions/resolve', {
    ...target,
    discussionId: 'def456',
    resolved: true,
  });
  expect(res.status).toBe(403);
  expect(await res.text()).toBe('not your thread');
  expect(seen.some(s => s.cmd === 'discussions:resolve')).toBe(false);
}, 15_000);

test('a reply to a thread someone else started still goes through', async () => {
  await ready();
  const res = await post('/discussions/reply', {
    ...target,
    discussionId: 'def456',
    body: 'fair point',
  });
  expect(res.status).toBe(200);
}, 15_000);

test('resolving a thread the MR does not have is a 404', async () => {
  await ready();
  const res = await post('/discussions/resolve', {
    ...target,
    discussionId: 'nope',
    resolved: true,
  });
  expect(res.status).toBe(404);
}, 15_000);

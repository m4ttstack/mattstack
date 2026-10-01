/** The server enforces every author-only rule on its own, whatever the UI
    sends. Each author-only route is called three ways: on someone else's MR
    (403), on an "all" board, which owns nothing (403), and on the seat's own
    MR (gets past the gate). Refusals must never reach GitLab or launch a
    pane, so each board gets its own fake GitLab and fake rt daemon and the
    tests assert what those saw. Thread resolve is author-only in a narrower
    way: allowed on every thread of your own MR and on threads you started
    anywhere, refused on someone else's thread on someone else's MR. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, test } from 'bun:test';

import { readDrafts, writeDraft } from '../draft-state.ts';
import { openStateDb } from '../state/db.ts';

type Seen = Array<{ cmd: string; body: unknown }>;

interface Board {
  port: number;
  url: (iid: number) => string;
  /** The rt repo label the board derives from its host, as the client sends it. */
  repo: string;
  db: ReturnType<typeof openStateDb>;
  gitlabSeen: string[];
  daemonSeen: Seen;
  stop: () => void;
}

const ALICE = { id: 'gitlab:1', username: 'alice', name: 'Alice' };
const BOB = { id: 'gitlab:2', username: 'bob', name: 'Bob' };

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

const thread = (id: string, starter: string, replier: string) => ({
  id,
  resolvable: true,
  resolved: false,
  notes: [glanceNote(1, starter), glanceNote(2, replier)],
});

// MR 7 is alice's, MR 20 is bob's. On each, one thread alice started and one
// bob started.
const DISCUSSIONS: Record<number, unknown[]> = {
  7: [thread('t7-alice', 'alice', 'bob'), thread('t7-bob', 'bob', 'alice')],
  20: [thread('t20-alice', 'alice', 'bob'), thread('t20-bob', 'bob', 'alice')],
};

function boot(name: string, port: number, seat: string | null): Board {
  const home = mkdtempSync(join(tmpdir(), `board-own-mr-${name}-`));
  const gitlabSeen: string[] = [];
  const gitlab = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      gitlabSeen.push(`${req.method} ${pathname}`);
      if (pathname === '/api/v4/user')
        return Response.json({
          id: 1,
          username: seat ?? 'alice',
          name: 'Seat',
          avatar_url: null,
        });
      return Response.json({ message: '404 Not Found' }, { status: 404 });
    },
  });
  const host = `http://127.0.0.1:${gitlab.port}`;

  const teamDir = join(home, '.mattstack', 'teams', 'testteam', 'mattstack');
  mkdirSync(teamDir, { recursive: true });
  writeFileSync(
    join(teamDir, 'settings.team.jsonc'),
    JSON.stringify({
      'board.gitlabHost': host,
      'board.projects': ['g/p'],
      'board.members': [{ username: 'alice' }, { username: 'bob' }],
    })
  );
  const userDir = join(home, '.mattstack', 'user');
  mkdirSync(userDir, { recursive: true });
  if (seat)
    writeFileSync(
      join(userDir, 'settings.user.jsonc'),
      JSON.stringify({ 'board.defaultMember': seat })
    );
  writeFileSync(join(home, '.mattstack', 'machine-key'), 'testmachine');
  const machineDir = join(home, '.mattstack', 'user', 'local', 'testmachine');
  mkdirSync(machineDir, { recursive: true });
  writeFileSync(
    join(machineDir, 'settings.local.jsonc'),
    JSON.stringify({
      'board.cwds': { review: home },
    })
  );

  const dbPath = join(home, 'state.db');
  const db = openStateDb(dbPath);
  const prs = [fakePr(host, 7, ALICE), fakePr(host, 20, BOB)];
  const daemonSeen: Seen = [];
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
      if (cmd === 'discussions:read' || cmd === 'discussions:resolve')
        return Response.json({
          ok: true,
          data: { fetchedAt: 1, discussions: DISCUSSIONS[iid] ?? [] },
        });
      return Response.json({ ok: false, error: 'not implemented' });
    },
  });

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
        ...process.env,
        HOME: home,
        BOARD_APP_ROOT: home,
        BOARD_STATE_DB: dbPath,
        PORT: String(port),
        GITLAB_TOKEN: 'fake-gitlab-token',
        SLACK_TOKEN: 'fake-slack-token',
        SWITCHBOARD_TOKEN: '',
        SWITCHBOARD_ADMIN_TOKEN: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  return {
    port,
    url: iid => `${host}/g/p/-/merge_requests/${iid}`,
    repo: `127.0.0.1:${gitlab.port}/g/p`,
    db,
    gitlabSeen,
    daemonSeen,
    stop: () => {
      proc.kill();
      daemon.stop(true);
      gitlab.stop(true);
    },
  };
}

const seated = boot('seat', 47966, 'alice');
const everyone = boot('all', 47967, null);

afterAll(() => {
  seated.stop();
  everyone.stop();
});

async function ready(b: Board): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${b.port}/healthz`)).ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server never came up');
}

async function post(b: Board, path: string, body: unknown): Promise<Response> {
  await ready(b);
  return fetch(`http://127.0.0.1:${b.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const held = (b: Board, iid: number) =>
  writeDraft(
    b.url(iid),
    'ci-note',
    { mrUrl: b.url(iid), iid, body: 'the cache key changed', status: 'held' },
    1000,
    b.db
  );

/** Every author-only request, addressed at one MR of a board. */
const ROUTES: Array<{
  name: string;
  path: string;
  body: (b: Board, iid: number) => unknown;
  setup?: (b: Board, iid: number) => void;
}> = [
  ...(['merge', 'rebase', 'setAutoMerge', 'cancelAutoMerge'] as const).map(
    action => ({
      name: `/mr/action ${action}`,
      path: '/mr/action',
      body: (b: Board, iid: number) => ({ mrUrl: b.url(iid), iid, action }),
    })
  ),
  {
    name: '/doctor',
    path: '/doctor',
    body: (b, iid) => ({ mrUrl: b.url(iid), iid }),
  },
  {
    name: '/doctor rebase mode',
    path: '/doctor',
    body: (b, iid) => ({ mrUrl: b.url(iid), iid, mode: 'rebase' }),
  },
  {
    name: '/doctor focus',
    path: '/doctor',
    body: (b, iid) => ({ mrUrl: b.url(iid), iid, focus: true }),
  },
  {
    name: '/respond',
    path: '/respond',
    body: (b, iid) => ({ mrUrl: b.url(iid), iid }),
  },
  {
    name: '/respond resume',
    path: '/respond',
    body: (b, iid) => ({ mrUrl: b.url(iid), iid, resume: true }),
  },
  {
    name: '/respond focus',
    path: '/respond',
    body: (b, iid) => ({ mrUrl: b.url(iid), iid, focus: true }),
  },
  {
    name: '/slack/post',
    path: '/slack/post',
    body: (b, iid) => ({ mrUrls: [b.url(iid)] }),
  },
  {
    name: '/drafts post',
    path: '/drafts',
    setup: held,
    body: (b, iid) => ({ mrUrl: b.url(iid), kind: 'ci-note', action: 'post' }),
  },
];

const wroteTo = (b: Board, iid: number) =>
  b.gitlabSeen.some(r => r.includes(`/merge_requests/${iid}`));
const launchedOn = (b: Board, iid: number) =>
  b.daemonSeen.some(
    s =>
      s.cmd.startsWith('agent:') &&
      JSON.stringify(s.body).includes(`merge_requests/${iid}`)
  );

describe("someone else's MR is refused", () => {
  for (const r of ROUTES)
    test(
      r.name,
      async () => {
        r.setup?.(seated, 20);
        const res = await post(seated, r.path, r.body(seated, 20));
        expect(res.status).toBe(403);
        expect(await res.text()).toBe('not your MR');
      },
      15_000
    );

  test('a multi-MR slack post that lists one of theirs is refused whole', async () => {
    const res = await post(seated, '/slack/post', {
      mrUrls: [seated.url(7), seated.url(20)],
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('not your MR');
  }, 15_000);

  test('a held note on their MR stays held, and can still be dismissed', async () => {
    expect(
      readDrafts(seated.db).find(d => d.mrUrl === seated.url(20))?.status
    ).toBe('held');
    const res = await post(seated, '/drafts', {
      mrUrl: seated.url(20),
      kind: 'ci-note',
      action: 'dismiss',
    });
    expect(res.status).toBe(200);
  }, 15_000);
});

describe('an "all" board owns nothing', () => {
  for (const r of ROUTES)
    test(
      r.name,
      async () => {
        r.setup?.(everyone, 7);
        const res = await post(everyone, r.path, r.body(everyone, 7));
        expect(res.status).toBe(403);
        expect(await res.text()).toBe('not your MR');
      },
      15_000
    );

  test('/discussions/resolve, even on a thread its MR author started', async () => {
    const res = await post(everyone, '/discussions/resolve', {
      repo: everyone.repo,
      iid: 7,
      discussionId: 't7-alice',
      author: 'alice',
      resolved: true,
    });
    expect(res.status).toBe(403);
  }, 15_000);

  test('nothing reached GitLab or launched a pane', () => {
    expect(wroteTo(everyone, 7)).toBe(false);
    expect(launchedOn(everyone, 7)).toBe(false);
    expect(everyone.daemonSeen.some(s => s.cmd === 'discussions:resolve')).toBe(
      false
    );
  });
});

describe('your own MR gets past the gate', () => {
  for (const action of ['merge', 'rebase', 'setAutoMerge', 'cancelAutoMerge'])
    test(`/mr/action ${action} reaches GitLab`, async () => {
      const before = seated.gitlabSeen.length;
      const res = await post(seated, '/mr/action', {
        mrUrl: seated.url(7),
        iid: 7,
        action,
      });
      expect(res.status).not.toBe(403);
      expect(
        seated.gitlabSeen
          .slice(before)
          .some(r => r.includes('/merge_requests/7'))
      ).toBe(true);
    }, 15_000);

  test('/doctor launches a pane, rebase mode too', async () => {
    for (const body of [
      { mrUrl: seated.url(7), iid: 7 },
      { mrUrl: seated.url(7), iid: 7, mode: 'rebase' },
    ]) {
      const res = await post(seated, '/doctor', body);
      expect(res.status).toBe(200);
    }
    await new Promise(r => setTimeout(r, 200));
    expect(launchedOn(seated, 7)).toBe(true);
  }, 15_000);

  test('/doctor focus and /respond focus get past the gate', async () => {
    for (const path of ['/doctor', '/respond']) {
      const res = await post(seated, path, {
        mrUrl: seated.url(7),
        iid: 7,
        focus: true,
      });
      expect(res.status).not.toBe(403);
    }
  }, 15_000);

  test('/respond launches a pane', async () => {
    const res = await post(seated, '/respond', {
      mrUrl: seated.url(7),
      iid: 7,
    });
    expect(res.status).toBe(200);
  }, 15_000);

  test('/respond resume gets as far as asking for a session', async () => {
    const res = await post(seated, '/respond', {
      mrUrl: seated.url(7),
      iid: 7,
      resume: true,
    });
    expect(res.status).not.toBe(403);
  }, 15_000);

  test('/slack/post posts it', async () => {
    const res = await post(seated, '/slack/post', { mrUrls: [seated.url(7)] });
    expect(res.status).toBe(200);
  }, 15_000);

  test('/drafts post sends the note to GitLab', async () => {
    held(seated, 7);
    const before = seated.gitlabSeen.length;
    const res = await post(seated, '/drafts', {
      mrUrl: seated.url(7),
      kind: 'ci-note',
      action: 'post',
    });
    expect(res.status).not.toBe(403);
    expect(
      seated.gitlabSeen
        .slice(before)
        .some(r => r.includes('/merge_requests/7/notes'))
    ).toBe(true);
  }, 15_000);
});

describe('/discussions/resolve', () => {
  const resolve = (iid: number, discussionId: string) =>
    post(seated, '/discussions/resolve', {
      repo: seated.repo,
      iid,
      discussionId,
      author: iid === 7 ? 'alice' : 'bob',
      resolved: true,
    });

  test("someone else's thread on someone else's MR is refused", async () => {
    const res = await resolve(20, 't20-bob');
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('not your thread');
  }, 15_000);

  test("a thread you started on someone else's MR resolves", async () => {
    expect((await resolve(20, 't20-alice')).status).toBe(200);
  }, 15_000);

  test("a reviewer's thread on your own MR resolves", async () => {
    expect((await resolve(7, 't7-bob')).status).toBe(200);
  }, 15_000);

  test('a body that claims the MR is yours does not make it so', async () => {
    const res = await post(seated, '/discussions/resolve', {
      repo: seated.repo,
      iid: 20,
      discussionId: 't20-bob',
      author: 'alice',
      resolved: true,
    });
    expect(res.status).toBe(403);
  }, 15_000);
});

test("no refusal on someone else's MR reached GitLab or launched a pane", () => {
  expect(wroteTo(seated, 20)).toBe(false);
  expect(launchedOn(seated, 20)).toBe(false);
});

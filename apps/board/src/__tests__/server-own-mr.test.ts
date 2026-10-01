/** The server enforces every author-only rule on its own, whatever the UI
    sends. Each author-only route is called three ways: on someone else's MR
    (403), on an "all" board, which owns nothing (403), and on the seat's own
    MR (gets past the gate). Refusals must never reach GitLab or launch a
    pane, so each board gets its own fake GitLab and fake rt daemon and the
    tests assert what those saw. Thread resolve is author-only in a narrower
    way: allowed on every thread of your own MR and on threads you started
    anywhere, refused on someone else's thread on someone else's MR. Gate
    answers split by the gate's own kind: respond and doctor gates are the
    author's, review gates stay with the reviewer. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, test } from 'bun:test';

import { readDrafts, writeDraft } from '../draft-state.ts';
import { openStateDb } from '../state/db.ts';
import { readMemory, writeMemory } from '../triage/memory-store.ts';

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

/** Gates waiting on a human, by kind, on MR 7 (alice's) and MR 20 (bob's). */
const GATES: Array<[id: string, kind: string, iid: number]> = [
  ['respond-7', 'respond-plan', 7],
  ['doctor-7', 'doctor-escalation', 7],
  ['respond-20', 'respond-post', 20],
  ['doctor-20', 'doctor-escalation', 20],
  ['review-20', 'review-post', 20],
];

function gateRow(host: string, id: string, kind: string, iid: number) {
  return {
    id,
    subject: `mr:${host}/g/p/-/merge_requests/${iid}`,
    kind,
    questions: [{ id: 'q', label: 'Go ahead?', options: ['yes', 'no'] }],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: Date.now(),
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    supersededBy: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    consumedAt: null,
    owner: null,
    escalatedAt: null,
  };
}

function boot(
  name: string,
  port: number,
  seat: string | null,
  tokenUser: string = seat ?? 'alice'
): Board {
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
          username: tokenUser,
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
  writeMemory(
    {
      ...readMemory(db),
      identity: { username: tokenUser, fetchedAt: Date.now() },
    },
    db
  );
  const prs = [fakePr(host, 7, ALICE), fakePr(host, 20, BOB)];
  const gates = GATES.map(([id, kind, iid]) => gateRow(host, id, kind, iid));
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
      if (cmd === 'gate:list') {
        const prefix = (body as { subjectPrefix?: string } | null)
          ?.subjectPrefix;
        return Response.json({
          ok: true,
          data: { gates: prefix === 'mr:' ? gates : [], cursor: 0 },
        });
      }
      if (cmd === 'gate:answer') {
        const { id, answers } = body as { id: string; answers: unknown };
        const row = gates.find(g => g.id === id);
        return Response.json({
          ok: true,
          data: {
            row: {
              ...row,
              status: 'answered',
              answer: { answers, by: 'board', answeredAt: Date.now() },
            },
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
// The seat says alice, but the board's GitLab token belongs to carol.
const borrowed = boot('borrowed', 47968, 'alice', 'carol');

afterAll(() => {
  seated.stop();
  everyone.stop();
  borrowed.stop();
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
/** Every author-only request, addressed at one MR of a board. `body` takes
    the MR the url names and, separately, the iid the body claims, so a
    mismatched pair can be sent; routes with no iid of their own leave
    `carriesIid` off. */
const ROUTES: Array<{
  name: string;
  path: string;
  body: (b: Board, urlIid: number, iid?: number) => unknown;
  carriesIid?: boolean;
  setup?: (b: Board, iid: number) => void;
}> = [
  ...(['merge', 'rebase', 'setAutoMerge', 'cancelAutoMerge'] as const).map(
    action => ({
      name: `/mr/action ${action}`,
      path: '/mr/action',
      carriesIid: true,
      body: (b: Board, u: number, iid = u) => ({
        mrUrl: b.url(u),
        iid,
        action,
      }),
    })
  ),
  {
    name: '/draft (mark as draft)',
    path: '/draft',
    carriesIid: true,
    body: (b, u, iid = u) => ({ mrUrl: b.url(u), iid, draft: true }),
  },
  {
    name: '/doctor',
    path: '/doctor',
    carriesIid: true,
    body: (b, u, iid = u) => ({ mrUrl: b.url(u), iid }),
  },
  {
    name: '/doctor rebase mode',
    path: '/doctor',
    carriesIid: true,
    body: (b, u, iid = u) => ({ mrUrl: b.url(u), iid, mode: 'rebase' }),
  },
  {
    name: '/doctor focus',
    path: '/doctor',
    carriesIid: true,
    body: (b, u, iid = u) => ({ mrUrl: b.url(u), iid, focus: true }),
  },
  {
    name: '/respond',
    path: '/respond',
    carriesIid: true,
    body: (b, u, iid = u) => ({ mrUrl: b.url(u), iid }),
  },
  {
    name: '/respond resume',
    path: '/respond',
    carriesIid: true,
    body: (b, u, iid = u) => ({ mrUrl: b.url(u), iid, resume: true }),
  },
  {
    name: '/respond focus',
    path: '/respond',
    carriesIid: true,
    body: (b, u, iid = u) => ({ mrUrl: b.url(u), iid, focus: true }),
  },
  {
    name: '/slack/post',
    path: '/slack/post',
    body: (b, u) => ({ mrUrls: [b.url(u)] }),
  },
  {
    name: '/drafts post',
    path: '/drafts',
    setup: held,
    body: (b, u) => ({ mrUrl: b.url(u), kind: 'ci-note', action: 'post' }),
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
  test('/draft reaches GitLab', async () => {
    const before = seated.gitlabSeen.length;
    const res = await post(seated, '/draft', {
      mrUrl: seated.url(7),
      iid: 7,
      draft: true,
    });
    expect(res.status).not.toBe(403);
    expect(
      seated.gitlabSeen.slice(before).some(r => r.includes('/merge_requests/7'))
    ).toBe(true);
  }, 15_000);

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

describe("your MR's url with someone else's iid is refused", () => {
  const agentCalls = (b: Board) =>
    b.daemonSeen.filter(x => x.cmd.startsWith('agent:')).length;
  for (const r of ROUTES.filter(x => x.carriesIid))
    test(
      r.name,
      async () => {
        const gitlabBefore = seated.gitlabSeen.length;
        const agentsBefore = agentCalls(seated);
        const res = await post(seated, r.path, r.body(seated, 7, 20));
        expect(res.status).toBe(400);
        expect(await res.text()).toBe(`iid 20 does not match ${seated.url(7)}`);
        await new Promise(x => setTimeout(x, 100));
        expect(seated.gitlabSeen.length).toBe(gitlabBefore);
        expect(agentCalls(seated)).toBe(agentsBefore);
      },
      15_000
    );
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

/** Answers one gate, waiting out the boot resync that loads gates into the
    board's cache (until then every id is unknown, a 404). */
async function answerGate(b: Board, gateId: string): Promise<Response> {
  for (let i = 0; i < 50; i++) {
    const res = await post(b, '/gate/answer', {
      gateId,
      answers: { q: 'yes' },
    });
    if (res.status !== 404) return res;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`gate ${gateId} never reached the board's cache`);
}

const answered = (b: Board, gateId: string) =>
  b.daemonSeen.some(
    s => s.cmd === 'gate:answer' && (s.body as { id?: string }).id === gateId
  );

describe('/gate/answer', () => {
  for (const id of ['respond-20', 'doctor-20'])
    test(`a ${id.split('-')[0]} gate on someone else's MR is refused`, async () => {
      const res = await answerGate(seated, id);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe('not your MR');
      expect(answered(seated, id)).toBe(false);
    }, 15_000);

  for (const id of ['respond-7', 'doctor-7'])
    test(`a ${id.split('-')[0]} gate on an "all" board is refused`, async () => {
      const res = await answerGate(everyone, id);
      expect(res.status).toBe(403);
      expect(answered(everyone, id)).toBe(false);
    }, 15_000);

  for (const id of ['respond-7', 'doctor-7'])
    test(`a ${id.split('-')[0]} gate on your own MR is answered`, async () => {
      const res = await answerGate(seated, id);
      expect(res.status).toBe(200);
      expect(answered(seated, id)).toBe(true);
    }, 15_000);

  test("a review gate on someone else's MR stays the reviewer's to answer", async () => {
    const res = await answerGate(seated, 'review-20');
    expect(res.status).toBe(200);
    expect(answered(seated, 'review-20')).toBe(true);
  }, 15_000);
});

describe("a seat that is not the token's user owns nothing", () => {
  for (const r of ROUTES)
    test(
      r.name,
      async () => {
        r.setup?.(borrowed, 7);
        const res = await post(borrowed, r.path, r.body(borrowed, 7));
        expect(res.status).toBe(403);
        expect(await res.text()).toBe('not your MR');
      },
      15_000
    );

  test("/discussions/resolve on a reviewer's thread on the seat's MR", async () => {
    const res = await post(borrowed, '/discussions/resolve', {
      repo: borrowed.repo,
      iid: 7,
      discussionId: 't7-bob',
      author: 'alice',
      resolved: true,
    });
    expect(res.status).toBe(403);
  }, 15_000);

  test('a thread the seat started is not resolvable under a borrowed seat', async () => {
    const res = await post(borrowed, '/discussions/resolve', {
      repo: borrowed.repo,
      iid: 20,
      discussionId: 't20-alice',
      author: 'bob',
      resolved: true,
    });
    expect(res.status).toBe(403);
  }, 15_000);

  test('the board data names the token user so the client applies the same rule', async () => {
    await ready(borrowed);
    const data = (await (
      await fetch(`http://127.0.0.1:${borrowed.port}/data.json`)
    ).json()) as { tokenUser?: string | null };
    expect(data.tokenUser).toBe('carol');
  }, 15_000);

  test('nothing reached GitLab or launched a pane', () => {
    expect(wroteTo(borrowed, 7)).toBe(false);
    expect(launchedOn(borrowed, 7)).toBe(false);
  });
});

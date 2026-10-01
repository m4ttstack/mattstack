/** Author-only routes refuse someone else's MR with 403 "not your MR":
    merge, rebase and auto-merge (/mr/action), doctor (/doctor), respond
    (/respond), slack posts (/slack/post) and posting a held doctor note
    (/drafts). The menu hides these on others' MRs; this is the boundary
    behind it. Same fake-daemon boot as server-stand-down.test.ts, so ownership
    resolves from a real snapshot. Every refusal fires before any GitLab,
    Slack or herdr call, so the fake tokens are never spent. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { readDrafts, writeDraft } from '../draft-state.ts';
import { openStateDb } from '../state/db.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-own-mr-'));

const teamDir = join(fakeHome, '.mattstack', 'teams', 'testteam', 'mattstack');
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.team.jsonc'),
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'board.members': [{ username: 'alice' }, { username: 'bob' }],
  })
);

const userDir = join(fakeHome, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'board.defaultMember': 'alice' })
);

writeFileSync(join(fakeHome, '.mattstack', 'machine-key'), 'testmachine');
const machineDir = join(fakeHome, '.mattstack', 'user', 'local', 'testmachine');
mkdirSync(machineDir, { recursive: true });
writeFileSync(
  join(machineDir, 'settings.local.jsonc'),
  JSON.stringify({
    'board.rtRepos': [{ project: 'g/p', repo: 'gitlab.example.com/g/p' }],
    'board.cwds': { review: fakeHome },
  })
);

const GITLAB_HOST = 'https://gitlab.example.com';
const url = (iid: number) => `${GITLAB_HOST}/g/p/-/merge_requests/${iid}`;

function fakePr(iid: number, author: Record<string, unknown>) {
  return {
    id: `gitlab:${iid}`,
    iid,
    repositoryId: 'gitlab:42',
    title: 'An MR',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: url(iid),
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

const ALICE = { id: 'gitlab:1', username: 'alice', name: 'Alice' };
const BOB = { id: 'gitlab:2', username: 'bob', name: 'Bob' };
const MINE = url(7);
const THEIRS = url(20);
const mrs = [fakePr(7, ALICE), fakePr(20, BOB)];

const dbPath = join(fakeHome, 'state.db');
const db = openStateDb(dbPath);

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const rtDaemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  fetch(req) {
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), {
        headers: { 'content-type': 'application/json' },
      });
    if (new URL(req.url).pathname !== '/project-mrs:read')
      return json({ ok: false, error: 'not implemented' });
    const byId: Record<string, unknown> = {};
    for (const pr of mrs)
      byId[pr.id] = { pr, fetchedAt: Date.now(), codeownerSections: [] };
    return json({
      ok: true,
      data: {
        mrs: byId,
        listSyncedAt: Date.now(),
        source: 'poll',
        syncedAt: Date.now(),
      },
    });
  },
});

const PORT = 47966;
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
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
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

async function expectRefused(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(await res.text()).toBe('not your MR');
}

for (const action of ['merge', 'rebase', 'setAutoMerge', 'cancelAutoMerge']) {
  test(`/mr/action ${action} refuses someone else's MR`, async () => {
    await ready();
    await expectRefused(
      await post('/mr/action', { mrUrl: THEIRS, iid: 20, action })
    );
  }, 15_000);
}

test('/mr/action still reaches GitLab for your own MR', async () => {
  await ready();
  const res = await post('/mr/action', {
    mrUrl: MINE,
    iid: 7,
    action: 'rebase',
  });
  expect(res.status).not.toBe(403);
}, 15_000);

test("/doctor refuses someone else's MR, rebase-only mode included", async () => {
  await ready();
  await expectRefused(await post('/doctor', { mrUrl: THEIRS, iid: 20 }));
  await expectRefused(
    await post('/doctor', { mrUrl: THEIRS, iid: 20, mode: 'rebase' })
  );
}, 15_000);

test("/respond refuses someone else's MR, resume and focus included", async () => {
  await ready();
  await expectRefused(await post('/respond', { mrUrl: THEIRS, iid: 20 }));
  await expectRefused(
    await post('/respond', { mrUrl: THEIRS, iid: 20, resume: true })
  );
  await expectRefused(
    await post('/respond', { mrUrl: THEIRS, iid: 20, focus: true })
  );
}, 15_000);

test('/respond on your own MR gets past the ownership check', async () => {
  await ready();
  const res = await post('/respond', { mrUrl: MINE, iid: 7, resume: true });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('no session id');
}, 15_000);

test("/slack/post refuses someone else's MR", async () => {
  await ready();
  await expectRefused(await post('/slack/post', { mrUrls: [THEIRS] }));
}, 15_000);

test("a summary post that lists someone else's MR is refused whole", async () => {
  await ready();
  await expectRefused(await post('/slack/post', { mrUrls: [MINE, THEIRS] }));
}, 15_000);

test("/drafts refuses to post a held note on someone else's MR, but dismisses it", async () => {
  await ready();
  writeDraft(
    THEIRS,
    'ci-note',
    { mrUrl: THEIRS, iid: 20, body: 'the cache key changed', status: 'held' },
    1000,
    db
  );
  await expectRefused(
    await post('/drafts', { mrUrl: THEIRS, kind: 'ci-note', action: 'post' })
  );
  expect(readDrafts(db).find(d => d.mrUrl === THEIRS)?.status).toBe('held');
  const res = await post('/drafts', {
    mrUrl: THEIRS,
    kind: 'ci-note',
    action: 'dismiss',
  });
  expect(res.status).toBe(200);
}, 15_000);

test("/draft (mark ready or draft) still refuses someone else's MR", async () => {
  await ready();
  await expectRefused(
    await post('/draft', { mrUrl: THEIRS, iid: 20, draft: true })
  );
}, 15_000);

/** A GitHub team's board: it boots the real board, lists the team's PRs with
    their gates from the daemon store, and sends its own PRs' writes through
    daemon verbs. The env keeps a GitLab token set, yet a GitHub team never
    reads it, so no write here may lean on one. The board is alice through
    the team record while the memory identity says zed, so a GitHub team
    never answers with the memory one. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { readDrafts, writeDraft } from '../draft-state.ts';
import { openStateDb } from '../state/db.ts';
import { readMemory, writeMemory } from '../triage/memory-store.ts';
import { bootBoardServer } from './board-server.ts';

const HOST = 'https://github.test';
const prUrl = (iid: number) => `${HOST}/o/r/pull/${iid}`;

const ALICE = { id: 'github:1', username: 'alice', name: 'Alice' };
const BOB = { id: 'github:2', username: 'bob', name: 'Bob' };

function fakePr(iid: number, author: Record<string, unknown>) {
  return {
    id: `github:${iid}`,
    iid,
    provider: 'github',
    repositoryId: 'github:9',
    title: 'A PR',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: prUrl(iid),
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

const reviewGate = {
  id: 'review-20',
  subject: `mr:${prUrl(20)}`,
  kind: 'review-post',
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

const home = mkdtempSync(join(tmpdir(), 'board-github-team-'));

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
    'mattstack.integrations': {
      forge: { provider: 'github', host: 'github.test' },
    },
    'board.projects': ['o/r'],
    'mattstack.roster': [
      { username: 'alice', teams: ['web'] },
      { username: 'bob', teams: ['web'] },
    ],
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

const teamRecordDir = join(home, '.mattstack', 'rt', 'teams');
mkdirSync(teamRecordDir, { recursive: true });
writeFileSync(
  join(teamRecordDir, 'testteam.json'),
  JSON.stringify({ forgeUsername: 'alice' })
);

const dbPath = join(home, 'state.db');
const db = openStateDb(dbPath);
writeMemory(
  {
    ...readMemory(db),
    identity: { username: 'zed', fetchedAt: Date.now() },
  },
  db
);

const prs = [
  fakePr(7, ALICE),
  fakePr(8, ALICE),
  fakePr(9, ALICE),
  fakePr(10, ALICE),
  fakePr(11, ALICE),
  fakePr(20, BOB),
];
const writes: Array<{ cmd: string; body: Record<string, unknown> }> = [];

const MERGE_ANSWERS: Record<number, unknown> = {
  7: { ok: true },
  8: { ok: true, data: { queued: { position: 2, state: 'QUEUED' } } },
  9: {
    ok: false,
    error: 'Error: mergePullRequest failed: 405 Pull Request is not mergeable',
  },
  10: { ok: false, error: 'rt daemon unreachable at /x (timed out)' },
};
const rtDir = join(home, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
let daemon: ReturnType<typeof Bun.serve> | undefined;
beforeAll(() => {
  daemon = Bun.serve({
    unix: join(rtDir, 'rt.sock'),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      const body =
        req.method === 'POST' ? await req.json().catch(() => null) : null;
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
          data: { gates: prefix === 'mr:' ? [reviewGate] : [], cursor: 0 },
        });
      }
      if (cmd === 'mr:action' || cmd === 'mr:comment') {
        const write = (body ?? {}) as Record<string, unknown>;
        writes.push({ cmd, body: write });
        if (cmd === 'mr:comment' && write.iid === 11)
          return Response.json({
            ok: false,
            error: 'Error: createComment failed: 422 x',
          });
        if (cmd === 'mr:comment')
          return Response.json({
            ok: true,
            data: {
              noteId: 555,
              discussionId: null,
              resolvable: false,
              url: 'u',
              mrUrl: 'm',
            },
          });
        if (write.action === 'merge')
          return Response.json(MERGE_ANSWERS[write.iid as number]);
        return Response.json({ ok: true });
      }
      if (cmd === 'mr:get')
        return Response.json({ ok: true, data: { mr: { state: 'opened' } } });
      return Response.json({ ok: false, error: 'not implemented' });
    },
  });
});

const server = bootBoardServer({
  preload: join(import.meta.dir, 'slack-api-mock-preload.ts'),
  env: {
    HOME: home,
    CLAUDE_BIN: join(home, 'no-claude-here'),
    BOARD_APP_ROOT: home,
    BOARD_STATE_DB: dbPath,
    GITLAB_TOKEN: 'fake-gitlab-token',
    SLACK_TOKEN: 'fake-slack-token',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

afterAll(() => {
  daemon?.stop(true);
});

const base = () => `http://127.0.0.1:${server.port}`;

async function post(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(await res.clone().text()).not.toContain('gitlab token not configured');
  return res;
}

const held = (iid: number) =>
  writeDraft(
    prUrl(iid),
    'ci-note',
    { mrUrl: prUrl(iid), iid, body: 'the cache key changed', status: 'held' },
    1000,
    db
  );

type Row = {
  webUrl: string;
  provider: string;
  gates: Array<{ gateId: string }>;
};

describe('a GitHub team', () => {
  test('boots the real board, not the setup page', async () => {
    const res = await fetch(`${base()}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('/data.json lists the GitHub PRs with their gate', async () => {
    let rows: Row[] = [];
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const data = (await (await fetch(`${base()}/data.json`)).json()) as {
        mrs: Row[];
      };
      rows = data.mrs;
      if (rows.find(r => r.webUrl === prUrl(20))?.gates.length) break;
      await Bun.sleep(200);
    }
    expect(rows.map(r => r.webUrl).sort()).toEqual(
      [prUrl(7), prUrl(8), prUrl(9), prUrl(10), prUrl(11), prUrl(20)].sort()
    );
    expect(rows.every(r => r.provider === 'github')).toBe(true);
    expect(
      rows.find(r => r.webUrl === prUrl(20))?.gates.map(g => g.gateId)
    ).toEqual(['review-20']);
    expect(rows.find(r => r.webUrl === prUrl(7))?.gates).toEqual([]);
  }, 15_000);

  async function postRead(path: string, body: unknown) {
    const res = await post(path, body);
    return { status: res.status, text: await res.text() };
  }
  const merge = (iid: number) =>
    postRead('/mr/action', { mrUrl: prUrl(iid), iid, action: 'merge' });
  const writesSince = (from: number) => writes.slice(from);

  test('merge on an own PR goes through mr:action', async () => {
    const from = writes.length;
    const res = await merge(7);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true });
    const [sent] = writesSince(from);
    expect(sent?.cmd).toBe('mr:action');
    expect(sent?.body).toMatchObject({ iid: 7, action: 'merge', args: [] });
    expect(typeof sent?.body.repoName).toBe('string');
    expect(sent?.body.repoName).not.toBe('');
  }, 15_000);

  test('a queued merge answers mergeQueued', async () => {
    const res = await merge(8);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({
      ok: true,
      mergeQueued: { position: 2, state: 'QUEUED' },
    });
  }, 15_000);

  test('a refused merge answers 409 with the forge reason', async () => {
    const res = await merge(9);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.text)).toEqual({
      reason: '405 Pull Request is not mergeable',
    });
  }, 15_000);

  test('an unanswered merge answers 504', async () => {
    const res = await merge(10);
    expect(res.status).toBe(504);
    expect(JSON.parse(res.text)).toEqual({
      reason: 'the merge may still land',
    });
  }, 15_000);

  test('auto-merge arm and cancel reach mr:action', async () => {
    for (const action of ['setAutoMerge', 'cancelAutoMerge']) {
      const from = writes.length;
      const res = await postRead('/mr/action', {
        mrUrl: prUrl(7),
        iid: 7,
        action,
      });
      expect(res.status).toBe(200);
      expect(writesSince(from)).toEqual([
        {
          cmd: 'mr:action',
          body: expect.objectContaining({ iid: 7, action }),
        },
      ]);
    }
  }, 15_000);

  test('the draft toggle sends toggleDraft', async () => {
    const from = writes.length;
    const res = await postRead('/draft', {
      mrUrl: prUrl(7),
      iid: 7,
      draft: true,
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true, draft: true });
    expect(writesSince(from)).toEqual([
      {
        cmd: 'mr:action',
        body: expect.objectContaining({
          iid: 7,
          action: 'toggleDraft',
          args: [true],
        }),
      },
    ]);
  }, 15_000);

  test('/data.json names the team username as the board user', async () => {
    const data = (await (await fetch(`${base()}/data.json`)).json()) as {
      tokenUser: string | null;
    };
    expect(data.tokenUser).toBe('alice');
  }, 15_000);

  test('a held draft posts through mr:comment', async () => {
    held(7);
    const from = writes.length;
    const res = await postRead('/drafts', {
      mrUrl: prUrl(7),
      kind: 'ci-note',
      action: 'post',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({
      ok: true,
      posted: true,
      noteId: 555,
    });
    expect(writesSince(from)).toEqual([
      {
        cmd: 'mr:comment',
        body: expect.objectContaining({
          iid: 7,
          body: 'the cache key changed',
          resolvable: false,
        }),
      },
    ]);
    const draft = readDrafts(db).find(d => d.mrUrl === prUrl(7));
    expect(draft?.status).toBe('posted');
    expect(draft?.postedNoteId).toBe(555);
  }, 15_000);

  test('a refused note post answers 409 and the draft stays held', async () => {
    held(11);
    const res = await postRead('/drafts', {
      mrUrl: prUrl(11),
      kind: 'ci-note',
      action: 'post',
    });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.text)).toEqual({ reason: '422 x' });
    expect(readDrafts(db).find(d => d.mrUrl === prUrl(11))?.status).toBe(
      'held'
    );
  }, 15_000);

  test("another author's PR is refused before any write", async () => {
    const from = writes.length;
    const res = await merge(20);
    expect(res.status).toBe(403);
    expect(res.text).toBe('not your MR');
    expect(writesSince(from)).toEqual([]);
  }, 15_000);

  test('dismissing a held draft still works on a GitHub team', async () => {
    held(7);
    const res = await post('/drafts', {
      mrUrl: prUrl(7),
      kind: 'ci-note',
      action: 'dismiss',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dismissed: true });
  }, 15_000);
});

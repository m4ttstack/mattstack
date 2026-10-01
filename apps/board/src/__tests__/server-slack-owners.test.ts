import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { dbPathForRoot, openStateDb } from '../state/index.ts';

// /slack/owners/preview and /slack/owners/post on a real server: a fake rt
// daemon answers the MR list and forge:get's approval state, and
// slack-api-mock-preload.ts answers slack.com and logs every message sent.
// Project g/p opts in through board.codeowners in its repo section; g/q does
// not. MR 701's Code Owner sections cover every row the preview can show.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-slack-owners-'));
const HOST = 'https://gitlab.example.com';

const teamDir = join(fakeHome, '.mattstack', 'teams', 'testteam', 'mattstack');
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.team.jsonc'),
  JSON.stringify({
    'board.gitlabHost': HOST,
    'board.projects': ['g/p', 'g/q'],
    'board.members': [{ username: 'alice' }, { username: 'bob' }],
    'board.slack': { channel: 'code-review', autoResolveIntervalMinutes: 0 },
    repos: {
      'gitlab.example.com/g/p': {
        'board.codeowners': { slack: { fromSectionName: true } },
      },
    },
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
    'board.rtRepos': [
      { project: 'g/p', repo: 'gitlab.example.com/g/p' },
      { project: 'g/q', repo: 'gitlab.example.com/g/q' },
    ],
  })
);

const url = (project: string, iid: number) =>
  `${HOST}/${project}/-/merge_requests/${iid}`;

function fakePr(project: string, iid: number, username: string) {
  return {
    id: `gitlab:${iid}`,
    iid,
    repositoryId: project === 'g/p' ? 'gitlab:42' : 'gitlab:43',
    title: 'ACME-1 An MR',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: false,
    webUrl: url(project, iid),
    sourceBranch: `feat/${iid}`,
    targetBranch: 'main',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
    sha: null,
    author: {
      id: `gitlab:${username}`,
      username,
      name: username,
      avatarUrl: null,
    },
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

const PRS: Record<string, ReturnType<typeof fakePr>[]> = {
  'g/p': [
    fakePr('g/p', 701, 'alice'),
    fakePr('g/p', 702, 'bob'),
    fakePr('g/p', 703, 'alice'),
    fakePr('g/p', 704, 'alice'),
    fakePr('g/p', 705, 'alice'),
  ],
  'g/q': [fakePr('g/q', 801, 'alice')],
};

const APPROVAL_STATE = {
  rules: [
    { rule_type: 'any_approver', section: null, approved: false },
    {
      rule_type: 'code_owner',
      section: 'Acme - #acme-channel',
      approved: false,
    },
    {
      rule_type: 'code_owner',
      section: 'Acme Jobs - #acme-channel',
      approved: false,
    },
    {
      rule_type: 'code_owner',
      section: 'Other - #other-channel',
      approved: true,
    },
    {
      rule_type: 'code_owner',
      section: 'Gone - #missing-channel',
      approved: false,
    },
    { rule_type: 'code_owner', section: 'Docs', approved: false },
    {
      rule_type: 'code_owner',
      section: 'Outside - #outside-channel',
      approved: false,
    },
  ],
};

const rule = (section: string) => ({
  rule_type: 'code_owner',
  section,
  approved: false,
});
/** 704 posts to one channel that works and one whose post fails; 705 is
    answered slowly so a second confirm lands while the first runs. */
const APPROVAL_BY_IID: Record<string, unknown> = {
  '704': {
    rules: [rule('Acme - #acme-channel'), rule('Flaky - #flaky-channel')],
  },
  '705': { rules: [rule('Acme - #acme-channel')] },
};

const forgeSeen: Array<{ repoName: string; path: string }> = [];
const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const rtDaemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const body = (
      req.method === 'POST' ? await req.json().catch(() => null) : null
    ) as { repoName?: string; path?: string } | null;
    if (pathname === '/project-mrs:read') {
      const project =
        (body?.repoName ?? '').includes('g%2Fq') ||
        (body?.repoName ?? '').endsWith('g/q')
          ? 'g/q'
          : 'g/p';
      const mrs: Record<string, unknown> = {};
      for (const pr of PRS[project]!)
        mrs[pr.id] = { pr, fetchedAt: Date.now(), codeownerSections: [] };
      return Response.json({
        ok: true,
        data: {
          mrs,
          listSyncedAt: Date.now(),
          source: 'poll',
          syncedAt: Date.now(),
        },
      });
    }
    if (pathname === '/forge:get') {
      forgeSeen.push({
        repoName: body?.repoName ?? '',
        path: body?.path ?? '',
      });
      const iid = /merge_requests\/(\d+)\//.exec(body?.path ?? '')?.[1] ?? '';
      if (iid === '705') await new Promise(r => setTimeout(r, 600));
      if (iid === '703')
        return Response.json({
          ok: true,
          data: {
            status: 200,
            body: '{"rules":[{"rule_type":"code_owner","sec',
            truncated: true,
            nextPage: null,
            totalPages: null,
          },
        });
      return Response.json({
        ok: true,
        data: {
          status: 200,
          body: APPROVAL_BY_IID[iid] ?? APPROVAL_STATE,
          truncated: false,
          nextPage: null,
          totalPages: null,
        },
      });
    }
    return Response.json({ ok: false, error: 'not implemented' });
  },
});

const postLog = join(fakeHome, 'slack-posts.ndjson');
const PORT = 47969;
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
      PORT: String(PORT),
      GITLAB_TOKEN: '',
      SLACK_TOKEN: 'fake-slack-token',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
      SLACK_MOCK_POST_LOG: postLog,
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

function sent(): Array<{ channel: string; text: string }> {
  if (!existsSync(postLog)) return [];
  return readFileSync(postLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { channel: string; text: string });
}

interface Preview {
  text: string;
  channels: Array<{ channel: string; sections: string[] }>;
  skipped: Array<{
    section: string;
    reason: string;
    channel?: string;
    permalink?: string;
  }>;
}

test('the board data names the repos that opted in', async () => {
  await ready();
  const data = (await (
    await fetch(`http://127.0.0.1:${PORT}/data.json`)
  ).json()) as {
    ownerSlackRepos?: string[];
    mrs: Array<{ iid: number; rtRepo: string | null }>;
  };
  const repoOf = (iid: number) => data.mrs.find(m => m.iid === iid)?.rtRepo;
  expect(data.ownerSlackRepos).toEqual([repoOf(701)!]);
  expect(data.ownerSlackRepos).not.toContain(repoOf(801)!);
}, 15_000);

test('preview groups unapproved sections by channel and says why the rest are skipped, sending nothing', async () => {
  await ready();
  const res = await post('/slack/owners/preview', { mrUrl: url('g/p', 701) });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Preview;
  expect(body.channels).toEqual([
    {
      channel: 'acme-channel',
      sections: ['Acme - #acme-channel', 'Acme Jobs - #acme-channel'],
    },
  ]);
  expect(body.skipped).toEqual([
    {
      section: 'Other - #other-channel',
      reason: 'approved',
      channel: 'other-channel',
    },
    {
      section: 'Gone - #missing-channel',
      reason: 'channel-missing',
      channel: 'missing-channel',
    },
    { section: 'Docs', reason: 'no-channel' },
    {
      section: 'Outside - #outside-channel',
      reason: 'not-member',
      channel: 'outside-channel',
    },
  ]);
  expect(body.text).toContain(url('g/p', 701));
  expect(forgeSeen.at(-1)?.path).toBe(
    'projects/:id/merge_requests/701/approval_state'
  );
  expect(sent()).toEqual([]);
}, 15_000);

test("someone else's MR is refused before GitLab is asked", async () => {
  await ready();
  const before = forgeSeen.length;
  for (const path of ['/slack/owners/preview', '/slack/owners/post']) {
    const res = await post(path, {
      mrUrl: url('g/p', 702),
      channels: ['acme-channel'],
    });
    expect(res.status).toBe(403);
  }
  expect(forgeSeen.length).toBe(before);
  expect(sent()).toEqual([]);
}, 15_000);

test('a repo that has not opted in is refused', async () => {
  await ready();
  for (const path of ['/slack/owners/preview', '/slack/owners/post']) {
    const res = await post(path, {
      mrUrl: url('g/q', 801),
      channels: ['acme-channel'],
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(
      'code owner posts are not turned on for this repo'
    );
  }
  expect(sent()).toEqual([]);
}, 15_000);

test('post refuses a channel the preview did not offer, and sends nothing', async () => {
  await ready();
  for (const channels of [
    ['code-review'],
    ['other-channel'],
    ['acme-channel', 'missing-channel'],
    ['outside-channel'],
    [],
  ]) {
    const res = await post('/slack/owners/post', {
      mrUrl: url('g/p', 701),
      channels,
    });
    expect(res.status).toBe(400);
  }
  expect(sent()).toEqual([]);
}, 15_000);

test('post sends once per confirmed channel, remembers it, and leaves the review-request ref alone', async () => {
  await ready();
  const res = await post('/slack/owners/post', {
    mrUrl: url('g/p', 701),
    channels: ['acme-channel'],
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    posted: Array<{ channel: string; permalink: string }>;
    failed: unknown[];
  };
  expect(body.failed).toEqual([]);
  expect(body.posted).toHaveLength(1);
  expect(body.posted[0]!.channel).toBe('acme-channel');
  expect(body.posted[0]!.permalink).toContain('C_ACME');
  const messages = sent();
  expect(messages).toHaveLength(1);
  expect(messages[0]!.channel).toBe('C_ACME');
  expect(messages[0]!.text).toContain(url('g/p', 701));

  const again = (await (
    await post('/slack/owners/preview', { mrUrl: url('g/p', 701) })
  ).json()) as Preview;
  expect(again.channels).toEqual([]);
  expect(again.skipped.filter(s => s.reason === 'already-posted')).toEqual([
    {
      section: 'Acme - #acme-channel',
      reason: 'already-posted',
      channel: 'acme-channel',
      permalink: body.posted[0]!.permalink,
    },
    {
      section: 'Acme Jobs - #acme-channel',
      reason: 'already-posted',
      channel: 'acme-channel',
      permalink: body.posted[0]!.permalink,
    },
  ]);

  const repeat = await post('/slack/owners/post', {
    mrUrl: url('g/p', 701),
    channels: ['acme-channel'],
  });
  expect(repeat.status).toBe(400);
  expect(sent()).toHaveLength(1);

  const db = openStateDb(dbPathForRoot(fakeHome));
  const refs = db.query('SELECT mr_url FROM slack_refs').all();
  db.close();
  expect(refs).toEqual([]);
}, 20_000);

const sentFor = (iid: number) =>
  sent().filter(m => m.text.includes(url('g/p', iid)));

test('a truncated approval answer is an error, never read as no sections', async () => {
  await ready();
  const res = await post('/slack/owners/preview', { mrUrl: url('g/p', 703) });
  expect(res.status).toBe(502);
  expect(await res.text()).toContain('too large');
}, 15_000);

test('a partly failed post reports each channel, and the one that went is not offered again', async () => {
  await ready();
  const res = await post('/slack/owners/post', {
    mrUrl: url('g/p', 704),
    channels: ['acme-channel', 'flaky-channel'],
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    posted: Array<{ channel: string }>;
    failed: Array<{ channel: string; error: string }>;
  };
  expect(body.posted.map(p => p.channel)).toEqual(['acme-channel']);
  expect(body.failed.map(f => f.channel)).toEqual(['flaky-channel']);
  expect(body.failed[0]!.error).toContain('not_in_channel');
  expect(sentFor(704)).toHaveLength(1);
  const again = (await (
    await post('/slack/owners/preview', { mrUrl: url('g/p', 704) })
  ).json()) as Preview;
  expect(again.channels.map(c => c.channel)).toEqual(['flaky-channel']);
}, 15_000);

test('a second confirm while the first is still running is refused, so nothing posts twice', async () => {
  await ready();
  const confirm = () =>
    post('/slack/owners/post', {
      mrUrl: url('g/p', 705),
      channels: ['acme-channel'],
    });
  const first = confirm();
  await new Promise(r => setTimeout(r, 100));
  const second = await confirm();
  expect(second.status).toBe(409);
  expect((await first).status).toBe(200);
  expect(sentFor(705)).toHaveLength(1);
}, 15_000);

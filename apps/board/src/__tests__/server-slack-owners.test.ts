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
// The team channel and our own code owners channel come from the team
// directory; a second board, whose team has no review channel, refuses.
const HOST = 'https://gitlab.example.com';

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
    fakePr('g/p', 706, 'alice'),
    fakePr('g/p', 707, 'alice'),
    fakePr('g/p', 708, 'alice'),
    fakePr('g/p', 709, 'alice'),
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
  // 706 needs our team and another; 707 only ours; 708 was posted to
  // #acme-channel by hand; 709 already has a team thread.
  '706': {
    rules: [rule('Ours - #ours-channel'), rule('Acme - #acme-channel')],
  },
  '707': {
    rules: [
      rule('Ours - #ours-channel'),
      { ...rule('Acme - #acme-channel'), approved: true },
    ],
  },
  '708': {
    rules: [rule('Ours - #ours-channel'), rule('Acme - #acme-channel')],
  },
  '709': { rules: [rule('Acme - #acme-channel')] },
};

const forgeSeen: Array<{ repoName: string; path: string }> = [];

/** A board on its own temp HOME, its own fake rt daemon and the Slack mock,
    whose org directory is `directory`. */
function bootBoard({
  port,
  directory,
  recheckMs,
}: {
  port: number;
  directory: unknown;
  recheckMs?: number;
}) {
  const home = mkdtempSync(join(tmpdir(), 'board-slack-owners-'));
  const orgDir = join(home, '.mattstack', 'orgs', 'testteam', 'mattstack');
  mkdirSync(join(orgDir, 'org'), { recursive: true });
  writeFileSync(
    join(orgDir, 'org', 'settings.org.jsonc'),
    JSON.stringify({
      'board.gitlabHost': HOST,
      'board.projects': ['g/p', 'g/q'],
      'mattstack.roster': [{ username: 'alice' }, { username: 'bob' }],
      'board.slack': { autoResolveIntervalMinutes: 0 },
      'board.tabs': [
        { id: 'team', label: 'Team', source: { kind: 'authors' } },
        {
          id: 'owners',
          label: 'Owners',
          source: {
            kind: 'codeowners',
            section: 'Ours - #ours-channel',
            excludeMembers: true,
          },
        },
      ],
      'mattstack.directory': directory,
      repos: {
        'gitlab.example.com/g/p': {
          'board.codeowners': { slack: { fromSectionName: true } },
        },
      },
    })
  );
  mkdirSync(join(orgDir, 'teams', 'web'), { recursive: true });
  writeFileSync(join(orgDir, 'teams', 'web', 'settings.team.jsonc'), '{}');
  const userDir = join(home, '.mattstack', 'user');
  mkdirSync(userDir, { recursive: true });
  writeFileSync(
    join(userDir, 'settings.user.jsonc'),
    JSON.stringify({
      'board.defaultMember': 'alice',
      'mattstack.activeTeam': 'web',
    })
  );
  writeFileSync(join(home, '.mattstack', 'machine-key'), 'testmachine');
  const machineDir = join(home, '.mattstack', 'user', 'local', 'testmachine');
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

  const rtDir = join(home, '.mattstack', 'rt');
  mkdirSync(rtDir, { recursive: true });
  const rtDaemon = Bun.serve({
    unix: join(rtDir, 'rt.sock'),
    fetch: fakeRtDaemon,
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
        PORT: String(port),
        GITLAB_TOKEN: '',
        SLACK_TOKEN: 'fake-slack-token',
        SWITCHBOARD_TOKEN: '',
        SWITCHBOARD_ADMIN_TOKEN: '',
        ...(recheckMs === undefined
          ? {}
          : { BOARD_REVIEW_RECHECK_MS: String(recheckMs) }),
        SLACK_MOCK_POST_LOG: join(home, 'slack-posts.ndjson'),
        SLACK_MOCK_HISTORY: JSON.stringify({
          C_ACME: [url('g/p', 708)],
          C_DEFAULT: [url('g/p', 709)],
        }),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  let output = '';
  for (const stream of [proc.stdout, proc.stderr])
    void (async () => {
      for await (const chunk of stream) output += Buffer.from(chunk).toString();
    })();
  return {
    port,
    home,
    output: () => output,
    stop: () => {
      proc.kill();
      rtDaemon.stop(true);
    },
  };
}

async function fakeRtDaemon(req: Request): Promise<Response> {
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
}

const board = bootBoard({
  port: 47969,
  directory: {
    teams: {
      web: {
        slack: {
          codeOwnersChannel: 'ours-channel',
          channels: [{ name: 'code-review', kind: 'review' }],
        },
      },
    },
  },
});
const noChannelBoard = bootBoard({
  port: 47971,
  directory: {
    teams: { web: { slack: { codeOwnersChannel: 'ours-channel' } } },
  },
});
const lateDirectoryBoard = bootBoard({
  port: 47973,
  directory: undefined,
  recheckMs: 0,
});
const PORT = board.port;
const NO_CHANNEL_PORT = noChannelBoard.port;
const fakeHome = board.home;
const postLog = join(fakeHome, 'slack-posts.ndjson');

afterAll(() => {
  board.stop();
  noChannelBoard.stop();
  lateDirectoryBoard.stop();
});

async function ready(port = PORT): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server never came up');
}

function postTo(port: number, path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function post(path: string, body: unknown): Promise<Response> {
  return postTo(PORT, path, body);
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
  team: { channel: string; posted: boolean; permalink?: string };
  direct: boolean;
  ownSections: string[];
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
  const refs = (
    db.query('SELECT ref FROM slack_refs').all() as Array<{ ref: string }>
  ).filter(r => (JSON.parse(r.ref) as { status: string }).status === 'found');
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

interface Outcome {
  posted: Array<{ channel: string; permalink: string; team?: boolean }>;
  failed: Array<{ channel: string; error: string }>;
}

async function boardMr(iid: number) {
  const data = (await (
    await fetch(`http://127.0.0.1:${PORT}/data.json`)
  ).json()) as { mrs: Array<{ iid: number; ownerPostsLeft?: string[] }> };
  return data.mrs.find(m => m.iid === iid)!;
}

test('our own section is the team row, never our code owner channel', async () => {
  await ready();
  const body = (await (
    await post('/slack/owners/preview', { mrUrl: url('g/p', 706) })
  ).json()) as Preview;
  expect(body.team).toEqual({ channel: 'code-review', posted: false });
  expect(body.ownSections).toEqual(['Ours - #ours-channel']);
  expect(body.channels).toEqual([
    { channel: 'acme-channel', sections: ['Acme - #acme-channel'] },
  ]);
  expect(body.skipped).toEqual([]);
  expect(body.direct).toBe(false);
}, 15_000);

test('posting only the team row leaves the other channels to post later', async () => {
  await ready();
  expect((await boardMr(706)).ownerPostsLeft).toBeUndefined();
  const res = await post('/slack/owners/post', {
    mrUrl: url('g/p', 706),
    team: true,
    channels: [],
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Outcome;
  expect(body.posted.map(p => [p.channel, p.team])).toEqual([
    ['code-review', true],
  ]);
  expect(sentFor(706).map(m => m.channel)).toEqual(['C_DEFAULT']);
  expect((await boardMr(706)).ownerPostsLeft).toEqual(['acme-channel']);

  const again = (await (
    await post('/slack/owners/preview', { mrUrl: url('g/p', 706) })
  ).json()) as Preview;
  expect(again.team.posted).toBe(true);
  expect(again.team.permalink).toContain('C_DEFAULT');

  const rest = await post('/slack/owners/post', {
    mrUrl: url('g/p', 706),
    channels: ['acme-channel'],
  });
  expect(rest.status).toBe(200);
  expect((await boardMr(706)).ownerPostsLeft).toEqual([]);
}, 20_000);

test('an MR needing only our own approval posts straight to the team channel', async () => {
  await ready();
  const body = (await (
    await post('/slack/owners/preview', { mrUrl: url('g/p', 707) })
  ).json()) as Preview;
  expect(body.channels).toEqual([]);
  expect(body.direct).toBe(true);
  const res = await post('/slack/owners/post', {
    mrUrl: url('g/p', 707),
    team: true,
  });
  expect(res.status).toBe(200);
  expect(sentFor(707).map(m => m.channel)).toEqual(['C_DEFAULT']);
  expect((await boardMr(707)).ownerPostsLeft).toEqual([]);
}, 15_000);

test('a post someone made by hand in a code owner channel counts as posted', async () => {
  await ready();
  const body = (await (
    await post('/slack/owners/preview', { mrUrl: url('g/p', 708) })
  ).json()) as Preview;
  expect(body.channels).toEqual([]);
  expect(body.skipped).toEqual([
    {
      section: 'Acme - #acme-channel',
      reason: 'already-posted',
      channel: 'acme-channel',
      permalink: expect.stringContaining('C_ACME'),
    },
  ]);
  expect(body.direct).toBe(true);
  const res = await post('/slack/owners/post', {
    mrUrl: url('g/p', 708),
    channels: ['acme-channel'],
  });
  expect(res.status).toBe(400);
  expect(sentFor(708)).toEqual([]);
}, 15_000);

test('a team thread that already exists is shown as posted and never posted again', async () => {
  await ready();
  const body = (await (
    await post('/slack/owners/preview', { mrUrl: url('g/p', 709) })
  ).json()) as Preview;
  expect(body.team.posted).toBe(true);
  expect(body.team.permalink).toContain('C_DEFAULT');
  expect(body.direct).toBe(false);
  const res = await post('/slack/owners/post', {
    mrUrl: url('g/p', 709),
    team: true,
  });
  expect(res.status).toBe(400);
  expect(sentFor(709)).toEqual([]);
}, 15_000);

test('a post naming nothing is refused', async () => {
  await ready();
  const res = await post('/slack/owners/post', {
    mrUrl: url('g/p', 706),
    team: false,
    channels: [],
  });
  expect(res.status).toBe(400);
}, 15_000);

test('a team with no review channel is refused whole, naming the fix', async () => {
  await ready(NO_CHANNEL_PORT);
  for (const path of [
    '/slack/owners/preview',
    '/slack/owners/post',
    '/slack/post',
  ]) {
    const res = await postTo(
      NO_CHANNEL_PORT,
      path,
      path === '/slack/post'
        ? { mrUrls: [url('g/p', 701)] }
        : { mrUrl: url('g/p', 701), team: true }
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(
      'Add a review channel for your team to the team directory'
    );
  }
}, 15_000);

test('refusals inside the recheck window reload the config only once', async () => {
  await ready(NO_CHANNEL_PORT);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await postTo(NO_CHANNEL_PORT, '/slack/post', {
          mrUrls: [url('g/p', 701)],
        })
      ).status
    ).toBe(400);
  const rechecks = () =>
    noChannelBoard
      .output()
      .split('no review channel, rechecking the team directory').length - 1;
  for (let i = 0; i < 50 && rechecks() === 0; i++) await Bun.sleep(100);
  expect(rechecks()).toBe(1);
}, 15_000);

test('a directory written after the board started is read before a post is refused', async () => {
  const { port, home } = lateDirectoryBoard;
  await ready(port);
  const post = () => postTo(port, '/slack/post', { mrUrls: [url('g/p', 701)] });
  const refused = await post();
  expect(refused.status).toBe(400);
  expect(await refused.text()).toBe(
    'Add a review channel for your team to the team directory'
  );
  const store = join(
    home,
    '.mattstack/orgs/testteam/mattstack/org/settings.org.jsonc'
  );
  writeFileSync(
    store,
    JSON.stringify({
      ...JSON.parse(readFileSync(store, 'utf8')),
      'mattstack.directory': {
        teams: {
          web: {
            slack: { channels: [{ name: 'code-review', kind: 'review' }] },
          },
        },
      },
    })
  );
  const res = await post();
  expect(res.status).toBe(200);
  expect(
    readFileSync(join(home, 'slack-posts.ndjson'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => (JSON.parse(line) as { channel: string }).channel)
  ).toEqual(['C_DEFAULT']);
}, 15_000);

/** POST /doctor with ring: true hands the MR's current trouble to the live
    work run that owns it (its own, else an ancestor's) instead of launching
    a doctor, and records a handoff per delivered frame. The snapshot carries
    each row's active run and its still-live handoffs.

    Real boot against a fake rt daemon (unix socket), as in
    server-stand-down.test.ts: runs:list, inbox:probe and inbox:ring are
    answered here, and agent:* calls are how a doctor launch shows up. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { readDoctorStates, writeDoctorState } from '../doctor-state.ts';
import { mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';
import {
  readMemory,
  writeHandoff,
  writeMemory,
} from '../triage/memory-store.ts';
import type { Handoff } from '../triage/memory.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-doctor-ring-'));

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

const ALICE = {
  id: 'gitlab:1',
  username: 'alice',
  name: 'Alice',
  avatarUrl: null,
};

function fakePr(o: {
  iid: number;
  failedPipeline?: number;
  conflicts?: boolean;
  shouldBeRebased?: boolean;
  sourceBranch?: string;
  targetBranch?: string;
  isStacked?: boolean;
}): Record<string, unknown> {
  return {
    id: `gitlab:${o.iid}`,
    iid: o.iid,
    repositoryId: 'gitlab:42',
    title: 'An MR',
    description: null,
    state: 'opened',
    draft: false,
    conflicts: o.conflicts ?? false,
    webUrl: url(o.iid),
    sourceBranch: o.sourceBranch ?? `feat/${o.iid}`,
    targetBranch: o.targetBranch ?? 'main',
    isStacked: o.isStacked ?? false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
    sha: null,
    author: ALICE,
    assignees: [],
    reviewers: [],
    roles: [],
    pipeline:
      o.failedPipeline === undefined
        ? null
        : {
            id: `gitlab:pipeline:${o.failedPipeline}`,
            status: 'failed',
            sha: null,
            ref: null,
            mergeRequestEventType: null,
            createdAt: null,
            webUrl: null,
            jobs: [],
          },
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
    shouldBeRebased: o.shouldBeRebased ?? false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 1,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
  };
}

const RED = url(31);
const CONFLICTED = url(32);
const BOTH = url(33);
const HALF = url(34);
const NOBODY = url(36);
const DEAF = url(37);
const LAUNCH = url(38);
const STALE = url(40);
const PARENT = url(41);
const CHILD = url(42);
const SNAP_CONFLICTED = url(43);
const OUTAGE = url(44);
const CLEAN = url(45);
const RED_ONLY = url(46);
const IN_FLIGHT = url(47);
const FAILED_LAUNCH = url(48);
const UNREADABLE = url(49);

const prs = [
  fakePr({ iid: 43, conflicts: true }),
  fakePr({ iid: 44, failedPipeline: 9044 }),
  fakePr({ iid: 45 }),
  fakePr({ iid: 46, failedPipeline: 9046 }),
  fakePr({ iid: 47, failedPipeline: 9047 }),
  fakePr({ iid: 48, failedPipeline: 9048 }),
  fakePr({ iid: 49, failedPipeline: 9049 }),
  fakePr({ iid: 31, failedPipeline: 9031 }),
  fakePr({ iid: 32, conflicts: true }),
  fakePr({ iid: 33, failedPipeline: 9033, conflicts: true }),
  fakePr({ iid: 34, failedPipeline: 9034, shouldBeRebased: true }),
  fakePr({ iid: 36, failedPipeline: 9036 }),
  fakePr({ iid: 37, failedPipeline: 9037 }),
  fakePr({ iid: 38, failedPipeline: 9038 }),
  fakePr({ iid: 40, failedPipeline: 9040, shouldBeRebased: true }),
  fakePr({ iid: 41, sourceBranch: 'feat/parent' }),
  fakePr({
    iid: 42,
    failedPipeline: 9042,
    sourceBranch: 'feat/child',
    targetBranch: 'feat/parent',
    isStacked: true,
  }),
];

function run(id: string, mr: string, session: string) {
  return {
    id,
    repo: 'gitlab.example.com-g-p',
    work_type: 'feature',
    pipeline: 'work',
    status: 'running',
    current_stage: 'implement',
    spawned_by: null,
    started_at: 1,
    ended_at: null,
    pack_commits: null,
    pack_dirty: 0,
    attention: 'none',
    last_event_at: 100,
    ticket: null,
    branch: null,
    session,
    mr,
  };
}

const runs = [
  run('run-red', RED, 'sess-red'),
  run('run-conflicted', CONFLICTED, 'sess-conflicted'),
  run('run-both', BOTH, 'sess-both'),
  run('run-half', HALF, 'sess-half'),
  run('run-deaf', DEAF, 'sess-deaf'),
  run('run-launch', LAUNCH, 'sess-launch'),
  run('run-parent', PARENT, 'sess-parent'),
  run('run-outage', OUTAGE, 'sess-outage'),
  run('run-clean', CLEAN, 'sess-clean'),
  run('run-red-only', RED_ONLY, 'sess-red-only'),
  run('run-in-flight', IN_FLIGHT, 'sess-in-flight'),
];

let runsListFails = false;
/** Parks UNREADABLE's agent:start until the test lets it resolve. */
const heldLaunch = (() => {
  let reach: () => void = () => {};
  let release: () => void = () => {};
  const reachedP = new Promise<void>(r => (reach = r));
  const releasedP = new Promise<void>(r => (release = r));
  return {
    reachedP,
    release,
    reached: () => {
      reach();
      return releasedP;
    },
  };
})();
const rings: Array<{ session: string; label: string; text: string }> = [];
const daemonSeen: string[] = [];

const dbPath = join(fakeHome, 'state.db');
const db = openStateDb(dbPath);

function handoff(over: Partial<Handoff> = {}): Handoff {
  return {
    runId: 'run-old',
    session: 'sess-old',
    stage: 'implement',
    pipelineId: null,
    viaMr: null,
    viaBranch: 'feat/x',
    at: 1,
    ...over,
  };
}

const seeded = readMemory(db);
const today = new Date().toISOString().slice(0, 10);
const seedRow = (h: Record<string, Handoff>) => ({
  lastDispatchAt: null,
  attemptsToday: 0,
  dayStamp: today,
  budgetEscalatedDay: null,
  lastHandledPipelineId: null,
  lastNeedsRebase: false,
  handoffs: h,
});
writeMemory(
  {
    identity: { username: 'alice', fetchedAt: Date.now() },
    mrs: {
      ...seeded.mrs,
      [LAUNCH]: seedRow({
        'pipeline-red': handoff({ pipelineId: 9038, viaMr: LAUNCH }),
      }),
      [FAILED_LAUNCH]: seedRow({
        'pipeline-red': handoff({ pipelineId: 9048, viaMr: FAILED_LAUNCH }),
      }),
      [STALE]: seedRow({
        'pipeline-red': handoff({ pipelineId: 1, viaMr: STALE }),
        'needs-rebase': handoff({ pipelineId: 9040, viaMr: STALE }),
      }),
    },
  },
  db
);

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
const rtDaemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  async fetch(req) {
    const cmd = new URL(req.url).pathname.slice(1);
    const body = (
      req.method === 'POST' ? await req.json().catch(() => null) : null
    ) as Record<string, unknown> | null;
    daemonSeen.push(`${cmd} ${JSON.stringify(body)}`);
    if (cmd === 'project-mrs:read') {
      const byId: Record<string, unknown> = {};
      for (const pr of prs) {
        byId[(pr as { id: string }).id] = {
          pr,
          fetchedAt: Date.now(),
          codeownerSections: [],
        };
      }
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
    if (cmd === 'runs:list')
      return runsListFails
        ? Response.json({ ok: false, error: 'runs store unavailable' })
        : Response.json({ ok: true, data: { runs } });
    if (cmd === 'inbox:probe')
      return Response.json({
        ok: true,
        data: { reachable: true, name: 'Pip' },
      });
    if (cmd === 'agent:start') {
      const subject = String(body?.subject ?? '');
      if (subject.endsWith(UNREADABLE)) await heldLaunch.reached();
      return subject.endsWith(FAILED_LAUNCH)
        ? Response.json({ ok: false, error: 'herdr is not running' })
        : Response.json({
            ok: true,
            data: {
              id: 'agent-1',
              sessionId: 'sess-doctor',
              paneId: 'p1',
              tabId: 't1',
              workspaceId: 'w1',
            },
          });
    }
    if (cmd === 'inbox:ring') {
      const ring = body as { session: string; label: string; text: string };
      const fails =
        ring.session === 'sess-deaf' ||
        (ring.session === 'sess-half' && ring.text.includes('needs a rebase'));
      if (!fails) rings.push(ring);
      return Response.json({
        ok: true,
        data: fails
          ? { delivered: false, reason: 'failed' }
          : { delivered: true },
      });
    }
    return Response.json({ ok: false, error: 'not implemented' });
  },
});

const PORT = 47974;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      BOARD_STATE_DB: dbPath,
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

function doctor(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/doctor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const iidOf = (u: string) => Number(u.split('/').pop());
const ringsTo = (session: string) => rings.filter(r => r.session === session);
const launchedOn = (iid: number) =>
  daemonSeen.some(
    s => s.startsWith('agent:') && s.includes(`merge_requests/${iid}`)
  );

type Row = {
  webUrl: string;
  activeRun?: Record<string, unknown>;
  handoffs?: Record<string, Handoff>;
};

async function rows(): Promise<Row[]> {
  const res = await fetch(`http://127.0.0.1:${PORT}/data.json`);
  return ((await res.json()) as { mrs: Row[] }).mrs;
}

test('ring with a live owner rings, records the handoff and marks the edge handled', async () => {
  await ready();
  const res = await doctor({ mrUrl: RED, iid: iidOf(RED), ring: true });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, rung: true, runId: 'run-red' });
  expect(ringsTo('sess-red')).toHaveLength(1);
  expect(ringsTo('sess-red')[0]!.label).toBe('board');
  expect(ringsTo('sess-red')[0]!.text).toContain('CI failed on !31');
  const m = readMemory(db).mrs[RED]!;
  expect(m.handoffs?.['pipeline-red']).toMatchObject({
    runId: 'run-red',
    session: 'sess-red',
    stage: 'implement',
    pipelineId: 9031,
    viaMr: RED,
    viaBranch: 'feat/31',
  });
  expect(m.lastHandledPipelineId).toBe(9031);
  expect(launchedOn(31)).toBe(false);
}, 15_000);

test('ring on a conflicted MR with green CI sends only the rebase frame', async () => {
  await ready();
  const res = await doctor({
    mrUrl: CONFLICTED,
    iid: iidOf(CONFLICTED),
    ring: true,
  });
  expect(res.status).toBe(200);
  const sent = ringsTo('sess-conflicted');
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).toContain('!32 needs a rebase onto main');
  const m = readMemory(db).mrs[CONFLICTED]!;
  expect(Object.keys(m.handoffs ?? {})).toEqual(['needs-rebase']);
  expect(m.lastNeedsRebase).toBe(true);
}, 15_000);

test('ring on a red and conflicted MR sends both frames and records both handoffs', async () => {
  await ready();
  const res = await doctor({ mrUrl: BOTH, iid: iidOf(BOTH), ring: true });
  expect(res.status).toBe(200);
  const sent = ringsTo('sess-both').map(r => r.text);
  expect(sent).toHaveLength(2);
  expect(sent.some(t => t.includes('CI failed on !33'))).toBe(true);
  expect(sent.some(t => t.includes('!33 needs a rebase'))).toBe(true);
  const m = readMemory(db).mrs[BOTH]!;
  expect(Object.keys(m.handoffs ?? {}).sort()).toEqual([
    'needs-rebase',
    'pipeline-red',
  ]);
  expect(m.lastHandledPipelineId).toBe(9033);
  expect(m.lastNeedsRebase).toBe(true);
}, 15_000);

test('rebase mode rings only the rebase frame on a red and conflicted MR', async () => {
  await ready();
  const before = ringsTo('sess-both').length;
  const res = await doctor({
    mrUrl: BOTH,
    iid: iidOf(BOTH),
    mode: 'rebase',
    ring: true,
  });
  expect(res.status).toBe(200);
  const sent = ringsTo('sess-both').slice(before);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).toContain('needs a rebase');
}, 15_000);

test('a half-delivered ring records only the delivered kind', async () => {
  await ready();
  const res = await doctor({ mrUrl: HALF, iid: iidOf(HALF), ring: true });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, rung: true, runId: 'run-half' });
  const m = readMemory(db).mrs[HALF]!;
  expect(Object.keys(m.handoffs ?? {})).toEqual(['pipeline-red']);
  expect(m.lastHandledPipelineId).toBe(9034);
  expect(m.lastNeedsRebase).toBe(false);
}, 15_000);

test("ring on a stacked child rings the parent's run with a downstream frame", async () => {
  await ready();
  const res = await doctor({ mrUrl: CHILD, iid: iidOf(CHILD), ring: true });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    rung: true,
    runId: 'run-parent',
  });
  const sent = ringsTo('sess-parent');
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).toContain(
    '!42 (stacked on your branch) has failing CI'
  );
  expect(readMemory(db).mrs[CHILD]!.handoffs?.['pipeline-red']).toMatchObject({
    runId: 'run-parent',
    viaMr: PARENT,
    viaBranch: 'feat/parent',
  });
}, 15_000);

test('ring with no live owner is a 409', async () => {
  await ready();
  const res = await doctor({ mrUrl: NOBODY, iid: iidOf(NOBODY), ring: true });
  expect(res.status).toBe(409);
  expect(await res.text()).toBe('no work run is active on this MR');
  expect(readMemory(db).mrs[NOBODY]?.handoffs).toBeUndefined();
  expect(launchedOn(36)).toBe(false);
}, 15_000);

test('ring whose delivery fails is a 409 and writes nothing', async () => {
  await ready();
  const res = await doctor({ mrUrl: DEAF, iid: iidOf(DEAF), ring: true });
  expect(res.status).toBe(409);
  expect(await res.text()).toBe("the worker's session did not answer");
  const m = readMemory(db).mrs[DEAF];
  expect(m?.handoffs).toBeUndefined();
  expect(m?.lastHandledPipelineId ?? null).toBeNull();
  expect(launchedOn(37)).toBe(false);
}, 15_000);

test('a launch without ring clears handoffs and launches as today', async () => {
  await ready();
  expect(readMemory(db).mrs[LAUNCH]?.handoffs).toBeDefined();
  const res = await doctor({ mrUrl: LAUNCH, iid: iidOf(LAUNCH) });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(ringsTo('sess-launch')).toHaveLength(0);
  for (
    let i = 0;
    i < 50 && readMemory(db).mrs[LAUNCH]?.handoffs !== undefined;
    i++
  )
    await new Promise(r => setTimeout(r, 100));
  expect(launchedOn(38)).toBe(true);
  expect(readMemory(db).mrs[LAUNCH]?.handoffs).toBeUndefined();
}, 15_000);

test('a launch that fails leaves the handoffs in place', async () => {
  await ready();
  const res = await doctor({ mrUrl: FAILED_LAUNCH, iid: iidOf(FAILED_LAUNCH) });
  expect(res.status).toBe(200);
  for (
    let i = 0;
    i < 50 && readDoctorStates(db).get(FAILED_LAUNCH)?.status !== 'error';
    i++
  )
    await new Promise(r => setTimeout(r, 100));
  expect(readDoctorStates(db).get(FAILED_LAUNCH)?.status).toBe('error');
  expect(
    readMemory(db).mrs[FAILED_LAUNCH]?.handoffs?.['pipeline-red']?.runId
  ).toBe('run-old');
}, 15_000);

test('ring while a doctor is running on the MR is a 409 and rings nobody', async () => {
  await ready();
  writeDoctorState(
    mintHandle('doctor', IN_FLIGHT, fakeHome),
    { mrUrl: IN_FLIGHT, iid: iidOf(IN_FLIGHT), status: 'diagnosing' },
    Date.now(),
    db
  );
  const res = await doctor({
    mrUrl: IN_FLIGHT,
    iid: iidOf(IN_FLIGHT),
    ring: true,
  });
  expect(res.status).toBe(409);
  expect(await res.text()).toBe('a doctor is already running on this MR');
  expect(ringsTo('sess-in-flight')).toHaveLength(0);
  expect(readMemory(db).mrs[IN_FLIGHT]?.handoffs).toBeUndefined();
}, 15_000);

test('a conflicts-only handoff shows on the snapshot', async () => {
  await ready();
  writeHandoff(
    SNAP_CONFLICTED,
    'needs-rebase',
    handoff({ runId: 'run-snap', viaMr: SNAP_CONFLICTED }),
    undefined,
    db
  );
  const row = (await rows()).find(r => r.webUrl === SNAP_CONFLICTED)!;
  expect(row.handoffs?.['needs-rebase']?.runId).toBe('run-snap');
  expect(row.handoffs?.['pipeline-red']).toBeUndefined();
}, 15_000);

test('ring when runs:list fails is a 503 and writes nothing', async () => {
  await ready();
  runsListFails = true;
  try {
    const res = await doctor({ mrUrl: OUTAGE, iid: iidOf(OUTAGE), ring: true });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('could not read runs from the daemon');
  } finally {
    runsListFails = false;
  }
  expect(ringsTo('sess-outage')).toHaveLength(0);
  expect(readMemory(db).mrs[OUTAGE]?.handoffs).toBeUndefined();
  expect(launchedOn(44)).toBe(false);
}, 15_000);

test('ring on an MR with nothing wrong is a 409 and rings nobody', async () => {
  await ready();
  const res = await doctor({ mrUrl: CLEAN, iid: iidOf(CLEAN), ring: true });
  expect(res.status).toBe(409);
  expect(await res.text()).toBe('nothing on this MR needs the worker');
  expect(ringsTo('sess-clean')).toHaveLength(0);
}, 15_000);

test('ring in rebase mode on a red-only MR is a 409 and rings nobody', async () => {
  await ready();
  const res = await doctor({
    mrUrl: RED_ONLY,
    iid: iidOf(RED_ONLY),
    mode: 'rebase',
    ring: true,
  });
  expect(res.status).toBe(409);
  expect(await res.text()).toBe('nothing on this MR needs the worker');
  expect(ringsTo('sess-red-only')).toHaveLength(0);
  expect(readMemory(db).mrs[RED_ONLY]?.handoffs).toBeUndefined();
}, 15_000);

test('the snapshot carries activeRun and only live handoffs', async () => {
  await ready();
  let red: Row | undefined;
  for (let i = 0; i < 50; i++) {
    red = (await rows()).find(r => r.webUrl === RED);
    if (red?.activeRun) break;
    await new Promise(r => setTimeout(r, 100));
  }
  expect(red?.activeRun).toEqual({
    runId: 'run-red',
    stage: 'implement',
    name: 'Pip',
  });
  const all = await rows();
  const child = all.find(r => r.webUrl === CHILD)!;
  expect(child.activeRun).toEqual({
    runId: 'run-parent',
    stage: 'implement',
    name: 'Pip',
    viaIid: 41,
  });
  expect(all.find(r => r.webUrl === NOBODY)!.activeRun).toBeUndefined();
  const stale = all.find(r => r.webUrl === STALE)!;
  expect(Object.keys(stale.handoffs ?? {})).toEqual(['needs-rebase']);
  expect(all.find(r => r.webUrl === NOBODY)!.handoffs).toBeUndefined();
}, 15_000);

test('a handoff clear whose memory read throws after a launch keeps the server up', async () => {
  await ready();
  const res = await doctor({ mrUrl: UNREADABLE, iid: iidOf(UNREADABLE) });
  expect(res.status).toBe(200);
  await heldLaunch.reachedP;
  db.run('ALTER TABLE kv RENAME TO kv_hidden');
  try {
    heldLaunch.release();
    for (
      let i = 0;
      i < 50 && readDoctorStates(db).get(UNREADABLE)?.paneId !== 'p1';
      i++
    )
      await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 200));
  } finally {
    db.run('ALTER TABLE kv_hidden RENAME TO kv');
  }
  expect(proc.exitCode).toBeNull();
  expect((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok).toBe(true);
}, 15_000);

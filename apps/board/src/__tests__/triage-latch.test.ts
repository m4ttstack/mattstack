import { afterAll, describe, expect, test } from 'bun:test';

import type { MRDetail } from '@mattstack/glance';
import {
  putLatchRow,
  readLatchRow,
  type LatchRow,
} from '../latch/latch-state.ts';
import { armedLatchBody, latchBody, spentLatchBody } from '../latch/markers.ts';
import type { LatchGateway } from '../latch/post.ts';
import type { ReviewState } from '../review-state.ts';
import type { AuditEntry } from '../triage/audit.ts';
import { parseTriageBlock } from '../triage/config.ts';
import {
  LATCH_POST_GRACE_MS,
  runLatchPass,
  runStamp,
  waitReasonOf,
  type LatchMrFacts,
  type LatchPassDeps,
} from '../triage/latch.ts';
import { emptyMrMemory, type DispatchMemory } from '../triage/memory.ts';
import { removeTempDbs, tempDb } from './latch-temp-db.ts';

afterAll(removeTempDbs);

const NOW = 1_000_000_000;
const MR = 'https://gitlab.com/acme/web/-/merge_requests/2317';
const IMG = '![re-review latch](/uploads/ab12/latch-2317.png)';
const cfg = parseTriageBlock({
  enabled: true,
  cooldownMinutes: 30,
  dailyAttemptBudget: 3,
});

const facts: LatchMrFacts = {
  mrUrl: MR,
  iid: 2317,
  projectId: 42,
  projectPath: 'acme/web',
  rtRepo: 'acme-web',
  approvedBySelf: false,
};
const commented: ReviewState = {
  mrUrl: MR,
  iid: 2317,
  status: 'done',
  outcome: 'comment',
  startedAt: 0,
  updatedAt: 0,
};

const noOutcome: ReviewState = { ...commented, outcome: undefined };
const RUNNING = '<!-- mattstack:board re-review-latch v1 running -->';
const QUEUED = '<!-- mattstack:board re-review-latch v1 queued -->';
const ARMED = '<!-- mattstack:board re-review-latch v1 -->';
const SPENT = '<!-- mattstack:board re-review-latch v1 spent -->';
const queuedBody = () => latchBody('queued', IMG, 'queued');
const runningBody = () => latchBody('running', IMG, 'running');
const errorBody = () => latchBody('error', IMG, 'error');

function row(over: Partial<LatchRow> = {}): LatchRow {
  return {
    mrUrl: MR,
    discussionId: 'd1',
    rootNoteId: 1,
    phase: 'armed',
    wait: null,
    launchAt: null,
    failures: 0,
    stuck: false,
    variant: 'armed',
    updatedAt: 1,
    ...over,
  };
}

function disc(
  id: string,
  body: string,
  createdAt: string,
  resolved: boolean,
  author = 'matt'
) {
  return {
    id,
    resolvable: true,
    resolved,
    notes: [
      {
        id: 1,
        body,
        author: { id: 1, username: author, name: author, avatarUrl: null },
        createdAt,
        system: false,
        type: 'DiscussionNote',
        resolvable: true,
        resolved,
        position: null,
      },
    ],
  };
}
const detail = (...d: ReturnType<typeof disc>[]) =>
  ({
    mrIid: 2317,
    repositoryId: 'gitlab:42',
    discussions: d,
  }) as unknown as MRDetail;

function harness(
  over: Partial<LatchPassDeps> & { detail?: MRDetail | null } = {}
) {
  const calls: string[] = [];
  const uploads: string[] = [];
  const launches: string[] = [];
  const noteBodies = new Map<number, string>();
  const gateway: LatchGateway = {
    async uploadFile(_p, filename) {
      calls.push('upload');
      uploads.push(filename);
      return { alt: '', url: '', full_path: '', markdown: IMG };
    },
    async createDiscussion() {
      calls.push('createDiscussion');
      return { id: 'new', notes: [{ id: 1 }] };
    },
    async updateNote(_p, _i, id, body) {
      calls.push(`updateNote:${id}`);
      noteBodies.set(id, body);
    },
    async resolveDiscussion(_p, _i, id) {
      calls.push(`resolve:${id}`);
    },
    async unresolveDiscussion(_p, _i, id) {
      calls.push(`unresolve:${id}`);
    },
    async createNote(_p, _i, body, d) {
      calls.push(`reply:${d}`);
      replies.push(body);
      return { id: 9 };
    },
  };
  const replies: string[] = [];
  const audits: AuditEntry[] = [];
  const memory: DispatchMemory = { identity: null, mrs: {} };
  const resurrects: string[] = [];
  const drops: string[] = [];
  const notifies: Array<{ title: string; message: string; mrUrl: string }> = [];
  const deps: LatchPassDeps = {
    readReviewStates: () => new Map([[MR, commented]]),
    readPrunedReviewStates: () => new Map(),
    resurrectReviewState: url => {
      resurrects.push(url);
      return true;
    },
    dropPrunedReviewState: url => {
      drops.push(url);
    },
    fetchLatchMrs: async () => [facts],
    readDetail: async () =>
      over.detail === undefined ? detail() : over.detail,
    gateway,
    launchReReview: async u => {
      launches.push(u);
      return { kind: 'launched' };
    },
    memory,
    self: 'matt',
    cfg,
    reReview: { enabled: true },
    appendAudit: entry => {
      audits.push(entry);
    },
    notify: async (title, message, mrUrl) => {
      notifies.push({ title, message, mrUrl });
    },
    now: () => NOW,
    db: tempDb(),
    ...over,
  };
  return {
    deps,
    calls,
    uploads,
    launches,
    memory,
    noteBodies,
    resurrects,
    drops,
    notifies,
    replies,
    audits,
  };
}

describe('step 0: no latch', () => {
  test('posts one on a comment-outcome state', async () => {
    const { deps, calls } = harness({ detail: detail() });
    const r = await runLatchPass(deps);
    expect(r.posted).toBe(1);
    expect(calls).toEqual(['upload', 'createDiscussion']);
  });

  // A second writer must see the post before the daemon's discussion store does.
  test('records the posted latch as an armed row', async () => {
    const db = tempDb();
    const { deps } = harness({ detail: detail(), db });
    await runLatchPass(deps);
    expect(readLatchRow(MR, db)).toEqual({
      mrUrl: MR,
      discussionId: 'new',
      rootNoteId: 1,
      phase: 'armed',
      wait: null,
      launchAt: null,
      failures: 0,
      stuck: false,
      variant: 'armed',
      updatedAt: NOW,
    });
  });

  test('posts nothing on an approve-outcome state', async () => {
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps, calls } = harness({
      detail: detail(),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });

  // Descoped: a spent relic with no live latch is left alone. Arming a second
  // cycle is the server's job.
  test('posts nothing when a spent relic exists but no live latch', async () => {
    const { deps, calls } = harness({
      detail: detail(
        disc('relic', spentLatchBody(IMG), '2026-08-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });

  // The server posts the instant a review lands; this pass checks for that
  // post through the daemon's discussion store, which within its staleness
  // window cannot prove the post exists yet. A freshly-done review defers to
  // a later tick instead of racing the server into a double post.
  test('holds off posting while the review is inside the grace window', async () => {
    const fresh: ReviewState = { ...commented, updatedAt: NOW - 60_000 };
    const { deps, calls } = harness({
      detail: detail(),
      readReviewStates: () => new Map([[MR, fresh]]),
    });
    const r = await runLatchPass(deps);
    expect(r.posted).toBe(0);
    expect(r.skipped).toBe(1);
    expect(calls).toEqual([]);
  });

  test('ignores a done state with no outcome at all', async () => {
    const noOutcome: ReviewState = { ...commented, outcome: undefined };
    const { deps, calls } = harness({
      detail: detail(),
      readReviewStates: () => new Map([[MR, noOutcome]]),
    });
    expect((await runLatchPass(deps)).skipped).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe('step 1: spent latch', () => {
  test('a spent resolved latch draws no writes and never dispatches', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });

  test('a spent unresolved latch is re-resolved, never rearmed', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(calls).toEqual(['resolve:d1']);
    expect(launches).toEqual([]);
  });

  // Branch order only matters here. A lone spent latch can never be a carrier,
  // so it lands in step 2 regardless; only a spent canon beside a resolved
  // armed extra proves the spent check must come first.
  test('a spent canon beside a resolved armed extra never dispatches', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('spent', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('extra', armedLatchBody(IMG), '2026-08-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).skipped).toBe(1);
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });
});

describe('step 2: armed and unresolved', () => {
  test('does nothing on a comment-outcome state', async () => {
    const { deps, calls } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
  });

  test('spends on an approve-outcome state, completing a missed server spend', async () => {
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps, calls } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toEqual(['upload', 'updateNote:1', 'resolve:d1']);
  });

  test("the spend stamps the row with the pass's clock", async () => {
    const db = tempDb();
    putLatchRow(
      {
        mrUrl: MR,
        discussionId: 'd1',
        rootNoteId: 1,
        phase: 'armed',
        wait: null,
        launchAt: null,
        failures: 0,
        stuck: false,
        variant: 'armed',
        updatedAt: 1,
      },
      db
    );
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps } = harness({
      db,
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    await runLatchPass(deps);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'spent',
      variant: 'approved',
      updatedAt: NOW,
    });
  });

  // Step 2 must spend every duplicate, not just the canonical latch.
  // Spending only the canon would strand an older armed-unresolved copy
  // forever, since the next tick sees the now-spent canon and stops at step 1
  // before ever looking at the older one.
  test('spends every armed-unresolved duplicate on an approve-outcome state', async () => {
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps, calls } = harness({
      detail: detail(
        disc('newer', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
        disc('older', armedLatchBody(IMG), '2026-08-01T10:00:00Z', false)
      ),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toContain('resolve:newer');
    expect(calls).toContain('resolve:older');
  });
});

describe('the re-review switch is board.reReview, not board.triage', () => {
  test('reReview disabled: a resolved latch is left alone, nothing is called', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      reReview: { enabled: false },
    });
    const r = await runLatchPass(deps);
    expect(r).toEqual({
      posted: 0,
      dispatched: 0,
      queued: 0,
      rejected: 0,
      spent: 0,
      repaired: 0,
      resurrected: 0,
      skipped: 0,
      failed: 0,
    });
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });

  test('triage (doctor/nudge) disabled but reReview enabled: still dispatches', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      cfg: parseTriageBlock({
        enabled: false,
        cooldownMinutes: 30,
        dailyAttemptBudget: 3,
      }),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(['upload', 'updateNote:1']);
  });
});

describe('step 3: armed and resolved', () => {
  test('dispatches and shows running on the resolved latch, with no reply', async () => {
    const db = tempDb();
    const { deps, calls, launches, memory, noteBodies } = harness({
      db,
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(['upload', 'updateNote:1']);
    expect(noteBodies.get(1)).toStartWith(RUNNING);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'running',
      launchAt: NOW,
      wait: null,
      variant: 'running',
    });
    expect(memory.mrs[MR]?.attemptsToday).toBe(1);
    expect(memory.mrs[MR]?.lastDispatchAt).toBe(NOW);
  });

  test('an approved MR spends instead of dispatching', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      fetchLatchMrs: async () => [{ ...facts, approvedBySelf: true }],
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual(['upload', 'updateNote:1', 'resolve:d1']);
  });

  // Spending only canon and the resolved carriers would strand an
  // armed-but-UNRESOLVED extra: it is not a carrier (requestCarriers only
  // counts resolved copies), so it survives to the next tick, which stops at
  // step 1 on the now-spent canon and never revisits it.
  test('an approved MR spends every latch found, including an armed-unresolved extra', async () => {
    const { deps, calls } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('extra', armedLatchBody(IMG), '2026-08-01T10:00:00Z', false)
      ),
      fetchLatchMrs: async () => [{ ...facts, approvedBySelf: true }],
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toContain('resolve:canon');
    expect(calls).toContain('resolve:extra');
  });

  // A GitLab write failing after a successful launch must still charge the
  // attempt, or the next tick reads the same resolved latch as a fresh
  // request and dispatches again every tick for as long as the write fails.
  test('a successful launch with a failing note rewrite still charges the attempt', async () => {
    const { deps, launches, memory } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      gateway: {
        async uploadFile() {
          return { alt: '', url: '', full_path: '', markdown: IMG };
        },
        async createDiscussion() {
          return { id: 'new', notes: [{ id: 1 }] };
        },
        async updateNote() {
          throw new Error('gitlab 500');
        },
        async resolveDiscussion() {},
        async unresolveDiscussion() {},
        async createNote() {
          return { id: 9 };
        },
      },
    });
    const result = await runLatchPass(deps);
    expect(result.failed).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(launches).toEqual([MR]);
    expect(memory.mrs[MR]?.attemptsToday).toBe(1);
    expect(memory.mrs[MR]?.lastDispatchAt).toBe(NOW);
  });

  test('a failed launch replies, consumes the request, and counts a rejection', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('extra', armedLatchBody(IMG), '2026-08-01T10:00:00Z', true)
      ),
      launchReReview: async () => ({ kind: 'error', message: 'boom' }),
    });
    expect((await runLatchPass(deps)).rejected).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toContain('reply:canon');
    expect(calls).toContain('resolve:extra');
  });

  test('a dispatch notifies in plain words, pointing at the MR', async () => {
    const { deps, notifies } = harness({
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    await runLatchPass(deps);
    expect(notifies).toEqual([
      {
        title: 'Follow-up review started on !2317',
        message: 'The author asked for a follow-up review',
        mrUrl: MR,
      },
    ]);
  });
});

describe('idempotence across ticks', () => {
  // The write-loop the design eliminated: a spent latch must draw no writes on
  // any later tick, not merely on the tick that spent it.
  test('a second tick over an already-spent latch writes nothing', async () => {
    const spentDetail = detail(
      disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true)
    );
    const { deps, calls } = harness({ detail: spentDetail });
    await runLatchPass(deps);
    await runLatchPass(deps);
    expect(calls).toEqual([]);
  });

  test('an approve-outcome state repairs a spent-but-unresolved latch once', async () => {
    const approved: ReviewState = { ...commented, outcome: 'approve' };
    const { deps, calls } = harness({
      detail: detail(
        disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(calls).toEqual(['resolve:d1']);
  });
});

describe('dedupe', () => {
  // A spent relic must never outrank a fresh latch, or the feature silently
  // disables itself on this MR forever.
  test('a fresh latch beats a spent relic', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('relic', spentLatchBody(IMG), '2026-08-01T10:00:00Z', true),
        disc('fresh', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(['upload', 'updateNote:1']);
  });

  // Resolving the duplicate is still asking, and the request must be consumed
  // in BOTH copies or it re-fires on every re-entry into scope.
  test('a resolved extra triggers the request and is spent by the disposal', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
        disc('extra', armedLatchBody(IMG), '2026-09-01T09:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toContain('resolve:canon');
    expect(calls).toContain('updateNote:1');
    expect(calls).toContain('resolve:extra');
    expect(calls.some(c => c.startsWith('reply:'))).toBe(false);
  });

  // The request bit must be consumed when the request queues too, not just
  // on dispatch. Left in the extra, it re-fires once the latch is armed again.
  test('queueing consumes a resolved extra, not just the canonical latch', async () => {
    const memory: DispatchMemory = {
      identity: null,
      mrs: {
        [MR]: { ...emptyMrMemory('1970-01-12'), lastDispatchAt: NOW - 60_000 },
      },
    };
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('extra', armedLatchBody(IMG), '2026-09-01T09:00:00Z', true)
      ),
      memory,
    });
    expect((await runLatchPass(deps)).queued).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).not.toContain('unresolve:canon');
    expect(calls).toContain('resolve:extra');
  });

  // The MR is not approved here (a dispatch, not an approval verdict), so the
  // extra's spend must read as a defunct duplicate, never as "Approved".
  test('consuming a duplicate on dispatch writes the superseded wording, not approved', async () => {
    const { deps, noteBodies } = harness({
      detail: detail(
        disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
        disc('extra', armedLatchBody(IMG), '2026-09-01T09:00:00Z', true)
      ),
    });
    await runLatchPass(deps);
    expect(noteBodies.get(1)).toContain(
      'Superseded by a newer latch on this MR'
    );
    expect(noteBodies.get(1)).not.toContain('Approved');
  });
});

describe('per-MR isolation', () => {
  // One MR's GitLab call throwing must not abort the tick: every MR queued
  // after it on the same run still has to get its own chance.
  test('a throwing MR is counted as failed and does not stop a later healthy one', async () => {
    const MR2 = 'https://gitlab.com/acme/web/-/merge_requests/9001';
    const facts2: LatchMrFacts = { ...facts, mrUrl: MR2, iid: 9001 };
    const { deps, calls } = harness({
      fetchLatchMrs: async () => [facts, facts2],
      readReviewStates: () =>
        new Map([
          [MR, commented],
          [MR2, commented],
        ]),
      readDetail: async mr => {
        if (mr.iid === facts.iid) throw new Error('gitlab 500');
        return detail();
      },
    });
    const result = await runLatchPass(deps);
    expect(result.failed).toBe(1);
    expect(result.posted).toBe(1);
    expect(calls).toEqual(['upload', 'createDiscussion']);
  });
});

describe('tombstone resurrection', () => {
  const tombstoned = {
    readReviewStates: () => new Map<string, ReviewState>(),
    readPrunedReviewStates: () => new Map([[MR, commented]]),
  };

  test('an armed resolved latch revives the tombstone and dispatches', async () => {
    const { deps, calls, launches, resurrects, drops } = harness({
      ...tombstoned,
      detail: detail(disc('d1', armedLatchBody(IMG), '2026-09-01', true)),
    });
    const result = await runLatchPass(deps);
    expect(resurrects).toEqual([MR]);
    expect(drops).toEqual([]);
    expect(result.resurrected).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(['upload', 'updateNote:1']);
  });

  test('an armed unresolved latch revives the tombstone and waits', async () => {
    const { deps, calls, resurrects } = harness({
      ...tombstoned,
      detail: detail(disc('d1', armedLatchBody(IMG), '2026-09-01', false)),
    });
    const result = await runLatchPass(deps);
    expect(resurrects).toEqual([MR]);
    expect(result.resurrected).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(calls).toEqual([]);
  });

  test('a tombstone whose MR has discussions but no latch is dropped', async () => {
    const { deps, calls, resurrects, drops } = harness({
      ...tombstoned,
      detail: detail(disc('plain', 'just a human thread', '2026-09-01', false)),
    });
    const result = await runLatchPass(deps);
    expect(drops).toEqual([MR]);
    expect(resurrects).toEqual([]);
    expect(result.resurrected).toBe(0);
    expect(calls).toEqual([]);
  });

  // A live write (relaunch, status CLI) can revive the row between this
  // pass's snapshot read and its claim; the snapshot's tomb is then stale
  // and dispatching on it could double up on a review already in flight.
  test('a lost resurrection claim skips the MR without dispatching', async () => {
    const { deps, calls, launches } = harness({
      ...tombstoned,
      resurrectReviewState: () => false,
      detail: detail(disc('d1', armedLatchBody(IMG), '2026-09-01', true)),
    });
    const result = await runLatchPass(deps);
    expect(result.dispatched).toBe(0);
    expect(result.resurrected).toBe(0);
    expect(result.skipped).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual([]);
  });

  // The daemon answers an unrecognized identity with an empty-but-ok result
  // (see LatchMrFacts.rtRepo). Dropping the tombstone on that wobble would
  // destroy the one record that lets the latch ever be found again.
  test('a tombstone is kept when the MR reads back zero discussions', async () => {
    const { deps, resurrects, drops } = harness({
      ...tombstoned,
      detail: detail(),
    });
    const result = await runLatchPass(deps);
    expect(drops).toEqual([]);
    expect(resurrects).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  test('a tombstone whose only latch is spent is dropped', async () => {
    const { deps, calls, drops } = harness({
      ...tombstoned,
      detail: detail(disc('relic', spentLatchBody(IMG), '2026-09-01', true)),
    });
    await runLatchPass(deps);
    expect(drops).toEqual([MR]);
    expect(calls).toEqual([]);
  });

  test('an approved MR revives the tombstone and spends the latch', async () => {
    const { deps, calls, resurrects } = harness({
      ...tombstoned,
      fetchLatchMrs: async () => [{ ...facts, approvedBySelf: true }],
      detail: detail(disc('d1', armedLatchBody(IMG), '2026-09-01', true)),
    });
    const result = await runLatchPass(deps);
    expect(resurrects).toEqual([MR]);
    expect(result.spent).toBe(1);
    expect(calls).toEqual(['upload', 'updateNote:1', 'resolve:d1']);
  });

  test('an unreadable detail leaves the tombstone in place for the next tick', async () => {
    const { deps, resurrects, drops } = harness({
      ...tombstoned,
      detail: null,
    });
    const result = await runLatchPass(deps);
    expect(resurrects).toEqual([]);
    expect(drops).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  test('an approve-outcome tombstone is not revived and never read', async () => {
    let reads = 0;
    const { deps, drops } = harness({
      readReviewStates: () => new Map<string, ReviewState>(),
      readPrunedReviewStates: () =>
        new Map([[MR, { ...commented, outcome: 'approve' as const }]]),
      readDetail: async () => {
        reads++;
        return detail();
      },
    });
    const result = await runLatchPass(deps);
    expect(reads).toBe(0);
    expect(drops).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  test('no live row and no tombstone skips without reading discussions', async () => {
    let reads = 0;
    const { deps } = harness({
      readReviewStates: () => new Map<string, ReviewState>(),
      readDetail: async () => {
        reads++;
        return detail();
      },
    });
    const result = await runLatchPass(deps);
    expect(reads).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe('one latch per reviewer', () => {
  test("another reviewer's armed latch does not stop this one posting", async () => {
    const { deps, calls } = harness({
      detail: detail(
        disc('lee', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false, 'lee')
      ),
    });
    expect((await runLatchPass(deps)).posted).toBe(1);
    expect(calls).toEqual(['upload', 'createDiscussion']);
  });

  test('a resolved latch from another reviewer starts nothing here', async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('lee', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true, 'lee'),
        disc('mine', armedLatchBody(IMG), '2026-09-01T09:00:00Z', false)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(0);
    expect(launches).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("someone else's approval leaves this reviewer's request standing", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc('mine', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
      fetchLatchMrs: async () => [{ ...facts, approvedBySelf: false }],
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(['upload', 'updateNote:1']);
  });

  test("approving in GitLab spends this reviewer's armed latch and no other", async () => {
    const { deps, calls } = harness({
      detail: detail(
        disc('mine', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
        disc('lee', armedLatchBody(IMG), '2026-09-01T11:00:00Z', false, 'lee')
      ),
      fetchLatchMrs: async () => [{ ...facts, approvedBySelf: true }],
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toEqual(['upload', 'updateNote:1', 'resolve:mine']);
  });

  test('posts nothing for a reviewer who already approved in GitLab', async () => {
    const { deps, calls } = harness({
      detail: detail(),
      fetchLatchMrs: async () => [{ ...facts, approvedBySelf: true }],
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('the queue', () => {
  const cooling = (): DispatchMemory => ({
    identity: null,
    mrs: {
      [MR]: { ...emptyMrMemory('1970-01-12'), lastDispatchAt: NOW - 60_000 },
    },
  });
  const queuedRow = (over: Partial<LatchRow> = {}) =>
    row({
      phase: 'queued',
      wait: 'cooldown',
      variant: 'queued-cooldown',
      ...over,
    });

  test('cooldown queues instead of replying Not yet', async () => {
    const db = tempDb();
    const { deps, calls, uploads, noteBodies, notifies, launches, audits } =
      harness({
        db,
        memory: cooling(),
        detail: detail(
          disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
        ),
      });
    expect((await runLatchPass(deps)).queued).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual(['upload', 'updateNote:1']);
    expect(uploads).toEqual(['latch-2317-queued-cooldown.gif']);
    expect(noteBodies.get(1)).toStartWith(QUEUED);
    expect(notifies).toEqual([]);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'queued',
      wait: 'cooldown',
      variant: 'queued-cooldown',
    });
    expect(audits.map(a => a.action)).toContain('queued');
  });

  test('queued dispatches when the block clears', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const { deps, calls, launches, noteBodies, memory, audits } = harness({
      db,
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', true)),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls.some(c => c.startsWith('reply:'))).toBe(false);
    expect(noteBodies.get(1)).toStartWith(RUNNING);
    expect(memory.mrs[MR]?.attemptsToday).toBe(1);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'running',
      launchAt: NOW,
      wait: null,
    });
    expect(audits.map(a => a.action)).toContain('dispatched');
  });

  test('wait reason change swaps the strip', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const { deps, uploads, launches, noteBodies, calls } = harness({
      db,
      memory: {
        identity: null,
        mrs: {
          [MR]: {
            ...emptyMrMemory('1970-01-12'),
            attemptsToday: 3,
            lastDispatchAt: NOW - 60_000,
          },
        },
      },
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', true)),
    });
    await runLatchPass(deps);
    expect(launches).toEqual([]);
    expect(uploads).toEqual(['latch-2317-queued-budget.gif']);
    expect(noteBodies.get(1)).toStartWith(QUEUED);
    expect(calls).toEqual(['upload', 'updateNote:1']);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'queued',
      wait: 'budget',
      variant: 'queued-budget',
    });
  });

  test('an unchanged wait touches nothing', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const { deps, calls } = harness({
      db,
      memory: cooling(),
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', true)),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(readLatchRow(MR, db)?.updatedAt).toBe(1);
  });

  test('a hand-launched review satisfies a queued request', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const reviewing: ReviewState = {
      ...commented,
      status: 'reviewing',
      startedAt: 5,
      runStartedAt: NOW - 1_000,
    };
    const { deps, launches, noteBodies, memory } = harness({
      db,
      readReviewStates: () => new Map([[MR, reviewing]]),
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', true)),
    });
    await runLatchPass(deps);
    expect(launches).toEqual([]);
    expect(memory.mrs[MR]).toBeUndefined();
    expect(noteBodies.get(1)).toStartWith(RUNNING);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'running',
      launchAt: NOW - 1_000,
    });
  });

  test('stale note never re-requests a running latch', async () => {
    const db = tempDb();
    putLatchRow(row({ phase: 'running', launchAt: NOW - 1_000 }), db);
    const { deps, calls, launches } = harness({
      db,
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    await runLatchPass(deps);
    expect(launches).toEqual([]);
    expect(calls).toEqual([]);
    expect(readLatchRow(MR, db)?.phase).toBe('running');
  });

  test('a running row whose lane is gone is skipped', async () => {
    const db = tempDb();
    putLatchRow(row({ phase: 'running', launchAt: NOW - 1_000 }), db);
    const { deps, calls, launches } = harness({
      db,
      readReviewStates: () => new Map(),
      detail: detail(disc('d1', runningBody(), '2026-09-01T10:00:00Z', true)),
    });
    expect((await runLatchPass(deps)).skipped).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('author reopening a queued latch withdraws it', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const { deps, calls, launches, noteBodies, audits } = harness({
      db,
      memory: cooling(),
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', false)),
    });
    await runLatchPass(deps);
    expect(launches).toEqual([]);
    expect(calls).toEqual(['upload', 'updateNote:1']);
    expect(noteBodies.get(1)).toStartWith(ARMED + '\n');
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'armed',
      wait: null,
      variant: 'armed',
    });
    expect(audits.map(a => a.action)).toContain('withdrawn');
  });

  test('a stale armed unresolved read does not withdraw a queued latch', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const { deps, calls, launches } = harness({
      db,
      memory: cooling(),
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
    });
    await runLatchPass(deps);
    expect(launches).toEqual([]);
    expect(calls).toEqual([]);
    expect(readLatchRow(MR, db)?.phase).toBe('queued');
  });

  test('crash shape is repaired after the grace window', async () => {
    const db = tempDb();
    putLatchRow(
      row({ variant: 'done-comments-3', updatedAt: NOW - LATCH_POST_GRACE_MS }),
      db
    );
    const { deps, calls, uploads, launches, noteBodies, audits } = harness({
      db,
      detail: detail(disc('d1', runningBody(), '2026-09-01T10:00:00Z', true)),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(launches).toEqual([]);
    expect(uploads).toEqual(['latch-2317-done-comments-3.gif']);
    expect(calls).toEqual(['upload', 'updateNote:1', 'unresolve:d1']);
    expect(noteBodies.get(1)).toStartWith(ARMED + '\n');
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'armed',
      variant: 'done-comments-3',
    });
    expect(audits.map(a => a.action)).toContain('repaired');
  });

  test('no repair inside the grace window', async () => {
    const db = tempDb();
    putLatchRow(row({ updatedAt: NOW }), db);
    const { deps, calls, launches } = harness({
      db,
      detail: detail(disc('d1', runningBody(), '2026-09-01T10:00:00Z', true)),
    });
    await runLatchPass(deps);
    expect(launches).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('queued row re-decides past an error lane', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const failed: ReviewState = {
      ...commented,
      status: 'error',
      outcome: undefined,
    };
    const { deps, launches, replies } = harness({
      db,
      readReviewStates: () => new Map([[MR, failed]]),
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', true)),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(replies).toEqual([]);
    expect(readLatchRow(MR, db)?.phase).toBe('running');
  });

  test('a queued row whose lane is gone re-decides as a commented review', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const { deps, launches } = harness({
      db,
      readReviewStates: () => new Map(),
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', true)),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(readLatchRow(MR, db)?.phase).toBe('running');
  });

  test('pre-change latch with no row is adopted', async () => {
    const db = tempDb();
    const { deps, calls, audits } = harness({
      db,
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
      ),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(readLatchRow(MR, db)).toMatchObject({
      discussionId: 'd1',
      rootNoteId: 1,
      phase: 'armed',
      updatedAt: NOW,
    });
    expect(audits.map(a => a.action)).toContain('adopted');
  });

  test('a spent note with no row is adopted as spent', async () => {
    const db = tempDb();
    const { deps } = harness({
      db,
      detail: detail(
        disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    await runLatchPass(deps);
    expect(readLatchRow(MR, db)?.phase).toBe('spent');
  });

  // A post race can leave the row on an older copy while the newest copy is
  // the one the author sees and acts on.
  test('a row on an older copy is re-pointed to the canonical latch', async () => {
    const db = tempDb();
    putLatchRow(row({ discussionId: 'old', updatedAt: NOW }), db);
    const { deps, launches, calls, audits } = harness({
      db,
      detail: detail(
        disc('new', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('old', armedLatchBody(IMG), '2026-08-01T10:00:00Z', false)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).not.toContain('resolve:old');
    expect(readLatchRow(MR, db)).toMatchObject({
      discussionId: 'new',
      phase: 'running',
      variant: 'running',
    });
    expect(audits.map(a => a.action)).toContain('repointed');
  });

  test('own approval spends from every phase', async () => {
    const bodies = {
      queued: queuedBody,
      running: runningBody,
      error: errorBody,
    };
    for (const phase of ['queued', 'running', 'error'] as const) {
      const db = tempDb();
      putLatchRow(row({ phase }), db);
      const { deps, launches, uploads, noteBodies } = harness({
        db,
        fetchLatchMrs: async () => [{ ...facts, approvedBySelf: true }],
        detail: detail(
          disc('d1', bodies[phase](), '2026-09-01T10:00:00Z', true)
        ),
      });
      expect((await runLatchPass(deps)).spent).toBe(1);
      expect(launches).toEqual([]);
      expect(uploads).toEqual(['latch-2317-approved.gif']);
      expect(noteBodies.get(1)).toStartWith(SPENT);
      expect(readLatchRow(MR, db)).toMatchObject({
        phase: 'spent',
        variant: 'approved',
      });
    }
  });

  // decideRequest has no reason left that never clears for a row-backed
  // latch, so the pane failing to start is the hard refusal this pass meets.
  test('a hard refusal still replies Not yet and reopens', async () => {
    const db = tempDb();
    putLatchRow(row({ updatedAt: NOW }), db);
    const { deps, calls, replies } = harness({
      db,
      launchReReview: async () => ({ kind: 'error', message: 'boom' }),
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).rejected).toBe(1);
    expect(replies).toEqual([
      "Not yet: the pane failed to start. Resolve this thread again once that clears and I'll pick it up.",
    ]);
    expect(calls).toEqual(['reply:d1', 'unresolve:d1']);
    expect(readLatchRow(MR, db)?.phase).toBe('armed');
  });

  test('an errored lane does not refuse an armed request', async () => {
    const db = tempDb();
    putLatchRow(row({ updatedAt: NOW }), db);
    const failed: ReviewState = {
      ...commented,
      status: 'error',
      outcome: undefined,
    };
    const { deps, launches, replies } = harness({
      db,
      readReviewStates: () => new Map([[MR, failed]]),
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(replies).toEqual([]);
    expect(readLatchRow(MR, db)?.phase).toBe('running');
  });

  test('an abandoned follow-up lane does not refuse an armed request', async () => {
    const db = tempDb();
    putLatchRow(row({ updatedAt: NOW }), db);
    const { deps, launches, replies } = harness({
      db,
      readReviewStates: () => new Map([[MR, noOutcome]]),
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(replies).toEqual([]);
    expect(readLatchRow(MR, db)?.phase).toBe('running');
  });

  test('an armed row whose lane is gone still takes a request', async () => {
    const db = tempDb();
    putLatchRow(row({ updatedAt: NOW }), db);
    const { deps, launches, replies } = harness({
      db,
      readReviewStates: () => new Map(),
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(replies).toEqual([]);
  });

  test('a request during a running review queues behind it', async () => {
    const db = tempDb();
    putLatchRow(row({ updatedAt: NOW }), db);
    const reviewing: ReviewState = { ...commented, status: 'reviewing' };
    const { deps, launches, uploads } = harness({
      db,
      readReviewStates: () => new Map([[MR, reviewing]]),
      detail: detail(
        disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
      ),
    });
    expect((await runLatchPass(deps)).queued).toBe(1);
    expect(launches).toEqual([]);
    expect(uploads).toEqual(['latch-2317-queued-review-in-flight.gif']);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'queued',
      wait: 'review-in-flight',
    });
  });

  test('reopening a queued latch while a hand-launched review runs withdraws it and leaves the thread open', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const reviewing: ReviewState = {
      ...commented,
      status: 'reviewing',
      runStartedAt: NOW - 1_000,
    };
    const { deps, calls, launches, noteBodies } = harness({
      db,
      readReviewStates: () => new Map([[MR, reviewing]]),
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', false)),
    });
    await runLatchPass(deps);
    expect(launches).toEqual([]);
    expect(calls).toEqual(['upload', 'updateNote:1']);
    expect(noteBodies.get(1)).toStartWith(ARMED + '\n');
    expect(readLatchRow(MR, db)).toMatchObject({ phase: 'armed', wait: null });
  });

  test('a wait change that loses its cas writes and counts nothing', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const { deps, calls, audits } = harness({
      db,
      casLatch: () => false,
      memory: {
        identity: null,
        mrs: {
          [MR]: { ...emptyMrMemory('1970-01-12'), attemptsToday: 3 },
        },
      },
      detail: detail(disc('d1', queuedBody(), '2026-09-01T10:00:00Z', true)),
    });
    const result = await runLatchPass(deps);
    expect(result.queued).toBe(0);
    expect(calls).toEqual([]);
    expect(audits.map(a => a.action)).not.toContain('queued');
  });

  // A read that cannot see the row's latch yet, beside an old spent relic,
  // must not overwrite the row with the relic.
  test('a live row is kept when the read shows only a spent latch elsewhere', async () => {
    const db = tempDb();
    putLatchRow(queuedRow(), db);
    const { deps, calls } = harness({
      db,
      detail: detail(
        disc('relic', spentLatchBody(IMG), '2026-08-01T10:00:00Z', true)
      ),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(readLatchRow(MR, db)).toMatchObject({
      discussionId: 'd1',
      phase: 'queued',
    });
  });

  test('a re-point that loses its cas skips the tick', async () => {
    const db = tempDb();
    putLatchRow(row({ discussionId: 'old', updatedAt: NOW }), db);
    const { deps, calls, launches } = harness({
      db,
      casLatch: () => false,
      detail: detail(
        disc('new', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
        disc('old', armedLatchBody(IMG), '2026-08-01T10:00:00Z', false)
      ),
    });
    expect((await runLatchPass(deps)).skipped).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual([]);
    expect(readLatchRow(MR, db)?.discussionId).toBe('old');
  });
});

describe('waitReasonOf', () => {
  test('maps the reasons that clear by themselves', () => {
    expect(waitReasonOf({ action: 'dispatch', reason: 'latch' })).toBe(
      'next-sweep'
    );
    expect(waitReasonOf({ action: 'reject', reason: 'cooldown' })).toBe(
      'cooldown'
    );
    expect(waitReasonOf({ action: 'reject', reason: 'budget-exhausted' })).toBe(
      'budget'
    );
    expect(waitReasonOf({ action: 'reject', reason: 'review-in-flight' })).toBe(
      'review-in-flight'
    );
  });

  test('null for reasons that never clear', () => {
    expect(
      waitReasonOf({ action: 'reject', reason: 'no-commented-review' })
    ).toBeNull();
    expect(
      waitReasonOf({ action: 'reject', reason: 'already-reviewed' })
    ).toBeNull();
  });
});

describe('runStamp', () => {
  test('the run start, falling back to the last write, never startedAt', () => {
    expect(runStamp({ ...commented, startedAt: 1, runStartedAt: 7 })).toBe(7);
    expect(runStamp({ ...commented, startedAt: 1, updatedAt: 9 })).toBe(9);
  });
});

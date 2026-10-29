/**
 * The latch pass: read every MR whose review is done or whose latch row is
 * live, and act on the latch.
 *
 * Branch order is the design's safety property, not a style choice. The spent
 * check is unconditional and runs first, so no board-made resolve can ever be
 * read back as a human request, whatever the MR's approval state does
 * afterwards.
 *
 * The latch row is the record and the note is what people see. Every
 * transition moves the row first and rewrites the note after, so a stale
 * discussion read still showing an older note never re-requests or clobbers a
 * latch the row has already moved on.
 */
import type { Database } from 'bun:sqlite';

import type { MRDetail } from '@mattstack/glance';
import {
  canonicalLatch,
  findLatches,
  hasLiveLatch,
  requestCarriers,
  type LatchRef,
} from '../latch/discussions.ts';
import {
  casLatch as casLatchIn,
  putLatchRow as putLatchRowIn,
  readLatchRow as readLatchRowIn,
  type LatchPhase,
  type LatchRow,
  type WaitReason,
} from '../latch/latch-state.ts';
import {
  postLatch,
  rewriteLatch,
  spendAllLatches,
  spendLatch,
  type LatchGateway,
  type LatchTarget,
} from '../latch/post.ts';
import {
  variantKey,
  variantOfKey,
  type BannerVariant,
} from '../latch/variants.ts';
import type { ReReviewLaunch } from '../review-launch.ts';
import type { ReviewState } from '../review-state.ts';
import type { AuditEntry } from './audit.ts';
import type { ReReviewConfig, TriageConfig } from './config.ts';
import {
  emptyMrMemory,
  rollDay,
  type DispatchMemory,
  type MrMemory,
} from './memory.ts';
import { decideRequest, plainReason, type ReReviewRequest } from './nudge.ts';

export interface LatchMrFacts {
  mrUrl: string;
  iid: number;
  projectId: number;
  projectPath: string;
  /** Encoded daemon identity for rt queries on this MR's discussions.
      An unrecognized identity answers with an empty-but-ok result rather than
      an error, so the distinction matters: sending a bare repo name here would
      silently disable triage. */
  rtRepo: string;
  /** This board's reviewer is among the MR's GitLab approvers. Approvals
      from anyone else never touch this reviewer's latch. */
  approvedBySelf: boolean;
}

type LatchPatch = Partial<Omit<LatchRow, 'mrUrl'>>;

export interface LatchPassDeps {
  readReviewStates(): Map<string, ReviewState>;
  /** Tombstoned review rows (pruned while the MR was off the board). A
      commented one whose MR is back in scope and still carries a live latch
      is resurrected; one whose latch is gone is dropped for good. */
  readPrunedReviewStates(): Map<string, ReviewState>;
  /** False when the claim is lost (the row already went live again): the
      snapshot's tombstone is stale and must not drive a dispatch. */
  resurrectReviewState(mrUrl: string): boolean;
  dropPrunedReviewState(mrUrl: string): void;
  fetchLatchMrs(): Promise<LatchMrFacts[]>;
  readDetail(mr: LatchMrFacts): Promise<MRDetail | null>;
  gateway: LatchGateway;
  launchReReview(mrUrl: string, iid: number): Promise<ReReviewLaunch>;
  /** The GitLab username behind this board's token: the only author whose
      latches this pass reads, posts, spends or answers. */
  self: string;
  memory: DispatchMemory;
  /** Cooldown and budget only. The pass's on/off switch is `reReview`, never
      cfg.enabled: that flag is the doctor/nudge sweeps' per-developer opt-in. */
  cfg: TriageConfig;
  reReview: ReReviewConfig;
  appendAudit(entry: AuditEntry): void;
  notify(title: string, message: string, mrUrl: string): Promise<void>;
  now(): number;
  /** The board's state db; the default is the live one. */
  db?: Database;
  /** The latch row store; each defaults to the latch-state function on `db`. */
  readLatchRow?(mrUrl: string): LatchRow | null;
  casLatch?(
    mrUrl: string,
    from: LatchPhase[],
    patch: LatchPatch,
    now: number,
    opts?: { discussionId?: string }
  ): boolean;
  putLatchRow?(row: LatchRow): void;
}

export interface LatchPassResult {
  posted: number;
  dispatched: number;
  queued: number;
  rejected: number;
  spent: number;
  repaired: number;
  resurrected: number;
  skipped: number;
  failed: number;
}

/** How long a freshly-done review is left to the server before this pass will
    arm a latch for it. The server posts the instant the done signal lands, but
    both writers check for an existing latch through the daemon's discussion
    store, which within its staleness window cannot show a post seconds old:
    posting here inside that window double-posts. A genuinely missed post
    (server down or throwing) still lands on the first tick past the window.
    The same window guards the repair of a row the note has not caught up to. */
export const LATCH_POST_GRACE_MS = 5 * 60_000;

const refusalReply = (reason: string) =>
  `Not yet: ${reason}. Resolve this thread again once that clears and I'll pick it up.`;

/** The wait a decision maps to, or null for a refusal that never clears by
    itself. */
export function waitReasonOf(decision: {
  action: string;
  reason: string;
}): WaitReason | null {
  if (decision.action === 'dispatch') return 'next-sweep';
  switch (decision.reason) {
    case 'cooldown':
      return 'cooldown';
    case 'budget-exhausted':
      return 'budget';
    case 'review-in-flight':
      return 'review-in-flight';
    default:
      return null;
  }
}

/** When the lane's current run began. `startedAt` is the lane's first-ever
    write and never resets, so it cannot stand in for a run. */
export function runStamp(r: ReviewState): number {
  return r.runStartedAt ?? r.updatedAt;
}

const IN_FLIGHT: ReadonlySet<LatchPhase> = new Set([
  'queued',
  'running',
  'error',
]);

interface Rows {
  read(mrUrl: string): LatchRow | null;
  cas(
    mrUrl: string,
    from: LatchPhase[],
    patch: LatchPatch,
    now: number,
    opts?: { discussionId?: string }
  ): boolean;
  put(row: LatchRow): void;
}

/** One MR's latch on one tick, past the spent and approval checks. */
interface Tick {
  deps: LatchPassDeps;
  rows: Rows;
  mr: LatchMrFacts;
  canon: LatchRef;
  carriers: LatchRef[];
  row: LatchRow;
  target: LatchTarget;
  policy: TriageConfig;
  dayStamp: string;
  now: number;
  result: LatchPassResult;
}

export async function runLatchPass(
  deps: LatchPassDeps
): Promise<LatchPassResult> {
  const result: LatchPassResult = {
    posted: 0,
    dispatched: 0,
    queued: 0,
    rejected: 0,
    spent: 0,
    repaired: 0,
    resurrected: 0,
    skipped: 0,
    failed: 0,
  };
  if (!deps.reReview.enabled) return result;
  // decideRequest refuses with "disabled" on cfg.enabled, which is the
  // doctor/nudge switch. A team with those sweeps off but re-review on must
  // not see every resolved latch answered "Not yet: disabled".
  const policy: TriageConfig = { ...deps.cfg, enabled: true };
  const rows: Rows = {
    read: deps.readLatchRow ?? (url => readLatchRowIn(url, deps.db)),
    cas:
      deps.casLatch ??
      ((url, from, patch, at, opts) =>
        casLatchIn(url, from, patch, at, deps.db, opts)),
    put: deps.putLatchRow ?? (row => putLatchRowIn(row, deps.db)),
  };

  const reviews = deps.readReviewStates();
  const pruned = deps.readPrunedReviewStates();
  const now = deps.now();
  const dayStamp = new Date(now).toISOString().slice(0, 10);
  const mrs = await deps.fetchLatchMrs();

  for (const mr of mrs) {
    // One MR's GitLab call throwing (an archived project, a 403 upload, a
    // transient 500) must not abort the tick and starve every MR queued
    // after it while the condition lasts.
    try {
      const stored = rows.read(mr.mrUrl);
      // A live row is followed whatever its lane reads: the lane moves
      // through queued, reviewing and error while the latch waits on it.
      const held = !!stored && stored.phase !== 'spent';
      const live = reviews.get(mr.mrUrl);
      // Only a commented tombstone is a resurrection candidate: an approve
      // outcome's latch is already spent-terminal, so reviving its row buys
      // nothing and would cost a discussion read every tick.
      const dead = live ? undefined : pruned.get(mr.mrUrl);
      const tomb =
        dead?.status === 'done' && dead.outcome === 'comment'
          ? dead
          : undefined;
      // A done state with no outcome records no verdict, so there is nothing to
      // arm and nothing to spend. decideRequest treats it the same way.
      if (
        !held &&
        ((!live && !tomb) ||
          (live && (live.status !== 'done' || !live.outcome)))
      ) {
        result.skipped++;
        continue;
      }
      const detail = await deps.readDetail(mr);
      if (!detail) {
        result.skipped++;
        continue;
      }
      const latches = findLatches(detail, deps.self);
      let review = live;
      if (!review && tomb) {
        // Zero discussions is indistinguishable from the daemon's
        // empty-but-ok answer for an unrecognized identity (see
        // LatchMrFacts.rtRepo), so the tombstone is kept for the next tick
        // rather than destroyed on what may be a transient wobble.
        if (detail.discussions.length === 0) {
          result.skipped++;
          continue;
        }
        // The live latch is the proof the tombstone still matters: without
        // one there is nothing a revived row could ever act on, and dropping
        // the tombstone keeps this MR out of every later tick's reads.
        if (!hasLiveLatch(latches)) {
          deps.dropPrunedReviewState(mr.mrUrl);
          result.skipped++;
          continue;
        }
        // A lost claim means a concurrent write revived the row (a relaunch,
        // a status CLI): the next tick reads it live and fresh, so acting on
        // this tick's stale snapshot would risk doubling a review in flight.
        if (!deps.resurrectReviewState(mr.mrUrl)) {
          result.skipped++;
          continue;
        }
        deps.appendAudit({
          ts: now,
          mrUrl: mr.mrUrl,
          iid: mr.iid,
          event: 'latch',
          action: 'resurrected',
        });
        result.resurrected++;
        review = tomb;
      }
      const canon = canonicalLatch(latches);

      // Step 0: nothing to act on. A spent relic with no live latch is the
      // descoped case: arming a second review cycle is the server's job. A
      // row mid-request proves a latch exists the read cannot show yet.
      if (!canon) {
        if (
          !(stored && IN_FLIGHT.has(stored.phase)) &&
          review?.status === 'done' &&
          review.outcome === 'comment' &&
          !mr.approvedBySelf &&
          now - review.updatedAt >= LATCH_POST_GRACE_MS
        ) {
          const { discussionId, rootNoteId } = await postLatch(
            deps.gateway,
            mr.projectId,
            mr.projectPath,
            mr.mrUrl,
            mr.iid,
            deps.db
          );
          rows.put({
            mrUrl: mr.mrUrl,
            discussionId,
            rootNoteId,
            phase: 'armed',
            wait: null,
            launchAt: null,
            failures: 0,
            stuck: false,
            variant: 'armed',
            updatedAt: now,
          });
          deps.appendAudit({
            ts: now,
            mrUrl: mr.mrUrl,
            iid: mr.iid,
            event: 'latch',
            action: 'posted',
          });
          result.posted++;
        } else {
          result.skipped++;
        }
        continue;
      }

      const row = trackCanon(deps, rows, mr, canon, stored, now);
      if (!row) {
        result.skipped++;
        continue;
      }

      // Step 1: spent wins over everything, unconditionally.
      if (canon.kind === 'spent') {
        if (!canon.resolved) {
          await spendLatch(
            deps.gateway,
            mr.projectId,
            mr.projectPath,
            mr.mrUrl,
            mr.iid,
            canon,
            { state: 'approved' },
            now,
            deps.db
          );
          deps.appendAudit({
            ts: now,
            mrUrl: mr.mrUrl,
            iid: mr.iid,
            event: 'latch',
            action: 'repaired',
          });
          result.repaired++;
        } else {
          result.skipped++;
        }
        continue;
      }

      // Step 2: this reviewer's own approval spends from every phase, whether
      // it came through a review or GitLab; anyone else's approval leaves the
      // latch standing. Every own latch, not just canon: an armed-unresolved
      // extra left out here would strand live on the next tick, which stops
      // at step 1 on the now-spent canon and never looks at it again. A row
      // already reading spent is no proof the note is: the spend moves the
      // row first, so this branch is also what heals a spend cut short.
      if (
        mr.approvedBySelf ||
        (review?.status === 'done' && review.outcome === 'approve')
      ) {
        await spendAll(deps, mr, latches);
        deps.appendAudit({
          ts: now,
          mrUrl: mr.mrUrl,
          iid: mr.iid,
          event: 'latch',
          action: 'spent',
        });
        result.spent++;
        continue;
      }

      const tick: Tick = {
        deps,
        rows,
        mr,
        canon,
        carriers: requestCarriers(latches),
        row,
        target: {
          projectId: mr.projectId,
          projectPath: mr.projectPath,
          iid: mr.iid,
          mrUrl: mr.mrUrl,
          discussionId: canon.discussionId,
          rootNoteId: canon.rootNoteId,
        },
        policy,
        dayStamp,
        now,
        result,
      };
      // Running and error rows are never a request, whatever the note shows:
      // they wait on the run landing.
      if (row.phase === 'armed') await armedLatch(tick, review);
      else if (row.phase === 'queued') await queuedLatch(tick, review);
      else result.skipped++;
    } catch (err) {
      console.error(
        `latch pass: !${mr.iid} (${mr.mrUrl}) failed: ${err instanceof Error ? err.message : err}`
      );
      result.failed++;
    }
  }
  return result;
}

/** The row for the canonical latch: adopted from the note when there is
    none, or re-pointed when a post race left it on an older copy. Null when
    another writer moved the row since this tick read it. */
function trackCanon(
  deps: LatchPassDeps,
  rows: Rows,
  mr: LatchMrFacts,
  canon: LatchRef,
  stored: LatchRow | null,
  now: number
): LatchRow | null {
  if (stored && stored.discussionId === canon.discussionId) return stored;
  const audit = (action: string) =>
    deps.appendAudit({
      ts: now,
      mrUrl: mr.mrUrl,
      iid: mr.iid,
      event: 'latch',
      action,
    });
  // A live row beside a read that shows only a spent latch elsewhere is a
  // read that cannot see the row's latch yet, as in step 0.
  if (stored && stored.phase !== 'spent' && canon.kind === 'spent') {
    return stored;
  }
  const fresh: Omit<LatchRow, 'mrUrl' | 'updatedAt'> = {
    discussionId: canon.discussionId,
    rootNoteId: canon.rootNoteId,
    phase: canon.kind,
    wait: null,
    launchAt: null,
    failures: 0,
    stuck: false,
    variant: null,
  };
  if (!stored) {
    const adopted: LatchRow = { mrUrl: mr.mrUrl, ...fresh, updatedAt: now };
    rows.put(adopted);
    audit('adopted');
    return adopted;
  }
  // Guarded on the copy this tick read, so a row another writer moved in the
  // meantime is never overwritten from a stale snapshot.
  const live = stored.phase !== 'spent';
  const moved = rows.cas(
    mr.mrUrl,
    [stored.phase],
    live
      ? { discussionId: canon.discussionId, rootNoteId: canon.rootNoteId }
      : fresh,
    now,
    { discussionId: stored.discussionId }
  );
  if (!moved) return null;
  audit(live ? 'repointed' : 'adopted');
  return live
    ? {
        ...stored,
        discussionId: canon.discussionId,
        rootNoteId: canon.rootNoteId,
        updatedAt: now,
      }
    : { mrUrl: mr.mrUrl, ...fresh, updatedAt: now };
}

/** The lane decideRequest sees for a latch the row holds. The row is the
    record that a commented review existed, so a lane reading error, done with
    no outcome, or gone must not be refused as having none. A lane in flight
    passes through, so it still reads review-in-flight. */
function rowLane(
  mr: LatchMrFacts,
  review: ReviewState | undefined
): ReviewState {
  if (review && (review.status === 'queued' || review.status === 'reviewing')) {
    return review;
  }
  return {
    ...(review ?? {
      mrUrl: mr.mrUrl,
      iid: mr.iid,
      status: 'done',
      startedAt: 0,
      updatedAt: 0,
    }),
    status: 'done',
    outcome: 'comment',
  };
}

async function armedLatch(
  t: Tick,
  review: ReviewState | undefined
): Promise<void> {
  if (t.canon.kind !== 'armed') return repairArmed(t);
  if (t.carriers.length === 0) {
    t.result.skipped++;
    return;
  }
  const m = memoryFor(t);
  const lane = rowLane(t.mr, review);
  const decision = decideRequest(requestOf(t), lane, m, t.policy, t.now);
  auditDecision(t, decision, m);
  if (decision.action === 'dispatch') return dispatch(t, 'armed', m);
  const wait = waitReasonOf(decision);
  if (wait) return queue(t, wait);
  return refuse(t, 'armed', decision.reason);
}

async function queuedLatch(
  t: Tick,
  review: ReviewState | undefined
): Promise<void> {
  const { rows, mr, canon, now } = t;
  const guard = { discussionId: canon.discussionId };
  // The queued marker proves this read post-dates the pass's own rewrite, so
  // an open thread is the author taking the request back, even while a review
  // runs. An armed open note is a read from before the request and proves
  // nothing.
  if (canon.kind === 'queued' && !canon.resolved) {
    const moved = rows.cas(
      mr.mrUrl,
      ['queued'],
      { phase: 'armed', wait: null },
      now,
      guard
    );
    if (moved) {
      await show(t, 'armed', { state: 'armed' }, 'keep');
      audit(t, 'withdrawn');
    }
    return;
  }
  // Any review that starts while the request waits is the follow-up, even one
  // launched by hand: one ask never gets two reviews.
  if (review && (review.status === 'queued' || review.status === 'reviewing')) {
    const moved = rows.cas(
      mr.mrUrl,
      ['queued'],
      { phase: 'running', launchAt: runStamp(review), wait: null },
      now,
      guard
    );
    if (moved) {
      await show(t, 'running', { state: 'running' }, threadClosed(t));
      audit(t, 'dispatched', { outcome: 'review already running' });
    }
    return;
  }
  const m = memoryFor(t);
  const lane = rowLane(mr, review);
  const decision = decideRequest(requestOf(t), lane, m, t.policy, now);
  const wait = decision.action === 'dispatch' ? null : waitReasonOf(decision);
  if (decision.action === 'dispatch' || !wait) {
    auditDecision(t, decision, m);
    if (decision.action === 'dispatch') return dispatch(t, 'queued', m);
    return refuse(t, 'queued', decision.reason);
  }
  const variant: BannerVariant = { state: 'queued', wait };
  if (variantKey(variant) === t.row.variant) {
    t.result.skipped++;
    return;
  }
  const moved = rows.cas(mr.mrUrl, ['queued'], { wait }, now, guard);
  if (!moved) {
    t.result.skipped++;
    return;
  }
  await show(t, 'queued', variant, 'keep');
  audit(t, 'queued', { reason: wait });
  t.result.queued++;
}

/** The row moved to armed but the note still shows a later phase: either the
    rewrite never landed, or this read predates one that did. Only a row
    older than the read's staleness window tells the two apart. */
async function repairArmed(t: Tick): Promise<void> {
  if (t.now - t.row.updatedAt < LATCH_POST_GRACE_MS) {
    t.result.skipped++;
    return;
  }
  await show(t, 'armed', armedVariantOf(t.row.variant), 'unresolve');
  audit(t, 'repaired');
  t.result.repaired++;
}

/** The armed banner the row last showed, so a done-comments count survives a
    repair; anything else falls back to the plain armed banner. */
function armedVariantOf(key: string | null): BannerVariant {
  const v = key ? variantOfKey(key) : null;
  return v && (v.state === 'armed' || v.state === 'done-comments')
    ? v
    : { state: 'armed' };
}

async function dispatch(
  t: Tick,
  from: 'armed' | 'queued',
  m: MrMemory
): Promise<void> {
  const { deps, rows, mr, canon, now } = t;
  const launch = await deps.launchReReview(mr.mrUrl, mr.iid);
  if (launch.kind === 'error') {
    await deps.gateway.createNote(
      mr.projectId,
      mr.iid,
      refusalReply('the pane failed to start'),
      canon.discussionId
    );
    await rearm(t, from);
    audit(t, 'launch-failed', { outcome: launch.message });
    t.result.rejected++;
    return;
  }

  // The launch already happened, so the attempt is charged before the
  // follow-up GitLab writes run: a write failing here must still count
  // against cooldown and budget, or a failing write turns into a launch
  // every tick.
  m.lastDispatchAt = now;
  m.attemptsToday++;
  const moved = rows.cas(
    mr.mrUrl,
    [from],
    { phase: 'running', launchAt: now, wait: null },
    now,
    { discussionId: canon.discussionId }
  );
  if (moved) await show(t, 'running', { state: 'running' }, threadClosed(t));
  await supersede(deps, mr, canon, t.carriers);
  audit(t, 'dispatched');
  await deps.notify(
    `Follow-up review started on !${mr.iid}`,
    'The author asked for a follow-up review',
    mr.mrUrl
  );
  t.result.dispatched++;
}

async function queue(t: Tick, wait: WaitReason): Promise<void> {
  const moved = t.rows.cas(
    t.mr.mrUrl,
    ['armed'],
    { phase: 'queued', wait },
    t.now,
    { discussionId: t.canon.discussionId }
  );
  if (!moved) {
    t.result.skipped++;
    return;
  }
  await show(t, 'queued', { state: 'queued', wait }, threadClosed(t));
  await supersede(t.deps, t.mr, t.canon, t.carriers);
  audit(t, 'queued', { reason: wait });
  t.result.queued++;
}

/** A refusal that never clears by itself: say why, then hand the latch back. */
async function refuse(
  t: Tick,
  from: 'armed' | 'queued',
  reason: string
): Promise<void> {
  const { deps, mr, canon } = t;
  await deps.gateway.createNote(
    mr.projectId,
    mr.iid,
    refusalReply(reason),
    canon.discussionId
  );
  await rearm(t, from);
  await deps.notify(
    `Follow-up review skipped on !${mr.iid}`,
    plainReason(reason, t.policy),
    mr.mrUrl
  );
  t.result.rejected++;
}

async function rearm(t: Tick, from: 'armed' | 'queued'): Promise<void> {
  if (from === 'armed') return consume(t.deps, t.mr, t.canon, t.carriers);
  const moved = t.rows.cas(
    t.mr.mrUrl,
    [from],
    { phase: 'armed', wait: null },
    t.now,
    { discussionId: t.canon.discussionId }
  );
  if (moved) await show(t, 'armed', { state: 'armed' }, 'unresolve');
  await supersede(t.deps, t.mr, t.canon, t.carriers);
}

/** Queued and running latches sit on a resolved thread; a request carried by
    an extra copy leaves the canon open until the rewrite closes it. */
function threadClosed(t: Tick): 'keep' | 'resolve' {
  return t.canon.resolved ? 'keep' : 'resolve';
}

function show(
  t: Tick,
  phase: LatchPhase,
  variant: BannerVariant,
  thread: 'resolve' | 'unresolve' | 'keep'
): Promise<void> {
  return rewriteLatch(
    t.deps.gateway,
    t.target,
    phase,
    variant,
    thread,
    t.now,
    t.deps.db
  );
}

function memoryFor(t: Tick): MrMemory {
  const m = rollDay(
    t.deps.memory.mrs[t.mr.mrUrl] ?? emptyMrMemory(t.dayStamp),
    t.dayStamp
  );
  t.deps.memory.mrs[t.mr.mrUrl] = m;
  return m;
}

function requestOf(t: Tick): ReReviewRequest {
  return {
    mrUrl: t.mr.mrUrl,
    iid: t.mr.iid,
    source: 'latch',
    receivedAt: null,
    handled: false,
  };
}

function audit(
  t: Tick,
  action: string,
  extra: Pick<AuditEntry, 'reason' | 'outcome'> = {}
): void {
  t.deps.appendAudit({
    ts: t.now,
    mrUrl: t.mr.mrUrl,
    iid: t.mr.iid,
    event: 'latch',
    action,
    ...extra,
  });
}

function auditDecision(
  t: Tick,
  decision: { action: string; reason: string },
  m: MrMemory
): void {
  t.deps.appendAudit({
    ts: t.now,
    mrUrl: t.mr.mrUrl,
    iid: t.mr.iid,
    event: 'latch',
    decision: decision.action,
    reason: decision.reason,
    attempt: m.attemptsToday + 1,
  });
}

/** Rearm the canonical latch and spend every OTHER copy carrying the request.
    Consuming the extras is what stops the request bit re-firing on the next
    re-entry into scope. */
async function consume(
  deps: LatchPassDeps,
  mr: LatchMrFacts,
  canon: LatchRef,
  carriers: LatchRef[]
): Promise<void> {
  if (canon.resolved) {
    await deps.gateway.unresolveDiscussion(
      mr.projectPath,
      mr.iid,
      canon.discussionId
    );
  }
  await supersede(deps, mr, canon, carriers);
}

/** Spend every request carrier but the canon. "superseded", not approved: the
    canon carries the request on, so these copies go defunct rather than
    recording a verdict that did not happen. */
async function supersede(
  deps: LatchPassDeps,
  mr: LatchMrFacts,
  canon: LatchRef,
  carriers: LatchRef[]
): Promise<void> {
  for (const c of carriers) {
    if (c.discussionId === canon.discussionId) continue;
    await spendLatch(
      deps.gateway,
      mr.projectId,
      mr.projectPath,
      mr.mrUrl,
      mr.iid,
      c,
      { state: 'superseded' },
      deps.now(),
      deps.db
    );
  }
}

/** Terminal disposal of every copy of this reviewer's latch once they approve. */
async function spendAll(
  deps: LatchPassDeps,
  mr: LatchMrFacts,
  latches: LatchRef[]
): Promise<void> {
  await spendAllLatches(
    deps.gateway,
    mr.projectId,
    mr.projectPath,
    mr.mrUrl,
    mr.iid,
    latches,
    { state: 'approved' },
    deps.now(),
    deps.db
  );
}

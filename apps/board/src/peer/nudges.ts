import { Database } from 'bun:sqlite';

import { getStateDb, persistOrWarn, runCriticalWrite } from '../state/index.ts';
import { ASK_HISTORY_MS } from './ask-inbox.ts';
import type { AskKind, NudgeResult } from './envelope.ts';

/** An inbound review ask, materialized from a peer's envelope. `kind` is
    absent on re-review asks (and on rows written before first-look asks
    existed); only first-look asks carry 'review'. */
export interface NudgeState {
  id: string;
  mrUrl: string;
  iid: number;
  from: string;
  note?: string;
  receivedAt: number;
  /** This board's own clock when the ask was materialized, comparable with
      ReviewState.runStartedAt where the relay's receivedAt is not. */
  materializedAt?: number;
  kind?: AskKind;
  title?: string;
  sourceBranch?: string;
  /** Set once the desktop notification for this ask has fired. */
  notifiedAt?: number;
  handled?: {
    at: number;
    result: NudgeResult;
    reason?: string;
    note?: string;
    declined?: true;
  };
}

/** Insert an inbound nudge. INSERT OR IGNORE, since at-least-once delivery
    from the switchboard means the same nudge can arrive more than once, and
    the first arrival wins. */
export function writeNudge(n: NudgeState, db: Database = getStateDb()): void {
  runCriticalWrite('nudge write', () => {
    db.query(
      'INSERT OR IGNORE INTO nudges (id, nudge, updated_at) VALUES (?, ?, ?)'
    ).run(n.id, JSON.stringify(n), Date.now());
  });
}

/** Read all inbound nudges. */
export function readNudges(db: Database = getStateDb()): NudgeState[] {
  const rows = db.query('SELECT nudge FROM nudges').all() as {
    nudge: string;
  }[];
  const out: NudgeState[] = [];
  for (const row of rows) {
    try {
      const n = JSON.parse(row.nudge) as NudgeState;
      if (n.id) out.push(n);
    } catch {
      continue;
    }
  }
  return out;
}

function readNudgeRow(id: string, db: Database): NudgeState | null {
  const row = db.query('SELECT nudge FROM nudges WHERE id = ?').get(id) as {
    nudge: string;
  } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.nudge) as NudgeState;
  } catch {
    return null;
  }
}

function writeNudgeRow(
  next: NudgeState,
  now: number,
  label: string,
  db: Database
): void {
  runCriticalWrite(label, () => {
    db.query('UPDATE nudges SET nudge = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(next),
      now,
      next.id
    );
  });
}

/** Read-merge-write a nudge's handled outcome. No-op if no row exists for
    this id. */
export function markNudgeHandled(
  id: string,
  result: NudgeResult,
  reason?: string,
  db: Database = getStateDb(),
  now: number = Date.now(),
  opts: { note?: string; declined?: true } = {}
): void {
  const prev = readNudgeRow(id, db);
  if (!prev) return;
  writeNudgeRow(
    {
      ...prev,
      handled: {
        at: now,
        result,
        ...(reason ? { reason } : {}),
        ...(opts.note ? { note: opts.note } : {}),
        ...(opts.declined ? { declined: true as const } : {}),
      },
    },
    now,
    'nudge handled write',
    db
  );
}

/** Record that the desktop notification for this ask has fired. No-op if no
    row exists for this id. */
export function markNudgeNotified(
  id: string,
  db: Database = getStateDb(),
  now: number = Date.now()
): void {
  const prev = readNudgeRow(id, db);
  if (!prev) return;
  writeNudgeRow({ ...prev, notifiedAt: now }, now, 'nudge notified write', db);
}

/** Delete stale inbound nudges. Handled history outlives its MR for
    ASK_HISTORY_MS, and a waiting ask need not be on this board, so it goes
    only once it is that old too. `keepUrls` is the current board MR set;
    callers gate this on a healthy snapshot so a failed fetch can't wipe live
    state. */
export function pruneNudges(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb(),
  now: number = Date.now()
): void {
  const stale = readNudges(db).filter(n =>
    n.handled
      ? now - n.handled.at > ASK_HISTORY_MS
      : !keepUrls.has(n.mrUrl) && now - n.receivedAt > ASK_HISTORY_MS
  );
  if (stale.length === 0) return;
  persistOrWarn('nudge prune', () => {
    const tx = db.transaction(() => {
      for (const n of stale) {
        db.query('DELETE FROM nudges WHERE id = ?').run(n.id);
      }
    });
    tx();
  });
}

/** A nudge this board sent out, and how the recipient board eventually
    resolved it. */
export interface SentNudge {
  nudgeId: string;
  mrUrl: string;
  iid: number;
  reviewer: string;
  sentAt: number;
  /** Absent means re-review (also on rows from before first-look asks). */
  kind?: AskKind;
  resolution?: SentNudgeResolution;
}

export interface SentNudgeResolution {
  result: NudgeResult | 'confirmed' | 'done' | 'failed';
  reason?: string;
  /** The finished run's verdict word ('comment', 'approve'), on 'done'. */
  outcome?: string;
  at: number;
  declined?: true;
  declineNote?: string;
}

/** Write a sent nudge, replacing any prior row for the same MR -- a board
    only ever has one outstanding sent nudge per MR. */
export function writeSentNudge(
  n: SentNudge,
  db: Database = getStateDb()
): void {
  runCriticalWrite('sent nudge write', () => {
    db.query(
      `INSERT INTO nudges_sent (mr_url, nudge, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(mr_url) DO UPDATE SET nudge = excluded.nudge, updated_at = excluded.updated_at`
    ).run(n.mrUrl, JSON.stringify(n), Date.now());
  });
}

/** Read all sent nudges, keyed by mrUrl. */
export function readSentNudges(
  db: Database = getStateDb()
): Map<string, SentNudge> {
  const rows = db.query('SELECT mr_url, nudge FROM nudges_sent').all() as {
    mr_url: string;
    nudge: string;
  }[];
  const out = new Map<string, SentNudge>();
  for (const row of rows) {
    try {
      out.set(row.mr_url, JSON.parse(row.nudge) as SentNudge);
    } catch {
      // skip unreadable row
    }
  }
  return out;
}

function readSentNudgeRow(mrUrl: string, db: Database): SentNudge | null {
  const row = db
    .query('SELECT nudge FROM nudges_sent WHERE mr_url = ?')
    .get(mrUrl) as { nudge: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.nudge) as SentNudge;
  } catch {
    return null;
  }
}

/** Read-merge-write a sent nudge's resolution. Silently returns when no row
    exists for this MR (a stale or duplicate delivery). Only a `confirmed`
    resolution may be replaced, and a `launched` one only by a fresh
    `confirmed`, so progress keeps resetting the quiet clock. */
export function resolveSentNudge(
  mrUrl: string,
  resolution: SentNudgeResolution,
  db: Database = getStateDb(),
  reviewer?: string
): void {
  runCriticalWrite('sent nudge resolve', () => {
    const tx = db.transaction(() => {
      const prev = readSentNudgeRow(mrUrl, db);
      if (!prev) return;
      if (reviewer !== undefined && prev.reviewer !== reviewer) return;
      const was = prev.resolution?.result;
      const refreshesLaunch =
        was === 'launched' && resolution.result === 'confirmed';
      if (resolution.result === 'pending' && was) return;
      if (was && was !== 'confirmed' && was !== 'pending' && !refreshesLaunch)
        return;
      const next: SentNudge = { ...prev, resolution };
      db.query(
        'UPDATE nudges_sent SET nudge = ?, updated_at = ? WHERE mr_url = ?'
      ).run(JSON.stringify(next), Date.now(), mrUrl);
    });
    tx();
  });
}

/** How long a finished ask (done or failed) stays on the row before it
    clears itself. */
export const SENT_FINISH_KEEP_MS = 24 * 60 * 60_000;

/** Mark a sent ask finished, `done` or `failed`, and keep it on the row so
    the asker can read the result. Correlation, in preference order: a
    `nudgeId` pins the finishing report to one exact ask (no clocks
    involved); without one, the `ifSentBefore` guard ignores a finishing
    report older than the ask -- at-least-once delivery means a peer's
    pre-nudge "done" can arrive after a fresh ask went out. The timestamp
    fallback compares two boards' clocks, so skew can hold a finished ask
    open until it self-expires; peers that echo the id back never hit that.
    Only an unresolved, confirmed or launched ask finishes, and a failed one
    only to done (a reviewer who resumed a stopped run); a rejected, expired
    or done one keeps its first verdict. `reviewer`, when
    given, is who sent the report: another teammate's review of the same MR
    is not the answer to this ask. */
export function finishSentNudge(
  mrUrl: string,
  finish: Pick<SentNudgeResolution, 'outcome' | 'reason' | 'at'> & {
    result: 'done' | 'failed';
  },
  ifSentBefore: number,
  db: Database = getStateDb(),
  nudgeId?: string,
  reviewer?: string
): void {
  persistOrWarn('sent nudge finish', () => {
    const tx = db.transaction(() => {
      const prev = readSentNudgeRow(mrUrl, db);
      if (!prev) return;
      if (reviewer !== undefined && prev.reviewer !== reviewer) return;
      if (nudgeId !== undefined) {
        if (prev.nudgeId !== nudgeId) return;
      } else if (prev.sentAt >= ifSentBefore) return;
      const r = prev.resolution?.result;
      const doneAfterStop = r === 'failed' && finish.result === 'done';
      if (
        r &&
        r !== 'confirmed' &&
        r !== 'launched' &&
        r !== 'pending' &&
        !doneAfterStop
      )
        return;
      const next: SentNudge = { ...prev, resolution: finish };
      db.query(
        'UPDATE nudges_sent SET nudge = ?, updated_at = ? WHERE mr_url = ?'
      ).run(JSON.stringify(next), Date.now(), mrUrl);
    });
    tx();
  });
}

/** Drop a sent ask from the row outright: the asker's dismiss. */
export function dismissSentNudge(
  mrUrl: string,
  db: Database = getStateDb()
): void {
  persistOrWarn('sent nudge dismiss', () => {
    db.query('DELETE FROM nudges_sent WHERE mr_url = ?').run(mrUrl);
  });
}

/** A finished ask past its keep window: off the row, awaiting a prune. */
export function isFinishedStale(n: SentNudge, now: number): boolean {
  const r = n.resolution;
  if (!r || (r.result !== 'done' && r.result !== 'failed')) return false;
  return now - r.at > SENT_FINISH_KEEP_MS;
}

/** Delete finished asks older than SENT_FINISH_KEEP_MS. */
export function pruneFinishedSentNudges(
  now: number = Date.now(),
  db: Database = getStateDb()
): void {
  const stale = [...readSentNudges(db).values()].filter(n =>
    isFinishedStale(n, now)
  );
  if (stale.length === 0) return;
  persistOrWarn('sent nudge finished prune', () => {
    const tx = db.transaction(() => {
      for (const n of stale) {
        db.query('DELETE FROM nudges_sent WHERE mr_url = ?').run(n.mrUrl);
      }
    });
    tx();
  });
}

/** Delete sent nudges whose MR is no longer on the board. */
export function pruneSentNudges(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const rows = db.query('SELECT mr_url FROM nudges_sent').all() as {
    mr_url: string;
  }[];
  const stale = rows.filter(row => !keepUrls.has(row.mr_url));
  if (stale.length === 0) return;
  persistOrWarn('sent nudge prune', () => {
    const tx = db.transaction(() => {
      for (const row of stale) {
        db.query('DELETE FROM nudges_sent WHERE mr_url = ?').run(row.mr_url);
      }
    });
    tx();
  });
}

/** The roster's name for a sent ask's reviewer. Roster usernames keep the case
    they were configured in; a sent ask's reviewer is canonical (lowercase). */
export function reviewerDisplayName(
  reviewer: string,
  members: ReadonlyArray<{ username: string; name?: string | null }>,
  memberNames: ReadonlyMap<string, string | null>
): string | undefined {
  const member = members.find(
    m => m.username.trim().toLowerCase() === reviewer
  );
  if (!member) return undefined;
  return memberNames.get(member.username) ?? member.name ?? undefined;
}

/** The board payload's view of a sent ask, or null once a finished one has
    outlived its keep window. */
export interface SentNudgeView {
  display: SentNudgeDisplay;
  reviewer: string;
  reviewerName?: string;
  kind?: AskKind;
  sentAt: number;
  reason?: string;
  outcome?: string;
  declined?: true;
  declineNote?: string;
  resolvedAt?: number;
  finishedAt?: number;
}

export function sentNudgeView(n: SentNudge, now: number): SentNudgeView | null {
  if (isFinishedStale(n, now)) return null;
  const r = n.resolution;
  const finished = r?.result === 'done' || r?.result === 'failed';
  return {
    display: sentNudgeDisplay(n, now),
    reviewer: n.reviewer,
    kind: n.kind,
    sentAt: n.sentAt,
    ...(r?.reason ? { reason: r.reason } : {}),
    ...(r?.outcome ? { outcome: r.outcome } : {}),
    ...(r?.declined ? { declined: true as const } : {}),
    ...(r?.declineNote ? { declineNote: r.declineNote } : {}),
    ...(r ? { resolvedAt: r.at } : {}),
    ...(finished && r ? { finishedAt: r.at } : {}),
  };
}

/** A sent nudge stays visible for this long with no board-to-board response
    before the chip self-expires to "no-response" in the UI. */
export const NUDGE_NO_RESPONSE_MS = 48 * 60 * 60_000;

/** A launched or confirmed ask with nothing heard for this long reads
    "no-update" on the row, without a write. */
export const NUDGE_QUIET_MS = 30 * 60_000;

export type SentNudgeDisplay =
  | 'requested'
  | 'confirmed'
  | 'pending'
  | 'launched'
  | 'no-update'
  | 'rejected'
  | 'expired'
  | 'no-response'
  | 'done'
  | 'failed';

/** A launched or confirmed ask quiet for over 30 minutes reads "no-update".
    An unanswered ask reads "requested" until 48 hours elapse, then
    "no-response". Both transitions need no write. */
export function sentNudgeDisplay(n: SentNudge, now: number): SentNudgeDisplay {
  const r = n.resolution;
  if (r) {
    if (r.result === 'pending')
      return now - r.at > NUDGE_NO_RESPONSE_MS ? 'no-response' : 'pending';
    const running = r.result === 'launched' || r.result === 'confirmed';
    return running && now - r.at > NUDGE_QUIET_MS ? 'no-update' : r.result;
  }
  return now - n.sentAt > NUDGE_NO_RESPONSE_MS ? 'no-response' : 'requested';
}

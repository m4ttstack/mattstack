import { Database } from 'bun:sqlite';

import { getStateDb, persistOrWarn, runCriticalWrite } from '../state/index.ts';
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
  kind?: AskKind;
  handled?: { at: number; result: NudgeResult; reason?: string };
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

export interface PendingNudge {
  from: string;
  receivedAt: number;
  kind?: AskKind;
  /** Triage is off, so nothing starts this ask until someone clicks. */
  awaitsClick?: true;
}

/** The asks still awaiting a decision, keyed by MR. Handled ones stay on
    disk for the outcome trail but are off the board. */
export function pendingNudgesByMr(
  nudges: NudgeState[],
  triageEnabled: boolean
): Map<string, PendingNudge[]> {
  const byMr = new Map<string, PendingNudge[]>();
  for (const n of nudges) {
    if (n.handled) continue;
    const entry: PendingNudge = {
      from: n.from,
      receivedAt: n.receivedAt,
      kind: n.kind,
      ...(triageEnabled ? {} : { awaitsClick: true as const }),
    };
    const list = byMr.get(n.mrUrl);
    if (list) list.push(entry);
    else byMr.set(n.mrUrl, [entry]);
  }
  return byMr;
}

/** Read-merge-write a nudge's handled outcome. No-op if no row exists for
    this id. */
export function markNudgeHandled(
  id: string,
  result: NudgeResult,
  reason?: string,
  db: Database = getStateDb(),
  now: number = Date.now()
): void {
  const row = db.query('SELECT nudge FROM nudges WHERE id = ?').get(id) as {
    nudge: string;
  } | null;
  if (!row) return;
  let prev: NudgeState;
  try {
    prev = JSON.parse(row.nudge) as NudgeState;
  } catch {
    return;
  }
  const next: NudgeState = { ...prev, handled: { at: now, result, reason } };
  runCriticalWrite('nudge handled write', () => {
    db.query('UPDATE nudges SET nudge = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(next),
      now,
      id
    );
  });
}

/** Delete inbound nudges whose MR is no longer on the board. `keepUrls` is
    the current board MR set; callers gate this on a healthy snapshot so a
    failed fetch can't wipe live state. */
export function pruneNudges(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const nudges = readNudges(db);
  const stale = nudges.filter(n => !keepUrls.has(n.mrUrl));
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
    exists for this MR -- an outcome for a nudge this board never sent (e.g.
    a stale/duplicate delivery). An existing terminal resolution ("launched" /
    "rejected" / "expired") is never overwritten; only a "confirmed"
    resolution may be replaced, since confirmation is a provisional ack, not
    the final word. */
export function resolveSentNudge(
  mrUrl: string,
  resolution: SentNudgeResolution,
  db: Database = getStateDb()
): void {
  runCriticalWrite('sent nudge resolve', () => {
    const tx = db.transaction(() => {
      const prev = readSentNudgeRow(mrUrl, db);
      if (!prev) return;
      if (prev.resolution && prev.resolution.result !== 'confirmed') return;
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
    Only an unresolved, confirmed or launched ask finishes: a rejected,
    expired or already finished one keeps its first verdict. */
export function finishSentNudge(
  mrUrl: string,
  finish: Pick<SentNudgeResolution, 'outcome' | 'reason' | 'at'> & {
    result: 'done' | 'failed';
  },
  ifSentBefore: number,
  db: Database = getStateDb(),
  nudgeId?: string
): void {
  persistOrWarn('sent nudge finish', () => {
    const tx = db.transaction(() => {
      const prev = readSentNudgeRow(mrUrl, db);
      if (!prev) return;
      if (nudgeId !== undefined) {
        if (prev.nudgeId !== nudgeId) return;
      } else if (prev.sentAt >= ifSentBefore) return;
      const r = prev.resolution?.result;
      if (r && r !== 'confirmed' && r !== 'launched') return;
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

/** The board payload's view of a sent ask, or null once a finished one has
    outlived its keep window. */
export interface SentNudgeView {
  display: SentNudgeDisplay;
  reviewer: string;
  kind?: AskKind;
  sentAt: number;
  reason?: string;
  outcome?: string;
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
    ...(r ? { resolvedAt: r.at } : {}),
    ...(finished && r ? { finishedAt: r.at } : {}),
  };
}

/** A sent nudge stays visible for this long with no board-to-board response
    before the chip self-expires to "no-response" in the UI. */
export const NUDGE_NO_RESPONSE_MS = 48 * 60 * 60_000;

export type SentNudgeDisplay =
  | 'requested'
  | 'confirmed'
  | 'launched'
  | 'rejected'
  | 'expired'
  | 'no-response'
  | 'done'
  | 'failed';

/** How a sent nudge should render right now. Resolution wins outright;
    otherwise it's "requested" until NUDGE_NO_RESPONSE_MS elapses, then the
    chip self-expires to "no-response" without needing a write. */
export function sentNudgeDisplay(n: SentNudge, now: number): SentNudgeDisplay {
  if (n.resolution) return n.resolution.result;
  return now - n.sentAt > NUDGE_NO_RESPONSE_MS ? 'no-response' : 'requested';
}

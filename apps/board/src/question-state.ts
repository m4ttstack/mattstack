import { createHash } from 'crypto';
import { join } from 'path';
import { Database } from 'bun:sqlite';

import type { ReportFinding } from './review-finding.ts';
import type { SheetDraft } from './sheet-draft-shape.ts';
import {
  definedFields,
  FRESH_RUN_PANE,
  slug,
  type PaneClearable,
} from './state/agent-states.ts';
import { boardStateRoot, getStateDb } from './state/db.ts';

export type QuestionStatus = 'queued' | 'live' | 'done' | 'error';

export interface QuestionState {
  mrUrl: string;
  iid: number;
  findingId: string;
  gateId: string;
  status: QuestionStatus;
  agentId?: string;
  paneId?: string;
  tabId?: string;
  workspaceId?: string;
  message?: string;
  /** When the row was last written: the table's `updated_at`, set on every
      row read back and never stored in the state json. */
  updatedAt?: number;
}

/** How long a launch may sit `queued` before the board stops waiting on it.
    The route answers before the pane comes up, and a board that restarts
    mid-launch never writes the outcome, so without a bound such a row would
    hold the review gate off parking and show a dead pill forever. Past it
    the row counts as neither running nor live, and the writer's sweep marks
    it an error (`expireStaleQueuedQuestions`). */
export const QUEUED_TTL_MS = 5 * 60_000;

/** Whether a row still holds its finding's question open: `live`, or
    `queued` and inside QUEUED_TTL_MS. */
export function questionRunning(q: QuestionState, now: number): boolean {
  if (q.status === 'live') return true;
  if (q.status !== 'queued') return false;
  return q.updatedAt === undefined || now - q.updatedAt <= QUEUED_TTL_MS;
}

/** Deterministic handle for one finding's question row, so a repeat ask
    resolves the same row. The hash keeps two ids that slug alike ('f 1/x',
    'f-1-x') from sharing a handle, which is unique in the table. The path
    is only the row's identity; nothing is written there. */
export function questionHandle(
  mrUrl: string,
  findingId: string,
  root: string = boardStateRoot()
): string {
  const hash = createHash('sha1').update(findingId).digest('hex').slice(0, 8);
  return join(
    root,
    'state',
    'questions',
    `${slug(mrUrl)}--${slug(findingId)}-${hash}.json`
  );
}

interface QuestionRow {
  mr_url: string;
  finding_id: string;
  state: string;
  updated_at: number;
}

function parseRow(row: QuestionRow): QuestionState {
  return {
    ...(JSON.parse(row.state) as QuestionState),
    updatedAt: row.updated_at,
  };
}

/** A question write: the pane keys and message also take null, which
    removes them (undefined leaves a key alone). */
export type QuestionPatch = Omit<
  PaneClearable<QuestionState>,
  'message' | 'updatedAt'
> & {
  message?: string | null;
};

/** Upserts a finding's question row, merging the patch into its state. */
export function writeQuestionState(
  mrUrl: string,
  findingId: string,
  patch: QuestionPatch,
  now: number = Date.now(),
  db: Database = getStateDb()
): void {
  db.transaction(() => {
    const row = db
      .query(
        'SELECT state FROM question_states WHERE mr_url = ? AND finding_id = ?'
      )
      .get(mrUrl, findingId) as { state: string } | null;
    const prev = (row ? JSON.parse(row.state) : {}) as Record<string, unknown>;
    const given = definedFields(patch) as Record<string, unknown>;
    // A message explains the status it was written with, so a status change
    // without its own message must not inherit the old one.
    if (
      given.status !== undefined &&
      given.status !== prev.status &&
      !('message' in given)
    )
      delete prev.message;
    // A queued write starts a fresh run: the dead run's pane keys must not
    // survive it (dedup would focus a dead tab, and markQuestionsGone would
    // end the new row by the old agent id) unless the patch sets them.
    if (given.status === 'queued')
      for (const k of Object.keys(FRESH_RUN_PANE)) delete prev[k];
    const next: Record<string, unknown> = {
      ...prev,
      mrUrl,
      findingId,
      ...given,
    };
    // null is the only way a write drops a key a prior run set.
    for (const [k, v] of Object.entries(given)) if (v === null) delete next[k];
    // The column is the write time; a read row spread back in must not
    // freeze a stale copy into the json.
    delete next.updatedAt;
    db.query(
      `INSERT INTO question_states (mr_url, finding_id, handle, state, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(mr_url, finding_id) DO UPDATE SET
         state = excluded.state, updated_at = excluded.updated_at`
    ).run(
      mrUrl,
      findingId,
      questionHandle(mrUrl, findingId),
      JSON.stringify(next),
      now
    );
  })();
}

/** Merges a patch into the row a handle names (the pane reports back by
    handle). False when no row has that handle. */
export function writeQuestionStateByHandle(
  handle: string,
  patch: QuestionPatch,
  now: number = Date.now(),
  db: Database = getStateDb()
): boolean {
  const row = db
    .query('SELECT mr_url, finding_id FROM question_states WHERE handle = ?')
    .get(handle) as { mr_url: string; finding_id: string } | null;
  if (!row) return false;
  writeQuestionState(row.mr_url, row.finding_id, patch, now, db);
  return true;
}

export function readQuestionByHandle(
  handle: string,
  db: Database = getStateDb()
): QuestionState | undefined {
  const row = db
    .query(
      'SELECT mr_url, finding_id, state, updated_at FROM question_states WHERE handle = ?'
    )
    .get(handle) as QuestionRow | null;
  return row ? parseRow(row) : undefined;
}

/** Every question row, keyed by MR url then finding id. */
export function readQuestionStates(
  db: Database = getStateDb()
): Map<string, Map<string, QuestionState>> {
  const rows = db
    .query('SELECT mr_url, finding_id, state, updated_at FROM question_states')
    .all() as QuestionRow[];
  const out = new Map<string, Map<string, QuestionState>>();
  for (const r of rows) {
    const byFinding = out.get(r.mr_url) ?? new Map<string, QuestionState>();
    byFinding.set(r.finding_id, parseRow(r));
    out.set(r.mr_url, byFinding);
  }
  return out;
}

/** One MR's questions as the gate sweep weighs them. */
export interface MrQuestionActivity {
  /** A question on the MR is still starting or running (`questionRunning`). */
  live: boolean;
  /** The newest write across the MR's question rows, whatever their status:
      a question ending (`done`, gone, error) stamps it too, so the review
      gate's parking grace restarts from the last question, not from when
      the gate opened. */
  lastActivityAt: number;
}

/** Every MR with a question row, with its liveness and last activity. */
export function questionActivity(
  now: number = Date.now(),
  db: Database = getStateDb()
): Map<string, MrQuestionActivity> {
  const out = new Map<string, MrQuestionActivity>();
  for (const [mrUrl, byFinding] of readQuestionStates(db)) {
    let live = false;
    let lastActivityAt = 0;
    for (const q of byFinding.values()) {
      if (questionRunning(q, now)) live = true;
      lastActivityAt = Math.max(lastActivityAt, q.updatedAt ?? 0);
    }
    out.set(mrUrl, { live, lastActivityAt });
  }
  return out;
}

/** MRs with a question still starting or running. A `queued` row past
    QUEUED_TTL_MS does not count: its launch never reported back. */
export function liveQuestionMrs(
  now: number = Date.now(),
  db: Database = getStateDb()
): Set<string> {
  const out = new Set<string>();
  for (const [mrUrl, a] of questionActivity(now, db))
    if (a.live) out.add(mrUrl);
  return out;
}

/** The writer sweep's bound on a launch: a `queued` row past QUEUED_TTL_MS
    becomes an error, so the sheet says the question never opened instead of
    showing nothing. Returns how many rows changed. */
export function expireStaleQueuedQuestions(
  now: number,
  db: Database = getStateDb()
): number {
  let count = 0;
  for (const [mrUrl, byFinding] of readQuestionStates(db)) {
    for (const q of byFinding.values()) {
      if (q.status !== 'queued' || questionRunning(q, now)) continue;
      writeQuestionState(
        mrUrl,
        q.findingId,
        { status: 'error', message: 'launch never reported back' },
        now,
        db
      );
      count++;
    }
  }
  return count;
}

/** Drops an MR's question rows and returns them, so the caller can close
    their tabs. */
export function deleteQuestionStates(
  mrUrl: string,
  db: Database = getStateDb()
): QuestionState[] {
  return db.transaction(() => {
    const rows = db
      .query(
        'SELECT mr_url, finding_id, state, updated_at FROM question_states WHERE mr_url = ?'
      )
      .all(mrUrl) as QuestionRow[];
    db.run('DELETE FROM question_states WHERE mr_url = ?', [mrUrl]);
    return rows.map(parseRow);
  })();
}

export function questionAgentIds(db: Database = getStateDb()): Set<string> {
  const out = new Set<string>();
  for (const byFinding of readQuestionStates(db).values()) {
    for (const q of byFinding.values()) if (q.agentId) out.add(q.agentId);
  }
  return out;
}

/** A queued or live row whose agent has left herdr is over: mark it done.
    Returns how many rows changed. */
export function markQuestionsGone(
  agentIds: ReadonlySet<string>,
  now: number = Date.now(),
  db: Database = getStateDb()
): number {
  let count = 0;
  for (const [mrUrl, byFinding] of readQuestionStates(db)) {
    for (const q of byFinding.values()) {
      if (
        (q.status === 'queued' || q.status === 'live') &&
        q.agentId &&
        agentIds.has(q.agentId)
      ) {
        writeQuestionState(mrUrl, q.findingId, { status: 'done' }, now, db);
        count++;
      }
    }
  }
  return count;
}

/** How long a revision may stay pending before the board stops waiting for
    the review wrapper to rebuild the gate. */
export const PENDING_REVISION_TTL_MS = 15 * 60_000;

export interface FindingRevision {
  mrUrl: string;
  findingId: string;
  original: ReportFinding;
  /** Null when the revision drops the finding. */
  revised: ReportFinding | null;
  status: 'pending' | 'applied' | 'failed';
  closedGate: string;
  newGate?: string;
  createdAt: number;
}

interface RevisionRow {
  mr_url: string;
  finding_id: string;
  original: string;
  revised: string | null;
  status: FindingRevision['status'];
  closed_gate: string;
  new_gate: string | null;
  created_at: number;
}

function parseRevision(r: RevisionRow): FindingRevision {
  return {
    mrUrl: r.mr_url,
    findingId: r.finding_id,
    original: JSON.parse(r.original) as ReportFinding,
    revised:
      r.revised === null ? null : (JSON.parse(r.revised) as ReportFinding),
    status: r.status,
    closedGate: r.closed_gate,
    ...(r.new_gate === null ? {} : { newGate: r.new_gate }),
    createdAt: r.created_at,
  };
}

export function insertPendingRevision(
  r: Omit<FindingRevision, 'status' | 'newGate'>,
  db: Database = getStateDb()
): void {
  db.run(
    `INSERT INTO finding_revisions
       (mr_url, finding_id, original, revised, status, closed_gate, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    [
      r.mrUrl,
      r.findingId,
      JSON.stringify(r.original),
      r.revised === null ? null : JSON.stringify(r.revised),
      r.closedGate,
      r.createdAt,
    ]
  );
}

/** Claims the MR's one pending-revision slot: checks for a live pending row
    and inserts this one in a single IMMEDIATE transaction, so two panes
    sending at once (separate processes, one db) cannot both win. False when
    a pending revision already holds the slot; nothing is written then. */
export function claimPendingRevision(
  r: Omit<FindingRevision, 'status' | 'newGate'>,
  now: number,
  db: Database = getStateDb()
): boolean {
  return db
    .transaction(() => {
      if (pendingRevision(r.mrUrl, now, db)) return false;
      insertPendingRevision(r, db);
      return true;
    })
    .immediate();
}

/** The newest pending revision on the MR that is still inside the TTL. */
export function pendingRevision(
  mrUrl: string,
  now: number,
  db: Database = getStateDb()
): FindingRevision | undefined {
  const row = db
    .query(
      `SELECT * FROM finding_revisions
       WHERE mr_url = ? AND status = 'pending' AND created_at > ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(mrUrl, now - PENDING_REVISION_TTL_MS) as RevisionRow | null;
  return row ? parseRevision(row) : undefined;
}

/** The rebuilt gate is up: every pending revision on the MR landed in it. */
export function markRevisionsApplied(
  mrUrl: string,
  newGate: string,
  db: Database = getStateDb()
): void {
  db.run(
    `UPDATE finding_revisions SET status = 'applied', new_gate = ?
     WHERE mr_url = ? AND status = 'pending'`,
    [newGate, mrUrl]
  );
}

/** The newest applied revision per finding. */
export function latestRevisions(
  mrUrl: string,
  db: Database = getStateDb()
): Map<string, FindingRevision> {
  const rows = db
    .query(
      `SELECT * FROM finding_revisions
       WHERE mr_url = ? AND status = 'applied' ORDER BY created_at ASC`
    )
    .all(mrUrl) as RevisionRow[];
  const out = new Map<string, FindingRevision>();
  for (const r of rows) out.set(r.finding_id, parseRevision(r));
  return out;
}

export function deleteRevisions(
  mrUrl: string,
  db: Database = getStateDb()
): void {
  db.run('DELETE FROM finding_revisions WHERE mr_url = ?', [mrUrl]);
}

/** Drops one revision, for a launch whose gate close failed. */
export function deleteRevision(
  mrUrl: string,
  findingId: string,
  createdAt: number,
  db: Database = getStateDb()
): void {
  db.run(
    'DELETE FROM finding_revisions WHERE mr_url = ? AND finding_id = ? AND created_at = ?',
    [mrUrl, findingId, createdAt]
  );
}

export type { SheetDraft };

export function readSheetDraft(
  mrUrl: string,
  db: Database = getStateDb()
): SheetDraft | undefined {
  const row = db
    .query('SELECT draft FROM review_sheet_drafts WHERE mr_url = ?')
    .get(mrUrl) as { draft: string } | null;
  return row ? (JSON.parse(row.draft) as SheetDraft) : undefined;
}

export function writeSheetDraft(
  mrUrl: string,
  d: SheetDraft,
  now: number = Date.now(),
  db: Database = getStateDb()
): void {
  db.run(
    `INSERT INTO review_sheet_drafts (mr_url, draft, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(mr_url) DO UPDATE SET
       draft = excluded.draft, updated_at = excluded.updated_at`,
    [mrUrl, JSON.stringify(d), now]
  );
}

export function deleteSheetDraft(
  mrUrl: string,
  db: Database = getStateDb()
): void {
  db.run('DELETE FROM review_sheet_drafts WHERE mr_url = ?', [mrUrl]);
}

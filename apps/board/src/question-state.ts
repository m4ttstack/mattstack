import { createHash } from 'crypto';
import { join } from 'path';
import { Database } from 'bun:sqlite';

import type { ReportFinding } from './review-finding.ts';
import { slug } from './state/agent-states.ts';
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
}

function parseRow(row: QuestionRow): QuestionState {
  return JSON.parse(row.state) as QuestionState;
}

function definedFields(patch: object): object {
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  );
}

/** Upserts a finding's question row, merging the patch into its state. */
export function writeQuestionState(
  mrUrl: string,
  findingId: string,
  patch: Partial<QuestionState>,
  now: number = Date.now(),
  db: Database = getStateDb()
): void {
  db.transaction(() => {
    const row = db
      .query(
        'SELECT state FROM question_states WHERE mr_url = ? AND finding_id = ?'
      )
      .get(mrUrl, findingId) as { state: string } | null;
    const prev = row ? (JSON.parse(row.state) as object) : {};
    const next = { ...prev, mrUrl, findingId, ...definedFields(patch) };
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
  patch: Partial<QuestionState>,
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
      'SELECT mr_url, finding_id, state FROM question_states WHERE handle = ?'
    )
    .get(handle) as QuestionRow | null;
  return row ? parseRow(row) : undefined;
}

/** Every question row, keyed by MR url then finding id. */
export function readQuestionStates(
  db: Database = getStateDb()
): Map<string, Map<string, QuestionState>> {
  const rows = db
    .query('SELECT mr_url, finding_id, state FROM question_states')
    .all() as QuestionRow[];
  const out = new Map<string, Map<string, QuestionState>>();
  for (const r of rows) {
    const byFinding = out.get(r.mr_url) ?? new Map<string, QuestionState>();
    byFinding.set(r.finding_id, parseRow(r));
    out.set(r.mr_url, byFinding);
  }
  return out;
}

/** MRs with a question still starting or running. */
export function liveQuestionMrs(db: Database = getStateDb()): Set<string> {
  const out = new Set<string>();
  for (const [mrUrl, byFinding] of readQuestionStates(db)) {
    for (const q of byFinding.values()) {
      if (q.status === 'queued' || q.status === 'live') out.add(mrUrl);
    }
  }
  return out;
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
        'SELECT mr_url, finding_id, state FROM question_states WHERE mr_url = ?'
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

/** Pending revisions that never got a rebuilt gate become failed. */
export function expireStaleRevisions(
  now: number,
  db: Database = getStateDb()
): number {
  return db.run(
    `UPDATE finding_revisions SET status = 'failed'
     WHERE status = 'pending' AND created_at <= ?`,
    [now - PENDING_REVISION_TTL_MS]
  ).changes;
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

/** The review sheet's unsent state: which findings are ticked, their
    editable texts, the chosen outcome and per-finding notes. */
export interface SheetDraft {
  ticked: string[];
  texts: Record<string, string>;
  outcome?: string;
  notes: Record<string, string>;
}

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

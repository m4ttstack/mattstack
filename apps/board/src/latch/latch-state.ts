import { Database } from 'bun:sqlite';

import { getStateDb } from '../state/index.ts';

export type LatchPhase = 'armed' | 'queued' | 'running' | 'error' | 'spent';
export type WaitReason =
  'next-sweep' | 'cooldown' | 'budget' | 'review-in-flight';

export interface LatchRow {
  mrUrl: string;
  discussionId: string;
  rootNoteId: number;
  phase: LatchPhase;
  wait: WaitReason | null;
  /** ms; the follow-up this latch waits on started at or after this. */
  launchAt: number | null;
  failures: number;
  stuck: boolean;
  /** variantKey of the banner last written to the note. */
  variant: string | null;
  /** The reply this latch still owes its discussion, verbatim. GitLab emails
      new notes, never edits, so the reply is the author's only notice. */
  replyDue: string | null;
  updatedAt: number;
}

interface LatchRecord {
  mr_url: string;
  discussion_id: string;
  root_note_id: number;
  phase: LatchPhase;
  wait: WaitReason | null;
  launch_at: number | null;
  failures: number;
  stuck: number;
  variant: string | null;
  reply_due: string | null;
  updated_at: number;
}

const COLUMNS: Record<keyof Omit<LatchRow, 'mrUrl'>, string> = {
  discussionId: 'discussion_id',
  rootNoteId: 'root_note_id',
  phase: 'phase',
  wait: 'wait',
  launchAt: 'launch_at',
  failures: 'failures',
  stuck: 'stuck',
  variant: 'variant',
  replyDue: 'reply_due',
  updatedAt: 'updated_at',
};

function toRow(r: LatchRecord): LatchRow {
  return {
    mrUrl: r.mr_url,
    discussionId: r.discussion_id,
    rootNoteId: r.root_note_id,
    phase: r.phase,
    wait: r.wait,
    launchAt: r.launch_at,
    failures: r.failures,
    stuck: r.stuck !== 0,
    variant: r.variant,
    replyDue: r.reply_due,
    updatedAt: r.updated_at,
  };
}

export function readLatchRow(
  mrUrl: string,
  db: Database = getStateDb()
): LatchRow | null {
  const r = db
    .query('SELECT * FROM latch_state WHERE mr_url = ?')
    .get(mrUrl) as LatchRecord | null;
  return r ? toRow(r) : null;
}

export function readLatchRows(db: Database = getStateDb()): LatchRow[] {
  return (
    db.query('SELECT * FROM latch_state ORDER BY mr_url').all() as LatchRecord[]
  ).map(toRow);
}

/** Inserts or replaces the row; for adoption and first post only. */
export function putLatchRow(row: LatchRow, db: Database = getStateDb()): void {
  db.run(
    `INSERT OR REPLACE INTO latch_state
       (mr_url, discussion_id, root_note_id, phase, wait, launch_at,
        failures, stuck, variant, reply_due, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.mrUrl,
      row.discussionId,
      row.rootNoteId,
      row.phase,
      row.wait,
      row.launchAt,
      row.failures,
      row.stuck ? 1 : 0,
      row.variant,
      row.replyDue,
      row.updatedAt,
    ]
  );
}

/** Clears the reply owed once it posted, only while the row still owes that
    same reply on that discussion; true when it cleared. */
export function clearReplyDue(
  mrUrl: string,
  discussionId: string,
  body: string,
  db: Database = getStateDb()
): boolean {
  const result = db.run(
    `UPDATE latch_state SET reply_due = NULL
     WHERE mr_url = ? AND discussion_id = ? AND reply_due = ?`,
    [mrUrl, discussionId, body]
  );
  return result.changes > 0;
}

/** Applies `patch` only while the row's phase is in `from` (and, with
    `discussionId`, only while the row tracks that latch); true when it moved. */
export function casLatch(
  mrUrl: string,
  from: LatchPhase[],
  patch: Partial<Omit<LatchRow, 'mrUrl'>>,
  now: number,
  db: Database = getStateDb(),
  opts: { discussionId?: string } = {}
): boolean {
  if (from.length === 0) return false;
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  for (const key of Object.keys(COLUMNS) as Array<keyof typeof COLUMNS>) {
    if (key === 'updatedAt' || !(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${COLUMNS[key]} = ?`);
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? null));
  }
  sets.push('updated_at = ?');
  values.push(now);
  const marks = from.map(() => '?').join(', ');
  const guard = opts.discussionId === undefined ? '' : ' AND discussion_id = ?';
  const guardValues =
    opts.discussionId === undefined ? [] : [opts.discussionId];
  const result = db.run(
    `UPDATE latch_state SET ${sets.join(', ')}
     WHERE mr_url = ? AND phase IN (${marks})${guard}`,
    [...values, mrUrl, ...from, ...guardValues]
  );
  return result.changes > 0;
}

export function cachedUpload(
  mrUrl: string,
  variantKey: string,
  db: Database = getStateDb()
): string | null {
  const r = db
    .query(
      'SELECT markdown FROM latch_uploads WHERE mr_url = ? AND variant = ?'
    )
    .get(mrUrl, variantKey) as { markdown: string } | null;
  return r ? r.markdown : null;
}

export function rememberUpload(
  mrUrl: string,
  variantKey: string,
  markdown: string,
  db: Database = getStateDb()
): void {
  db.run(
    'INSERT OR REPLACE INTO latch_uploads (mr_url, variant, markdown) VALUES (?, ?, ?)',
    [mrUrl, variantKey, markdown]
  );
}

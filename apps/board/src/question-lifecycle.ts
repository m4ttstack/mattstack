import type { Database } from 'bun:sqlite';

import type { GateRow } from '@mattstack/rt-client';
import type { ExecutorView, QuestionInfo } from './client/types.ts';
import type { GateEventFrame } from './gates/ingest.ts';
import {
  deleteQuestionStates,
  deleteRevisions,
  deleteSheetDraft,
  latestRevisions,
  markQuestionsGone,
  markRevisionsApplied,
  PENDING_REVISION_TTL_MS,
  pendingRevision,
  questionAgentIds,
  readQuestionStates,
} from './question-state.ts';
import { getStateDb } from './state/db.ts';

// How the board reacts to the review gate around a finding's questions: a
// rebuilt gate settles the revision that asked for it, a submitted review
// (or a done review, or an MR leaving the board) ends the MR's questions,
// and the sheet reads one `QuestionInfo` per MR.

export interface LifecycleIo {
  closeTab(tabId: string): Promise<unknown>;
  logError(message: string): void;
  /** The state db; the board's own when absent. */
  db?: Database;
}

const REVIEW_GATE_KIND = 'review-post';
const MR_SUBJECT_PREFIX = 'mr:';

/** The gate id and MR a review-post frame names, or null for any other
    frame. The daemon's `gate/opened/*` and `gate/answered/*` payloads both
    carry `id`, `subject` and `kind`. */
function reviewGateOf(
  frame: GateEventFrame
): { gateId: string; mrUrl: string } | null {
  const p = frame.payload;
  if (!p || typeof p !== 'object') return null;
  const { id, subject, kind } = p as Record<string, unknown>;
  if (kind !== REVIEW_GATE_KIND) return null;
  if (typeof id !== 'string' || !id) return null;
  if (typeof subject !== 'string' || !subject.startsWith(MR_SUBJECT_PREFIX))
    return null;
  const mrUrl = subject.slice(MR_SUBJECT_PREFIX.length);
  return mrUrl ? { gateId: id, mrUrl } : null;
}

/** Ends an MR's questions: drops their rows, the sheet draft and the
    revisions, then closes every question tab the rows recorded. The rows
    go first so a launch still coming up finds its row gone and writes
    nothing back. A tab that will not close is logged, never thrown: the
    state is already cleared and one dead tab must not stop the rest. */
export async function clearMrQuestions(
  mrUrl: string,
  io: LifecycleIo
): Promise<void> {
  const db = io.db ?? getStateDb();
  const rows = db.transaction(() => {
    const deleted = deleteQuestionStates(mrUrl, db);
    deleteSheetDraft(mrUrl, db);
    deleteRevisions(mrUrl, db);
    return deleted;
  })();
  for (const row of rows) {
    if (!row.tabId) continue;
    try {
      await io.closeTab(row.tabId);
    } catch (err) {
      io.logError(
        `question tab close failed for ${mrUrl} (${row.findingId}): ${err instanceof Error ? err.message : err}`
      );
    }
  }
}

/** The relay handler's hook, fed every gate frame (writer only):
    - a review-post gate opening is the review agent's rebuild, so every
      revision pending on that MR landed in it;
    - a review-post gate answered is the review submitted, which ends the
      MR's questions.
    Any other frame is a no-op. A revision's own gate close (reason
    `revised`) is a `gate/closed/*` frame and never reaches either branch. */
export async function onReviewGateEvent(
  frame: GateEventFrame,
  io: LifecycleIo
): Promise<void> {
  const opened = frame.topic.startsWith('gate/opened/');
  if (!opened && !frame.topic.startsWith('gate/answered/')) return;
  const gate = reviewGateOf(frame);
  if (!gate) return;
  if (opened) {
    markRevisionsApplied(gate.mrUrl, gate.gateId, io.db ?? getStateDb());
    return;
  }
  await clearMrQuestions(gate.mrUrl, io);
}

/** Every MR with any question row, revision or sheet draft. */
export function questionMrUrls(db: Database = getStateDb()): Set<string> {
  const rows = db
    .query(
      `SELECT mr_url FROM question_states
       UNION SELECT mr_url FROM finding_revisions
       UNION SELECT mr_url FROM review_sheet_drafts`
    )
    .all() as { mr_url: string }[];
  return new Set(rows.map(r => r.mr_url));
}

/** The /data.json prune's sibling: an MR that left the board takes its
    questions with it, tabs included. */
export async function pruneOffBoardQuestions(
  onBoard: ReadonlySet<string>,
  io: LifecycleIo
): Promise<void> {
  for (const mrUrl of questionMrUrls(io.db ?? getStateDb())) {
    if (!onBoard.has(mrUrl)) await clearMrQuestions(mrUrl, io);
  }
}

/** Each MR's standing review-post gate (open or parked), from the gate
    cache's rows. The supersede rule keeps at most one per MR. */
export function openReviewGates(rows: GateRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== REVIEW_GATE_KIND) continue;
    if (row.status !== 'open' && row.status !== 'parked') continue;
    if (!row.subject.startsWith(MR_SUBJECT_PREFIX)) continue;
    out.set(row.subject.slice(MR_SUBJECT_PREFIX.length), row.id);
  }
  return out;
}

/** The periodic pass over pending revisions. On an MR whose review gate is
    standing, a pending revision was rebuilt into that gate and the open
    event was missed, so it is marked applied with that gate's id, never
    failed. The one exception is the gate the revision itself closed (its
    close is still in flight): that is not a rebuild. Only pending rows on
    an MR with no standing review gate fail, once older than the TTL.
    Returns how many rows changed. */
export function settleStaleRevisions(
  now: number,
  reviewGates: ReadonlyMap<string, string>,
  db: Database = getStateDb()
): number {
  return db.transaction(() => {
    let changed = 0;
    for (const [mrUrl, gateId] of reviewGates) {
      changed += db.run(
        `UPDATE finding_revisions SET status = 'applied', new_gate = ?
         WHERE mr_url = ? AND status = 'pending' AND closed_gate != ?`,
        [gateId, mrUrl, gateId]
      ).changes;
    }
    changed += db.run(
      `UPDATE finding_revisions SET status = 'failed'
       WHERE status = 'pending' AND created_at <= ?
         AND mr_url NOT IN (SELECT value FROM json_each(?))`,
      [now - PENDING_REVISION_TTL_MS, JSON.stringify([...reviewGates.keys()])]
    ).changes;
    return changed;
  })();
}

/** The review sheet's view of one MR's questions. Undefined when the MR
    has no question row, applied revision or pending revision. */
export function questionInfoFor(
  mrUrl: string,
  now: number,
  db: Database = getStateDb()
): QuestionInfo | undefined {
  const rows = readQuestionStates(db).get(mrUrl);
  const applied = latestRevisions(mrUrl, db);
  const rebuilding = pendingRevision(mrUrl, now, db) !== undefined;
  if (!rows?.size && applied.size === 0 && !rebuilding) return undefined;
  const live: QuestionInfo['live'] = {};
  for (const [findingId, q] of rows ?? []) {
    if (q.status !== 'queued' && q.status !== 'live') continue;
    live[findingId] = {
      status: q.status,
      ...(q.paneId ? { paneId: q.paneId } : {}),
      ...(q.tabId ? { tabId: q.tabId } : {}),
    };
  }
  const revised: QuestionInfo['revised'] = {};
  for (const [findingId, r] of applied) {
    // An applied row always carries the gate it landed in.
    if (!r.newGate) continue;
    revised[findingId] = {
      original: r.original,
      revised: r.revised,
      newGate: r.newGate,
    };
  }
  return { live, revised, rebuilding };
}

/** Question panes carry their MR's `mr:` subject, so a closed question tab
    would otherwise join the MR row as an interrupted lane. Drops every
    executor that is a question pane and reports the gone ones, which the
    server marks done (`markQuestionsGone`) so a dead tab stops holding the
    review gate off parking. */
export function withoutQuestionExecutors(
  executors: ExecutorView[],
  questionAgents: ReadonlySet<string>
): { executors: ExecutorView[]; goneQuestionAgents: Set<string> } {
  const kept: ExecutorView[] = [];
  const goneQuestionAgents = new Set<string>();
  for (const e of executors) {
    if (!questionAgents.has(e.agentId)) {
      kept.push(e);
      continue;
    }
    if (e.state === 'gone') goneQuestionAgents.add(e.agentId);
  }
  return { executors: kept, goneQuestionAgents };
}

/** The writer's periodic sweep runs this before it reads `liveQuestionMrs()`
    for `planSweep`: a question pane the reconciler reports gone has its row
    marked done, so the MR's review gate can park on that same pass even
    with no board UI open to drive the request path. Returns the executors
    with every question pane dropped. */
export function retireGoneQuestions(
  executors: ExecutorView[],
  now: number,
  db: Database = getStateDb()
): ExecutorView[] {
  const { executors: kept, goneQuestionAgents } = withoutQuestionExecutors(
    executors,
    questionAgentIds(db)
  );
  if (goneQuestionAgents.size) markQuestionsGone(goneQuestionAgents, now, db);
  return kept;
}

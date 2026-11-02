import type { Database } from 'bun:sqlite';

import type { GateEventFrame } from './gates/ingest.ts';
import { parseSheetDraft, type SheetDraft } from './sheet-draft-shape.ts';
import { getStateDb } from './state/db.ts';
import {
  deleteKvValue,
  getKvValue,
  listKvValues,
  setKvValue,
} from './state/kv-blob.ts';

// The review sheet's unsent ticks and edits, one kv row per MR url, so a gate
// the review agent re-raises after revising a finding comes back the way the
// reviewer left it (client/board/sheet-draft.ts). A fresh review run, a real
// verdict on the review gate and the MR leaving the board drop it.

export const SHEET_DRAFT_NS = 'review-sheet-draft';

export function readSheetDraft(
  mrUrl: string,
  db: Database = getStateDb()
): SheetDraft | undefined {
  return (
    parseSheetDraft(getKvValue(SHEET_DRAFT_NS, mrUrl, null, db)) ?? undefined
  );
}

export function writeSheetDraft(
  mrUrl: string,
  draft: SheetDraft,
  db: Database = getStateDb()
): void {
  setKvValue(SHEET_DRAFT_NS, mrUrl, draft, db);
}

export function deleteSheetDraft(
  mrUrl: string,
  db: Database = getStateDb()
): void {
  deleteKvValue(SHEET_DRAFT_NS, mrUrl, db);
}

/** The /data.json prune's sibling: an MR that left the board takes its
    draft with it. */
export function pruneSheetDrafts(
  onBoard: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  for (const mrUrl of listKvValues(SHEET_DRAFT_NS, db).keys())
    if (!onBoard.has(mrUrl)) deleteSheetDraft(mrUrl, db);
}

/** The relay's `gate/answered/*` hook (writer only): a review-post gate
    answered with a real verdict is the review submitted, so its draft goes.
    An answer whose `next` is `iterate` or `hold` keeps the run going and
    keeps the draft. The daemon's answered payload carries `id`, `subject`,
    `kind` and the row's `answers`, whose values are a string or a
    `{ value }`. Returns whether a draft was dropped. */
export function dropDraftOnReviewVerdict(
  frame: GateEventFrame,
  db: Database = getStateDb()
): boolean {
  if (!frame.topic.startsWith('gate/answered/')) return false;
  const p = frame.payload;
  if (!p || typeof p !== 'object') return false;
  const { subject, kind, answers } = p as Record<string, unknown>;
  if (kind !== 'review-post') return false;
  if (typeof subject !== 'string' || !subject.startsWith('mr:')) return false;
  const mrUrl = subject.slice('mr:'.length);
  if (!mrUrl) return false;
  const next =
    answers && typeof answers === 'object'
      ? (answers as Record<string, unknown>).next
      : undefined;
  const value =
    next && typeof next === 'object'
      ? (next as { value?: unknown }).value
      : next;
  if (value === 'iterate' || value === 'hold') return false;
  deleteSheetDraft(mrUrl, db);
  return true;
}

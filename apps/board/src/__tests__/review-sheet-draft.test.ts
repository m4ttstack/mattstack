import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  dropDraftOnReviewVerdict,
  pruneSheetDrafts,
  readSheetDraft,
  SHEET_DRAFT_NS,
  writeSheetDraft,
} from '../review-sheet-draft.ts';
import { openStateDb, SCHEMA_VERSION } from '../state/db.ts';
import { setKvValue } from '../state/kv-blob.ts';

const MR_A = 'https://gitlab.example.com/acme/widgets/-/merge_requests/31';
const MR_B = 'https://gitlab.example.com/acme/widgets/-/merge_requests/32';
const DRAFT = {
  ticked: ['f1'],
  known: ['f1', 'f2'],
  texts: { 'comment:f1': 'my words' },
  outcome: 'comment',
  notes: {},
};

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sheet-draft-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const answered = (
  answers: Record<string, unknown>,
  over: Record<string, unknown> = {}
) => ({
  topic: 'gate/answered/g1',
  payload: {
    id: 'g1',
    subject: `mr:${MR_A}`,
    kind: 'review-post',
    answers,
    by: 'board',
    ...over,
  },
});

describe('the review sheet draft store', () => {
  test('lives in the kv table, so the schema stays at 5', () => {
    expect(SCHEMA_VERSION).toBe(5);
    writeSheetDraft(MR_A, DRAFT, db);
    expect(readSheetDraft(MR_A, db)).toEqual(DRAFT);
    const row = db
      .query('SELECT v FROM kv WHERE ns = ? AND k = ?')
      .get(SHEET_DRAFT_NS, MR_A) as { v: string } | null;
    expect(JSON.parse(row!.v)).toEqual(DRAFT);
  });

  test('a stored value of the wrong shape reads as no draft', () => {
    setKvValue(SHEET_DRAFT_NS, MR_A, { ticked: 'f1' }, db);
    expect(readSheetDraft(MR_A, db)).toBeUndefined();
  });

  test('an MR that left the board takes its draft with it', () => {
    writeSheetDraft(MR_A, DRAFT, db);
    writeSheetDraft(MR_B, DRAFT, db);
    pruneSheetDrafts(new Set([MR_B]), db);
    expect(readSheetDraft(MR_A, db)).toBeUndefined();
    expect(readSheetDraft(MR_B, db)).toEqual(DRAFT);
  });
});

describe('dropDraftOnReviewVerdict', () => {
  test('a verdict on the review gate drops the draft', () => {
    writeSheetDraft(MR_A, DRAFT, db);
    expect(dropDraftOnReviewVerdict(answered({ outcome: 'approve' }), db)).toBe(
      true
    );
    expect(readSheetDraft(MR_A, db)).toBeUndefined();
  });

  test.each([
    ['iterate', 'iterate'],
    ['hold', 'hold'],
    ['iterate with a note', { value: 'iterate', note: 'one more pass' }],
  ])('an answer whose next is %s keeps it', (_name, next) => {
    writeSheetDraft(MR_A, DRAFT, db);
    expect(dropDraftOnReviewVerdict(answered({ next }), db)).toBe(false);
    expect(readSheetDraft(MR_A, db)).toEqual(DRAFT);
  });

  test('another gate kind, another MR or another frame leaves it alone', () => {
    writeSheetDraft(MR_A, DRAFT, db);
    dropDraftOnReviewVerdict(answered({}, { kind: 'respond-post' }), db);
    dropDraftOnReviewVerdict(answered({}, { subject: `mr:${MR_B}` }), db);
    dropDraftOnReviewVerdict({ ...answered({}), topic: 'gate/opened/g1' }, db);
    expect(readSheetDraft(MR_A, db)).toEqual(DRAFT);
  });
});

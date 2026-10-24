import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  deleteQuestionStates,
  deleteRevision,
  deleteRevisions,
  deleteSheetDraft,
  expireStaleRevisions,
  insertPendingRevision,
  latestRevisions,
  liveQuestionMrs,
  markQuestionsGone,
  markRevisionsApplied,
  PENDING_REVISION_TTL_MS,
  pendingRevision,
  questionAgentIds,
  questionHandle,
  readQuestionByHandle,
  readQuestionStates,
  readSheetDraft,
  writeQuestionState,
  writeQuestionStateByHandle,
  writeSheetDraft,
} from '../question-state.ts';
import { parseReportFinding, type ReportFinding } from '../review-finding.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qs-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://g/x/-/merge_requests/1';
const URL_B = 'https://g/x/-/merge_requests/2';

function finding(id: string, title = 't'): ReportFinding {
  return { id, tier: 'Minor', title, body: 'b', comment: 'c' };
}

describe('question handle', () => {
  test('ids that slug alike get distinct handles with no slash after questions/', () => {
    const a = questionHandle(URL_A, 'f 1/x', dir);
    const b = questionHandle(URL_A, 'f-1-x', dir);
    expect(a).not.toBe(b);
    for (const h of [a, b]) {
      expect(h.split('questions/')[1]).not.toContain('/');
    }
    expect(questionHandle(URL_A, 'f1', dir)).not.toBe(
      questionHandle(URL_A, 'f2', dir)
    );
  });
});

describe('question states', () => {
  test('two findings on one MR keep two rows and two handles', () => {
    writeQuestionState(URL_A, 'f1', { gateId: 'g', status: 'queued' }, 1, db);
    writeQuestionState(URL_A, 'f2', { gateId: 'g', status: 'live' }, 2, db);
    expect(readQuestionStates(db).get(URL_A)?.size).toBe(2);
    const handles = db
      .query('SELECT handle FROM question_states')
      .all() as Array<{ handle: string }>;
    expect(new Set(handles.map(h => h.handle)).size).toBe(2);
  });

  test('writes merge into the state, by key and by handle', () => {
    writeQuestionState(URL_A, 'f1', { iid: 1, status: 'queued' }, 1, db);
    writeQuestionState(URL_A, 'f1', { status: 'live', agentId: 'a1' }, 2, db);
    expect(readQuestionStates(db).get(URL_A)?.get('f1')).toMatchObject({
      mrUrl: URL_A,
      findingId: 'f1',
      iid: 1,
      status: 'live',
      agentId: 'a1',
    });
    const handle = questionHandle(URL_A, 'f1');
    expect(writeQuestionStateByHandle(handle, { message: 'hi' }, 3, db)).toBe(
      true
    );
    expect(readQuestionByHandle(handle, db)?.message).toBe('hi');
    expect(readQuestionByHandle(handle, db)?.status).toBe('live');
    expect(writeQuestionStateByHandle('nope', { message: 'x' }, 3, db)).toBe(
      false
    );
    expect(readQuestionByHandle('nope', db)).toBeUndefined();
  });

  test('liveQuestionMrs includes only queued and live rows', () => {
    writeQuestionState(URL_A, 'f1', { status: 'queued' }, 1, db);
    writeQuestionState(URL_B, 'f1', { status: 'done' }, 1, db);
    writeQuestionState(URL_B, 'f2', { status: 'error' }, 1, db);
    expect([...liveQuestionMrs(db)]).toEqual([URL_A]);
    writeQuestionState(URL_B, 'f3', { status: 'live' }, 1, db);
    expect(liveQuestionMrs(db)).toEqual(new Set([URL_A, URL_B]));
  });

  test('markQuestionsGone ends only queued or live rows whose agent left', () => {
    writeQuestionState(URL_A, 'f1', { status: 'live', agentId: 'a1' }, 1, db);
    writeQuestionState(URL_A, 'f2', { status: 'live', agentId: 'a2' }, 1, db);
    writeQuestionState(URL_A, 'f3', { status: 'error', agentId: 'a1' }, 1, db);
    expect(questionAgentIds(db)).toEqual(new Set(['a1', 'a2']));
    expect(markQuestionsGone(new Set(['a1']), 5, db)).toBe(1);
    const by = readQuestionStates(db).get(URL_A)!;
    expect(by.get('f1')?.status).toBe('done');
    expect(by.get('f2')?.status).toBe('live');
    expect(by.get('f3')?.status).toBe('error');
  });

  test('deleteQuestionStates returns the deleted rows and leaves other MRs', () => {
    writeQuestionState(URL_A, 'f1', { tabId: 't1' }, 1, db);
    writeQuestionState(URL_B, 'f1', { tabId: 't2' }, 1, db);
    const gone = deleteQuestionStates(URL_A, db);
    expect(gone.map(q => q.tabId)).toEqual(['t1']);
    expect(readQuestionStates(db).has(URL_A)).toBe(false);
    expect(readQuestionStates(db).has(URL_B)).toBe(true);
  });
});

describe('finding revisions', () => {
  const rev = (findingId: string, createdAt: number, revised = true) => ({
    mrUrl: URL_A,
    findingId,
    original: finding(findingId, 'old'),
    revised: revised ? finding(findingId, 'new') : null,
    closedGate: 'g1',
    createdAt,
  });
  const count = () =>
    db.query('SELECT COUNT(*) AS n FROM finding_revisions').get();

  test('pendingRevision is undefined once the TTL has passed', () => {
    insertPendingRevision(rev('f1', 1000), db);
    expect(
      pendingRevision(URL_A, 1000 + PENDING_REVISION_TTL_MS - 1, db)
    ).toMatchObject({ findingId: 'f1', status: 'pending' });
    expect(
      pendingRevision(URL_A, 1000 + PENDING_REVISION_TTL_MS, db)
    ).toBeUndefined();
  });

  test('pendingRevision returns the newest pending row', () => {
    insertPendingRevision(rev('f1', 1000), db);
    insertPendingRevision(rev('f2', 2000, false), db);
    const p = pendingRevision(URL_A, 3000, db);
    expect(p?.findingId).toBe('f2');
    expect(p?.revised).toBeNull();
  });

  test('expireStaleRevisions fails exactly the stale pending rows', () => {
    insertPendingRevision(rev('f1', 1000), db);
    insertPendingRevision(rev('f2', 1000 + PENDING_REVISION_TTL_MS), db);
    expect(expireStaleRevisions(1000 + PENDING_REVISION_TTL_MS, db)).toBe(1);
    const rows = db
      .query(
        'SELECT finding_id, status FROM finding_revisions ORDER BY finding_id'
      )
      .all();
    expect(rows).toEqual([
      { finding_id: 'f1', status: 'failed' },
      { finding_id: 'f2', status: 'pending' },
    ]);
  });

  test('markRevisionsApplied sets new_gate and latestRevisions returns the newest per finding', () => {
    insertPendingRevision(rev('f1', 1000), db);
    markRevisionsApplied(URL_A, 'g2', db);
    insertPendingRevision(rev('f1', 2000), db);
    insertPendingRevision(rev('f2', 2000, false), db);
    markRevisionsApplied(URL_A, 'g3', db);
    const latest = latestRevisions(URL_A, db);
    expect(latest.get('f1')).toMatchObject({
      status: 'applied',
      newGate: 'g3',
      createdAt: 2000,
    });
    expect(latest.get('f2')?.revised).toBeNull();
    expect(latest.get('f1')?.original.title).toBe('old');
  });

  test('a pending row is not a latest revision', () => {
    insertPendingRevision(rev('f1', 1000), db);
    expect(latestRevisions(URL_A, db).size).toBe(0);
  });

  test('deleteRevision drops one row, deleteRevisions the MR', () => {
    insertPendingRevision(rev('f1', 1000), db);
    insertPendingRevision(rev('f1', 2000), db);
    deleteRevision(URL_A, 'f1', 1000, db);
    expect(count()).toEqual({ n: 1 });
    deleteRevisions(URL_A, db);
    expect(count()).toEqual({ n: 0 });
  });
});

describe('sheet drafts', () => {
  test('a draft round-trips and deleteSheetDraft removes it', () => {
    const d = {
      ticked: ['f1'],
      texts: { f1: 'edited' },
      outcome: 'approve',
      notes: { f1: 'n' },
    };
    expect(readSheetDraft(URL_A, db)).toBeUndefined();
    writeSheetDraft(URL_A, d, 1, db);
    writeSheetDraft(URL_A, { ...d, ticked: [] }, 2, db);
    expect(readSheetDraft(URL_A, db)).toEqual({ ...d, ticked: [] });
    deleteSheetDraft(URL_A, db);
    expect(readSheetDraft(URL_A, db)).toBeUndefined();
  });
});

describe('parseReportFinding', () => {
  test('accepts a complete finding and keeps typed optionals', () => {
    expect(
      parseReportFinding({
        ...finding('f1'),
        line: 'L3',
        evidence: 'out',
        junk: 1,
      })
    ).toEqual({ ...finding('f1'), line: 'L3', evidence: 'out' });
  });

  test('is null when a required field is missing or mistyped', () => {
    for (const k of ['id', 'tier', 'title', 'body', 'comment']) {
      const f: Record<string, unknown> = { ...finding('f1') };
      delete f[k];
      expect(parseReportFinding(f)).toBeNull();
    }
    expect(parseReportFinding({ ...finding('f1'), tier: 'Huge' })).toBeNull();
    expect(parseReportFinding(null)).toBeNull();
    expect(parseReportFinding('x')).toBeNull();
  });
});

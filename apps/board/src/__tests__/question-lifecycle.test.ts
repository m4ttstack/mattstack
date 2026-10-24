import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { GateRow } from '@mattstack/rt-client';
import type { ExecutorView } from '../client/types.ts';
import { planSweep } from '../gates/sweep.ts';
import {
  clearMrQuestions,
  onReviewGateEvent,
  openReviewGates,
  pruneOffBoardQuestions,
  questionInfoFor,
  retireGoneQuestions,
  settleStaleRevisions,
  withoutQuestionExecutors,
  type LifecycleIo,
} from '../question-lifecycle.ts';
import {
  insertPendingRevision,
  latestRevisions,
  liveQuestionMrs,
  markQuestionsGone,
  PENDING_REVISION_TTL_MS,
  pendingRevision,
  readQuestionStates,
  readSheetDraft,
  writeQuestionState,
  writeSheetDraft,
} from '../question-state.ts';
import type { ReportFinding } from '../review-finding.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ql-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://g/x/-/merge_requests/1';
const URL_B = 'https://g/x/-/merge_requests/2';
const NOW = 50_000_000;

function finding(id: string, title = 't'): ReportFinding {
  return { id, tier: 'Minor', title, body: 'b', comment: 'c' };
}

function fakeIo(): LifecycleIo & { closed: string[]; errors: string[] } {
  const closed: string[] = [];
  const errors: string[] = [];
  return {
    closed,
    errors,
    db,
    closeTab: async tabId => {
      closed.push(tabId);
    },
    logError: m => errors.push(m),
  };
}

function seedMr(mrUrl: string): void {
  writeQuestionState(
    mrUrl,
    'f1',
    { status: 'live', iid: 1, gateId: 'g0', agentId: 'a1', tabId: 'tab-1' },
    NOW,
    db
  );
  writeQuestionState(
    mrUrl,
    'f2',
    { status: 'live', iid: 1, gateId: 'g0', agentId: 'a2', tabId: 'tab-2' },
    NOW,
    db
  );
  writeSheetDraft(
    mrUrl,
    { ticked: ['f1'], known: ['f1'], texts: {}, notes: {} },
    NOW,
    db
  );
  insertPendingRevision(
    {
      mrUrl,
      findingId: 'f1',
      original: finding('f1'),
      revised: finding('f1', 'new'),
      closedGate: 'g0',
      createdAt: NOW,
    },
    db
  );
}

function frame(verb: 'opened' | 'answered', kind: string, mrUrl = URL_A) {
  return {
    topic: `gate/${verb}/g1`,
    payload: { id: 'g1', subject: `mr:${mrUrl}`, kind },
  };
}

describe('onReviewGateEvent', () => {
  test('an opened review-post marks the pending revision applied with the new gate id', async () => {
    seedMr(URL_A);
    await onReviewGateEvent(frame('opened', 'review-post'), fakeIo());
    expect(pendingRevision(URL_A, NOW, db)).toBeUndefined();
    expect(latestRevisions(URL_A, db).get('f1')?.newGate).toBe('g1');
  });

  test('an opened respond-post leaves the pending revision alone', async () => {
    seedMr(URL_A);
    await onReviewGateEvent(frame('opened', 'respond-post'), fakeIo());
    expect(pendingRevision(URL_A, NOW, db)?.findingId).toBe('f1');
  });

  test('an answered review-post closes both question tabs on that MR and clears rows, sheet draft and revisions', async () => {
    seedMr(URL_A);
    seedMr(URL_B);
    const io = fakeIo();
    await onReviewGateEvent(frame('answered', 'review-post'), io);
    expect(io.closed.sort()).toEqual(['tab-1', 'tab-2']);
    expect(readQuestionStates(db).has(URL_A)).toBe(false);
    expect(readSheetDraft(URL_A, db)).toBeUndefined();
    expect(pendingRevision(URL_A, NOW, db)).toBeUndefined();
    expect(latestRevisions(URL_A, db).size).toBe(0);
    // The other MR is untouched.
    expect(readQuestionStates(db).get(URL_B)?.size).toBe(2);
    expect(readSheetDraft(URL_B, db)).toBeDefined();
    expect(pendingRevision(URL_B, NOW, db)).toBeDefined();
  });

  test('an answered respond-post on the same MR touches nothing', async () => {
    seedMr(URL_A);
    const io = fakeIo();
    await onReviewGateEvent(frame('answered', 'respond-post'), io);
    expect(io.closed).toEqual([]);
    expect(readQuestionStates(db).get(URL_A)?.size).toBe(2);
    expect(readSheetDraft(URL_A, db)).toBeDefined();
    expect(pendingRevision(URL_A, NOW, db)).toBeDefined();
  });

  test('a frame for a non-MR subject or with no id is ignored', async () => {
    seedMr(URL_A);
    const io = fakeIo();
    await onReviewGateEvent(
      {
        topic: 'gate/answered/g1',
        payload: { id: 'g1', subject: 'run:r1', kind: 'review-post' },
      },
      io
    );
    await onReviewGateEvent(
      {
        topic: 'gate/answered/g1',
        payload: { subject: `mr:${URL_A}`, kind: 'review-post' },
      },
      io
    );
    expect(io.closed).toEqual([]);
    expect(readQuestionStates(db).get(URL_A)?.size).toBe(2);
  });

  test('a tab that fails to close is logged and the rest still clears', async () => {
    seedMr(URL_A);
    const io = fakeIo();
    io.closeTab = async tabId => {
      if (tabId === 'tab-1') throw new Error('gone');
      io.closed.push(tabId);
    };
    await onReviewGateEvent(frame('answered', 'review-post'), io);
    expect(io.closed).toEqual(['tab-2']);
    expect(io.errors).toHaveLength(1);
    expect(readQuestionStates(db).has(URL_A)).toBe(false);
  });
});

describe('pruneOffBoardQuestions', () => {
  test('clears every MR with question state that left the board', async () => {
    seedMr(URL_A);
    seedMr(URL_B);
    const io = fakeIo();
    await pruneOffBoardQuestions(new Set([URL_B]), io);
    expect(io.closed.sort()).toEqual(['tab-1', 'tab-2']);
    expect(readQuestionStates(db).has(URL_A)).toBe(false);
    expect(readSheetDraft(URL_A, db)).toBeUndefined();
    expect(readQuestionStates(db).has(URL_B)).toBe(true);
  });

  test('an MR with only a sheet draft left is still cleared', async () => {
    writeSheetDraft(
      URL_A,
      { ticked: [], known: [], texts: {}, notes: {} },
      NOW,
      db
    );
    await pruneOffBoardQuestions(new Set(), fakeIo());
    expect(readSheetDraft(URL_A, db)).toBeUndefined();
  });
});

describe('clearMrQuestions', () => {
  test('a done review clears the MR the same way a submit does', async () => {
    seedMr(URL_A);
    const io = fakeIo();
    await clearMrQuestions(URL_A, io);
    expect(io.closed.sort()).toEqual(['tab-1', 'tab-2']);
    expect(readQuestionStates(db).has(URL_A)).toBe(false);
  });
});

describe('questionInfoFor', () => {
  test('undefined when the MR has no rows of any kind', () => {
    expect(questionInfoFor(URL_A, NOW, db)).toBeUndefined();
  });

  test('reports rebuilding: true while a revision is pending and false once it is older than the TTL', () => {
    seedMr(URL_A);
    expect(questionInfoFor(URL_A, NOW + 1000, db)?.rebuilding).toBe(true);
    expect(
      questionInfoFor(URL_A, NOW + PENDING_REVISION_TTL_MS + 1, db)?.rebuilding
    ).toBe(false);
  });

  test('lists live and queued questions and applied revisions with their gate', () => {
    seedMr(URL_A);
    writeQuestionState(
      URL_A,
      'f3',
      { status: 'queued', iid: 1, gateId: 'g0' },
      NOW,
      db
    );
    writeQuestionState(
      URL_A,
      'f4',
      { status: 'done', iid: 1, gateId: 'g0' },
      NOW,
      db
    );
    expect(questionInfoFor(URL_A, NOW, db)?.revised).toEqual({});
    return onReviewGateEvent(frame('opened', 'review-post'), fakeIo()).then(
      () => {
        expect(questionInfoFor(URL_A, NOW, db)).toEqual({
          live: {
            f1: { status: 'live', tabId: 'tab-1' },
            f2: { status: 'live', tabId: 'tab-2' },
            f3: { status: 'queued' },
          },
          revised: {
            f1: {
              original: finding('f1'),
              revised: finding('f1', 'new'),
              newGate: 'g1',
            },
          },
          rebuilding: false,
        });
      }
    );
  });
});

function executor(overrides: Partial<ExecutorView>): ExecutorView {
  return {
    agentId: 'x',
    repo: null,
    subject: `mr:${URL_A}`,
    surface: 'herdr',
    sessionId: 's',
    paneRef: null,
    state: 'gone',
    since: 1,
    openGateIds: [],
    ...overrides,
  };
}

describe('withoutQuestionExecutors', () => {
  test('removes a gone question executor, reports it, and keeps a review lane executor on the same subject', () => {
    const question = executor({ agentId: 'q1' });
    const lane = executor({ agentId: 'review-1' });
    const liveQuestion = executor({ agentId: 'q2', state: 'live' });
    const out = withoutQuestionExecutors(
      [question, lane, liveQuestion],
      new Set(['q1', 'q2'])
    );
    expect(out.executors).toEqual([lane]);
    expect([...out.goneQuestionAgents]).toEqual(['q1']);
  });

  test('after markQuestionsGone, liveQuestionMrs() no longer holds that MR', () => {
    seedMr(URL_A);
    expect(liveQuestionMrs(db).has(URL_A)).toBe(true);
    const { goneQuestionAgents } = withoutQuestionExecutors(
      [executor({ agentId: 'a1' }), executor({ agentId: 'a2' })],
      new Set(['a1', 'a2'])
    );
    markQuestionsGone(goneQuestionAgents, NOW, db);
    expect(liveQuestionMrs(db).has(URL_A)).toBe(false);
  });
});

function gateRow(overrides: Partial<GateRow>): GateRow {
  return {
    id: 'g1',
    subject: `mr:${URL_A}`,
    kind: 'review-post',
    questions: [],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: NOW,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    supersededBy: null,
    owner: null,
    escalatedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

describe('settleStaleRevisions', () => {
  function pending(mrUrl: string, createdAt: number, closedGate = 'g0') {
    insertPendingRevision(
      {
        mrUrl,
        findingId: 'f1',
        original: finding('f1'),
        revised: null,
        closedGate,
        createdAt,
      },
      db
    );
  }
  const statusOf = (mrUrl: string) =>
    db
      .query('SELECT status, new_gate FROM finding_revisions WHERE mr_url = ?')
      .get(mrUrl) as { status: string; new_gate: string | null };

  test('a pending revision on an MR with a standing review gate is applied with that gate, even when stale', () => {
    pending(URL_A, NOW);
    const later = NOW + PENDING_REVISION_TTL_MS + 1;
    expect(settleStaleRevisions(later, new Map([[URL_A, 'g9']]), db)).toBe(1);
    expect(statusOf(URL_A)).toEqual({ status: 'applied', new_gate: 'g9' });
  });

  test('a fresh pending revision on such an MR is applied too: the open event was missed', () => {
    pending(URL_A, NOW);
    settleStaleRevisions(NOW + 1, new Map([[URL_A, 'g9']]), db);
    expect(statusOf(URL_A).status).toBe('applied');
  });

  test('the gate the revision itself closed is not its rebuild', () => {
    pending(URL_A, NOW, 'g0');
    const later = NOW + PENDING_REVISION_TTL_MS + 1;
    expect(settleStaleRevisions(later, new Map([[URL_A, 'g0']]), db)).toBe(0);
    expect(statusOf(URL_A)).toEqual({ status: 'pending', new_gate: null });
  });

  test('with no standing review gate a revision fails only past the TTL', () => {
    pending(URL_A, NOW);
    pending(URL_B, NOW + 10);
    const at = NOW + PENDING_REVISION_TTL_MS;
    expect(settleStaleRevisions(at, new Map(), db)).toBe(1);
    expect(statusOf(URL_A).status).toBe('failed');
    expect(statusOf(URL_B).status).toBe('pending');
  });
});

describe('retireGoneQuestions', () => {
  const GRACE = 60_000;
  const sweepOnce = (executors: ExecutorView[]) => {
    retireGoneQuestions(executors, NOW, db);
    return planSweep(
      [gateRow({ openedAt: NOW - GRACE - 1 })],
      {
        reviews: new Map(),
        responds: new Map(),
        doctors: new Map(),
        questionMrs: liveQuestionMrs(db),
      },
      NOW,
      GRACE
    );
  };

  test('a gone question executor releases the MR so its review gate parks within one sweep', () => {
    seedMr(URL_A);
    const actions = sweepOnce([
      executor({ agentId: 'a1' }),
      executor({ agentId: 'a2' }),
    ]);
    expect(actions.map(a => [a.kind, a.mrUrl])).toEqual([['park', URL_A]]);
  });

  test('one question still running keeps the gate held', () => {
    seedMr(URL_A);
    const actions = sweepOnce([
      executor({ agentId: 'a1' }),
      executor({ agentId: 'a2', state: 'live' }),
    ]);
    expect(actions).toEqual([]);
    expect(readQuestionStates(db).get(URL_A)?.get('f1')?.status).toBe('done');
  });

  test('returns the executors with every question pane dropped', () => {
    seedMr(URL_A);
    const lane = executor({ agentId: 'review-1' });
    expect(
      retireGoneQuestions(
        [
          executor({ agentId: 'a1' }),
          lane,
          executor({ agentId: 'a2', state: 'live' }),
        ],
        NOW,
        db
      )
    ).toEqual([lane]);
  });
});

describe('openReviewGates', () => {
  test('maps each MR to its standing review-post gate, open or parked', () => {
    const out = openReviewGates([
      gateRow({ id: 'g1' }),
      gateRow({ id: 'g2', subject: `mr:${URL_B}`, status: 'parked' }),
      gateRow({
        id: 'g3',
        subject: 'mr:https://g/x/-/merge_requests/3',
        status: 'answered',
      }),
      gateRow({
        id: 'g4',
        subject: 'mr:https://g/x/-/merge_requests/4',
        kind: 'respond-post',
      }),
      gateRow({ id: 'g5', subject: 'run:r1' }),
    ]);
    expect(out).toEqual(
      new Map([
        [URL_A, 'g1'],
        [URL_B, 'g2'],
      ])
    );
  });
});

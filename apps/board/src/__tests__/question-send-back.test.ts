import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { GateRow } from '@mattstack/rt-client';
import {
  sendBack,
  type SendBackInput,
  type SendBackIo,
} from '../question-send-back.ts';
import {
  deleteRevision,
  insertPendingRevision,
  pendingRevision,
  questionHandle,
  readQuestionByHandle,
  writeQuestionState,
} from '../question-state.ts';
import type { ReportFinding } from '../review-finding.ts';
import { openStateDb } from '../state/db.ts';

const MR = 'https://g/x/-/merge_requests/9';
const NOW = 1_000_000;

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qsb-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function finding(id: string, title = 'old title'): ReportFinding {
  return { id, tier: 'Important', title, body: 'b', comment: 'c' };
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const REPORT_PATH = '/board/state/reviews/mr.json';
const REVISION_PATH = '/board/state/reviews/mr.revision.json';
const reportText = JSON.stringify({
  findings: [finding('f1'), finding('f2')],
});

function gate(over: Partial<GateRow> = {}, options: unknown[] = ['f1', 'f2']) {
  return {
    id: 'g-open',
    subject: `mr:${MR}`,
    kind: 'review-post',
    status: 'open',
    questions: [
      { id: 'findings-1', label: 'l', multi: true, options },
      { id: 'outcome', label: 'o', multi: false, options: ['comment'] },
    ],
    ...over,
  } as unknown as GateRow;
}

interface Harness {
  io: SendBackIo;
  files: Map<string, string>;
  closes: Array<{ id: string; reason: string }>;
}

function harness(
  opts: {
    openGate?: GateRow | 'parked' | null;
    report?: string | null;
    close?: () => Promise<{ ok: boolean; error?: string }>;
  } = {}
): Harness {
  const files = new Map<string, string>();
  if (opts.report !== null) files.set(REPORT_PATH, opts.report ?? reportText);
  const closes: Array<{ id: string; reason: string }> = [];
  const io: SendBackIo = {
    question: handle => readQuestionByHandle(handle, db),
    reportJsonPath: () => REPORT_PATH,
    readFile: path => files.get(path) ?? null,
    writeFile: (path, text) => void files.set(path, text),
    removeFile: path => void files.delete(path),
    openReviewGate: async () =>
      opts.openGate === undefined ? gate() : opts.openGate,
    gateClose: async payload => {
      closes.push(payload);
      return opts.close ? opts.close() : { ok: true };
    },
    pendingRevision: (mrUrl, now) => pendingRevision(mrUrl, now, db),
    insertPendingRevision: r => insertPendingRevision(r, db),
    deleteRevision: (mrUrl, findingId, createdAt) =>
      deleteRevision(mrUrl, findingId, createdAt, db),
  };
  return { io, files, closes };
}

/** Seeds the row an ask would have written and returns its handle. */
function seed(findingId = 'f1'): string {
  writeQuestionState(
    MR,
    findingId,
    { iid: 9, gateId: 'g-old', status: 'live' },
    NOW,
    db
  );
  return questionHandle(MR, findingId);
}

function input(
  handle: string,
  over: Partial<SendBackInput> = {}
): SendBackInput {
  return {
    handle,
    revision: { finding: finding('f1', 'new title') },
    reportSha: sha(reportText),
    now: NOW,
    ...over,
  };
}

function revisionRows(): number {
  return (
    db.query('SELECT COUNT(*) AS n FROM finding_revisions').get() as {
      n: number;
    }
  ).n;
}

describe('sendBack refusals', () => {
  test('a handle with no question row', async () => {
    const h = harness();
    const r = await sendBack(input('/board/state/questions/nope.json'), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message: 'this question is no longer tracked by the board',
    });
    expect(h.closes).toEqual([]);
  });

  test('a revision that changes the finding id', async () => {
    const h = harness();
    const r = await sendBack(
      input(seed(), { revision: { finding: finding('f2') } }),
      h.io
    );
    expect(r).toEqual({
      kind: 'refused',
      message: 'the revision must keep finding id f1',
    });
    expect(h.closes).toEqual([]);
  });

  test('a parked review gate', async () => {
    const h = harness({ openGate: 'parked' });
    const r = await sendBack(input(seed()), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message:
        'the review is parked; resume it from the board, then send again',
    });
    expect(h.closes).toEqual([]);
  });

  test('no review gate at all', async () => {
    const h = harness({ openGate: null });
    const r = await sendBack(input(seed()), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message: 'the review was already submitted or closed',
    });
  });

  test('the gate no longer lists the finding', async () => {
    const h = harness({ openGate: gate({}, ['f2']) });
    const r = await sendBack(input(seed()), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message: 'this finding is no longer in the review',
    });
    expect(h.closes).toEqual([]);
  });

  test('a rebuild already in flight', async () => {
    const h = harness();
    insertPendingRevision(
      {
        mrUrl: MR,
        findingId: 'f2',
        original: finding('f2'),
        revised: null,
        closedGate: 'g-prev',
        createdAt: NOW - 1000,
      },
      db
    );
    const r = await sendBack(input(seed()), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message: 'the review is being rebuilt; send again once it reopens',
    });
    expect(h.closes).toEqual([]);
    expect(h.files.has(REVISION_PATH)).toBe(false);
  });

  test('a report that changed since the agent read it', async () => {
    const h = harness();
    const r = await sendBack(input(seed(), { reportSha: sha('older') }), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message:
        'the review report changed since you read it; re-read it and check the revision still holds',
    });
    expect(h.closes).toEqual([]);
    expect(revisionRows()).toBe(0);
  });

  test('a report that is gone counts as changed', async () => {
    const h = harness({ report: null });
    const r = await sendBack(input(seed()), h.io);
    expect(r.kind).toBe('refused');
    expect(h.closes).toEqual([]);
  });

  test('a report that no longer holds the finding', async () => {
    const text = JSON.stringify({ findings: [finding('f2')] });
    const h = harness({ report: text });
    const r = await sendBack(input(seed(), { reportSha: sha(text) }), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message: 'this finding is no longer in the review',
    });
    expect(h.closes).toEqual([]);
  });

  test('a gate answered between the lookup and the close leaves no revision behind', async () => {
    const h = harness({
      close: async () => ({ ok: false, error: 'already-answered' }),
    });
    const r = await sendBack(input(seed()), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message: 'the review was already submitted or closed',
    });
    expect(h.closes).toEqual([{ id: 'g-open', reason: 'revised' }]);
    expect(revisionRows()).toBe(0);
    expect(h.files.has(REVISION_PATH)).toBe(false);
  });

  test('already-closed reads the same', async () => {
    const h = harness({
      close: async () => ({ ok: false, error: 'already-closed' }),
    });
    const r = await sendBack(input(seed()), h.io);
    expect(r).toEqual({
      kind: 'refused',
      message: 'the review was already submitted or closed',
    });
    expect(revisionRows()).toBe(0);
  });

  test('any other close failure leaves nothing behind and says why', async () => {
    const h = harness({
      close: async () => ({ ok: false, error: 'daemon unreachable' }),
    });
    const r = await sendBack(input(seed()), h.io);
    expect(r.kind).toBe('refused');
    expect((r as { message: string }).message).toContain('daemon unreachable');
    expect(revisionRows()).toBe(0);
    expect(h.files.has(REVISION_PATH)).toBe(false);
  });

  test('a close that throws is cleaned up the same way', async () => {
    const h = harness({
      close: async () => {
        throw new Error('socket closed');
      },
    });
    const r = await sendBack(input(seed()), h.io);
    expect(r.kind).toBe('refused');
    expect(revisionRows()).toBe(0);
    expect(h.files.has(REVISION_PATH)).toBe(false);
  });
});

describe('sendBack success', () => {
  test('writes the revision file, a pending row, and closes the gate as revised', async () => {
    const h = harness();
    const revised = finding('f1', 'new title');
    const r = await sendBack(
      input(seed(), { revision: { finding: revised } }),
      h.io
    );
    expect(r).toEqual({ kind: 'sent' });
    expect(JSON.parse(h.files.get(REVISION_PATH)!)).toEqual({
      findingId: 'f1',
      revised,
      original: finding('f1'),
    });
    expect(pendingRevision(MR, NOW, db)).toMatchObject({
      findingId: 'f1',
      closedGate: 'g-open',
      revised,
      original: finding('f1'),
      createdAt: NOW,
    });
    expect(h.closes).toEqual([{ id: 'g-open', reason: 'revised' }]);
  });

  test('a drop writes revised null', async () => {
    const h = harness();
    const r = await sendBack(input(seed(), { revision: { drop: true } }), h.io);
    expect(r).toEqual({ kind: 'sent' });
    expect(JSON.parse(h.files.get(REVISION_PATH)!)).toEqual({
      findingId: 'f1',
      revised: null,
      original: finding('f1'),
    });
    expect(pendingRevision(MR, NOW, db)!.revised).toBeNull();
    expect(h.closes).toEqual([{ id: 'g-open', reason: 'revised' }]);
  });

  test('finds the finding in a gate option given as an object', async () => {
    const h = harness({
      openGate: gate({}, [{ value: 'f1', label: 'Old title' }]),
    });
    expect(await sendBack(input(seed()), h.io)).toEqual({ kind: 'sent' });
  });

  test('finds the finding in an unchunked findings question', async () => {
    const g = gate();
    g.questions[0]!.id = 'findings';
    const h = harness({ openGate: g });
    expect(await sendBack(input(seed()), h.io)).toEqual({ kind: 'sent' });
  });

  test('does not count an option on a question that is not a findings question', async () => {
    const g = gate({}, ['f2']);
    g.questions[1]!.options = ['f1'];
    const h = harness({ openGate: g });
    const r = await sendBack(input(seed()), h.io);
    expect(r.kind).toBe('refused');
  });
});

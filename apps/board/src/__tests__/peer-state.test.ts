import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ASK_HISTORY_MS } from '../peer/ask-inbox.ts';
import {
  dismissSentNudge,
  finishSentNudge,
  markNudgeHandled,
  markNudgeNotified,
  NUDGE_NO_RESPONSE_MS,
  NUDGE_QUIET_MS,
  pendingNudgesByMr,
  pruneFinishedSentNudges,
  pruneNudges,
  pruneSentNudges,
  readNudges,
  readSentNudges,
  resolveSentNudge,
  reviewerDisplayName,
  SENT_FINISH_KEEP_MS,
  sentNudgeDisplay,
  sentNudgeView,
  writeNudge,
  writeSentNudge,
  type NudgeState,
  type SentNudge,
} from '../peer/nudges.ts';
import {
  attachPeerReviews,
  importPeerReviewFiles,
  peerReviewFilePath,
  peerReviewKey,
  prunePeerReviews,
  readPeerReviews,
  writePeerReview,
  type PeerReviewState,
} from '../peer/peer-reviews.ts';
import { openStateDb } from '../state/db.ts';
import { getKvValue } from '../state/kv-blob.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ps-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/1';

describe('peerReviewFilePath', () => {
  test('is deterministic and lives under the dir', () => {
    expect(peerReviewFilePath(URL_A, 'grace', dir)).toBe(
      peerReviewFilePath(URL_A, 'grace', dir)
    );
    expect(peerReviewFilePath(URL_A, 'grace', dir).startsWith(dir)).toBe(true);
    expect(peerReviewFilePath(URL_A, 'grace', dir).endsWith('.json')).toBe(
      true
    );
  });
});

describe('peerReviewKey', () => {
  test('separates MR and reviewer so the pair is unique', () => {
    expect(peerReviewKey(URL_A, 'grace')).toBe(`${URL_A}\ngrace`);
    expect(peerReviewKey(URL_A, 'grace')).not.toBe(peerReviewKey(URL_A, 'ada'));
  });
});

describe('writePeerReview', () => {
  const base = (over: Partial<PeerReviewState> = {}): PeerReviewState => ({
    mrUrl: URL_A,
    iid: 4821,
    reviewer: 'grace',
    status: 'reviewing',
    updatedAt: 1000,
    ...over,
  });

  test('first write returns true and persists', () => {
    expect(writePeerReview(base(), db)).toBe(true);
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('reviewing');
  });

  test('a newer state replaces an older one', () => {
    writePeerReview(base({ updatedAt: 1000, status: 'reviewing' }), db);
    expect(writePeerReview(base({ updatedAt: 2000, status: 'done' }), db)).toBe(
      true
    );
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('done');
  });

  test('an older or equal state is ignored', () => {
    writePeerReview(base({ updatedAt: 2000, status: 'done' }), db);
    expect(
      writePeerReview(base({ updatedAt: 1000, status: 'reviewing' }), db)
    ).toBe(false);
    expect(
      writePeerReview(base({ updatedAt: 2000, status: 'error' }), db)
    ).toBe(false);
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('done');
  });

  test('a busy commit returns false and rolls back the write', () => {
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 0');
    const reader = new Database(join(dir, 'state.db'));
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    let wrote: boolean;
    try {
      reader.exec('BEGIN');
      reader.query('SELECT * FROM kv').all();
      wrote = writePeerReview(base(), db);
    } finally {
      reader.exec('ROLLBACK');
      reader.close();
      console.error = originalError;
    }
    expect(readPeerReviews(db).size).toBe(0);
    expect(errors).toEqual([['peer review write: write skipped (db busy)']]);
    expect(wrote).toBe(false);
  });

  test('writes nothing to the legacy folder', () => {
    writePeerReview(base(), db);
    expect(existsSync(peerReviewFilePath(URL_A, 'grace', dir))).toBe(false);
  });
});

describe('importPeerReviewFiles', () => {
  const legacy = () => join(dir, 'peer-reviews');
  const put = (s: PeerReviewState) => {
    mkdirSync(legacy(), { recursive: true });
    writeFileSync(
      peerReviewFilePath(s.mrUrl, s.reviewer, legacy()),
      JSON.stringify(s)
    );
  };
  const NOW = new Date('2026-10-02T12:00:00');
  const marker = () => getKvValue('meta', 'peer-reviews-imported', false, db);

  test('imports each file, sets the marker and renames the folder aside', () => {
    put({
      mrUrl: URL_A,
      iid: 4821,
      reviewer: 'grace',
      status: 'done',
      updatedAt: 5,
    });
    put({
      mrUrl: URL_B,
      iid: 1,
      reviewer: 'ada',
      status: 'reviewing',
      updatedAt: 5,
    });
    expect(importPeerReviewFiles(db, legacy(), NOW)).toEqual({
      imported: 2,
      skipped: 0,
      renamed: true,
    });
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('done');
    expect(readPeerReviews(db).get(URL_B)?.[0]?.status).toBe('reviewing');
    expect(marker()).toBe(true);
    expect(existsSync(legacy())).toBe(false);
    expect(readdirSync(dir)).toContain('peer-reviews.imported-2026-10-02');
  });

  test('a newer db row wins over an older file', () => {
    writePeerReview(
      {
        mrUrl: URL_A,
        iid: 4821,
        reviewer: 'grace',
        status: 'done',
        updatedAt: 9,
      },
      db
    );
    put({
      mrUrl: URL_A,
      iid: 4821,
      reviewer: 'grace',
      status: 'reviewing',
      updatedAt: 5,
    });
    expect(importPeerReviewFiles(db, legacy(), NOW).imported).toBe(1);
    expect(readPeerReviews(db).get(URL_A)?.[0]?.status).toBe('done');
    expect(marker()).toBe(true);
  });

  test('skips unreadable and invalid files, imports the rest and sets the marker', () => {
    put({
      mrUrl: URL_A,
      iid: 4821,
      reviewer: 'grace',
      status: 'done',
      updatedAt: 5,
    });
    writeFileSync(join(legacy(), 'broken.json'), '{not json');
    mkdirSync(join(legacy(), 'unreadable.json'));
    writeFileSync(join(legacy(), 'invalid.json'), '{}');
    writeFileSync(join(legacy(), 'ignored.txt'), '{not json');
    expect(importPeerReviewFiles(db, legacy(), NOW)).toEqual({
      imported: 1,
      skipped: 3,
      renamed: true,
    });
    expect(readPeerReviews(db).has(URL_A)).toBe(true);
    expect(marker()).toBe(true);
  });

  test('a second run is inert, and a missing folder just sets the marker', () => {
    expect(importPeerReviewFiles(db, legacy(), NOW)).toEqual({
      imported: 0,
      skipped: 0,
      renamed: false,
    });
    expect(marker()).toBe(true);
    put({
      mrUrl: URL_A,
      iid: 4821,
      reviewer: 'grace',
      status: 'done',
      updatedAt: 5,
    });
    expect(importPeerReviewFiles(db, legacy(), NOW)).toEqual({
      imported: 0,
      skipped: 0,
      renamed: false,
    });
    expect(readPeerReviews(db).size).toBe(0);
    expect(existsSync(legacy())).toBe(true);
  });

  test('a busy write leaves the marker unset and legacy files intact for retry', () => {
    put({
      mrUrl: URL_A,
      iid: 4821,
      reviewer: 'grace',
      status: 'done',
      updatedAt: 5,
    });
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 0');
    const reader = new Database(join(dir, 'state.db'));
    const originalTransaction = db.transaction.bind(db);
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => errors.push(args);
    reader.exec('BEGIN');
    reader.query('SELECT * FROM kv').all();
    db.transaction = ((fn: () => unknown) => {
      const transaction = originalTransaction(fn);
      return () => {
        try {
          return transaction();
        } finally {
          reader.exec('ROLLBACK');
        }
      };
    }) as typeof db.transaction;
    try {
      expect(() => importPeerReviewFiles(db, legacy(), NOW)).toThrow();
    } finally {
      db.transaction = originalTransaction;
      reader.close();
      console.error = originalError;
    }
    expect(errors).toEqual([['peer review write: write skipped (db busy)']]);
    expect(readPeerReviews(db).size).toBe(0);
    expect(marker()).toBe(false);
    expect(existsSync(peerReviewFilePath(URL_A, 'grace', legacy()))).toBe(true);
    expect(importPeerReviewFiles(db, legacy(), NOW)).toEqual({
      imported: 1,
      skipped: 0,
      renamed: true,
    });
    expect(marker()).toBe(true);
  });
});

describe('readPeerReviews', () => {
  test('groups one entry per reviewer under each MR', () => {
    writePeerReview(
      {
        mrUrl: URL_A,
        iid: 4821,
        reviewer: 'grace',
        status: 'done',
        updatedAt: 1,
      },
      db
    );
    writePeerReview(
      {
        mrUrl: URL_A,
        iid: 4821,
        reviewer: 'ada',
        status: 'reviewing',
        updatedAt: 1,
      },
      db
    );
    writePeerReview(
      { mrUrl: URL_B, iid: 1, reviewer: 'grace', status: 'done', updatedAt: 1 },
      db
    );
    const map = readPeerReviews(db);
    expect(
      map
        .get(URL_A)
        ?.map(r => r.reviewer)
        .sort()
    ).toEqual(['ada', 'grace']);
    expect(map.get(URL_B)?.length).toBe(1);
  });

  test('returns an empty map on an empty db', () => {
    expect(readPeerReviews(db).size).toBe(0);
  });
});

describe('prunePeerReviews', () => {
  test('keeps states whose MR is kept, deletes the rest', () => {
    writePeerReview(
      {
        mrUrl: URL_A,
        iid: 4821,
        reviewer: 'grace',
        status: 'reviewing',
        updatedAt: 1,
      },
      db
    );
    writePeerReview(
      {
        mrUrl: URL_B,
        iid: 1,
        reviewer: 'grace',
        status: 'reviewing',
        updatedAt: 1,
      },
      db
    );
    prunePeerReviews(new Set([URL_A]), db);
    const map = readPeerReviews(db);
    expect(map.has(URL_A)).toBe(true);
    expect(map.has(URL_B)).toBe(false);
  });
});

describe('attachPeerReviews', () => {
  test('attaches peerReviews by webUrl, leaves others untouched', () => {
    const map = new Map<string, PeerReviewState[]>([
      [
        URL_A,
        [
          {
            mrUrl: URL_A,
            iid: 4821,
            reviewer: 'grace',
            status: 'reviewing',
            updatedAt: 1,
          },
        ],
      ],
    ]);
    const [a, b] = attachPeerReviews(
      [{ webUrl: URL_A }, { webUrl: 'https://other/mr/9' }],
      map
    );
    expect(a!.peerReviews?.length).toBe(1);
    expect(b!.peerReviews).toBeUndefined();
  });
});

describe('writeNudge / readNudges', () => {
  const n = (over: Partial<NudgeState> = {}): NudgeState => ({
    id: 'n1',
    mrUrl: URL_A,
    iid: 4821,
    from: 'ada',
    receivedAt: 1,
    ...over,
  });

  test('dedupes by id -- second write with same id is a no-op', () => {
    writeNudge(n({ note: 'first' }), db);
    writeNudge(n({ note: 'second' }), db);
    const all = readNudges(db);
    expect(all.length).toBe(1);
    expect(all[0]!.note).toBe('first');
  });

  test('readNudges returns empty array with no rows', () => {
    expect(readNudges(db)).toEqual([]);
  });
});

describe('markNudgeHandled', () => {
  test('round-trips the handled result and reason', () => {
    writeNudge(
      { id: 'n1', mrUrl: URL_A, iid: 4821, from: 'ada', receivedAt: 1 },
      db
    );
    markNudgeHandled('n1', 'launched', 'checked out and ran it', db, 5000);
    const handled = readNudges(db).find(x => x.id === 'n1');
    expect(handled?.handled).toEqual({
      at: 5000,
      result: 'launched',
      reason: 'checked out and ran it',
    });
  });
});

describe('ask consent rows', () => {
  test('notified marker and handled note persist', () => {
    writeNudge({ id: 'n', mrUrl: 'u', iid: 1, from: 'rae', receivedAt: 1 }, db);
    markNudgeNotified('n', db, 7);
    markNudgeHandled('n', 'rejected', 'busy right now', db, 9, {
      note: 'after standup',
      declined: true,
    });
    expect(readNudges(db)[0]).toMatchObject({
      notifiedAt: 7,
      handled: {
        at: 9,
        result: 'rejected',
        reason: 'busy right now',
        note: 'after standup',
        declined: true,
      },
    });
  });

  test('prune keeps a waiting ask off the board, drops history past 14 days', () => {
    const now = 30 * 24 * 60 * 60_000;
    writeNudge(
      {
        id: 'wait',
        mrUrl: 'off',
        iid: 1,
        from: 'rae',
        receivedAt: now - 60_000,
      },
      db
    );
    writeNudge(
      {
        id: 'old',
        mrUrl: 'on',
        iid: 2,
        from: 'rae',
        receivedAt: 1,
        handled: { at: now - ASK_HISTORY_MS - 1, result: 'launched' },
      },
      db
    );
    writeNudge(
      {
        id: 'recent',
        mrUrl: 'off',
        iid: 3,
        from: 'rae',
        receivedAt: 1,
        handled: { at: now - 1000, result: 'launched' },
      },
      db
    );
    writeNudge(
      {
        id: 'lost',
        mrUrl: 'off',
        iid: 4,
        from: 'rae',
        receivedAt: now - ASK_HISTORY_MS - 1,
      },
      db
    );
    pruneNudges(new Set(['on']), db, now);
    expect(
      readNudges(db)
        .map(n => n.id)
        .sort()
    ).toEqual(['recent', 'wait']);
  });
});

describe('pruneNudges', () => {
  test('keeps nudges whose MR is kept, deletes the rest', () => {
    writeNudge(
      { id: 'n1', mrUrl: URL_A, iid: 4821, from: 'ada', receivedAt: 1 },
      db
    );
    writeNudge(
      { id: 'n2', mrUrl: URL_B, iid: 1, from: 'ada', receivedAt: 1 },
      db
    );
    pruneNudges(new Set([URL_A]), db);
    const ids = readNudges(db).map(x => x.id);
    expect(ids).toEqual(['n1']);
  });
});

describe('writeSentNudge / readSentNudges', () => {
  test('one row per MR, keyed by mrUrl on read', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    const map = readSentNudges(db);
    expect(map.get(URL_A)?.nudgeId).toBe('n1');
  });
});

describe('resolveSentNudge', () => {
  test('a progress confirmation refreshes a launched ask', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    resolveSentNudge(URL_A, { result: 'confirmed', at: 50 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'confirmed',
      at: 50,
    });
  });

  test('a confirmation never replaces a declined or expired ask', () => {
    for (const result of ['rejected', 'expired'] as const) {
      writeSentNudge(
        {
          nudgeId: 'n1',
          mrUrl: URL_A,
          iid: 4821,
          reviewer: 'grace',
          sentAt: 1,
        },
        db
      );
      resolveSentNudge(URL_A, { result, at: 10 }, db);
      resolveSentNudge(URL_A, { result: 'confirmed', at: 50 }, db);
      expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe(result);
    }
  });

  test('is a no-op when no row exists for the MR', () => {
    resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    expect(readSentNudges(db).size).toBe(0);
  });

  test('merges the resolution into the existing sent-nudge row', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'launched',
      at: 10,
    });
  });

  test('does not overwrite an existing terminal resolution', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    resolveSentNudge(URL_A, { result: 'rejected', at: 20 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'launched',
      at: 10,
    });
  });

  test("a 'confirmed' resolution may still be replaced by a later terminal result", () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'confirmed', at: 10 }, db);
    resolveSentNudge(URL_A, { result: 'launched', at: 20 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'launched',
      at: 20,
    });
  });

  test('a re-sent nudge that lands between the read and the mutation is not overwritten with stale identity', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );

    // A second connection stands in for a writeSentNudge that replaces this
    // row with a brand new ask right before resolveSentNudge's own UPDATE
    // runs. The guard (`prev.resolution` undefined/confirmed) and the
    // mutation must see the same snapshot, or this resolves a nudge that
    // was already superseded.
    const other = openStateDb(db.filename);
    const originalQuery = db.query.bind(db);
    let injected = false;
    (db as unknown as { query: typeof db.query }).query = ((sql: string) => {
      if (!injected && sql.includes('UPDATE nudges_sent')) {
        injected = true;
        other
          .query(
            `INSERT INTO nudges_sent (mr_url, nudge, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(mr_url) DO UPDATE SET nudge = excluded.nudge, updated_at = excluded.updated_at`
          )
          .run(
            URL_A,
            JSON.stringify({
              nudgeId: 'n2',
              mrUrl: URL_A,
              iid: 4821,
              reviewer: 'grace',
              sentAt: 50,
            }),
            50
          );
      }
      return originalQuery(sql);
    }) as typeof db.query;

    try {
      resolveSentNudge(URL_A, { result: 'launched', at: 10 }, db);
    } finally {
      (db as unknown as { query: typeof db.query }).query = originalQuery;
      other.close();
    }

    expect(injected).toBe(true);
    const row = readSentNudges(db).get(URL_A);
    expect(row?.nudgeId).toBe('n2');
    expect(row?.resolution).toEqual({ result: 'launched', at: 10 });
  });
});

const DONE = { result: 'done' as const, at: 1 };

describe('finishSentNudge', () => {
  test('done after failed still requires the matching ask, reviewer and fallback time', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    const stopped = {
      result: 'failed' as const,
      reason: 'pane closed',
      at: 10,
    };
    finishSentNudge(URL_A, stopped, 5, db, 'n1', 'grace');
    finishSentNudge(URL_A, DONE, 5, db, 'old-ask', 'grace');
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual(stopped);
    finishSentNudge(URL_A, DONE, 5, db, 'n1', 'bob');
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual(stopped);
    finishSentNudge(URL_A, DONE, 1, db, undefined, 'grace');
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual(stopped);
    finishSentNudge(URL_A, DONE, 5, db, undefined, 'grace');
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual(DONE);
  });

  test('done replaces failed; rejected, expired and done stay final', () => {
    const send = () =>
      writeSentNudge(
        {
          nudgeId: 'n1',
          mrUrl: URL_A,
          iid: 4821,
          reviewer: 'grace',
          sentAt: 1,
        },
        db
      );
    send();
    finishSentNudge(
      URL_A,
      { result: 'failed', reason: 'pane closed', at: 10 },
      5,
      db,
      'n1'
    );
    finishSentNudge(
      URL_A,
      { result: 'done', outcome: 'comment', at: 20 },
      5,
      db,
      'n1'
    );
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'done',
      outcome: 'comment',
      at: 20,
    });
    finishSentNudge(URL_A, { result: 'failed', at: 30 }, 5, db, 'n1');
    expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe('done');
    for (const result of ['rejected', 'expired'] as const) {
      send();
      resolveSentNudge(URL_A, { result, at: 10 }, db);
      finishSentNudge(URL_A, { result: 'done', at: 20 }, 5, db, 'n1');
      expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe(result);
    }
  });

  test('is a no-op when no row exists for the MR', () => {
    finishSentNudge(URL_A, DONE, 10, db);
    expect(readSentNudges(db).size).toBe(0);
  });

  test('marks the sent nudge done when it was sent before the cutoff', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 5 }, db);
    finishSentNudge(URL_A, DONE, 10, db);
    expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe('done');
  });

  test("keeps a nudge sent at or after the cutoff, so a redelivered old 'done' cannot clear a fresh ask", () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 20 },
      db
    );
    finishSentNudge(URL_A, DONE, 10, db);
    expect(readSentNudges(db).has(URL_A)).toBe(true);
    finishSentNudge(URL_A, DONE, 20, db);
    expect(readSentNudges(db).has(URL_A)).toBe(true);
  });

  test('a matching nudge id finishes regardless of clock skew between boards', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 20 },
      db
    );
    // ifSentBefore says "keep" (author clock behind asker clock), but the id
    // pins the done to this exact ask.
    finishSentNudge(URL_A, DONE, 10, db, 'n1');
    expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe('done');
  });

  test('a mismatched nudge id never finishes, even when the timestamp allows', () => {
    writeSentNudge(
      { nudgeId: 'n2', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    finishSentNudge(URL_A, DONE, 10, db, 'n1');
    expect(readSentNudges(db).has(URL_A)).toBe(true);
  });

  test('only finishes the named MR', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    writeSentNudge(
      { nudgeId: 'n2', mrUrl: URL_B, iid: 1, reviewer: 'grace', sentAt: 1 },
      db
    );
    finishSentNudge(URL_A, DONE, 10, db);
    const map = readSentNudges(db);
    expect(map.get(URL_A)?.resolution?.result).toBe('done');
    expect(map.get(URL_B)?.resolution).toBeUndefined();
  });

  test('a fresh ask that lands between the read and the delete is not finished', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );

    // A second connection stands in for the fresh writeSentNudge that lands
    // right before finishSentNudge's own UPDATE runs -- the exact case the
    // ifSentBefore guard exists for.
    const other = openStateDb(db.filename);
    const originalQuery = db.query.bind(db);
    let injected = false;
    (db as unknown as { query: typeof db.query }).query = ((sql: string) => {
      if (!injected && sql.includes('UPDATE nudges_sent')) {
        injected = true;
        other
          .query(
            `INSERT INTO nudges_sent (mr_url, nudge, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(mr_url) DO UPDATE SET nudge = excluded.nudge, updated_at = excluded.updated_at`
          )
          .run(
            URL_A,
            JSON.stringify({
              nudgeId: 'n2',
              mrUrl: URL_A,
              iid: 4821,
              reviewer: 'grace',
              sentAt: 50,
            }),
            50
          );
      }
      return originalQuery(sql);
    }) as typeof db.query;

    try {
      finishSentNudge(URL_A, DONE, 10, db);
    } finally {
      (db as unknown as { query: typeof db.query }).query = originalQuery;
      other.close();
    }

    expect(injected).toBe(true);
    expect(readSentNudges(db).get(URL_A)?.nudgeId).toBe('n2');
  });

  test('records the outcome and the finish time', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    finishSentNudge(
      URL_A,
      { result: 'done', outcome: 'comment', at: 99 },
      10,
      db
    );
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'done',
      outcome: 'comment',
      at: 99,
    });
  });

  test('a failed run is recorded with its reason', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'launched', at: 5 }, db);
    finishSentNudge(URL_A, { result: 'failed', reason: 'boom', at: 9 }, 10, db);
    expect(readSentNudges(db).get(URL_A)?.resolution).toEqual({
      result: 'failed',
      reason: 'boom',
      at: 9,
    });
  });

  test('a redelivered report never overwrites a finished ask', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    finishSentNudge(URL_A, { result: 'done', at: 20 }, 10, db);
    finishSentNudge(URL_A, { result: 'failed', at: 30 }, 10, db);
    resolveSentNudge(URL_A, { result: 'confirmed', at: 40 }, db);
    expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe('done');
  });

  test('a rejected ask stays rejected', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    resolveSentNudge(URL_A, { result: 'rejected', at: 5 }, db);
    finishSentNudge(URL_A, { result: 'done', at: 20 }, 10, db);
    expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe('rejected');
  });
});

describe('a report only counts from the teammate that was asked', () => {
  const ask = () =>
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );

  test('another reviewer finishing the MR leaves the ask alone', () => {
    ask();
    finishSentNudge(URL_A, DONE, 10, db, undefined, 'bob');
    expect(readSentNudges(db).get(URL_A)?.resolution).toBeUndefined();
  });

  test('the asked reviewer finishes it', () => {
    ask();
    finishSentNudge(URL_A, DONE, 10, db, undefined, 'grace');
    expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe('done');
  });

  test('another reviewer starting a review does not confirm the ask', () => {
    ask();
    resolveSentNudge(URL_A, { result: 'confirmed', at: 5 }, db, 'bob');
    expect(readSentNudges(db).get(URL_A)?.resolution).toBeUndefined();
    resolveSentNudge(URL_A, { result: 'confirmed', at: 6 }, db, 'grace');
    expect(readSentNudges(db).get(URL_A)?.resolution?.result).toBe('confirmed');
  });
});

describe('reviewerDisplayName', () => {
  const members = [
    { username: 'Grace', name: 'Grace Hopper' },
    { username: 'bob', name: null },
  ];

  test('finds a roster entry whatever the case of its username', () => {
    expect(reviewerDisplayName('grace', members, new Map())).toBe(
      'Grace Hopper'
    );
  });

  test('prefers the resolved display name over the configured one', () => {
    expect(
      reviewerDisplayName('grace', members, new Map([['Grace', 'G. Hopper']]))
    ).toBe('G. Hopper');
  });

  test('is undefined for a member with no name or no roster entry', () => {
    expect(reviewerDisplayName('bob', members, new Map())).toBeUndefined();
    expect(reviewerDisplayName('zed', members, new Map())).toBeUndefined();
  });
});

describe('dismissSentNudge', () => {
  test('deletes only the named MR sent ask', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    writeSentNudge(
      { nudgeId: 'n2', mrUrl: URL_B, iid: 1, reviewer: 'grace', sentAt: 1 },
      db
    );
    dismissSentNudge(URL_A, db);
    const map = readSentNudges(db);
    expect(map.has(URL_A)).toBe(false);
    expect(map.has(URL_B)).toBe(true);
  });
});

describe('pruneFinishedSentNudges', () => {
  test('drops finished asks past the keep window and nothing else', () => {
    const base = { iid: 1, reviewer: 'grace', sentAt: 1 };
    writeSentNudge({ ...base, nudgeId: 'a', mrUrl: URL_A }, db);
    finishSentNudge(URL_A, { result: 'done', at: 1000 }, 10, db);
    writeSentNudge({ ...base, nudgeId: 'b', mrUrl: URL_B }, db);
    pruneFinishedSentNudges(1000 + SENT_FINISH_KEEP_MS + 1, db);
    const map = readSentNudges(db);
    expect(map.has(URL_A)).toBe(false);
    expect(map.has(URL_B)).toBe(true);
  });

  test('keeps a finished ask inside the window', () => {
    writeSentNudge(
      { nudgeId: 'a', mrUrl: URL_A, iid: 1, reviewer: 'grace', sentAt: 1 },
      db
    );
    finishSentNudge(URL_A, { result: 'failed', at: 1000 }, 10, db);
    pruneFinishedSentNudges(1000 + SENT_FINISH_KEEP_MS - 1, db);
    expect(readSentNudges(db).has(URL_A)).toBe(true);
  });
});

describe('pruneSentNudges', () => {
  test('keeps sent nudges whose MR is kept, deletes the rest', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: URL_A, iid: 4821, reviewer: 'grace', sentAt: 1 },
      db
    );
    writeSentNudge(
      { nudgeId: 'n2', mrUrl: URL_B, iid: 1, reviewer: 'grace', sentAt: 1 },
      db
    );
    pruneSentNudges(new Set([URL_A]), db);
    const map = readSentNudges(db);
    expect(map.has(URL_A)).toBe(true);
    expect(map.has(URL_B)).toBe(false);
  });
});

describe('sentNudgeDisplay', () => {
  test('a launched or confirmed ask quiet past NUDGE_QUIET_MS reads no-update', () => {
    const base: SentNudge = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'matt',
      sentAt: 0,
    };
    for (const result of ['launched', 'confirmed'] as const) {
      const n = { ...base, resolution: { result, at: 100 } };
      expect(sentNudgeDisplay(n, 100 + NUDGE_QUIET_MS)).toBe(result);
      expect(sentNudgeDisplay(n, 100 + NUDGE_QUIET_MS + 1)).toBe('no-update');
    }
  });

  test('an unanswered ask never reads no-update', () => {
    const base: SentNudge = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'matt',
      sentAt: 0,
    };
    expect(sentNudgeDisplay(base, NUDGE_QUIET_MS + 1)).toBe('requested');
  });

  test('finished, declined and expired asks never read no-update', () => {
    const base: SentNudge = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'matt',
      sentAt: 0,
    };
    for (const result of ['done', 'failed', 'rejected', 'expired'] as const)
      expect(
        sentNudgeDisplay(
          { ...base, resolution: { result, at: 0 } },
          NUDGE_QUIET_MS * 10
        )
      ).toBe(result);
  });

  test('honours resolution then self-expiry', () => {
    const base: SentNudge = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'matt',
      sentAt: 0,
    };
    expect(sentNudgeDisplay(base, 1)).toBe('requested');
    expect(sentNudgeDisplay(base, NUDGE_NO_RESPONSE_MS + 1)).toBe(
      'no-response'
    );
    expect(
      sentNudgeDisplay(
        { ...base, resolution: { result: 'launched', at: 5 } },
        6
      )
    ).toBe('launched');
    expect(
      sentNudgeDisplay(
        { ...base, resolution: { result: 'confirmed', at: 5 } },
        6
      )
    ).toBe('confirmed');
    expect(
      sentNudgeDisplay(
        { ...base, resolution: { result: 'done', at: 5 } },
        NUDGE_NO_RESPONSE_MS + 1
      )
    ).toBe('done');
    expect(
      sentNudgeDisplay({ ...base, resolution: { result: 'failed', at: 5 } }, 6)
    ).toBe('failed');
  });
});

describe('sentNudgeView', () => {
  const base: SentNudge = {
    nudgeId: 'n',
    mrUrl: URL_A,
    iid: 1,
    reviewer: 'grace',
    sentAt: 100,
    kind: 're-review',
  };

  test('carries the display, reviewer, kind and send time', () => {
    expect(sentNudgeView(base, 200)).toEqual({
      display: 'requested',
      reviewer: 'grace',
      kind: 're-review',
      sentAt: 100,
    });
  });

  test('a done ask carries its verdict and finish time', () => {
    const done: SentNudge = {
      ...base,
      resolution: { result: 'done', outcome: 'comment', at: 150 },
    };
    expect(sentNudgeView(done, 200)).toMatchObject({
      display: 'done',
      outcome: 'comment',
      finishedAt: 150,
    });
  });

  test('a failed or rejected ask carries its reason', () => {
    const failed: SentNudge = {
      ...base,
      resolution: { result: 'failed', reason: 'boom', at: 150 },
    };
    expect(sentNudgeView(failed, 200)).toMatchObject({
      display: 'failed',
      reason: 'boom',
      finishedAt: 150,
    });
  });

  test('a finished ask past its keep window is off the row', () => {
    const done: SentNudge = {
      ...base,
      resolution: { result: 'done', at: 150 },
    };
    expect(sentNudgeView(done, 150 + SENT_FINISH_KEEP_MS + 1)).toBeNull();
  });

  test('an unanswered ask is never hidden by age', () => {
    expect(sentNudgeView(base, 100 + SENT_FINISH_KEEP_MS * 5)).toMatchObject({
      display: 'no-response',
    });
  });
});

describe('pendingNudgesByMr', () => {
  const ask = (id: string, mrUrl: string, extra: Partial<NudgeState> = {}) =>
    ({
      id,
      mrUrl,
      iid: 1,
      from: 'jo',
      receivedAt: 100,
      kind: 'review',
      ...extra,
    }) satisfies NudgeState;

  test('groups unhandled asks by MR and drops handled ones', () => {
    const byMr = pendingNudgesByMr(
      [
        ask('a', 'u1'),
        ask('b', 'u1', { from: 'sam' }),
        ask('c', 'u2', { handled: { at: 1, result: 'rejected' } }),
      ],
      true
    );
    expect([...byMr.keys()]).toEqual(['u1']);
    expect(byMr.get('u1')).toEqual([
      { from: 'jo', receivedAt: 100, kind: 'review' },
      { from: 'sam', receivedAt: 100, kind: 'review' },
    ]);
  });

  test('with triage off every ask waits for a click', () => {
    const byMr = pendingNudgesByMr([ask('a', 'u1')], false);
    expect(byMr.get('u1')).toEqual([
      { from: 'jo', receivedAt: 100, kind: 'review', awaitsClick: true },
    ]);
  });
});

describe('pending and declined asks', () => {
  test('a late pending never overwrites a started ask', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: 'u', iid: 1, reviewer: 'mira', sentAt: 0 },
      db
    );
    resolveSentNudge('u', { result: 'confirmed', at: 1 }, db);
    resolveSentNudge('u', { result: 'pending', at: 2 }, db);
    expect(readSentNudges(db).get('u')?.resolution?.result).toBe('confirmed');
  });
  test('pending is replaced by any later answer', () => {
    writeSentNudge(
      {
        nudgeId: 'n1',
        mrUrl: 'u',
        iid: 1,
        reviewer: 'mira',
        sentAt: 0,
        kind: 'review',
      },
      db
    );
    resolveSentNudge('u', { result: 'pending', at: 1 }, db);
    resolveSentNudge('u', { result: 'launched', at: 2 }, db);
    expect(readSentNudges(db).get('u')?.resolution?.result).toBe('launched');
  });
  test('a late pending never overwrites a rejected ask', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: 'u', iid: 1, reviewer: 'mira', sentAt: 0 },
      db
    );
    resolveSentNudge('u', { result: 'rejected', reason: 'busy', at: 1 }, db);
    resolveSentNudge('u', { result: 'pending', at: 2 }, db);
    expect(readSentNudges(db).get('u')?.resolution?.result).toBe('rejected');
  });
  test('a decline keeps its flag and note', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: 'u', iid: 1, reviewer: 'mira', sentAt: 0 },
      db
    );
    resolveSentNudge('u', { result: 'pending', at: 1 }, db);
    resolveSentNudge(
      'u',
      {
        result: 'rejected',
        reason: 'busy right now',
        declined: true,
        declineNote: 'after standup',
        at: 2,
      },
      db
    );
    const view = sentNudgeView(readSentNudges(db).get('u')!, 3);
    expect(view).toMatchObject({
      display: 'rejected',
      reason: 'busy right now',
      declined: true,
      declineNote: 'after standup',
    });
  });
  test('pending reads no-response after 48h like an unanswered ask', () => {
    const n = {
      nudgeId: 'n',
      mrUrl: 'u',
      iid: 1,
      reviewer: 'mira',
      sentAt: 0,
      resolution: { result: 'pending' as const, at: 10 },
    };
    expect(sentNudgeDisplay(n, 10 + NUDGE_NO_RESPONSE_MS - 1)).toBe('pending');
    expect(sentNudgeDisplay(n, 10 + NUDGE_NO_RESPONSE_MS + 1)).toBe(
      'no-response'
    );
  });
  test('a pending ask can still finish when the run reports done', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: 'u', iid: 1, reviewer: 'mira', sentAt: 0 },
      db
    );
    resolveSentNudge('u', { result: 'pending', at: 1 }, db);
    finishSentNudge(
      'u',
      { result: 'done', outcome: 'comment', at: 5 },
      9,
      db,
      'n1'
    );
    expect(readSentNudges(db).get('u')?.resolution?.result).toBe('done');
  });
});

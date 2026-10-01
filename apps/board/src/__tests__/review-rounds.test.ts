import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  dropRounds,
  ledgerView,
  qualifySkippedId,
  readRounds,
  recordRound,
  type ReviewRound,
  type SkippedFinding,
} from '../review-rounds.ts';
import { openStateDb } from '../state/db.ts';

const URL_A = 'https://gitlab.example.com/acme/webapp/-/merge_requests/41';
let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rr-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const skip = (id: string, title: string): SkippedFinding => ({
  id,
  title,
  severity: 'minor',
  file: 'src/cart.ts',
  line: 12,
  excerpt: 'why',
  snippet: 'const a = 1;',
});
const round = (n: number, over: Partial<ReviewRound> = {}): ReviewRound => ({
  mrUrl: URL_A,
  round: n,
  reviewedSha: `sha${n}`,
  outcome: 'comment',
  skipped: [],
  restored: [],
  confirmed: [],
  recordedAt: n * 1000,
  ...over,
});

describe('review rounds', () => {
  test('an MR with no rounds reads as round 0', () => {
    expect(ledgerView(readRounds(URL_A, db))).toEqual({
      round: 0,
      reviewedSha: null,
      rounds: [],
      skipped: [],
      confirmed: [],
    });
  });

  test('rounds read back in order with their json columns parsed', () => {
    recordRound(round(2, { confirmed: ['d2'] }), db);
    recordRound(
      round(1, { skipped: [skip('r1-f1', 'first')], confirmed: ['d1'] }),
      db
    );
    const rows = readRounds(URL_A, db);
    expect(rows.map(r => r.round)).toEqual([1, 2]);
    expect(rows[0]!.skipped[0]!.title).toBe('first');
    const view = ledgerView(rows);
    expect(view.round).toBe(2);
    expect(view.reviewedSha).toBe('sha2');
    expect(view.rounds).toEqual([
      { round: 1, reviewedSha: 'sha1', recordedAt: 1000 },
      { round: 2, reviewedSha: 'sha2', recordedAt: 2000 },
    ]);
    expect(view.confirmed).toEqual(['d1', 'd2']);
  });

  test('recording a round again replaces it', () => {
    recordRound(round(1, { outcome: 'comment' }), db);
    recordRound(round(1, { outcome: 'approve' }), db);
    expect(readRounds(URL_A, db).map(r => r.outcome)).toEqual(['approve']);
  });

  test('a restored finding leaves the skipped list; its namesake from another round stays', () => {
    recordRound(
      round(1, {
        skipped: [skip('r1-f1', 'round one f1'), skip('r1-f2', 'round one f2')],
      }),
      db
    );
    recordRound(
      round(2, {
        skipped: [skip('r2-f1', 'round two f1')],
        restored: ['r1-f1'],
      }),
      db
    );
    const view = ledgerView(readRounds(URL_A, db));
    expect(view.skipped.map(s => [s.id, s.round])).toEqual([
      ['r1-f2', 1],
      ['r2-f1', 2],
    ]);
  });

  test('qualifySkippedId prefixes a bare id and leaves a qualified one alone', () => {
    expect(qualifySkippedId(2, 'f3')).toBe('r2-f3');
    expect(qualifySkippedId(2, 'r1-f3')).toBe('r1-f3');
  });

  test('rounds are per MR, and dropRounds removes only that MR', () => {
    recordRound(round(1), db);
    recordRound(round(1, { mrUrl: `${URL_A}0` }), db);
    dropRounds(URL_A, db);
    expect(readRounds(URL_A, db)).toEqual([]);
    expect(readRounds(`${URL_A}0`, db)).toHaveLength(1);
  });

  test('a row whose json column is corrupt reads as empty lists, not a throw', () => {
    recordRound(round(1), db);
    db.run("UPDATE review_rounds SET skipped = 'not json' WHERE round = 1");
    expect(readRounds(URL_A, db)[0]!.skipped).toEqual([]);
  });

  test('dropping a pruned review drops its rounds', async () => {
    const { dropPrunedReviewState } = await import('../review-state.ts');
    recordRound(round(1), db);
    dropPrunedReviewState(URL_A, db);
    expect(readRounds(URL_A, db)).toEqual([]);
  });
});

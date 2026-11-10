import { afterEach, describe, expect, test } from 'bun:test';

import {
  CLOSED_REPORTED_NS,
  closedPaneReports,
  markClosedPaneReported,
  type ClosedPaneLane,
} from '../peer/closed-pane.ts';
import { makeEnvelope } from '../peer/envelope.ts';
import { readOutbox } from '../peer/outbox.ts';
import {
  clearLocalPark,
  commitReviewState,
  isReviewParked,
  LOCAL_PARK_NS,
  parkedPayload,
  pruneLocalParks,
  recordLocalPark,
  stoppedPayload,
} from '../peer/park-report.ts';
import { openStateDb } from '../state/db.ts';
import { listKvValues } from '../state/kv-blob.ts';

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

describe('parkedPayload', () => {
  test('stamps parkedAt and updatedAt with the same clock', () => {
    expect(parkedPayload({ iid: 4821 }, URL_A, 7_000)).toEqual({
      mrUrl: URL_A,
      iid: 4821,
      status: 'parked',
      parkedAt: 7_000,
      updatedAt: 7_000,
    });
  });
});

describe('stoppedPayload', () => {
  test('a parked review gate that closes reports stopped with the reason', () => {
    expect(
      stoppedPayload(
        { status: 'parked', kind: 'review-post', openedAt: 5_000 },
        URL_A,
        { iid: 4821, runStartedAt: 4_000 },
        'abandoned',
        8_000
      )
    ).toEqual({
      mrUrl: URL_A,
      iid: 4821,
      status: 'stopped',
      reason: 'abandoned',
      updatedAt: 8_000,
    });
  });

  test('a superseded parked review gate reports nothing', () => {
    expect(
      stoppedPayload(
        { status: 'parked', kind: 'review-post', openedAt: 5_000 },
        URL_A,
        { iid: 4821, runStartedAt: 4_000 },
        'superseded',
        8_000
      )
    ).toBeNull();
  });

  test('an open review gate that closes reports nothing', () => {
    expect(
      stoppedPayload(
        { status: 'open', kind: 'review-post', openedAt: 5_000 },
        URL_A,
        { iid: 4821, runStartedAt: 4_000 },
        'abandoned',
        8_000
      )
    ).toBeNull();
  });

  test("a parked gate from an earlier run reports nothing to the current run's ask", () => {
    expect(
      stoppedPayload(
        { status: 'parked', kind: 'review-post', openedAt: 3_000 },
        URL_A,
        { iid: 4821, runStartedAt: 4_000 },
        'abandoned',
        8_000
      )
    ).toBeNull();
  });

  test('a parked respond gate reports nothing', () => {
    expect(
      stoppedPayload(
        { status: 'parked', kind: 'respond-post', openedAt: 5_000 },
        URL_A,
        { iid: 4821, runStartedAt: 4_000 },
        'abandoned',
        8_000
      )
    ).toBeNull();
  });
});

const databases: ReturnType<typeof openStateDb>[] = [];
function freshDb() {
  const db = openStateDb(':memory:');
  databases.push(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('local park record', () => {
  const lane = {
    iid: 4821,
    status: 'reviewing',
    agentId: 'ag-1',
    runStartedAt: 500,
  };
  const reports = (isParked: (url: string, runStartedAt: number) => boolean) =>
    closedPaneReports({
      reviews: new Map<string, ClosedPaneLane>([[URL_A, lane]]),
      executors: [
        { agentId: 'ag-1', sessionId: '', state: 'gone', since: 1_000 },
      ],
      authorOf: () => 'kim',
      self: 'pat',
      reported: new Map(),
      nudges: [],
      isParked,
      now: 10_000,
    });
  const parkedRow = (kind: string, openedAt: number) => ({
    kind,
    status: 'parked',
    openedAt,
  });

  test('a park recorded before the gate cache says parked skips the closed pane report', () => {
    const db = freshDb();
    recordLocalPark(URL_A, 7_000, db);
    expect(reports((url, start) => isReviewParked([], url, start, db))).toEqual(
      []
    );
  });

  test('a cleared record reports pane closed again', () => {
    const db = freshDb();
    recordLocalPark(URL_A, 7_000, db);
    clearLocalPark(URL_A, db);
    expect(isReviewParked([], URL_A, 500, db)).toBe(false);
    expect(
      reports((url, start) => isReviewParked([], url, start, db))
    ).toHaveLength(1);
  });

  test("a parked review row from the lane's run counts; a parked respond row does not", () => {
    const db = freshDb();
    expect(
      isReviewParked([parkedRow('review-post', 600)], URL_A, 500, db)
    ).toBe(true);
    expect(
      isReviewParked([parkedRow('respond-post', 600)], URL_A, 500, db)
    ).toBe(false);
  });

  test('a parked row from an earlier run still lets a dead new run report pane closed', () => {
    const db = freshDb();
    const old = [parkedRow('review-post', 400)];
    expect(isReviewParked(old, URL_A, 500, db)).toBe(false);
    expect(
      reports((url, start) => isReviewParked(old, url, start, db))
    ).toMatchObject([{ payload: { status: 'error', reason: 'pane closed' } }]);
  });

  test('a local record from an earlier run does not count', () => {
    const db = freshDb();
    recordLocalPark(URL_A, 400, db);
    expect(isReviewParked([], URL_A, 500, db)).toBe(false);
  });

  test('a stopped commit clears the record, writes the marker and queues the report together', () => {
    const db = freshDb();
    recordLocalPark(URL_A, 7_000, db);
    const draft = makeEnvelope('kim', 'review-state', {
      mrUrl: URL_A,
      status: 'stopped',
    });
    commitReviewState(
      URL_A,
      'stopped',
      [draft],
      tx => markClosedPaneReported(URL_A, 500, tx),
      db
    );
    expect(isReviewParked([], URL_A, 500, db)).toBe(false);
    expect(listKvValues(CLOSED_REPORTED_NS, db).get(URL_A)).toBe(500);
    expect(readOutbox(db).map(e => e.envelope.id)).toEqual([draft.id]);
  });

  test('a commit that sends nothing still clears the record and writes the marker', () => {
    const db = freshDb();
    recordLocalPark(URL_A, 7_000, db);
    commitReviewState(
      URL_A,
      'stopped',
      [],
      tx => markClosedPaneReported(URL_A, 500, tx),
      db
    );
    expect(isReviewParked([], URL_A, 500, db)).toBe(false);
    expect(listKvValues(CLOSED_REPORTED_NS, db).get(URL_A)).toBe(500);
  });

  test('a failed commit keeps the record', () => {
    const db = freshDb();
    recordLocalPark(URL_A, 7_000, db);
    expect(() =>
      commitReviewState(
        URL_A,
        'stopped',
        [],
        () => {
          throw new Error('marker write failed');
        },
        db
      )
    ).toThrow('marker write failed');
    expect(isReviewParked([], URL_A, 500, db)).toBe(true);
  });

  test('a parked commit keeps the record', () => {
    const db = freshDb();
    recordLocalPark(URL_A, 7_000, db);
    commitReviewState(URL_A, 'parked', [], undefined, db);
    expect(isReviewParked([], URL_A, 500, db)).toBe(true);
  });

  test('prune drops records for MRs off the board', () => {
    const db = freshDb();
    recordLocalPark(URL_A, 7_000, db);
    pruneLocalParks(new Set(), db);
    expect(listKvValues(LOCAL_PARK_NS, db).size).toBe(0);
  });
});

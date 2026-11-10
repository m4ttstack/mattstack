import type { Database } from 'bun:sqlite';

import { domainForKind } from '@mattstack/gate-kit';
import { getStateDb, persistOrWarn } from '../state/index.ts';
import {
  deleteKvValue,
  getKvValue,
  listKvValues,
  setKvValue,
} from '../state/kv-blob.ts';
import type { DraftEnvelope, ReviewStatePayload } from './envelope.ts';
import { enqueueOutbox } from './outbox.ts';

/** mrUrl -> when this board's sweep parked its review gate. The gate cache
    only says parked once the daemon's frame is relayed back, and the closed
    pane sweep must not call that window a failure. */
export const LOCAL_PARK_NS = 'peer-review-parked';

export function parkedPayload(
  lane: { iid: number },
  mrUrl: string,
  now: number
): ReviewStatePayload {
  return {
    mrUrl,
    iid: lane.iid,
    status: 'parked',
    parkedAt: now,
    updatedAt: now,
  };
}

/** Only a park this board reported is owed a `stopped`: a gate closed while
    still open never told the author it was parked. A superseded gate has a
    newer run whose own status is the truth, so it is owed nothing, and so is
    a gate opened before the lane's current run (see `isReviewParked`). */
export function stoppedPayload(
  row: { status: string; kind: string; openedAt: number },
  mrUrl: string,
  lane: { iid: number; runStartedAt?: number },
  reason: string,
  now: number
): ReviewStatePayload | null {
  if (row.status !== 'parked' || domainForKind(row.kind) !== 'review')
    return null;
  if (reason === 'superseded') return null;
  if (row.openedAt < (lane.runStartedAt ?? 0)) return null;
  return { mrUrl, iid: lane.iid, status: 'stopped', reason, updatedAt: now };
}

export function recordLocalPark(
  mrUrl: string,
  parkedAt: number,
  db: Database = getStateDb()
): void {
  persistOrWarn('local park write', () =>
    setKvValue(LOCAL_PARK_NS, mrUrl, parkedAt, db)
  );
}

/** Unguarded, so it can share a caller's transaction. */
export function clearLocalPark(
  mrUrl: string,
  db: Database = getStateDb()
): void {
  deleteKvValue(LOCAL_PARK_NS, mrUrl, db);
}

/** Only a park from the lane's current run counts: parked rows outlive the
    run that opened them, since a new run closes no gates. A gate is the
    run's when it opened after the run began; `parkedAt` would not do, since
    the sweep can park an older run's gate after a new run starts. */
export function isReviewParked(
  gateRows: ReadonlyArray<{ kind: string; status: string; openedAt: number }>,
  mrUrl: string,
  runStartedAt: number,
  db: Database = getStateDb()
): boolean {
  if (
    gateRows.some(
      r =>
        domainForKind(r.kind) === 'review' &&
        r.status === 'parked' &&
        r.openedAt >= runStartedAt
    )
  )
    return true;
  const local = getKvValue<number | null>(LOCAL_PARK_NS, mrUrl, null, db);
  return local !== null && local >= runStartedAt;
}

/** One transaction for the envelopes, the local park clear and the caller's
    extra writes (a closed pane marker), so the closed pane sweep never sees
    the park gone before the report that ended it is queued. */
export function commitReviewState(
  mrUrl: string,
  status: string,
  envelopes: readonly DraftEnvelope[],
  alongside: ((db: Database) => void) | undefined,
  db: Database = getStateDb()
): void {
  db.transaction(() => {
    for (const envelope of envelopes) enqueueOutbox(envelope, db);
    if (status !== 'parked') clearLocalPark(mrUrl, db);
    alongside?.(db);
  })();
}

export function pruneLocalParks(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const stale = [...listKvValues(LOCAL_PARK_NS, db).keys()].filter(
    url => !keepUrls.has(url)
  );
  if (stale.length === 0) return;
  persistOrWarn('local park prune', () => {
    db.transaction(() => {
      for (const url of stale) deleteKvValue(LOCAL_PARK_NS, url, db);
    })();
  });
}

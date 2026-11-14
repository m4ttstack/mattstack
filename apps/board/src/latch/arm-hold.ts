/**
 * A GitHub latch arm that throws can fail the same way on every retry after
 * gh has already posted a holder comment, so each retry would notify the PR
 * again. A failed arm holds that PR's arm for an hour at both posting sites.
 * GitLab never holds: its path is unchanged.
 */
import type { Database } from 'bun:sqlite';

import {
  deleteKvValue,
  getKvValue,
  getStateDb,
  setKvValue,
} from '../state/index.ts';
import type { AuditEntry } from '../triage/audit.ts';
import { postLatch, type LatchGateway, type LatchMr } from './post.ts';

const NS = 'latch-arm-hold';
export const ARM_HOLD_MS = 60 * 60 * 1000;

export function armHeld(
  gw: LatchGateway,
  mrUrl: string,
  now: number,
  db: Database = getStateDb()
): boolean {
  if (gw.forge !== 'github') return false;
  const hold = getKvValue<{ until?: unknown } | null>(NS, mrUrl, null, db);
  return typeof hold?.until === 'number' && now < hold.until;
}

/** postLatch, holding the PR's arm when a GitHub post throws. The error is
    rethrown so each caller's own failure handling still runs. */
export async function postLatchOrHold(
  gw: LatchGateway,
  mr: LatchMr & { mrUrl: string },
  appendAudit: (entry: AuditEntry) => void,
  now: number,
  db: Database = getStateDb()
): ReturnType<typeof postLatch> {
  if (gw.forge !== 'github') return postLatch(gw, mr, db);
  try {
    const posted = await postLatch(gw, mr, db);
    deleteKvValue(NS, mr.mrUrl, db);
    return posted;
  } catch (err) {
    setKvValue(NS, mr.mrUrl, { until: now + ARM_HOLD_MS }, db);
    appendAudit({
      ts: now,
      mrUrl: mr.mrUrl,
      iid: mr.iid,
      event: 'latch',
      action: 'arm-failed',
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

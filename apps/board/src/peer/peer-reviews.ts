import { join } from 'path';
import type { Database } from 'bun:sqlite';

import { getStateDb, persistOrWarn } from '../state/index.ts';
import {
  deleteKvValue,
  getKvValue,
  listKvValues,
  setKvValue,
} from '../state/kv-blob.ts';

/** A peer's review status for one MR, as materialized from an inbound
    review-state envelope. Multiple reviewers can each have their own state
    for the same mrUrl -- see readPeerReviews' grouping. */
export interface PeerReviewState {
  mrUrl: string;
  iid: number;
  reviewer: string;
  status: string;
  outcome?: string;
  updatedAt: number;
}

export const PEER_REVIEW_NS = 'peer-review';

export function peerReviewKey(mrUrl: string, reviewer: string): string {
  return `${mrUrl}\n${reviewer}`;
}

/** Where peer reviews lived before state.db; read only by the one-shot
    import. */
export const PEER_REVIEW_DIR = join(
  import.meta.dir,
  '..',
  '..',
  'state',
  'peer-reviews'
);

export function peerReviewFilePath(
  mrUrl: string,
  reviewer: string,
  dir: string = PEER_REVIEW_DIR
): string {
  const slug = `${mrUrl}-${reviewer}`
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** Last-write-wins on the payload clock, not arrival order: at-least-once
    delivery and outbox retries can deliver an older state after a newer
    one. Returns whether this state was written. */
export function writePeerReview(
  s: PeerReviewState,
  db: Database = getStateDb()
): boolean {
  const key = peerReviewKey(s.mrUrl, s.reviewer);
  let wrote = false;
  persistOrWarn('peer review write', () => {
    wrote = db.transaction(() => {
      const prev = getKvValue<PeerReviewState | null>(
        PEER_REVIEW_NS,
        key,
        null,
        db
      );
      if (prev && prev.updatedAt >= s.updatedAt) return false;
      setKvValue(PEER_REVIEW_NS, key, s, db);
      return true;
    })();
  });
  return wrote;
}

/** Every peer review state, grouped by mrUrl. */
export function readPeerReviews(
  db: Database = getStateDb()
): Map<string, PeerReviewState[]> {
  const out = new Map<string, PeerReviewState[]>();
  for (const value of listKvValues(PEER_REVIEW_NS, db).values()) {
    const state = value as PeerReviewState;
    if (!state?.mrUrl) continue;
    const list = out.get(state.mrUrl);
    if (list) list.push(state);
    else out.set(state.mrUrl, [state]);
  }
  return out;
}

/** Callers gate this on a healthy snapshot so a failed fetch can't wipe
    live state. */
export function prunePeerReviews(
  keepUrls: ReadonlySet<string>,
  db: Database = getStateDb()
): void {
  const stale = [...listKvValues(PEER_REVIEW_NS, db)].filter(
    ([, v]) => !keepUrls.has((v as PeerReviewState)?.mrUrl)
  );
  if (stale.length === 0) return;
  persistOrWarn('peer review prune', () => {
    db.transaction(() => {
      for (const [key] of stale) deleteKvValue(PEER_REVIEW_NS, key, db);
    })();
  });
}

/** Attach each MR's peer review states (matched by webUrl) as a
    `peerReviews` field. Non-mutating. */
export function attachPeerReviews<T extends { webUrl?: string | null }>(
  mrs: T[],
  peerReviews: Map<string, PeerReviewState[]>
): Array<T & { peerReviews?: PeerReviewState[] }> {
  return mrs.map(mr =>
    mr.webUrl && peerReviews.has(mr.webUrl)
      ? { ...mr, peerReviews: peerReviews.get(mr.webUrl) }
      : mr
  );
}

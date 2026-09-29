import type { RefreshProgress } from '../../shared/types';

/**
 * Identity of one progress reading. Two equal keys mean the refresh has not moved, which is
 * the only stall signal the client gets: the server reports counts, not liveness.
 */
export function progressKey(p: RefreshProgress | null): string {
  return p ? `${p.window}|${p.phase}|${p.done}/${p.total}|${p.label}` : '';
}

/** How long a refresh may sit on one reading before the bar stops looking healthy. */
export const STALL_AFTER_MS = 20_000;

/**
 * Past this, a stalled request has certainly blown its per-attempt deadline and been
 * retried (DEFAULT_TIMEOUT_MS in server/util/http.ts), so we can say so rather than guess.
 */
export const REQUEST_DEADLINE_MS = 30_000;

/** The stall copy once a reading stops moving, or null while it progresses. */
export function stallNotice(idleMs: number): string | null {
  if (idleMs < STALL_AFTER_MS) return null;
  const s = Math.floor(idleMs / 1000);
  return idleMs >= REQUEST_DEADLINE_MS
    ? `No progress for ${s}s · still waiting on GitLab, cancel to try again later`
    : `No progress for ${s}s`;
}

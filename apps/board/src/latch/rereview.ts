import type { ReviewerLatch } from './discussions.ts';

/** The `reReview` field of a gate answer body: latch discussion ids the
    developer ticked. Anything but an array of non-empty strings is no pick. */
export function parseReReview(body: unknown): string[] {
  const ids = (body as { reReview?: unknown } | null)?.reReview;
  if (!Array.isArray(ids)) return [];
  if (!ids.every(id => typeof id === 'string' && id)) return [];
  return ids as string[];
}

/** The picked ids that name an unrequested latch on the MR; with `person`,
    only that reviewer's latch. The browser's pick is untrusted, so the board
    keeps only ids it can match to a latch it computed itself. */
export function acceptedReReview(
  ids: string[],
  latches: ReviewerLatch[],
  person?: string
): string[] {
  const who = person?.toLowerCase();
  const allowed = new Set(
    latches
      .filter(
        l =>
          !l.requested &&
          (who === undefined || l.reviewer.toLowerCase() === who)
      )
      .map(l => l.discussionId)
  );
  return ids.filter(id => allowed.has(id));
}

/** Settles a picked re-review once respond reports a terminal status: `done`
    resolves each picked discussion (a failed resolve is logged, never
    thrown), `error` only drops the pick, anything else leaves it for the
    next signal. */
export async function settleReReview(
  status: string,
  pending: string[],
  resolve: (discussionId: string) => Promise<void>,
  clear: () => void,
  log: (msg: string) => void
): Promise<void> {
  if (pending.length === 0) return;
  if (status !== 'done' && status !== 'error') return;
  if (status === 'done') {
    for (const id of new Set(pending)) {
      try {
        await resolve(id);
      } catch (err) {
        log(
          `re-review resolve failed for ${id}: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }
  clear();
}

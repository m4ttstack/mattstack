/** Shared by the server and the browser client, so this module must never
    import `fs`. */

interface HeldFacts {
  updatedAt: string | null;
  review?: { status: string; updatedAt?: number; dismissedAt?: number } | null;
}

/** A review that stopped on purpose, with nothing on the MR since: GitLab's
    updatedAt moves on a push, a comment or a reopen. An unknown updatedAt
    keeps the hold standing. */
export function reviewHeldStanding(mr: HeldFacts): boolean {
  const r = mr.review;
  if (r?.status !== 'held' || r.dismissedAt !== undefined) return false;
  const moved = mr.updatedAt ? Date.parse(mr.updatedAt) : NaN;
  return !(moved > (r.updatedAt ?? 0));
}

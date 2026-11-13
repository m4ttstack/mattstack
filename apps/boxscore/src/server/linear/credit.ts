import { isRevertTitle } from '../../shared/reverts.js';
import type { LinkVia, MrState } from '../store/model.js';

/** One linked MR's identity plus the fields the qualifying/credit rules need. */
export interface LinkCandidate {
  iid: number;
  projectPath: string;
  authorUsername: string | null;
  state: MrState;
  mergedAt: string | null;
  title: string;
  via: LinkVia;
}

/**
 * Among MRs tied on `timeOf`, the lower (projectPath, iid) pair wins: an arbitrary but
 * deterministic order, independent of scan order.
 */
function earliestMr<T extends { projectPath: string; iid: number }>(
  mrs: readonly T[],
  timeOf: (m: T) => string
): T {
  return mrs.reduce((best, m) => {
    const delta = Date.parse(timeOf(m)) - Date.parse(timeOf(best));
    if (delta !== 0) return delta < 0 ? m : best;
    if (m.projectPath !== best.projectPath)
      return m.projectPath < best.projectPath ? m : best;
    return m.iid < best.iid ? m : best;
  });
}

/**
 * Qualifying merged MRs for credit/closedAt: merged, non-revert (a revert's title proves
 * nothing about who finished the ticket), and attachment-graded when the issue has any
 * MR-shaped attachment (GitLab MR or GitHub PR) -- an attachment is a deliberate link, so it outranks a
 * same-ticket text mention that only happened to land in a merged MR's title or
 * description. `hadMrAttachment` stays true for an attachment that parsed as an MR URL but
 * resolved to no known MR, so a ticket implemented before the data horizon qualifies
 * nothing rather than falling back to text links. Attachments that are not MR/PR URLs
 * (issues, commits) leave the fallback open.
 */
export function qualifyingMrs(
  candidates: readonly LinkCandidate[],
  hadMrAttachment: boolean
): LinkCandidate[] {
  const grade: LinkVia =
    hadMrAttachment || candidates.some(c => c.via === 'attachment')
      ? 'attachment'
      : 'closing';
  return candidates.filter(
    c =>
      c.via === grade &&
      c.state === 'merged' &&
      c.mergedAt !== null &&
      !isRevertTitle(c.title)
  );
}

/** Credit the earliest-merged qualifying MR's author, preferring a roster author. */
export function creditedUserOf(
  qualifying: readonly LinkCandidate[],
  roster: ReadonlySet<string>,
  canon?: (login: string) => string
): string | null {
  const withAuthor = qualifying
    .filter(
      (c): c is LinkCandidate & { authorUsername: string } =>
        c.authorUsername !== null
    )
    .map(c => (canon ? { ...c, authorUsername: canon(c.authorUsername) } : c));
  if (withAuthor.length === 0) return null;
  const rosterMatches = withAuthor.filter(c => roster.has(c.authorUsername));
  const pool = rosterMatches.length > 0 ? rosterMatches : withAuthor;
  return earliestMr(pool, m => m.mergedAt!).authorUsername;
}

/** Latest mergedAt among qualifying merged MRs, or null when none qualify. */
export function closedAtOf(qualifying: readonly LinkCandidate[]): string | null {
  return qualifying.reduce<string | null>(
    (latest, c) =>
      latest === null || Date.parse(c.mergedAt!) > Date.parse(latest)
        ? c.mergedAt!
        : latest,
    null
  );
}

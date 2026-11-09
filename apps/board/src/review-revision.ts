import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { FindingEntry } from './client/board/gate-ctx.ts';
import { readReviewGate } from './client/board/review-gate.ts';
import type { GateQuestion } from './gates/store.ts';

// The review sheet's "revised" notice, derived with no stored state: a
// review agent that revises a finding re-raises its gate, which supersedes
// the old one, and the board compares the two gates' findings by id.

const REVIEW_GATE_KIND = 'review-post';

/** What the MR's open review gate changed across the gates it superseded in
    the same run: the earliest version of each finding whose severity, anchor,
    title, body, fix or comment differ. A finding the new gate dropped has no
    card, so it is left out. `previousGateId`, `previousFindingIds` and
    `changedIds` (revised since the immediately previous gate) let the sheet
    carry the reviewer's draft over from that gate. */
export interface ReviewRevision {
  gateId: string;
  previousGateId: string;
  previousFindingIds: string[];
  changedIds: string[];
  revised: Record<string, { original: FindingEntry }>;
}

/** The two cache reads the derivation needs (`GateCache` satisfies it). */
export interface RevisionSource {
  get(subject: string, kind: string): FacilityGateRow | undefined;
  supersededBy(gateId: string): FacilityGateRow | undefined;
}

/** A review-post row's findings by id, or null when the row is not a sheet
    the board can read. */
export function gateFindings(
  row: FacilityGateRow
): Map<string, FindingEntry> | null {
  const gate = readReviewGate({
    kind: row.kind,
    context: row.context ?? undefined,
    meta: row.meta ?? undefined,
    questions: row.questions as GateQuestion[],
  });
  if (!gate) return null;
  return new Map([...gate.findings.values()].map(f => [f.id, f]));
}

/** Whether a finding reads differently on the new gate. */
export function findingChanged(a: FindingEntry, b: FindingEntry): boolean {
  return (
    a.severity !== b.severity ||
    a.file !== b.file ||
    a.title !== b.title ||
    a.body !== b.body ||
    a.fix !== b.fix ||
    a.comment !== b.comment
  );
}

/** The originals of every finding both gates carry that changed. */
export function revisedFindings(
  previous: ReadonlyMap<string, FindingEntry>,
  current: ReadonlyMap<string, FindingEntry>
): Record<string, { original: FindingEntry }> {
  const out: Record<string, { original: FindingEntry }> = {};
  for (const [id, now] of current) {
    const before = previous.get(id);
    if (before && findingChanged(before, now)) out[id] = { original: before };
  }
  return out;
}

/** The MR's review revision: its open review-post gate against the closed
    one that gate superseded. Nothing when there is no open gate, no
    predecessor in the cache (a board restart, say), the predecessor opened
    before the lane's current run started (`runStartedAt`: a fresh run or a
    re-review supersedes the last run's gate too, and finding ids are
    positional, so its `f2` is not this run's), or either gate is not a
    readable sheet. */
export function reviewRevisionFor(
  cache: RevisionSource,
  mrUrl: string,
  runStartedAt?: number
): ReviewRevision | undefined {
  const open = cache.get(`mr:${mrUrl}`, REVIEW_GATE_KIND);
  if (!open || open.status !== 'open') return undefined;
  const previous = cache.supersededBy(open.id);
  if (!previous || previous.subject !== open.subject) return undefined;
  if (runStartedAt !== undefined && previous.openedAt < runStartedAt)
    return undefined;
  const before = gateFindings(previous);
  const now = gateFindings(open);
  if (!before || !now) return undefined;
  const originals = new Map(before);
  const seen = new Set([open.id, previous.id]);
  let older = cache.supersededBy(previous.id);
  while (
    older &&
    !seen.has(older.id) &&
    older.subject === open.subject &&
    (runStartedAt === undefined || older.openedAt >= runStartedAt)
  ) {
    const findings = gateFindings(older);
    if (!findings) break;
    for (const [id, finding] of findings)
      if (originals.has(id)) originals.set(id, finding);
    seen.add(older.id);
    older = cache.supersededBy(older.id);
  }
  return {
    gateId: open.id,
    previousGateId: previous.id,
    previousFindingIds: [...before.keys()],
    changedIds: Object.keys(revisedFindings(before, now)),
    revised: revisedFindings(originals, now),
  };
}

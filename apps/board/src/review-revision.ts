import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import type { FindingEntry } from './client/board/gate-ctx.ts';
import { readReviewGate } from './client/board/review-gate.ts';
import type { GateQuestion } from './gates/store.ts';

// The review sheet's "revised" notice, derived with no stored state: a
// review agent that revises a finding re-raises its gate, which supersedes
// the old one, and the board compares the two gates' findings by id.

const REVIEW_GATE_KIND = 'review-post';

/** What the MR's open review gate changed from the gate it superseded: the
    original of each finding whose severity, anchor, title or body differ.
    A finding the new gate dropped has no card, so it is left out. */
export interface ReviewRevision {
  gateId: string;
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
    a.body !== b.body
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
    predecessor in the cache (a board restart, say), either gate is not a
    readable sheet, or no finding changed. */
export function reviewRevisionFor(
  cache: RevisionSource,
  mrUrl: string
): ReviewRevision | undefined {
  const open = cache.get(`mr:${mrUrl}`, REVIEW_GATE_KIND);
  if (!open || open.status !== 'open') return undefined;
  const previous = cache.supersededBy(open.id);
  if (!previous || previous.subject !== open.subject) return undefined;
  const before = gateFindings(previous);
  const now = gateFindings(open);
  if (!before || !now) return undefined;
  const revised = revisedFindings(before, now);
  return Object.keys(revised).length ? { gateId: open.id, revised } : undefined;
}

/** The id of the MR's review gate that `gateId` superseded, while the cache
    still holds it, else null. The review sheet restores a draft saved on that
    gate onto `gateId` (`draftRestorableOn` in sheet-draft-shape.ts). */
export function previousReviewGateId(
  cache: Pick<RevisionSource, 'supersededBy'>,
  mrUrl: string,
  gateId: string
): string | null {
  const previous = cache.supersededBy(gateId);
  if (
    !previous ||
    previous.kind !== REVIEW_GATE_KIND ||
    previous.subject !== `mr:${mrUrl}`
  )
    return null;
  return previous.id;
}

import type { GateDraft } from '@mattstack/gate-kit/react';
import type { GateRow } from '../../gates/store.ts';
import type { ReviewRevision } from '../../review-revision.ts';
import { commentKey } from './review-drafts.ts';
import { readReviewGate } from './review-gate.ts';

/** The review sheet's collapsed findings multi (`collapseChunks`). */
const FINDINGS = 'findings';

/** A re-raised review gate's starting form, from the gate-kit draft the
    reviewer left on the gate it superseded, or null when there is none.
    Every pick, note and text carries over, earlier-thread picks included,
    except that:
    - the findings ticks keep the reviewer's choice for each finding both
      gates carry, and tick a finding new to this gate, as a fresh gate does;
    - a revised finding loses its edited comment, so the agent's new draft
      shows instead of the edit it replaces. */
export function seedReviewDraft(
  previous: GateDraft | null,
  carry: {
    findingIds: readonly string[];
    previousFindingIds: readonly string[];
    revisedIds: readonly string[];
  }
): GateDraft | null {
  if (!previous) return null;
  const selections = { ...previous.selections };
  const ticks = selections[FINDINGS];
  if (Array.isArray(ticks)) {
    const known = new Set(carry.previousFindingIds);
    const ticked = new Set(ticks);
    selections[FINDINGS] = carry.findingIds.filter(
      id => !known.has(id) || ticked.has(id)
    );
  }
  const current = new Set(carry.findingIds);
  const revised = new Set(carry.revisedIds);
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(previous.texts ?? {})) {
    if (key.startsWith(commentKey(''))) {
      const id = key.slice(commentKey('').length);
      if (!current.has(id) || revised.has(id)) continue;
    }
    texts[key] = value;
  }
  return { selections, notes: { ...previous.notes }, texts, item: null };
}

/** The gate `gate` superseded in the same review run, when the MR's row
    names one for it: what its form seeds from. */
export function reviewPredecessor(
  gate: GateRow,
  revision: ReviewRevision | undefined
): ReviewRevision | undefined {
  return revision?.gateId === gate.gateId ? revision : undefined;
}

/** The finding ids a review gate shows, in the order it lists them. */
export function reviewFindingIds(gate: GateRow): string[] {
  return [...(readReviewGate(gate)?.findings.keys() ?? [])];
}

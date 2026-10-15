import { optionValue } from './options';
import type { GateSelections } from './payload';
import type { GateQuestion } from './types';

export const NEXT_QUESTION_ID = 'next';
export const PROCEED_VALUE = 'proceed';

/** Kinds whose Proceed is consent to post to a forge or act on a pane, so
    a fresh form never opens with it picked. */
export const NO_PRESET_KINDS: ReadonlySet<string> = new Set([
  'review-post',
  'respond-plan',
  'respond-post',
  'pane-attention',
]);

/** The picks a fresh form opens with: Proceed on a single-select `next`
    that offers it, nothing else, and nothing at all for NO_PRESET_KINDS. */
export function presetSelections(
  questions: GateQuestion[],
  kind: string
): GateSelections {
  if (NO_PRESET_KINDS.has(kind)) return {};
  const next = questions.find(q => q.id === NEXT_QUESTION_ID && !q.multi);
  return next?.options.some(o => optionValue(o) === PROCEED_VALUE)
    ? { [NEXT_QUESTION_ID]: PROCEED_VALUE }
    : {};
}

/** `selections` minus every pick still equal to its preset, so an untouched
    preset never counts as a draft. */
export function withoutPreset(
  selections: GateSelections,
  preset: GateSelections
): GateSelections {
  const out: GateSelections = {};
  for (const [id, v] of Object.entries(selections))
    if (preset[id] !== v) out[id] = v;
  return out;
}

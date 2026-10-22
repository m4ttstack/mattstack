import { optionLabel, optionValue } from './options';
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

/** Agents also write the marker mid-label ("Hand back (Recommended). I
    give you the branch."), which the board badges as recommended, so a
    preset must honour it wherever it sits. */
const RECOMMENDED_ANYWHERE = /\(\s*recommended\s*\)/i;

/** The agent's own pick for one question: its first recommended option on
    a single-select, every recommended option on a multi, or undefined when
    it recommends nothing. */
export function recommendedPick(
  question: GateQuestion
): string | string[] | undefined {
  const picks = question.options
    .filter(o => RECOMMENDED_ANYWHERE.test(optionLabel(o)))
    .map(optionValue);
  if (picks.length === 0) return undefined;
  return question.multi ? picks : picks[0];
}

/** The picks a fresh form opens with: every question's recommended
    option(s), else Proceed on a single-select `next` that offers it, and
    nothing at all for NO_PRESET_KINDS. */
export function presetSelections(
  questions: GateQuestion[],
  kind: string
): GateSelections {
  if (NO_PRESET_KINDS.has(kind)) return {};
  const out: GateSelections = {};
  for (const q of questions) {
    const pick = recommendedPick(q);
    if (pick !== undefined) out[q.id] = pick;
  }
  const next = questions.find(q => q.id === NEXT_QUESTION_ID && !q.multi);
  if (
    next &&
    out[next.id] === undefined &&
    next.options.some(o => optionValue(o) === PROCEED_VALUE)
  )
    out[next.id] = PROCEED_VALUE;
  return out;
}

function samePick(a: string | string[] | undefined, b: string | string[]) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((v, i) => v === sortedB[i]);
}

/** `selections` minus every pick still equal to its preset, so an untouched
    preset never counts as a draft. */
export function withoutPreset(
  selections: GateSelections,
  preset: GateSelections
): GateSelections {
  const out: GateSelections = {};
  for (const [id, v] of Object.entries(selections))
    if (!samePick(preset[id], v)) out[id] = v;
  return out;
}

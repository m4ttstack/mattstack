import type { QuestionnaireItemDefinition } from '@shadcn/react/questionnaire';

import {
  CODE_CHANGES_QUESTION_ID,
  codeChangesHidden,
  effectiveSelections,
} from '../collapse';
import { optionDescription, optionDisplayFor, optionValue } from '../options';
import {
  gateAnswerPayload,
  writeIns,
  type GateAnswers,
  type GateSelections,
} from '../payload';
import type { GateQuestion } from '../types';

export { Questionnaire } from '@shadcn/react/questionnaire';
export type { QuestionnaireItemDefinition } from '@shadcn/react/questionnaire';
export { gateDraftKey, useGateDraft } from './draft';
export type { GateDraft } from './draft';

/** The slice of a gate the adapter needs; both apps' row shapes satisfy it
    structurally. */
export interface GateForItems {
  kind: string;
  questions: GateQuestion[];
}

export interface GateItemChoice {
  value: string;
  /** Display text via the option transform (label, or the verb-token
      compaction for bare strings). Submission always uses `value`. */
  label: string;
  /** The full raw value when it differs from `label` -- title/tooltip
      material, mirroring GateOptionDisplay.title. */
  description?: string;
  /** The option's own secondary one-liner (BOARD-36), rendered as a muted
      line under the label -- distinct from `description` above. */
  subtitle?: string;
  /** The agent's pick; render a badge. */
  recommended?: boolean;
}

export interface GateItemDisplay {
  name: string;
  prompt: string;
  multiple: boolean;
  required: boolean;
  choices: GateItemChoice[];
  /** The question's own context (BOARD-36), rendered with its card above
      its options -- distinct from the gate-level context block. */
  context?: string;
  /** Note text with no pick answers this question as `{ writeIn }`. */
  writeIn?: true;
}

export interface GateItems {
  /** For Questionnaire.Root's `items` prop (logical order and validation). */
  items: QuestionnaireItemDefinition[];
  /** One entry per item, same order, carrying what a styled layer renders. */
  display: GateItemDisplay[];
}

/**
 * Gate questions to questionnaire items plus display data. The respond
 * collapse is STRUCTURAL here: the code-changes item is excluded from the
 * returned items until some other selection carries a `fix:` value, so
 * inclusion is reactive to `selections` and the hidden question never
 * renders at all. Zero-option questions are excluded too -- they have
 * nothing to collect and gateAnswerPayload already exempts them.
 * Single-selects are required: answered by a pick from the question's own
 * set or, on a question marked `writeIn`, by note text instead (`writeIns`);
 * a multi question is skippable, because "none of these" is a legitimate
 * multi answer -- the questionnaire's skip affordance submits it as an
 * explicit `[]`, which the daemon records.
 */
export function gateItems(
  gate: GateForItems,
  selections: GateSelections
): GateItems {
  const hidden = codeChangesHidden(gate.kind, gate.questions, selections);
  const visible = gate.questions.filter(
    q => q.options.length > 0 && !(hidden && q.id === CODE_CHANGES_QUESTION_ID)
  );
  const display: GateItemDisplay[] = visible.map(q => ({
    name: q.id,
    prompt: q.label,
    multiple: q.multi,
    required: !q.multi,
    choices: q.options.map(opt => {
      const d = optionDisplayFor(opt);
      const subtitle = optionDescription(opt);
      return {
        value: optionValue(opt),
        label: d.text,
        ...(d.title !== undefined ? { description: d.title } : {}),
        ...(subtitle !== undefined ? { subtitle } : {}),
        ...(d.recommended ? { recommended: true } : {}),
      };
    }),
    ...(q.context !== undefined ? { context: q.context } : {}),
    ...(q.writeIn === true ? { writeIn: true as const } : {}),
  }));
  return {
    items: display.map(d => ({
      name: d.name,
      required: d.required,
      choices: d.choices.map(c => ({ value: c.value })),
    })),
    display,
  };
}

/** The form field a question's optional note travels in; the cards name
    their note inputs with it and `answersFromForm` reads it back. */
export function noteFieldName(questionId: string): string {
  return `${questionId}:note`;
}

/**
 * The native form back to one atomic wire answer: `get` for a single-select,
 * `getAll` for a multi, then through effectiveSelections (the structurally
 * excluded code-changes item submits the sentinel) into gateAnswerPayload.
 * Null while any single-select lacks an answer, so a caller can refuse the
 * submit on that alone. A multi question with no form entries submits an
 * explicit `[]`: a skipped item's inputs drop their `name` and post
 * nothing, and the questionnaire's own submit validation guarantees every
 * rendered item was answered or deliberately skipped before this runs --
 * while the daemon requires the question id to be present even when the
 * answer is empty. A question whose note field is non-empty after trimming
 * submits `{ value, note }`; every other question submits the bare
 * selection, and the injected sentinel never carries a note. A `writeIn`
 * question with no pick and note text submits `{ writeIn }`.
 */
export function answersFromForm(
  gate: GateForItems,
  formData: FormData
): { answers: GateAnswers } | null {
  const selections: GateSelections = {};
  for (const q of gate.questions) {
    if (q.multi) {
      selections[q.id] = formData
        .getAll(q.id)
        .filter((v): v is string => typeof v === 'string');
    } else {
      const value = formData.get(q.id);
      if (typeof value === 'string' && value.length > 0)
        selections[q.id] = value;
    }
  }
  const notes: Record<string, string> = {};
  for (const q of gate.questions) {
    const raw = formData.get(noteFieldName(q.id));
    if (typeof raw === 'string') notes[q.id] = raw;
  }
  const written = writeIns(gate.questions, selections, notes);
  const payload = gateAnswerPayload(
    gate.questions,
    effectiveSelections(gate.kind, gate.questions, selections),
    written
  );
  if (!payload) return null;
  const answers: GateAnswers = {};
  for (const [id, value] of Object.entries(payload.answers)) {
    const note = id in selections ? (notes[id] ?? '').trim() : '';
    answers[id] = note.length > 0 ? { value, note } : value;
  }
  for (const [id, text] of Object.entries(written))
    answers[id] = { writeIn: text };
  return { answers };
}

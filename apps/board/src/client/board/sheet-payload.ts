import {
  effectiveSelections,
  gateAnswerPayload,
  writeIns,
  type GateAnswers,
  type GateSelections,
} from '@mattstack/gate-kit';
import type { GateRow } from '../../gates/store.ts';

/** The wire answer from the sheet's own selections, built the way
    `answersFromForm` builds it from a form: only a displayed single-select
    counts (a hidden code-changes pick is stale and yields to the
    sentinel), every multi submits an array, a trimmed note wraps its
    question's value, and an edited reply's trimmed text rides alongside as
    `text`. A shown `writeIn` question with no pick and note text answers
    `{ writeIn }`. Null while any required question is unanswered. */
export function sheetAnswers(
  gate: GateRow,
  shown: Set<string>,
  selections: GateSelections,
  notes: Record<string, string>,
  texts: Record<string, string> = {}
): { answers: GateAnswers } | null {
  const sel: GateSelections = {};
  for (const q of gate.questions) {
    const v = selections[q.id];
    if (q.multi) sel[q.id] = shown.has(q.id) && Array.isArray(v) ? v : [];
    else if (shown.has(q.id) && typeof v === 'string' && v) sel[q.id] = v;
  }
  const written = writeIns(
    gate.questions.filter(q => shown.has(q.id)),
    sel,
    notes
  );
  const payload = gateAnswerPayload(
    gate.questions,
    effectiveSelections(gate.kind, gate.questions, sel),
    written
  );
  if (!payload) return null;
  const answers: GateAnswers = {};
  for (const [id, value] of Object.entries(payload.answers)) {
    const note = id in sel ? (notes[id] ?? '').trim() : '';
    const text = texts[id];
    answers[id] =
      note || text
        ? { value, ...(note ? { note } : {}), ...(text ? { text } : {}) }
        : value;
  }
  for (const [id, text] of Object.entries(written))
    answers[id] = { writeIn: text };
  return { answers };
}

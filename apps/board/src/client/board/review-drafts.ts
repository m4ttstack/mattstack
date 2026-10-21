import type { GateAnswers, GateQuestion } from '@mattstack/gate-kit';
import type { FindingEntry } from './gate-ctx.ts';
import { postedText } from './respond-post.ts';
import { isFindingsQuestion } from './review-gate.ts';

/** Form text keys: one per finding's comment, one summary line per
    verdict, so each verdict keeps its own edit. */
export const commentKey = (findingId: string) => `comment:${findingId}`;
export const summaryKey = (outcome: string) => `summary:${outcome}`;

/** An inline comment needs both a file and a line; the gate joins them as
    `file:line`, so a bare file (or none) posts in the summary instead. */
export function hasDiffLine(f: Pick<FindingEntry, 'file'>): boolean {
  return f.file !== undefined && /:\d+$/.test(f.file);
}

/** The verdict question, by the id the gate validators look up; a gate
    with no `outcome` question falls back to its first single-select. */
export function findOutcomeQuestion(
  questions: GateQuestion[]
): GateQuestion | undefined {
  return (
    questions.find(q => !q.multi && q.id === 'outcome') ??
    questions.find(q => !q.multi)
  );
}

export interface DraftEdits {
  texts: Record<string, string>;
  summary?: string;
}

/** The edits, as they post, that differ from their drafts, for ticked findings
    only, keyed by finding id, plus the selected verdict's summary edit.
    Null when a ticked finding's edit, or the selected verdict's summary
    edit, is blank: an empty comment cannot post. */
export function draftEdits(
  drafts: { findings: Map<string, string>; summaries: Record<string, string> },
  ticked: Set<string>,
  texts: Record<string, string>,
  outcome: string | undefined
): DraftEdits | null {
  const out: DraftEdits = { texts: {} };
  for (const [id, draft] of drafts.findings) {
    if (!ticked.has(id)) continue;
    const edit = texts[commentKey(id)];
    if (edit === undefined) continue;
    if (edit.trim() === '') return null;
    const posted = postedText(edit);
    if (posted !== postedText(draft)) out.texts[id] = posted;
  }
  const summaryDraft =
    outcome !== undefined ? drafts.summaries[outcome] : undefined;
  const summaryEdit =
    outcome !== undefined ? texts[summaryKey(outcome)] : undefined;
  if (summaryEdit !== undefined && summaryDraft !== undefined) {
    if (summaryEdit.trim() === '') return null;
    const posted = postedText(summaryEdit);
    if (posted !== postedText(summaryDraft)) out.summary = posted;
  }
  return out;
}

/** Rides the edits on the split answers: each `findings-N` answer carries
    only its own ids' texts, and the summary edit rides the verdict as
    `text` beside any note. Runs on chunk answers, after
    `splitChunkSelections`. */
export function attachDraftEdits(
  answers: GateAnswers,
  questions: GateQuestion[],
  edits: DraftEdits
): GateAnswers {
  const out: GateAnswers = { ...answers };
  for (const q of questions) {
    if (!q.multi || !isFindingsQuestion(q)) continue;
    const value = out[q.id];
    if (!Array.isArray(value)) continue;
    const texts = Object.fromEntries(
      value.flatMap(id =>
        edits.texts[id] !== undefined ? [[id, edits.texts[id]!]] : []
      )
    );
    if (Object.keys(texts).length > 0) out[q.id] = { value, texts };
  }
  const outcome = findOutcomeQuestion(questions);
  const verdict = outcome ? out[outcome.id] : undefined;
  if (outcome && edits.summary !== undefined) {
    if (typeof verdict === 'string')
      out[outcome.id] = { value: verdict, text: edits.summary };
    else if (
      verdict !== undefined &&
      !Array.isArray(verdict) &&
      'value' in verdict
    )
      out[outcome.id] = { ...verdict, text: edits.summary };
  }
  return out;
}

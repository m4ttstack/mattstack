import type { GateAnswer, GateQuestion, GateRow } from '@mattstack/rt-client';
import { gateOptionValue } from '@mattstack/rt-client/gate';

/** Claude Code's in-pane form caps a question at four options, so an agent
    splits a longer multi-select into `<id>-1`, `<id>-2`, ... with labels
    ending "(1 of 2)". The console has no cap: it shows the parts as one
    question and splits the answer back before the daemon sees it. */

type Answers = GateAnswer['answers'];
type AnswerValue = Answers[string];

const PART_ID = /^(.+)-(\d+)$/;
const PART_LABEL = /\s*\(\s*\d+\s+of\s+\d+\s*\)\s*$/i;

interface Joined {
  id: string;
  parts: GateQuestion[];
}

/** Runs that are certainly one split list, the same rule the gate-form mod
    joins by: consecutive multi-select parts `<id>-1..n` (n of at least 2)
    that ask the same thing (one label once "(1 of 2)" is dropped, one
    context), with no write-in, no option value in two parts, and no other
    question already named `<id>`. Anything less stays as it came. */
function joinedRuns(questions: GateQuestion[]): Joined[] {
  const runs: Joined[] = [];
  let i = 0;
  while (i < questions.length) {
    const head = PART_ID.exec(questions[i]!.id);
    if (!head || head[2] !== '1' || !questions[i]!.multi) {
      i++;
      continue;
    }
    const base = head[1]!;
    const label = questions[i]!.label.replace(PART_LABEL, '');
    const parts = [questions[i]!];
    let j = i + 1;
    while (j < questions.length) {
      const q = questions[j]!;
      const m = PART_ID.exec(q.id);
      if (
        !m ||
        m[1] !== base ||
        Number(m[2]) !== parts.length + 1 ||
        !q.multi ||
        q.label.replace(PART_LABEL, '') !== label
      )
        break;
      parts.push(q);
      j++;
    }
    const clash = questions.some(q => q.id === base);
    const values = parts.flatMap(p => p.options.map(gateOptionValue));
    const context = parts[0]!.context ?? '';
    const certain =
      parts.length >= 2 &&
      !clash &&
      parts.every(p => p.writeIn !== true && (p.context ?? '') === context) &&
      new Set(values).size === values.length;
    if (certain) runs.push({ id: base, parts });
    i = j;
  }
  return runs;
}

function joinQuestions(questions: GateQuestion[], runs: Joined[]) {
  const firstOf = new Map(runs.map(r => [r.parts[0]!.id, r]));
  const skip = new Set(runs.flatMap(r => r.parts.slice(1).map(p => p.id)));
  const out: GateQuestion[] = [];
  for (const q of questions) {
    if (skip.has(q.id)) continue;
    const run = firstOf.get(q.id);
    if (!run) {
      out.push(q);
      continue;
    }
    out.push({
      id: run.id,
      label: q.label.replace(PART_LABEL, ''),
      multi: true,
      options: run.parts.flatMap(p => p.options),
      ...(q.context ? { context: q.context } : {}),
    });
  }
  return out;
}

const valuesOf = (answer: AnswerValue | undefined): string[] => {
  if (answer === undefined) return [];
  if (typeof answer === 'string') return [answer];
  if (Array.isArray(answer)) return answer;
  if ('writeIn' in answer) return [];
  return Array.isArray(answer.value) ? answer.value : [answer.value];
};

const noteOf = (answer: AnswerValue | undefined): string | undefined =>
  answer && typeof answer === 'object' && !Array.isArray(answer)
    ? 'note' in answer
      ? answer.note
      : undefined
    : undefined;

function joinAnswers(answers: Answers, runs: Joined[]): Answers {
  const out: Answers = { ...answers };
  for (const run of runs) {
    const given = run.parts.filter(p => p.id in answers);
    if (given.length === 0) continue;
    const writeIn = given
      .map(p => answers[p.id])
      .find(
        (a): a is { writeIn: string } =>
          !!a && typeof a === 'object' && !Array.isArray(a) && 'writeIn' in a
      );
    const values = given.flatMap(p => valuesOf(answers[p.id]));
    const notes = given
      .map(p => noteOf(answers[p.id]))
      .filter((n): n is string => !!n);
    for (const p of run.parts) delete out[p.id];
    out[run.id] =
      writeIn && values.length === 0
        ? writeIn
        : notes.length > 0
          ? { value: values, note: notes.join('\n') }
          : values;
  }
  return out;
}

/** The row with each split question shown as one, its answer joined too. */
export function joinSplitQuestions(row: GateRow): GateRow {
  const runs = joinedRuns(row.questions ?? []);
  if (runs.length === 0) return row;
  return {
    ...row,
    questions: joinQuestions(row.questions, runs),
    answer: row.answer
      ? { ...row.answer, answers: joinAnswers(row.answer.answers, runs) }
      : row.answer,
  };
}

/** A joined answer split back into the parts the gate was opened with: each
    pick goes to the part that offered it, and a note rides on the first
    part. */
export function splitJoinedAnswers(
  questions: GateQuestion[],
  answers: Answers
): Answers {
  const runs = joinedRuns(questions);
  if (runs.length === 0) return answers;
  const out: Answers = { ...answers };
  for (const run of runs) {
    if (!(run.id in answers)) continue;
    const answer = answers[run.id];
    delete out[run.id];
    const picks = valuesOf(answer);
    const note = noteOf(answer);
    const owner = (v: string) =>
      run.parts.find(p => p.options.some(o => gateOptionValue(o) === v)) ??
      run.parts[0]!;
    run.parts.forEach((part, i) => {
      const mine = picks.filter(v => owner(v) === part);
      out[part.id] = i === 0 && note ? { value: mine, note } : mine;
    });
  }
  return out;
}

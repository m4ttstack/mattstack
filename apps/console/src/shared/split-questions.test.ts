import type { GateQuestion, GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { joinSplitQuestions, splitJoinedAnswers } from './split-questions';

const opt = (value: string) => ({ value, label: value });

const questions: GateQuestion[] = [
  { id: 'open_as', label: 'How?', multi: false, options: [opt('draft')] },
  {
    id: 'labels-1',
    label: 'Which previews? (1 of 2)',
    multi: true,
    options: [opt('a'), opt('b')],
  },
  {
    id: 'labels-2',
    label: 'Which previews? (2 of 2)',
    multi: true,
    options: [opt('c'), opt('none')],
  },
];

const row = (over: Partial<GateRow> = {}): GateRow =>
  ({ id: 'g', questions, answer: null, ...over }) as GateRow;

describe('joinSplitQuestions', () => {
  it('shows the parts as one question with every option', () => {
    const joined = joinSplitQuestions(row()).questions;
    expect(joined.map(q => q.id)).toEqual(['open_as', 'labels']);
    expect(joined[1]).toMatchObject({
      label: 'Which previews?',
      multi: true,
      options: [opt('a'), opt('b'), opt('c'), opt('none')],
    });
  });

  it('joins a recorded answer across the parts', () => {
    const joined = joinSplitQuestions(
      row({
        answer: {
          answers: { open_as: 'draft', 'labels-1': ['a'], 'labels-2': ['c'] },
          by: 'console',
          answeredAt: 1,
        },
      })
    );
    expect(joined.answer?.answers).toEqual({
      open_as: 'draft',
      labels: ['a', 'c'],
    });
  });

  it('leaves single-select and differently labelled parts alone', () => {
    const single = questions.map(q => ({ ...q, multi: false }));
    expect(joinSplitQuestions(row({ questions: single })).questions).toBe(
      single
    );
    const other = [
      questions[1]!,
      { ...questions[2]!, label: 'Something else (2 of 2)' },
    ];
    expect(joinSplitQuestions(row({ questions: other })).questions).toBe(other);
  });
});

describe('splitJoinedAnswers', () => {
  it('sends each pick to the part that offered it', () => {
    expect(
      splitJoinedAnswers(questions, { open_as: 'draft', labels: ['c', 'a'] })
    ).toEqual({ open_as: 'draft', 'labels-1': ['a'], 'labels-2': ['c'] });
  });

  it('answers a part with no picks as none and keeps the note on the first', () => {
    expect(
      splitJoinedAnswers(questions, {
        labels: { value: ['none'], note: 'skip QA' },
      })
    ).toEqual({
      'labels-1': { value: [], note: 'skip QA' },
      'labels-2': ['none'],
    });
  });

  it('passes answers through when nothing was split', () => {
    const answers = { open_as: 'draft' };
    expect(splitJoinedAnswers([questions[0]!], answers)).toBe(answers);
  });
});

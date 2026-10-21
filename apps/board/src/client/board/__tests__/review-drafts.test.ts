import { describe, expect, test } from 'bun:test';

import { joinSummary } from '@mattstack/gate-kit';
import type { GateQuestion } from '../../../gates/store.ts';
import {
  attachDraftEdits,
  commentKey,
  draftEdits,
  findOutcomeQuestion,
  hasDiffLine,
  summaryKey,
} from '../review-drafts.ts';

const DRAFTS = {
  findings: new Map([
    ['f1', 'Draft one.'],
    ['f2', 'Draft two.'],
    ['f5', 'Draft five.'],
  ]),
  summaries: { approve: 'Approve draft.', comment: 'Comment draft.' },
};

const QUESTIONS: GateQuestion[] = [
  {
    id: 'findings-1',
    label: 'Post which findings?',
    multi: true,
    options: ['f1', 'f2'],
  },
  {
    id: 'findings-2',
    label: 'Post which findings?',
    multi: true,
    options: ['f5'],
  },
  {
    id: 'outcome',
    label: 'Verdict',
    multi: false,
    options: ['approve', 'comment'],
  },
];

describe('joinSummary', () => {
  test('is the line, then each folded finding one blank line apart', () => {
    expect(joinSummary('Line.', ['A.', 'B.'])).toBe('Line.\n\nA.\n\nB.');
    expect(joinSummary('Line.', [])).toBe('Line.');
  });
});

describe('draftEdits', () => {
  const ticked = new Set(['f1', 'f2', 'f5']);

  test('an edit that matches its draft as it would post is dropped', () => {
    expect(
      draftEdits(
        DRAFTS,
        ticked,
        {
          [commentKey('f1')]: '\nDraft one.\n',
          [summaryKey('approve')]: 'Approve draft. ',
        },
        'approve'
      )
    ).toEqual({ texts: {} });
  });

  test('a changed edit rides as it would post, keyed by finding id', () => {
    expect(
      draftEdits(
        DRAFTS,
        ticked,
        {
          [commentKey('f2')]: '\nNew two. ',
          [summaryKey('approve')]: 'New summary.',
        },
        'approve'
      )
    ).toEqual({ texts: { f2: 'New two.' }, summary: 'New summary.' });
  });

  test('an edit opening on an indented code line keeps the indent', () => {
    expect(
      draftEdits(
        DRAFTS,
        ticked,
        { [commentKey('f2')]: '    return null;\n\nWould this read better?\n' },
        'approve'
      )
    ).toEqual({ texts: { f2: '    return null;\n\nWould this read better?' } });
  });

  test("an unticked finding's edit is dropped", () => {
    expect(
      draftEdits(
        DRAFTS,
        new Set(['f1']),
        { [commentKey('f2')]: 'New two.' },
        'approve'
      )
    ).toEqual({ texts: {} });
  });

  test("an unticked finding's blank edit does not block submit", () => {
    expect(
      draftEdits(
        DRAFTS,
        new Set(['f1']),
        { [commentKey('f2')]: '  ' },
        'approve'
      )
    ).toEqual({ texts: {} });
  });

  test('a blank ticked edit gives null', () => {
    expect(
      draftEdits(DRAFTS, ticked, { [commentKey('f1')]: ' \n ' }, 'approve')
    ).toBeNull();
  });

  test("a blank edit of the selected verdict's summary gives null", () => {
    expect(
      draftEdits(DRAFTS, ticked, { [summaryKey('approve')]: '' }, 'approve')
    ).toBeNull();
  });

  test("only the selected verdict's summary edit rides", () => {
    expect(
      draftEdits(
        DRAFTS,
        ticked,
        {
          [summaryKey('approve')]: 'Approve edit.',
          [summaryKey('comment')]: 'Comment edit.',
        },
        'comment'
      )
    ).toEqual({ texts: {}, summary: 'Comment edit.' });
  });

  test("an unselected verdict's blank summary edit does not block submit", () => {
    expect(
      draftEdits(DRAFTS, ticked, { [summaryKey('approve')]: '  ' }, 'comment')
    ).toEqual({ texts: {} });
  });

  test("a summary edit that matches the selected verdict's draft is dropped", () => {
    expect(
      draftEdits(
        DRAFTS,
        ticked,
        { [summaryKey('comment')]: '\nComment draft.\n' },
        'comment'
      )
    ).toEqual({ texts: {} });
  });

  test('with no verdict picked no summary edit rides', () => {
    expect(
      draftEdits(DRAFTS, ticked, { [summaryKey('approve')]: 'New.' }, undefined)
    ).toEqual({ texts: {} });
  });
});

describe('attachDraftEdits', () => {
  const answers = {
    'findings-1': ['f1', 'f2'],
    'findings-2': ['f5'],
    outcome: 'approve',
  };

  test('texts split across the chunks that hold each id', () => {
    expect(
      attachDraftEdits(answers, QUESTIONS, {
        texts: { f1: 'One.', f5: 'Five.' },
      })
    ).toEqual({
      'findings-1': { value: ['f1', 'f2'], texts: { f1: 'One.' } },
      'findings-2': { value: ['f5'], texts: { f5: 'Five.' } },
      outcome: 'approve',
    });
  });

  test('a chunk with no edits stays a bare array', () => {
    expect(
      attachDraftEdits(answers, QUESTIONS, { texts: { f2: 'Two.' } })
    ).toEqual({
      'findings-1': { value: ['f1', 'f2'], texts: { f2: 'Two.' } },
      'findings-2': ['f5'],
      outcome: 'approve',
    });
  });

  test('the summary edit rides the outcome as text', () => {
    expect(
      attachDraftEdits(answers, QUESTIONS, { texts: {}, summary: 'New.' })
        .outcome
    ).toEqual({ value: 'approve', text: 'New.' });
  });

  test("the outcome's note is kept beside the text", () => {
    expect(
      attachDraftEdits(
        { ...answers, outcome: { value: 'approve', note: 'ship it' } },
        QUESTIONS,
        { texts: {}, summary: 'New.' }
      ).outcome
    ).toEqual({ value: 'approve', note: 'ship it', text: 'New.' });
  });

  test('empty edits add nothing', () => {
    expect(attachDraftEdits(answers, QUESTIONS, { texts: {} })).toEqual(
      answers
    );
  });
});

describe('findOutcomeQuestion', () => {
  const NEXT: GateQuestion = {
    id: 'next',
    label: 'Next',
    multi: false,
    options: ['proceed', 'hold'],
  };

  test('finds the question by id outcome, past an earlier single-select', () => {
    expect(findOutcomeQuestion([NEXT, ...QUESTIONS])?.id).toBe('outcome');
  });

  test('falls back to the first single-select when no question is outcome', () => {
    expect(findOutcomeQuestion([QUESTIONS[0]!, NEXT])?.id).toBe('next');
  });

  test('the summary edit rides outcome, not an earlier single-select', () => {
    expect(
      attachDraftEdits(
        { 'findings-1': ['f1'], next: 'proceed', outcome: 'approve' },
        [NEXT, ...QUESTIONS],
        { texts: {}, summary: 'New.' }
      )
    ).toEqual({
      'findings-1': ['f1'],
      next: 'proceed',
      outcome: { value: 'approve', text: 'New.' },
    });
  });
});

describe('hasDiffLine', () => {
  test('a file with a line number anchors; a bare file or none does not', () => {
    expect(hasDiffLine({ file: 'lib/a.ts:42' })).toBe(true);
    expect(hasDiffLine({ file: 'lib/a.ts' })).toBe(false);
    expect(hasDiffLine({})).toBe(false);
  });
});

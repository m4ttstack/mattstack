import type { GateQuestion, GateRow, RunStageRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  decisionLogForRun,
  gateEndNote,
  gateKindLabel,
  gateStage,
  optionViews,
  pickedText,
  questionAnswer,
  tookRecommendation,
  waitingOnYou,
} from './gates';

const gate = (o: Partial<GateRow>): GateRow => ({
  id: 'g',
  subject: 'run:r1',
  kind: 'plan',
  questions: [],
  meta: null,
  status: 'answered',
  answer: null,
  openedAt: 0,
  parkedAt: null,
  closedAt: null,
  closedReason: null,
  supersededBy: null,
  agent: null,
  pane: null,
  nudge: null,
  delivery: null,
  released: false,
  consumedAt: null,
  owner: null,
  escalatedAt: null,
  ...o,
});
const stage = (
  name: string,
  started_at: number,
  ended_at: number | null
): RunStageRow => ({
  name,
  status: 'done',
  attempt: 1,
  started_at,
  ended_at,
  reason: null,
  detail_path: null,
});

describe('decisionLogForRun', () => {
  it('keeps every status for this run only, oldest first', () => {
    const log = decisionLogForRun(
      [
        gate({ id: 'b', openedAt: 20, status: 'closed' }),
        gate({ id: 'a', openedAt: 10 }),
        gate({ id: 'x', subject: 'run:r12', openedAt: 5 }),
      ],
      'r1'
    );
    expect(log.map(g => g.id)).toEqual(['a', 'b']);
  });
});

describe('gateStage', () => {
  const stages = [stage('plan', 0, 100), stage('evidence', 100, null)];
  it('prefers meta.stage', () =>
    expect(
      gateStage(gate({ meta: { stage: 'ship' }, openedAt: 50 }), stages)
    ).toBe('ship'));
  it('falls back to the stage running at openedAt', () => {
    expect(gateStage(gate({ openedAt: 50 }), stages)).toBe('plan');
    expect(gateStage(gate({ openedAt: 500 }), stages)).toBe('evidence');
  });
  it('picks the latest-started match whatever the list order', () => {
    const unsorted = [stage('retry', 50, null), stage('plan', 0, null)];
    expect(gateStage(gate({ openedAt: 60 }), unsorted)).toBe('retry');
  });
  it('is null before any stage', () =>
    expect(gateStage(gate({ openedAt: -1 }), stages)).toBeNull());
});

describe('tookRecommendation', () => {
  const q: GateQuestion = {
    id: 'approach',
    label: 'Which?',
    multi: false,
    options: [
      { value: 'server', label: 'Server-side (Recommended)' },
      { value: 'client', label: 'Client-side' },
    ],
  };
  const ans = (v: unknown) => ({
    answers: { approach: v } as never,
    by: 'console',
    answeredAt: 1,
  });
  it('true when the pick is the recommended one', () =>
    expect(tookRecommendation(q, ans('server'))).toBe(true));
  it('reads the value from a noted answer', () =>
    expect(tookRecommendation(q, ans({ value: 'client', note: 'n' }))).toBe(
      false
    ));
  it('null with no recommendation or no answer', () => {
    expect(
      tookRecommendation({ ...q, options: ['a', 'b'] }, ans('a'))
    ).toBeNull();
    expect(tookRecommendation(q, null)).toBeNull();
  });
});

describe('waitingOnYou', () => {
  it('merges overlapping gates and counts open time to now', () => {
    const gates = [
      gate({ openedAt: 0, answer: { answers: {}, by: 'x', answeredAt: 100 } }),
      gate({ openedAt: 50, answer: { answers: {}, by: 'x', answeredAt: 150 } }),
      gate({ openedAt: 300, status: 'open' }),
    ];
    expect(waitingOnYou(gates, 400)).toBe(150 + 100);
  });
  it('ends a closed gate at closedAt', () => {
    expect(
      waitingOnYou([gate({ openedAt: 0, status: 'closed', closedAt: 30 })], 999)
    ).toBe(30);
  });
});

describe('questionAnswer', () => {
  const q: GateQuestion = {
    id: 'scope',
    label: 'Scope',
    multi: false,
    options: ['a', 'b'],
  };
  const withAnswer = (v: unknown) =>
    gate({
      answer: { answers: { scope: v } as never, by: 'console', answeredAt: 1 },
    });

  it('reads a bare pick', () =>
    expect(questionAnswer(withAnswer('a').answer, q)).toEqual({
      picked: ['a'],
    }));
  it('reads a multi pick', () =>
    expect(questionAnswer(withAnswer(['a', 'b']).answer, q)).toEqual({
      picked: ['a', 'b'],
    }));
  it('carries the note and the edited text', () =>
    expect(
      questionAnswer(withAnswer({ value: 'a', note: 'n', text: 't' }).answer, q)
    ).toEqual({ picked: ['a'], note: 'n', text: 't' }));
  it('is null with no answer or no entry for the question', () => {
    expect(questionAnswer(null, q)).toBeNull();
    expect(
      questionAnswer({ answers: {}, by: 'x', answeredAt: 1 }, q)
    ).toBeNull();
  });
});

describe('gateEndNote', () => {
  it('reads closed with its reason', () =>
    expect(
      gateEndNote(gate({ status: 'closed', closedReason: 'abandoned' }))
    ).toBe('closed: abandoned'));
  it('reads superseded alone', () =>
    expect(
      gateEndNote(gate({ status: 'closed', closedReason: 'superseded' }))
    ).toBe('superseded'));
  it('reads a closed gate with no reason as closed', () =>
    expect(gateEndNote(gate({ status: 'closed' }))).toBe('closed'));
  it('is null for a gate that is not closed', () =>
    expect(gateEndNote(gate({ status: 'answered' }))).toBeNull());
});

describe('gateKindLabel', () => {
  it('spells a kind as words', () => {
    expect(gateKindLabel('review-post')).toBe('Review post');
    expect(gateKindLabel('respond-plan')).toBe('Respond plan');
    expect(gateKindLabel('self-review')).toBe('Self review');
  });
});

describe('optionViews and pickedText', () => {
  const q: GateQuestion = {
    id: 'a',
    label: 'A?',
    multi: true,
    options: [
      { value: 'x', label: 'Ex (Recommended)' },
      { value: 'y', label: 'Why' },
      'bare',
    ],
  };
  it('lifts the recommended marker off the label', () =>
    expect(optionViews(q)).toEqual([
      { value: 'x', text: 'Ex', recommended: true },
      { value: 'y', text: 'Why', recommended: false },
      { value: 'bare', text: 'bare', recommended: false },
    ]));
  it('joins the picked labels and keeps an unknown value as it is', () =>
    expect(pickedText(q, ['x', 'gone'])).toBe('Ex, gone'));
});

import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  answeredBy,
  answerStamp,
  answerSurface,
  contextSchema,
  countCommits,
  headSha,
  myGateSpans,
  structuredContextSummary,
} from './answers';
import { formatClock } from './clock';

const gate = (o: Partial<GateRow> = {}): GateRow => ({
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
const answered = (by: string | undefined): GateRow =>
  gate({
    answer: { answers: {}, by: by as string, answeredAt: 5 },
  });

describe('answeredBy', () => {
  it.each(['console', 'pane', 'board'] as const)('%s is you', via => {
    expect(answeredBy(answered(via))).toEqual({ you: true, via });
  });

  it('reads a shepherd as not you', () => {
    expect(answeredBy(answered('shepherd'))).toEqual({
      you: false,
      via: 'shepherd',
    });
  });

  it('is null for a missing or unknown by, or no answer', () => {
    expect(answeredBy(answered(undefined))).toBeNull();
    expect(answeredBy(answered(''))).toBeNull();
    expect(answeredBy(answered('mystery'))).toBeNull();
    expect(answeredBy(gate())).toBeNull();
  });
});

describe('structuredContextSummary', () => {
  const ctx = (o: object) => JSON.stringify(o);

  it('summarises each known schema by its first array', () => {
    expect(
      structuredContextSummary(
        ctx({ 'gate-ctx': 'findings@1', items: [1, 2, 3] })
      )
    ).toBe('3 findings');
    expect(
      structuredContextSummary(
        ctx({ 'gate-ctx': 'carryover@1', note: 'x', items: [1] })
      )
    ).toBe('1 carried over');
    expect(
      structuredContextSummary(ctx({ 'gate-ctx': 'skipped@1', items: [] }))
    ).toBe('0 skipped');
  });

  it('reads the schema key when there is no gate-ctx', () => {
    expect(
      structuredContextSummary(ctx({ schema: 'findings@1', list: ['a', 'b'] }))
    ).toBe('2 findings');
  });

  it('prefers gate-ctx over schema', () => {
    expect(
      structuredContextSummary(
        ctx({ 'gate-ctx': 'skipped@1', schema: 'findings@1', a: [1] })
      )
    ).toBe('1 skipped');
  });

  it('counts a known schema with no array as zero', () => {
    expect(structuredContextSummary(ctx({ 'gate-ctx': 'findings@1' }))).toBe(
      '0 findings'
    );
  });

  it('calls other JSON objects structured context', () => {
    expect(
      structuredContextSummary(ctx({ 'gate-ctx': 'other@1', items: [1] }))
    ).toBe('structured context');
    expect(structuredContextSummary(ctx({ a: 1 }))).toBe('structured context');
  });

  it('calls a top-level JSON array structured context', () => {
    expect(structuredContextSummary('[1,2]')).toBe('structured context');
    expect(structuredContextSummary('[]')).toBe('structured context');
  });

  it('is null for prose, invalid JSON, scalars and empties', () => {
    expect(structuredContextSummary('## Plan\n\nDo the thing')).toBeNull();
    expect(structuredContextSummary('{"gate-ctx": ')).toBeNull();
    expect(structuredContextSummary('42')).toBeNull();
    expect(structuredContextSummary('')).toBeNull();
    expect(structuredContextSummary(null)).toBeNull();
    expect(structuredContextSummary(undefined)).toBeNull();
  });
});

describe('countCommits', () => {
  it.each([
    ['e797751 cb5f031 1e90006', 3],
    ['e797751, cb5f031,1e90006', 3],
    ['e797751,cb5f031', 2],
    ['abc1234..def5678 (4): first, second', 4],
    ['e797751', 1],
    ['', 0],
    ['   ', 0],
    [null, 0],
  ])('%j is %i', (value, n) => expect(countCommits(value)).toBe(n));
});

describe('myGateSpans', () => {
  it('spans my gates from open to answer, close or now', () => {
    const spans = myGateSpans(
      [
        gate({
          openedAt: 10,
          answer: { answers: {}, by: 'console', answeredAt: 20 },
        }),
        gate({ openedAt: 30, status: 'closed', closedAt: 40 }),
        gate({ openedAt: 50, status: 'open' }),
      ],
      100
    );
    expect(spans).toEqual([
      { from: 10, to: 20 },
      { from: 30, to: 40 },
      { from: 50, to: 100 },
    ]);
  });

  it('leaves out herd-owned gates and empty spans', () => {
    expect(
      myGateSpans(
        [
          gate({ owner: 'herd:abc', openedAt: 1, closedAt: 9 }),
          gate({ openedAt: 100, closedAt: 100 }),
        ],
        200
      )
    ).toEqual([]);
  });
});

describe('answerStamp', () => {
  const at = new Date(2026, 9, 8, 13, 41).getTime();
  const stamped = (by: string | undefined): GateRow =>
    gate({ answer: { answers: {}, by: by as string, answeredAt: at } });

  it('reads "you" for console, pane and board', () => {
    for (const by of ['console', 'pane', 'board'])
      expect(answerStamp(stamped(by))).toBe(`you · ${formatClock(at)}`);
  });

  it('reads "shepherd" for a shepherd', () =>
    expect(answerStamp(stamped('shepherd'))).toBe(
      `shepherd · ${formatClock(at)}`
    ));

  it('is the time alone when by is missing', () =>
    expect(answerStamp(stamped(undefined))).toBe(formatClock(at)));

  it('is null with no answer', () => expect(answerStamp(gate())).toBeNull());
});

describe('answerSurface', () => {
  it.each([
    ['console', 'Answered in the console'],
    ['pane', 'Answered in the pane'],
    ['board', 'Answered in the board'],
    ['shepherd', 'Answered by a shepherd'],
  ])('%s -> %s', (by, label) =>
    expect(answerSurface(answered(by))).toBe(label)
  );

  it('is null when by is missing', () =>
    expect(answerSurface(answered(undefined))).toBeNull());
});

describe('contextSchema', () => {
  it('reads gate-ctx, then schema', () => {
    expect(contextSchema('{"gate-ctx":"findings@1"}')).toBe('findings@1');
    expect(contextSchema('{"schema":"carryover@1"}')).toBe('carryover@1');
  });
  it('is null for prose and JSON with neither key', () => {
    expect(contextSchema('## Plan')).toBeNull();
    expect(contextSchema('{"a":1}')).toBeNull();
    expect(contextSchema(null)).toBeNull();
  });
});

describe('headSha', () => {
  it.each([
    ['e41d2b8..9f2c1a7 (4): parcel card, tests', '9f2c1a7'],
    ['e797751 cb5f031 1e90006', '1e90006'],
    ['abc1234,def5678', 'def5678'],
    ['9f2c1a7d2e', '9f2c1a7'],
    ['wrote some commits', null],
    [null, null],
  ])('%j is %j', (value, sha) => expect(headSha(value)).toBe(sha));
});

import { describe, expect, test } from 'bun:test';

import { parseSheetDraft } from '../../../sheet-draft-shape.ts';
import { restoreOps, snapshotSheet } from '../sheet-draft.ts';

const draft = {
  ticked: ['f1', 'f3', 'gone'],
  texts: {
    'comment:f1': 'edit one',
    'comment:f3': 'edit three',
    'comment:gone': 'edit of a removed finding',
    'summary:approve': 'edited summary',
    stray: 'not a draft key',
  },
  outcome: 'approve',
  notes: { outcome: 'merge when CI settles' },
};

describe('restoreOps', () => {
  test('ticks the findings the draft ticked, unticks the rest, skips unknown ids', () => {
    const ops = restoreOps(draft, ['f1', 'f2', 'f3'], []);
    expect(ops.filter(o => o.op === 'tick')).toEqual([
      { op: 'tick', id: 'f1', on: true },
      { op: 'tick', id: 'f2', on: false },
      { op: 'tick', id: 'f3', on: true },
    ]);
    expect(ops).not.toContainEqual(
      expect.objectContaining({ key: 'comment:gone' })
    );
    expect(ops).not.toContainEqual(expect.objectContaining({ key: 'stray' }));
  });

  test('a revised finding keeps its tick but loses its comment edit', () => {
    const ops = restoreOps(draft, ['f1', 'f2', 'f3'], ['f3']);
    expect(ops).toContainEqual({ op: 'tick', id: 'f3', on: true });
    expect(ops).not.toContainEqual(
      expect.objectContaining({ key: 'comment:f3' })
    );
    expect(ops).toContainEqual({
      op: 'text',
      key: 'comment:f1',
      value: 'edit one',
    });
  });

  test('carries the outcome, the summary text and the notes', () => {
    const ops = restoreOps(draft, ['f1'], []);
    expect(ops).toContainEqual({ op: 'outcome', value: 'approve' });
    expect(ops).toContainEqual({
      op: 'text',
      key: 'summary:approve',
      value: 'edited summary',
    });
    expect(ops).toContainEqual({
      op: 'note',
      key: 'outcome',
      value: 'merge when CI settles',
    });
  });

  test('a draft with no outcome sets none', () => {
    const rest = { ...draft, outcome: undefined };
    expect(restoreOps(rest, ['f1'], []).some(o => o.op === 'outcome')).toBe(
      false
    );
  });
});

describe('snapshotSheet', () => {
  test('unions chunked and collapsed findings selections', () => {
    const snap = snapshotSheet(
      {
        selections: {
          'findings-1': ['f1', 'f2'],
          'findings-2': ['f2', 'f5'],
          findings: ['f9'],
          skipped: ['s1'],
          outcome: 'comment',
        },
        texts: {},
        notes: {},
      },
      { findings: 'findings', outcome: 'outcome' }
    );
    expect(snap.ticked.sort()).toEqual(['f1', 'f2', 'f5', 'f9']);
    expect(snap.outcome).toBe('comment');
  });

  test('keeps only comment and summary texts, and the notes', () => {
    const snap = snapshotSheet(
      {
        selections: { findings: ['f1'], outcome: 'approve' },
        texts: {
          'comment:f1': 'a',
          'summary:approve': 'b',
          'reply:thread-1': 'carryover reply',
        },
        notes: { outcome: 'n' },
      },
      { findings: 'findings', outcome: 'outcome' }
    );
    expect(snap.texts).toEqual({ 'comment:f1': 'a', 'summary:approve': 'b' });
    expect(snap.notes).toEqual({ outcome: 'n' });
  });

  test('round-trips through restoreOps', () => {
    const form = {
      selections: { findings: ['f1', 'f3'], outcome: 'approve' },
      texts: { 'comment:f3': 'x' },
      notes: {},
    };
    const ops = restoreOps(
      snapshotSheet(form, { findings: 'findings', outcome: 'outcome' }),
      ['f1', 'f2', 'f3'],
      []
    );
    expect(ops.filter(o => o.op === 'tick' && o.on).length).toBe(2);
    expect(ops).toContainEqual({ op: 'text', key: 'comment:f3', value: 'x' });
  });
});

describe('parseSheetDraft', () => {
  test('accepts a draft, drops unknown fields and keeps an absent outcome absent', () => {
    expect(
      parseSheetDraft({ ticked: ['f1'], texts: {}, notes: {}, extra: 1 })
    ).toEqual({ ticked: ['f1'], texts: {}, notes: {} });
  });

  test.each([
    [null],
    [[]],
    [{ texts: {}, notes: {} }],
    [{ ticked: [1], texts: {}, notes: {} }],
    [{ ticked: [], texts: { a: 1 }, notes: {} }],
    [{ ticked: [], texts: {}, notes: [] }],
    [{ ticked: [], texts: {}, notes: {}, outcome: 3 }],
  ])('rejects %j', body => {
    expect(parseSheetDraft(body)).toBeNull();
  });
});

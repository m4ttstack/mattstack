import { describe, expect, it } from 'vitest';

import { runKind, runTitle } from './kind';

describe('runKind', () => {
  it.each([
    ['feature', 'work'],
    ['work', 'work'],
    ['review', 'review'],
    ['receive-review', 'respond'],
    ['watch-ci', 'utility'],
    ['sync-open-mrs', 'utility'],
    ['', 'utility'],
  ])('%s is %s', (type, kind) => expect(runKind(type)).toBe(kind));
});

describe('runTitle', () => {
  const run = (o: object = {}) => ({
    ticket: null,
    branch: null,
    work_type: 'feature',
    id: 'r1',
    ...o,
  });

  it('prefers the ticket title', () => {
    expect(
      runTitle(run({ branch: 'web-412' }), {
        ticketTitle: 'Add export',
        mrTitle: 'MR',
      })
    ).toBe('Add export');
  });

  it('falls back to the branch', () => {
    expect(runTitle(run({ branch: 'web-412-export' }), {})).toBe(
      'web-412-export'
    );
  });

  it('uses the MR title for review and respond runs', () => {
    expect(
      runTitle(run({ work_type: 'review' }), { mrTitle: 'Fix cart' })
    ).toBe('Fix cart');
    expect(
      runTitle(run({ work_type: 'receive-review' }), { mrTitle: 'Fix cart' })
    ).toBe('Fix cart');
  });

  it('ignores the MR title for other kinds', () => {
    expect(runTitle(run(), { mrTitle: 'Fix cart' })).toBe('feature run');
  });

  it('ends on the work type, never the run id', () => {
    expect(runTitle(run({ work_type: 'watch-ci', id: 'r9' }), {})).toBe(
      'watch-ci run'
    );
  });

  it('skips blank values', () => {
    expect(
      runTitle(run({ branch: '  ' }), { ticketTitle: '', mrTitle: null })
    ).toBe('feature run');
  });

  it('titles a review by its MR, never its id', () => {
    const review = run({
      branch: 'feature/x',
      work_type: 'review',
      id: '2026-1',
      outcome: { reviewed: { iid: 412 } },
    });
    expect(runTitle(review, { mrTitle: 'Dedupe contacts' })).toBe(
      'Dedupe contacts'
    );
    expect(runTitle(review, { ticketTitle: 'Dedupe' })).toBe('Dedupe');
    expect(runTitle(review, {})).toBe('Review of !412');
    expect(runTitle({ ...review, outcome: null }, {})).toBe('review run');
  });
});

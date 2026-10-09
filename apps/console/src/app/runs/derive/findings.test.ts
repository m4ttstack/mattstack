import { describe, expect, it } from 'vitest';

import { parseFinding } from './findings';

describe('parseFinding', () => {
  it('lifts severity and location', () => {
    expect(
      parseFinding(
        '[Important] Dedupe matches on email only. (contacts/import/dedupe.ts:58)'
      )
    ).toEqual({
      severity: 'important',
      text: 'Dedupe matches on email only.',
      where: 'contacts/import/dedupe.ts:58',
    });
  });

  it('drops a non-blocking tag and keeps minor', () => {
    expect(
      parseFinding('[Minor] [NON-BLOCKING] overview leans on another island')
    ).toEqual({
      severity: 'minor',
      text: 'overview leans on another island',
      where: null,
    });
  });

  it('leaves plain text alone', () => {
    expect(parseFinding('Approve')).toEqual({
      severity: null,
      text: 'Approve',
      where: null,
    });
  });
});

import { expect, test } from 'bun:test';

import { redoCopy } from '../redo-copy.ts';

test('one MR: says it starts from scratch and that a run already happened', () => {
  expect(redoCopy('review', 1)).toEqual({
    title: 'Redo review?',
    body: [
      'This will start a new review from scratch.',
      'Another review was already run on this MR. Are you sure?',
    ],
    confirmLabel: 'Redo review',
  });
  expect(redoCopy('respond', 1).body[0]).toBe(
    'This will start a new response from scratch.'
  );
  expect(redoCopy('doctor', 1).confirmLabel).toBe('Redo doctor run');
});

test('several MRs: counts them', () => {
  expect(redoCopy('review', 4)).toEqual({
    title: 'Redo 4 reviews?',
    body: [
      'This will start 4 new reviews from scratch.',
      'Each of these MRs already had a review run. Are you sure?',
    ],
    confirmLabel: 'Redo 4 reviews',
  });
});

test('several MRs where only some had a run: says how many', () => {
  expect(redoCopy('review', 4, 1).body[1]).toBe(
    '1 of these MRs already had a review run. Are you sure?'
  );
});

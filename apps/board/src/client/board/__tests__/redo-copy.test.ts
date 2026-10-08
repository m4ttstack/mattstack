import { expect, test } from 'bun:test';

import { redoCopy } from '../redo-copy.ts';

test('one MR: says it starts from scratch and that a run already happened', () => {
  expect(redoCopy('review', 1)).toEqual({
    title: 'Redo review?',
    body: [
      'This will start a new review from scratch.',
      'This MR already had a review. Are you sure?',
    ],
    confirmLabel: 'Redo review',
  });
  expect(redoCopy('respond', 1).body).toEqual([
    'This will start a new response from scratch.',
    'This MR already had a response. Are you sure?',
  ]);
  expect(redoCopy('doctor', 1)).toEqual({
    title: 'Redo doctor run?',
    body: [
      'This will start a new doctor run from scratch.',
      'This MR already had a doctor run. Are you sure?',
    ],
    confirmLabel: 'Redo doctor run',
  });
});

test('several MRs that all had a run: counts them', () => {
  expect(redoCopy('review', 4)).toEqual({
    title: 'Redo 4 reviews?',
    body: [
      'This will start 4 new reviews from scratch.',
      'Each of these MRs already had a review. Are you sure?',
    ],
    confirmLabel: 'Redo 4 reviews',
  });
  expect(redoCopy('doctor', 2).body[1]).toBe(
    'Each of these MRs already had a doctor run. Are you sure?'
  );
});

test('a mix of first runs and redos starts them, and says how many had one', () => {
  expect(redoCopy('review', 3, 1)).toEqual({
    title: 'Start 3 reviews?',
    body: [
      'This will start 3 new reviews from scratch.',
      '1 of these MRs already had a review. Are you sure?',
    ],
    confirmLabel: 'Start 3 reviews',
  });
});

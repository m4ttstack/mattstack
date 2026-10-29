import { expect, test } from 'bun:test';

import {
  canonicalReactedBy,
  canonicalReactions,
  DEFAULT_SLACK_EMOJI,
} from '../slack-emoji.ts';

test("another channel's emoji count as the board's marks", () => {
  expect(
    canonicalReactions(
      ['eyestalks', 'mr-approved', 'white_check_mark', 'tada'],
      DEFAULT_SLACK_EMOJI,
      { looking: ['eyestalks'], approved: ['mr-approved'] }
    )
  ).toEqual(['eyes', 'white_check_mark', 'tada']);
});

test('who reacted merges across a role and its aliases', () => {
  expect(
    canonicalReactedBy(
      {
        white_check_mark: { you: false, others: ['U1'] },
        'mr-approved': { you: true, others: ['U1', 'U2'] },
        tada: { you: false, others: ['U3'] },
      },
      DEFAULT_SLACK_EMOJI,
      { approved: ['mr-approved'] }
    )
  ).toEqual({
    white_check_mark: { you: true, others: ['U1', 'U2'] },
    tada: { you: false, others: ['U3'] },
  });
});

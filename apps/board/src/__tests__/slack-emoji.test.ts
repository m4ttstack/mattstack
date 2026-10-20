import { expect, test } from 'bun:test';

import { canonicalReactions, DEFAULT_SLACK_EMOJI } from '../slack-emoji.ts';

test("another channel's emoji count as the board's marks", () => {
  expect(
    canonicalReactions(
      ['eyestalks', 'mr-approved', 'white_check_mark', 'tada'],
      DEFAULT_SLACK_EMOJI,
      { looking: ['eyestalks'], approved: ['mr-approved'] }
    )
  ).toEqual(['eyes', 'white_check_mark', 'tada']);
});

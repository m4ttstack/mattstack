import { expect, test } from 'bun:test';

import { getDef } from '@mattstack/rt-client';
import { ALL_TURN } from '../../../turn.ts';
import { AUTHOR_LABEL, REVIEWER_LABEL } from '../turn-labels.ts';

type Side = {
  labels: Record<string, string>;
  default: string[];
  items: { enum: string[] };
};

const sides = () =>
  getDef('board.turn')!.schema!.properties as Record<
    'author' | 'reviewer',
    Side
  >;
const sentence = (s: string) => s[0]!.toUpperCase() + s.slice(1);

test("the settings editor's checkbox labels are the board's own words", () => {
  const { author, reviewer } = sides();
  expect(author.labels).toEqual(
    Object.fromEntries(
      Object.entries(AUTHOR_LABEL).map(([k, v]) => [k, sentence(v)])
    )
  );
  expect(reviewer.labels).toEqual(
    Object.fromEntries(
      Object.entries(REVIEWER_LABEL).map(([k, v]) => [k, sentence(v)])
    )
  );
});

test('the settings editor reads an unset list the way the board does: every signal', () => {
  const { author, reviewer } = sides();
  expect(author.default).toEqual(ALL_TURN.author);
  expect(author.items.enum).toEqual(ALL_TURN.author);
  expect(reviewer.default).toEqual(ALL_TURN.reviewer);
  expect(reviewer.items.enum).toEqual(ALL_TURN.reviewer);
});

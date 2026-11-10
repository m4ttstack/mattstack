import { describe, expect, test } from 'bun:test';

import { slackFaceNames } from '../slack-face-names.ts';

describe('slackFaceNames', () => {
  test('authors, board members and every org team member are matched', () => {
    expect(
      slackFaceNames(
        [{ author: { username: 'carl', name: 'Carl Ray' } }],
        new Map([['amy', 'Amy Ito']]),
        [
          {
            name: 'other',
            members: [{ username: 'leath', name: 'Leath Cooper' }],
          },
        ]
      )
    ).toEqual([
      ['carl', 'Carl Ray'],
      ['amy', 'Amy Ito'],
      ['leath', 'Leath Cooper'],
    ]);
  });

  test('a team member without a name is still passed, as unnamed', () => {
    expect(
      slackFaceNames([], new Map(), [
        { name: 'other', members: [{ username: 'x' }] },
      ])
    ).toEqual([['x', undefined]]);
  });
});

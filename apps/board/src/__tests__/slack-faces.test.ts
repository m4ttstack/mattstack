import { expect, test } from 'bun:test';

import { slackFaces } from '../slack-faces.ts';

const slack = [
  { id: 'U1', displayName: 'alex', realName: 'Alex Example' },
  { id: 'U2', displayName: 'sam', realName: 'Sam Lee' },
  { id: 'U3', displayName: 'sam', realName: 'Sam Park' },
];

test('a real name matches whatever its case and spacing', () => {
  expect(slackFaces([['aexample', '  alex   EXAMPLE ']], slack)).toEqual({
    aexample: 'U1',
  });
});

test('a display name matches when it fits one person', () => {
  expect(slackFaces([['a', 'alex']], slack)).toEqual({ a: 'U1' });
});

test('a name that fits two people matches neither', () => {
  expect(slackFaces([['s', 'sam']], slack)).toEqual({});
});

test('no name and an unknown name match nobody', () => {
  expect(
    slackFaces(
      [
        ['a', null],
        ['b', 'Nobody Here'],
      ],
      slack
    )
  ).toEqual({});
});

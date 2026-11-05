import { expect, test } from 'bun:test';

import { matchSlackFaces } from '../src/slack-faces.ts';

const slack = [
  { id: 'U1', displayName: 'alex', realName: 'Alex Example' },
  { id: 'U2', displayName: 'sam', realName: 'Sam Lee' },
  { id: 'U3', displayName: 'sam', realName: 'Sam Park' },
];

test('a real name matches whatever its case and spacing', () => {
  expect(matchSlackFaces([['aexample', '  alex   EXAMPLE ']], slack)).toEqual({
    aexample: 'U1',
  });
});

test('a display name matches when it fits one person', () => {
  expect(matchSlackFaces([['a', 'alex']], slack)).toEqual({ a: 'U1' });
});

test('a name that fits two people matches neither', () => {
  expect(matchSlackFaces([['s', 'sam']], slack)).toEqual({});
});

test('a middle initial does not stop a match', () => {
  expect(matchSlackFaces([['a', 'Alex Q. Example']], slack)).toEqual({ a: 'U1' });
});

test('a loose match that fits two people matches neither', () => {
  const twins = [
    { id: 'U1', displayName: '', realName: 'Sam A Lee' },
    { id: 'U2', displayName: '', realName: 'Sam B Lee' },
  ];
  expect(matchSlackFaces([['s', 'Sam Lee']], twins)).toEqual({});
});

test('no name and an unknown name match nobody', () => {
  expect(
    matchSlackFaces(
      [
        ['a', null],
        ['b', 'Nobody Here'],
      ],
      slack
    )
  ).toEqual({});
});

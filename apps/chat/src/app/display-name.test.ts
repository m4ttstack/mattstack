import { expect, test } from 'vitest';

import { displayName, dmPairLabel, repeatedPairLabels } from './display-name';

test('displayName prefers the name and falls back to the id', () => {
  expect(displayName({ handle: 'remy.m2p4', name: 'remy' })).toBe('remy');
  expect(displayName({ handle: 'kai' })).toBe('kai');
});

test('dmPairLabel reads names, each side falling back to its id', () => {
  expect(
    dmPairLabel({ a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' })
  ).toBe('kai ↔ remy');
  expect(dmPairLabel({ a: 'kai', b: 'remy' })).toBe('kai ↔ remy');
});

test('repeatedPairLabels names only the pair labels two listed DMs share', () => {
  const repeated = repeatedPairLabels([
    { participants: { a: 'kai', b: 'remy', aName: 'kai', bName: 'remy' } },
    {
      participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
    },
    { participants: { a: 'jay', b: 'max' } },
    {},
  ]);
  expect([...repeated]).toEqual(['kai ↔ remy']);
});

import { expect, test } from 'bun:test';

import { triageOwns } from '../triage/seat.ts';

const by = (username: string) => ({ author: { username } });

test('triage owns an MR the seat and the token user both authored', () => {
  expect(triageOwns(by('alice'), 'alice', 'alice')).toBe(true);
  expect(triageOwns(by('Alice'), 'alice', 'ALICE')).toBe(true);
});

test("a seat that is not the token's user owns nothing", () => {
  expect(triageOwns(by('alice'), 'alice', 'carol')).toBe(false);
  expect(triageOwns(by('carol'), 'alice', 'carol')).toBe(false);
});

test('a seatless ("all") board owns nothing, so neither auto-doctor nor respond asks run', () => {
  expect(triageOwns(by('alice'), 'all', 'alice')).toBe(false);
  expect(triageOwns(by('alice'), '', 'alice')).toBe(false);
});

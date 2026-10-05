import { describe, expect, test } from 'bun:test';

import { ALL_TURN } from '../turn.ts';
import { readTurnConfig } from '../turn-setting.ts';

const resolver = (value: unknown) =>
  ((key: string) => {
    if (key !== 'board.turn') throw new Error(`unexpected ${key}`);
    return { value };
  }) as never;

describe('readTurnConfig', () => {
  test('unset resolves to every signal', () => {
    expect(readTurnConfig(resolver(undefined))).toEqual(ALL_TURN);
  });
  test('a stored value is resolved', () => {
    expect(readTurnConfig(resolver({ author: ['threads'] })).author).toEqual(['threads']);
  });
  test('a resolver that throws (unregistered key on an old pin) falls open', () => {
    const throwing = (() => { throw new Error('unknown key'); }) as never;
    expect(readTurnConfig(throwing)).toEqual(ALL_TURN);
  });
});

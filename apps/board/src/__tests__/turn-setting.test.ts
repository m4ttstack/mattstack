import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { ALL_TURN } from '../turn.ts';
import { readTurnConfig, resetTurnWarning } from '../turn-setting.ts';

const resolver = (value: unknown) =>
  ((key: string) => {
    if (key !== 'board.turn') throw new Error(`unexpected ${key}`);
    return { value };
  }) as never;

describe('readTurnConfig', () => {
  afterEach(resetTurnWarning);

  test('unset resolves to every signal', () => {
    expect(readTurnConfig(resolver(undefined))).toEqual(ALL_TURN);
  });
  test('a stored value is resolved', () => {
    expect(readTurnConfig(resolver({ author: ['threads'] })).author).toEqual(['threads']);
  });
  test('a resolver that throws (unregistered key on an old pin) falls open', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = (() => { throw new Error('unknown key'); }) as never;
    expect(readTurnConfig(throwing)).toEqual(ALL_TURN);
    warn.mockRestore();
  });
  test('a non-object value falls open', () => {
    expect(readTurnConfig(resolver('x'))).toEqual(ALL_TURN);
  });
  test('an unknown signal name falls open', () => {
    expect(readTurnConfig(resolver({ author: ['nope'] }))).toEqual(ALL_TURN);
  });
  test('a throwing resolver warns once across repeated reads', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = (() => { throw new Error('unknown key'); }) as never;
    readTurnConfig(throwing);
    readTurnConfig(throwing);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

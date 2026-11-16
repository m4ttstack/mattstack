import { describe, expect, test } from 'bun:test';

import { joinErrors } from '../join-errors.ts';

describe('joinErrors', () => {
  test('joins several messages with a semicolon, no dot', () => {
    expect(joinErrors(['acme/web: timeout', 'acme/api: 502'])).toBe(
      'acme/web: timeout; acme/api: 502'
    );
  });
  test('leaves one message as it is', () => {
    expect(joinErrors(['acme/web: timeout'])).toBe('acme/web: timeout');
  });
});

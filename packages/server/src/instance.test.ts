import { expect, test } from 'vitest';

import { bootId, buildIdOf } from './instance';

test('bootId is a uuid', () => {
  expect(bootId).toMatch(/^[0-9a-f-]{36}$/);
});

test('buildIdOf is 16 hex chars that follow the bytes, not the part type', () => {
  const id = buildIdOf('a', 'b');
  expect(id).toMatch(/^[0-9a-f]{16}$/);
  expect(buildIdOf(new TextEncoder().encode('a'), 'b')).toBe(id);
  expect(buildIdOf('a', 'c')).not.toBe(id);
});

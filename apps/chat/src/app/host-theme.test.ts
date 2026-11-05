import { expect, test } from 'vitest';

import { hostTheme } from './host-theme';

test('an embed takes the scheme the host names', () => {
  expect(hostTheme('/embed/r/rt', '?theme=dark')).toBe('dark');
  expect(hostTheme('/embed/r/rt', '?theme=light')).toBe('light');
});

test('any other value leaves the scheme alone', () => {
  expect(hostTheme('/embed/r/rt', '?theme=neon')).toBeUndefined();
  expect(hostTheme('/embed/r/rt', '')).toBeUndefined();
});

test('the main app ignores the parameter', () => {
  expect(hostTheme('/r/rt', '?theme=dark')).toBeUndefined();
});

import { describe, expect, test } from 'bun:test';
import { mainCheckoutOf } from '../src/cli/context.ts';

describe('mainCheckoutOf', () => {
  test('a .git common dir belongs to the checkout that holds it', () => {
    expect(mainCheckoutOf('/Users/me/code/app/.git')).toBe('/Users/me/code/app');
  });

  test('a bare repo has no main checkout', () => {
    expect(mainCheckoutOf('/srv/git/app.git')).toBeNull();
  });
});

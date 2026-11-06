// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { isCompiledBinaryMain, isHelperBundle } from './compiled-binary';

describe('isCompiledBinaryMain', () => {
  it('is true for the virtual path Bun compiles the entrypoint into', () => {
    expect(isCompiledBinaryMain('/$bunfs/root/console')).toBe(true);
  });

  it('is false for a normal filesystem path (bun run of source)', () => {
    expect(
      isCompiledBinaryMain('/Users/matt/console/src/server/index.ts')
    ).toBe(false);
  });

  it('is false for an empty string', () => {
    expect(isCompiledBinaryMain('')).toBe(false);
  });
});

describe('isHelperBundle', () => {
  const g = globalThis as { MATTSTACK_HELPER_BUNDLE?: unknown };
  afterEach(() => {
    delete g.MATTSTACK_HELPER_BUNDLE;
  });

  it('is false where the bundle define never ran', () => {
    expect(isHelperBundle()).toBe(false);
  });

  it('is true once the define is true', () => {
    g.MATTSTACK_HELPER_BUNDLE = true;
    expect(isHelperBundle()).toBe(true);
  });

  it('ignores a value other than true', () => {
    g.MATTSTACK_HELPER_BUNDLE = 'true';
    expect(isHelperBundle()).toBe(false);
  });
});

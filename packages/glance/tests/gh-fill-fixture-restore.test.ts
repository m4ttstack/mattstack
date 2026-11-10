import { describe, expect, test } from 'bun:test';
import { stubForge, useForgeStub } from './helpers/gh-fill-fixture.ts';

const originalFetch = globalThis.fetch;
useForgeStub();

describe('stubForge restore', () => {
  test('first test installs the stub', () => {
    stubForge({});
    expect(globalThis.fetch).not.toBe(originalFetch);
  });

  test('second test starts with the real fetch', () => {
    expect(globalThis.fetch).toBe(originalFetch);
    stubForge({});
    expect(globalThis.fetch).not.toBe(originalFetch);
  });
});

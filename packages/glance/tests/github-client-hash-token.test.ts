import { describe, expect, test } from 'bun:test';
import { hashToken } from '../src/githubClient';

describe('hashToken', () => {
  test('is deterministic, 16 hex chars, and differs per token', () => {
    const a = hashToken('ghp_first');
    expect(hashToken('ghp_first')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hashToken('ghp_second')).not.toBe(a);
    expect(hashToken('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

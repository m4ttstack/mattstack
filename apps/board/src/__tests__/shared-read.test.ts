import { describe, expect, test } from 'bun:test';

import { sharedRead } from '../shared-read.ts';

describe('sharedRead', () => {
  function counter(result: () => Promise<string>) {
    const calls: string[] = [];
    const read = (key: string) => {
      calls.push(key);
      return result();
    };
    return { calls, read };
  }

  test('concurrent callers for one key share a single read', async () => {
    const { calls, read } = counter(async () => 'v');
    const shared = sharedRead(read, { freshMs: 1000, failMs: 1000 });
    const got = await Promise.all([shared('a'), shared('a'), shared('a')]);
    expect(got).toEqual(['v', 'v', 'v']);
    expect(calls).toEqual(['a']);
  });

  test('keys read separately', async () => {
    const { calls, read } = counter(async () => 'v');
    const shared = sharedRead(read, { freshMs: 1000, failMs: 1000 });
    await Promise.all([shared('a'), shared('b')]);
    expect(calls).toEqual(['a', 'b']);
  });

  test('reuses a result while fresh and reads again once stale', async () => {
    let t = 0;
    const { calls, read } = counter(async () => 'v');
    const shared = sharedRead(read, {
      freshMs: 1000,
      failMs: 5000,
      now: () => t,
    });
    await shared('a');
    t = 999;
    await shared('a');
    expect(calls.length).toBe(1);
    t = 1000;
    await shared('a');
    expect(calls.length).toBe(2);
  });

  test('a failure is replayed without reading until the backoff passes', async () => {
    let t = 0;
    const { calls, read } = counter(async () => {
      throw new Error('worktree list failed');
    });
    const shared = sharedRead(read, {
      freshMs: 1000,
      failMs: 5000,
      now: () => t,
    });
    await expect(shared('a')).rejects.toThrow('worktree list failed');
    t = 4999;
    await expect(shared('a')).rejects.toThrow('worktree list failed');
    expect(calls.length).toBe(1);
    t = 5000;
    await expect(shared('a')).rejects.toThrow('worktree list failed');
    expect(calls.length).toBe(2);
  });

  test('a fresh read skips the cache and a replayed failure, and later reads share its result', async () => {
    let n = 0;
    let fail = true;
    const read = async () => {
      n++;
      if (fail) throw new Error('busy');
      return `v${n}`;
    };
    const shared = sharedRead(read, {
      freshMs: 1000,
      failMs: 5000,
      now: () => 0,
    });
    await expect(shared('a')).rejects.toThrow('busy');
    fail = false;
    expect(await shared('a', { fresh: true })).toBe('v2');
    expect(await shared('a')).toBe('v2');
    expect(n).toBe(2);
  });
});

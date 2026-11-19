import { describe, expect, test } from 'bun:test';

import { MEMBER_FAIL_MS, MEMBER_FRESH_MS, memberRead } from '../member-read.ts';

const POLL_MS = 15_000;

describe('memberRead', () => {
  test('tabs polling one member share a single fetch', async () => {
    const calls: string[] = [];
    const read = memberRead(async (u: string) => {
      calls.push(u);
      return [u];
    });
    await Promise.all([read('ana'), read('ana'), read('bo')]);
    expect(calls).toEqual(['ana', 'bo']);
  });

  test('a result is reused within one poll interval, then refetched', async () => {
    let t = 0;
    let calls = 0;
    const read = memberRead(
      async () => {
        calls++;
        return [];
      },
      () => t
    );
    await read('ana');
    t = MEMBER_FRESH_MS - 1;
    await read('ana');
    expect(calls).toBe(1);
    t = POLL_MS;
    await read('ana');
    expect(calls).toBe(2);
  });

  test('a failed fetch is replayed until the backoff passes', async () => {
    let t = 0;
    let calls = 0;
    const read = memberRead(
      async () => {
        calls++;
        throw new Error('daemon timeout');
      },
      () => t
    );
    await expect(read('ana')).rejects.toThrow('daemon timeout');
    t = POLL_MS * 3;
    await expect(read('ana')).rejects.toThrow('daemon timeout');
    expect(calls).toBe(1);
    t = MEMBER_FAIL_MS;
    await expect(read('ana')).rejects.toThrow('daemon timeout');
    expect(calls).toBe(2);
  });
});

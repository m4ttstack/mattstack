import { describe, expect, test } from 'bun:test';

import { skipWhileBusy } from '../poll-guard.ts';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise(r => setTimeout(r, 0));

describe('skipWhileBusy', () => {
  test('a tick while the previous request is pending starts nothing', async () => {
    const first = deferred();
    let calls = 0;
    const tick = skipWhileBusy(() => {
      calls++;
      return calls === 1 ? first.promise : Promise.resolve();
    });
    tick();
    tick();
    tick();
    expect(calls).toBe(1);
    first.resolve();
    await settle();
    tick();
    expect(calls).toBe(2);
  });

  test('a failed request frees the next tick', async () => {
    const first = deferred();
    let calls = 0;
    const tick = skipWhileBusy(() => {
      calls++;
      return calls === 1 ? first.promise : Promise.resolve();
    });
    tick();
    first.reject(new Error('502'));
    await settle();
    tick();
    expect(calls).toBe(2);
  });
});

import { describe, expect, test } from 'bun:test';

import { claimCronWaiting, triageShouldRun } from '../triage/peer-pass.ts';

describe('triageShouldRun', () => {
  const off = { triage: false, reReview: false, peerAsks: false };

  test('the peer pass runs only for automatic asks', () => {
    expect(triageShouldRun(true, { ...off, peerAsks: true })).toBe(true);
    expect(
      triageShouldRun(true, { triage: true, reReview: true, peerAsks: false })
    ).toBe(false);
  });

  test('the full pass runs when any of the three switches is on', () => {
    expect(triageShouldRun(false, off)).toBe(false);
    expect(triageShouldRun(false, { ...off, triage: true })).toBe(true);
    expect(triageShouldRun(false, { ...off, reReview: true })).toBe(true);
    expect(triageShouldRun(false, { ...off, peerAsks: true })).toBe(true);
  });
});

describe('claimCronWaiting', () => {
  test('takes a free claim at once', async () => {
    const sleeps: number[] = [];
    const token = await claimCronWaiting({
      tryClaim: () => 'tok',
      sleep: async ms => void sleeps.push(ms),
    });
    expect(token).toBe('tok');
    expect(sleeps).toEqual([]);
  });

  test('waits for a held claim and takes it once released', async () => {
    let t = 0;
    let attempts = 0;
    const token = await claimCronWaiting({
      tryClaim: () => (++attempts < 4 ? false : 'tok'),
      now: () => t,
      sleep: async ms => {
        t += ms;
      },
    });
    expect(token).toBe('tok');
    expect(attempts).toBe(4);
    expect(t).toBe(3_000);
  });

  test('gives up after the stale window', async () => {
    let t = 0;
    const token = await claimCronWaiting({
      tryClaim: () => false,
      now: () => t,
      sleep: async ms => {
        t += ms;
      },
    });
    expect(token).toBe(false);
    expect(t).toBe(120_000);
  });
});

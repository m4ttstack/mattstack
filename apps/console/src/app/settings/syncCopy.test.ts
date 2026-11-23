import { describe, expect, it } from 'vitest';

import { agoText, pushHelps, waitingTitle } from './syncCopy';

describe('syncCopy', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');

  it('reads a push time in plain steps', () => {
    expect(agoText(now - 20_000, now)).toBe('just now');
    expect(agoText(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(agoText(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(agoText(now - 50 * 3_600_000, now)).toBe('2 d ago');
  });

  it('offers a push only where one can help', () => {
    expect(pushHelps({ kind: 'waiting', count: 1 })).toBe(true);
    expect(pushHelps({ kind: 'pushed', lastPushAt: null })).toBe(true);
    expect(pushHelps({ kind: 'unknown' })).toBe(false);
    expect(
      pushHelps({ kind: 'stuck', reason: 'push-failed', detail: null })
    ).toBe(true);
    for (const reason of ['conflict', 'trial', 'layout-hold'] as const)
      expect(pushHelps({ kind: 'stuck', reason, detail: null })).toBe(false);
  });

  it('counts one change in the singular', () => {
    expect(waitingTitle(1, 'acme')).toBe('1 change waiting to reach acme');
    expect(waitingTitle(3, 'acme')).toBe('3 changes waiting to reach acme');
  });
});

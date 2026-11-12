import { describe, expect, it } from 'vitest';

import { confirmLabel, type TeamInvite } from './team';

const invite = (handle: string, state: TeamInvite['state']): TeamInvite => ({
  handle,
  teams: [],
  expiresAt: '2026-12-01T00:00:00.000Z',
  state,
});

describe('confirmLabel', () => {
  it('is null when nobody has replied', () => {
    expect(confirmLabel([])).toBeNull();
    expect(
      confirmLabel([invite('a', 'invited'), invite('b', 'expired')])
    ).toBeNull();
  });
  it('names a single replier', () => {
    expect(
      confirmLabel([invite('alice', 'replied'), invite('b', 'invited')])
    ).toBe('Add alice');
  });
  it('counts several repliers', () => {
    expect(
      confirmLabel([invite('alice', 'replied'), invite('bob', 'replied')])
    ).toBe('Add 2 people');
  });
});

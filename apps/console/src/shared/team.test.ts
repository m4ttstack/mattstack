import { describe, expect, it } from 'vitest';

import { confirmLabel, settledMembers, type TeamInvite } from './team';

const invite = (handle: string, state: TeamInvite['state']): TeamInvite => ({
  handle,
  teams: [],
  expiresAt: '2026-12-01T00:00:00.000Z',
  state,
});

describe('settledMembers', () => {
  it('drops a member with an open invite in any state, by canonical handle', () => {
    const members = settledMembers({
      slug: 'acme',
      name: 'acme',
      role: 'org-owner',
      activeTeam: null,
      relayFailed: false,
      adminSecrets: null,
      members: [
        { username: 'matt', role: 'org-owner', peered: true },
        { username: 'Alice', role: 'member', peered: false },
        { username: 'bob', role: 'member', peered: false },
        { username: 'cy', role: 'member', peered: false },
      ],
      invites: [
        invite(' alice ', 'replied'),
        invite('bob', 'invited'),
        invite('cy', 'expired'),
      ],
    });
    expect(members.map(m => m.username)).toEqual(['matt']);
  });
});

describe('confirmLabel', () => {
  it('is null when nobody has replied', () => {
    expect(confirmLabel([])).toBeNull();
    expect(
      confirmLabel([invite('a', 'invited'), invite('b', 'expired')])
    ).toBeNull();
  });
  it('reads Approve for a single replier', () => {
    expect(
      confirmLabel([invite('alice', 'replied'), invite('b', 'invited')])
    ).toBe('Approve');
  });
  it('counts several repliers', () => {
    expect(
      confirmLabel([invite('alice', 'replied'), invite('bob', 'replied')])
    ).toBe('Approve 2');
  });
});

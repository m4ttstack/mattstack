// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { rolesInfo } from './boxscore-roles';

const deps = (teams: string[], joined: string[], roster: unknown) => ({
  teams: () => teams,
  isJoined: (t: string) => joined.includes(t),
  roster: () => roster,
});

describe('rolesInfo', () => {
  it('lists the roster and marks the owner', () => {
    expect(
      rolesInfo(
        deps(
          ['acme'],
          [],
          [{ username: 'ada', name: 'Ada' }, { username: 'bob' }]
        )
      )
    ).toEqual({
      members: [
        { username: 'ada', name: 'Ada' },
        { username: 'bob', name: null },
      ],
      access: 'owner',
    });
  });
  it('marks a joined Mac as a member', () => {
    expect(rolesInfo(deps(['acme'], ['acme'], [])).access).toBe('member');
  });
  it('marks a Mac with no team', () => {
    expect(rolesInfo(deps([], [], [])).access).toBe('no-team');
  });
  it('drops roster entries with no username', () => {
    expect(
      rolesInfo(deps(['acme'], [], [{ name: 'x' }, 'junk'])).members
    ).toEqual([]);
  });
});

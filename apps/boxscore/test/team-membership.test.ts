import { describe, expect, it } from 'vitest';

import { standingOf } from '../src/server/config/team.js';

describe('standingOf', () => {
  it('lets an org admin see the whole team', () => {
    expect(standingOf({ kind: 'admin' }, 'widgets')).toEqual({
      seesTeam: true,
    });
  });
  it('lets an owner of the active team see the whole team', () => {
    expect(
      standingOf({ kind: 'owner', teams: ['gadgets', 'widgets'] }, 'widgets')
    ).toEqual({ seesTeam: true });
  });
  it('limits an owner of another team to the roles setting', () => {
    expect(
      standingOf({ kind: 'owner', teams: ['gadgets'] }, 'widgets')
    ).toEqual({ seesTeam: false });
  });
  it('limits an owner on no team to the roles setting', () => {
    expect(standingOf({ kind: 'owner', teams: ['gadgets'] }, null)).toEqual({
      seesTeam: false,
    });
  });
  it('limits a member, and a Mac with no recorded username, to the roles setting', () => {
    expect(standingOf({ kind: 'member' }, 'widgets')).toEqual({
      seesTeam: false,
    });
    expect(standingOf({ kind: 'unknown' }, 'widgets')).toEqual({
      seesTeam: false,
    });
  });
});

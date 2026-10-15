import { describe, expect, it } from 'vitest';

import { standingOf } from '../src/server/config/team.js';

describe('standingOf', () => {
  it('lets an org owner and an admin see the whole team', () => {
    expect(standingOf({ kind: 'org-owner' }, null).seesTeam).toBe(true);
    expect(standingOf({ kind: 'admin' }, null).seesTeam).toBe(true);
  });
  it('lets an owner see only the teams they own', () => {
    expect(standingOf({ kind: 'owner', teams: ['widgets'] }, 'widgets').seesTeam).toBe(true);
    expect(standingOf({ kind: 'owner', teams: ['widgets'] }, 'gadgets').seesTeam).toBe(false);
  });
});

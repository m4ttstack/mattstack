// @vitest-environment node
import type { OrgRoles } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { rolesInfo } from './boxscore-roles';

const ORG_ROLES: OrgRoles = {
  admins: ['dev1'],
  teams: { widgets: { owners: ['Dev2'] }, gadgets: { owners: ['dev3'] } },
};

const deps = ({
  org = 'acme',
  team = 'widgets',
  username = 'dev1',
  roles = ORG_ROLES,
  roster = [],
}: {
  org?: string | null;
  team?: string | null;
  username?: string | null;
  roles?: OrgRoles;
  roster?: unknown;
}) => ({
  where: () => ({ org, team }),
  username: () => username,
  roles: () => roles,
  roster: () => roster,
});

const roster = [
  { username: 'dev1', name: 'Dev One' },
  { username: 'dev2' },
  { username: 'dev3', name: 'Dev Three' },
];

describe('rolesInfo', () => {
  it("lists the active team's roster, marking who sees the team by their org role", async () => {
    expect(await rolesInfo(deps({ roster }))).toEqual({
      members: [
        { username: 'dev1', name: 'Dev One', fixed: 'admin' },
        { username: 'dev2', name: null, fixed: 'owner' },
        { username: 'dev3', name: 'Dev Three', fixed: null },
      ],
      access: 'owner',
    });
  });
  it('lets an org admin edit', async () => {
    expect((await rolesInfo(deps({ username: 'dev1' }))).access).toBe('owner');
  });
  it('lets an owner of the active team edit, matching the name in any case', async () => {
    expect((await rolesInfo(deps({ username: 'dev2' }))).access).toBe('owner');
  });
  it('makes an owner of another team a member here', async () => {
    expect((await rolesInfo(deps({ username: 'dev3' }))).access).toBe('member');
  });
  it('makes a Mac with no recorded username a member', async () => {
    expect((await rolesInfo(deps({ username: null }))).access).toBe('member');
  });
  it('marks a Mac in no org', async () => {
    expect((await rolesInfo(deps({ org: null }))).access).toBe('no-team');
  });
  it('fixes no owner when the Mac works as no team', async () => {
    const info = await rolesInfo(deps({ roster, team: null }));
    expect(info.members.map(m => m.fixed)).toEqual(['admin', null, null]);
  });
  it('drops roster entries with no username', async () => {
    expect(
      (await rolesInfo(deps({ roster: [{ name: 'x' }, 'junk'] }))).members
    ).toEqual([]);
  });
});

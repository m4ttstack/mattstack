import {
  activeTeam,
  activeTeamRoster,
  readForgeUsername,
  readOrgRoles,
  roleOf,
  type OrgRole,
  type OrgRoles,
} from '@mattstack/rt-client';

export interface RolesInfo {
  /** `fixed`: the member sees the whole team through their org role, whatever `boxscore.roles` says. */
  members: {
    username: string;
    name: string | null;
    fixed: 'admin' | 'owner' | null;
  }[];
  /** owner: this Mac is an org admin or an owner of its active team, so it may write the team's roles. */
  access: 'owner' | 'member' | 'no-team';
}

export interface RolesDeps {
  where: () => { org: string | null; team: string | null };
  /** The username this Mac recorded for the org, or null. */
  username: (org: string) => string | null;
  roles: (org: string) => OrgRoles;
  roster: () => unknown;
}

const realDeps: RolesDeps = {
  where: () => {
    const { org, team } = activeTeam();
    return { org, team };
  },
  username: org => readForgeUsername(org),
  roles: org => readOrgRoles(org),
  roster: () => activeTeamRoster(),
};

/** Mirrors boxscore's own viewer rule: an org admin, or an owner of the team being viewed. */
function standing(
  role: OrgRole,
  team: string | null
): 'admin' | 'owner' | null {
  if (role.kind === 'admin') return 'admin';
  if (role.kind === 'owner' && team !== null && role.teams.includes(team))
    return 'owner';
  return null;
}

export async function rolesInfo(
  deps: RolesDeps = realDeps
): Promise<RolesInfo> {
  const { org, team } = deps.where();
  const roles = org === null ? null : deps.roles(org);
  const raw = deps.roster();
  const members = (Array.isArray(raw) ? raw : []).flatMap(e =>
    typeof e === 'object' && e !== null && typeof e.username === 'string'
      ? [
          {
            username: e.username as string,
            name: typeof e.name === 'string' ? (e.name as string) : null,
            fixed: roles
              ? standing(roleOf(e.username as string, roles), team)
              : null,
          },
        ]
      : []
  );
  if (org === null || roles === null) return { members, access: 'no-team' };
  const self = standing(roleOf(deps.username(org), roles), team);
  return { members, access: self === null ? 'member' : 'owner' };
}

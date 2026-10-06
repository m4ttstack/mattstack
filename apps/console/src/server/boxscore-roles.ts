import { getSetting, isJoinedTeam, listTeams } from '@mattstack/rt-client';

export interface RolesInfo {
  members: { username: string; name: string | null }[];
  /** owner: this Mac created the team and may write team settings. */
  access: 'owner' | 'member' | 'no-team';
}

export interface RolesDeps {
  teams: () => string[];
  isJoined: (team: string) => boolean;
  roster: () => unknown;
}

const realDeps: RolesDeps = {
  teams: listTeams,
  isJoined: isJoinedTeam,
  roster: () => getSetting<unknown>('mattstack.roster').value,
};

export function rolesInfo(deps: RolesDeps = realDeps): RolesInfo {
  const teams = deps.teams();
  const raw = deps.roster();
  const members = (Array.isArray(raw) ? raw : []).flatMap(e =>
    typeof e === 'object' && e !== null && typeof e.username === 'string'
      ? [
          {
            username: e.username as string,
            name: typeof e.name === 'string' ? (e.name as string) : null,
          },
        ]
      : []
  );
  const access =
    teams.length === 0
      ? 'no-team'
      : teams.some(deps.isJoined)
        ? 'member'
        : 'owner';
  return { members, access };
}

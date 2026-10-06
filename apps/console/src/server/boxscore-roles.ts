import { getSetting, isJoinedTeam, listTeams } from '@mattstack/rt-client';

import { gitlabUsername } from './gitlab-user';

export interface RolesInfo {
  members: { username: string; name: string | null }[];
  /** owner: this Mac created the team and may write team settings. */
  access: 'owner' | 'member' | 'no-team';
  /** The roster username of the person at this owner Mac; null when unknown. */
  self: string | null;
}

export interface RolesDeps {
  teams: () => string[];
  isJoined: (team: string) => boolean;
  roster: () => unknown;
  whoami: () => Promise<string | null>;
}

const realDeps: RolesDeps = {
  teams: () => listTeams(),
  isJoined: team => isJoinedTeam(team),
  roster: () => getSetting<unknown>('mattstack.roster').value,
  whoami: () => gitlabUsername(),
};

export async function rolesInfo(
  deps: RolesDeps = realDeps
): Promise<RolesInfo> {
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
  let self: string | null = null;
  if (access === 'owner') {
    const who = (await deps.whoami())?.toLowerCase();
    self =
      members.find(m => m.username.toLowerCase() === who)?.username ?? null;
  }
  return { members, access, self };
}

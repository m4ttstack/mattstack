import { isJoinedTeam, listTeams } from '@mattstack/rt-client';

export interface TeamMembership {
  /** true = this Mac joined by invite (a member); false = it created the team (the owner). */
  joined: boolean;
}

/** One team per Mac is the rule, but two clones can exist; any joined one counts as joined. */
export function joinedOf(
  teams: string[],
  isJoined: (team: string) => boolean
): TeamMembership | null {
  if (teams.length === 0) return null;
  return { joined: teams.some(isJoined) };
}

let reader: (() => TeamMembership | null) | null = null;

/** Test seam. Under vitest the default reads no team, so no test touches the real ~/.mattstack. */
export function __setTeamReader(r: (() => TeamMembership | null) | null): void {
  reader = r;
}

export function readTeamMembership(): TeamMembership | null {
  if (reader) return reader();
  if (process.env.VITEST) return null;
  return joinedOf(listTeams(), isJoinedTeam);
}

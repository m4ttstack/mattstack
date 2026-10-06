import {
  activeTeam,
  currentOrg,
  currentRole,
  type OrgRole,
} from '@mattstack/rt-client';

export interface TeamMembership {
  /** This Mac's role shows it the whole team whatever `boxscore.roles` says: an org admin, or an owner of the active team. */
  seesTeam: boolean;
}

export function standingOf(role: OrgRole, team: string | null): TeamMembership {
  return {
    seesTeam:
      role.kind === 'admin' ||
      (role.kind === 'owner' && team !== null && role.teams.includes(team)),
  };
}

let reader: (() => TeamMembership | null) | null = null;

/** Test seam. Under vitest the default reads no team, so no test touches the real ~/.mattstack. */
export function __setTeamReader(r: (() => TeamMembership | null) | null): void {
  reader = r;
}

/** Null on a Mac in no org. */
export function readTeamMembership(): TeamMembership | null {
  if (reader) return reader();
  if (process.env.VITEST) return null;
  const org = currentOrg();
  if (org === null) return null;
  return standingOf(currentRole(org), activeTeam().team);
}

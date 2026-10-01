import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import { discoverTeams } from "../setup/team-settings.ts";

export const ONE_TEAM_RULE = "mattstack supports one team per machine today";

function otherTeamZones(p: Probes, slug: string): string[] {
  return discoverTeams(p)
    .filter((team) => team !== slug)
    .sort();
}

/** Refuses a join or create that would leave this machine with a second team zone: the settings resolver folds every zone, so a second team silently overrides the first. */
export function assertOnlyTeam(p: Probes, slug: string): void {
  const others = otherTeamZones(p, slug);
  if (others.length === 0) return;
  throw new UserActionableError("team-already-set-up", `this machine is set up for team ${others.join(", ")}; ${ONE_TEAM_RULE}`);
}

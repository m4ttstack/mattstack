import { join } from "path";
import type { Probes } from "../setup/probes.ts";
import { TEAM_NAME_RE } from "../../packages/rt-client/src/settings/stores.ts";
import { UserActionableError } from "../errors.ts";

export function assertTeamName(team: string): void {
  if (!TEAM_NAME_RE.test(team)) {
    throw new UserActionableError("bad-team-name", `${JSON.stringify(team)} cannot be a team name`, {}, {
      why: "A team name uses lowercase letters, digits and dashes, and starts with a letter.",
    });
  }
}

export function assertTeamFolders(p: Pick<Probes, "home" | "exists">, org: string, teams: string[]): void {
  for (const team of teams) {
    assertTeamName(team);
    if (!p.exists(join(p.home, ".mattstack", "teams", org, "mattstack", "teams", team, "settings.team.jsonc"))) {
      throw new UserActionableError("no-such-team", `This org has no ${team} team`, {}, { next: `rt team add ${team} --owner <username>` });
    }
  }
}

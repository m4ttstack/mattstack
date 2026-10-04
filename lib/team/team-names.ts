import { TEAM_NAME_RE } from "../../packages/rt-client/src/settings/stores.ts";
import { UserActionableError } from "../errors.ts";

export function assertTeamName(team: string): void {
  if (!TEAM_NAME_RE.test(team)) {
    throw new UserActionableError("bad-team-name", `${JSON.stringify(team)} cannot be a team name`, {}, {
      why: "A team name uses lowercase letters, digits and dashes, and starts with a letter.",
    });
  }
}

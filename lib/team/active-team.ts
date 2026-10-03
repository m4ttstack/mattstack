import { join } from "path";
import { decideActiveTeam, rosterFrom, type ActiveTeam } from "../../packages/rt-client/src/settings/active-team.ts";
import { parseStoreText, TEAM_NAME_RE } from "../settings/stores.ts";
import type { Probes } from "../setup/probes.ts";
import { orgStoreFile } from "./org-store.ts";
import { readTeamLocal } from "./team-local.ts";

/** The active team as rt-client's activeTeam() decides it, read through Probes so setup and daemon code never touches the ambient HOME. */
export function activeTeamFor(p: Pick<Probes, "readFile" | "readDir" | "home">, org: string): ActiveTeam {
  const orgFile = orgStoreFile(p.home, org);
  const userFile = join(p.home, ".mattstack", "user", "settings.user.jsonc");
  const orgRaw = p.readFile(orgFile);
  const userRaw = p.readFile(userFile);
  const setting = userRaw === null ? undefined : parseStoreText(userFile, userRaw).global["mattstack.activeTeam"];
  const username = readTeamLocal(p, org).forgeUsername ?? null;
  const decision = decideActiveTeam({
    username,
    roster: orgRaw === null ? [] : rosterFrom(parseStoreText(orgFile, orgRaw)),
    setting: typeof setting === "string" ? setting : undefined,
    teamFolders: () => p.readDir(join(p.home, ".mattstack", "teams", org, "mattstack", "teams")).filter((name) => TEAM_NAME_RE.test(name)),
  });
  return { org, username, ...decision };
}

/**
 * Which folders of an org clone a Mac checks out. Org owners and admins see
 * every team folder; everyone else sees the org files and their own teams.
 * Cone mode keeps every file directly under each parent of a listed folder,
 * so listing `mattstack/org` keeps `mattstack/mattstack.jsonc` too.
 */

import { join } from "path";
import { rosterFrom, sameUser } from "../../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, roleOf, type OrgRole } from "../../packages/rt-client/src/settings/org-roles.ts";
import { TEAM_NAME_RE, parseStoreTextStrict } from "../../packages/rt-client/src/settings/stores.ts";
import { ORG_STORE_REL } from "../../packages/rt-client/src/settings/paths.ts";
import type { Probes } from "../setup/probes.ts";
import { checkedOutBranch } from "./org-branch.ts";
import { ORG_CLONE_FOLDERS } from "./org-clone.ts";
import { isUnclaimed, orgRolesOf } from "./org-store-scope.ts";
import { withoutUrls } from "./redact.ts";
import { readTeamLocal } from "./team-local.ts";

const ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
const TEAMS_REL = "mattstack/teams";

export function coneFor(role: OrgRole, listedOn: string[]): string[] {
  if (isOrgAdmin(role)) return [...ORG_CLONE_FOLDERS];
  const owned = role.kind === "owner" ? role.teams : [];
  const teams = [...new Set([...listedOn, ...owned])].filter((t) => TEAM_NAME_RE.test(t)).sort();
  return [".claude-plugin", "mattstack/org", ...teams.map((t) => `${TEAMS_REL}/${t}`)];
}

/** The cone this Mac's role reaches, or null when the clone's own org store cannot be trusted to narrow it. */
function roleCone(p: Pick<Probes, "readFile" | "home">, dir: string, org: string): string[] | null {
  const username = readTeamLocal(p, org).forgeUsername ?? null;
  if (username === null) return null;
  const raw = p.readFile(join(dir, ORG_STORE_REL));
  if (raw === null) return null;
  const store = parseStoreTextStrict(ORG_STORE_REL, raw);
  const roles = store === null ? null : orgRolesOf(store);
  if (store === null || roles === null || isUnclaimed(roles)) return null;
  const role = roleOf(username, roles);
  if (role.kind === "unknown") return null;
  const entry = rosterFrom(store).find((e) => sameUser(e.username, username));
  const listedOn = Array.isArray(entry?.teams) ? entry.teams.filter((t): t is string => typeof t === "string") : [];
  return coneFor(role, listedOn);
}

/** Team folders with at least one file in the working tree; `S` marks the files a sparse checkout left out. */
async function checkedOutTeams(p: Pick<Probes, "exec">, dir: string): Promise<string[]> {
  const listed = await p.exec(["git", "ls-files", "-v", "--", TEAMS_REL], { cwd: dir, env: ENV });
  if (listed.code !== 0) throw new Error(withoutUrls(listed.stderr));
  const teams = new Set<string>();
  for (const line of listed.stdout.split("\n")) {
    const team = new RegExp(`^[^S] ${TEAMS_REL}/([^/]+)/`).exec(line)?.[1];
    if (team !== undefined) teams.add(team);
  }
  return [...teams].sort();
}

/** Whether the team folder holds an unsaved change, or a commit not on the remote branch; a remote ref git cannot find counts as unpushed. */
async function holdsChanges(p: Pick<Probes, "exec">, dir: string, team: string, branch: string | null): Promise<boolean> {
  const path = `${TEAMS_REL}/${team}`;
  const status = await p.exec(["git", "status", "--porcelain", "--", path], { cwd: dir, env: ENV });
  if (status.code !== 0 || status.stdout.trim() !== "") return true;
  if (branch === null) return true;
  const ahead = await p.exec(["git", "log", "--oneline", `refs/remotes/origin/${branch}..HEAD`, "--", path], { cwd: dir, env: ENV });
  return ahead.code !== 0 || ahead.stdout.trim() !== "";
}

/**
 * Narrows (or widens) the clone's sparse checkout to what this Mac's role
 * reaches. A team folder the new cone drops stays checked out while it holds
 * unsaved or unpushed work, and `kept` names those teams. An org store this
 * Mac cannot trust to narrow by gets the full cone.
 */
export async function applyRoleCone(p: Pick<Probes, "exec" | "readFile" | "home">, dir: string, org: string): Promise<{ applied: string[]; kept: string[] }> {
  const wanted = roleCone(p, dir, org) ?? [...ORG_CLONE_FOLDERS];
  const kept: string[] = [];
  if (!wanted.includes("mattstack")) {
    const branch = await checkedOutBranch(p, dir);
    for (const team of await checkedOutTeams(p, dir)) {
      if (wanted.includes(`${TEAMS_REL}/${team}`)) continue;
      if (await holdsChanges(p, dir, team, branch)) kept.push(team);
    }
  }
  const applied = [...wanted, ...kept.map((t) => `${TEAMS_REL}/${t}`)].sort();
  const set = await p.exec(["git", "sparse-checkout", "set", "--cone", ...applied], { cwd: dir, env: ENV });
  if (set.code !== 0) throw new Error(withoutUrls(set.stderr));
  return { applied, kept };
}

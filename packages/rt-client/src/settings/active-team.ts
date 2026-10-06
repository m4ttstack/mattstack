/**
 * Which team this Mac reads settings as. Everything here reads store files
 * directly and never calls getSetting: the resolver calls this to find the
 * team layer, so going through the resolver would recurse.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { parse, type ParseError } from "jsonc-parser";
import { readSection } from "./migrate.ts";
import { orgSettingsPath, teamPackDir, userSettingsPath } from "./paths.ts";
import { getDef } from "./registry-machinery.ts";
import { currentOrg, listTeamFolders, readStore, TEAM_NAME_RE, type StoreFile } from "./stores.ts";
import { readForgeUsername } from "./team-local-read.ts";

export interface RosterEntry {
  username: string;
  name?: string;
  agePublicKey?: string;
  teams?: string[];
  [key: string]: unknown;
}

export interface OrgRoles {
  admins: string[];
  teams: Record<string, { owners: string[] }>;
}

export type ActiveTeamReason = "no-org" | "chosen" | "first-team" | "no-team" | "setting-only" | "identity";

export interface ActiveTeam {
  org: string | null;
  team: string | null;
  reason: ActiveTeamReason;
  username: string | null;
  /** The team folders the roster lists this member on. */
  listedOn: string[];
}

/** Forge usernames are case-insensitive on GitHub and GitLab. */
export function sameUser(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function stored<T>(key: string, section: Record<string, unknown>): T | undefined {
  const def = getDef(key);
  if (!def) return undefined;
  const read = readSection(def, section, { layer: true });
  return read.present ? (read.value as T) : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

export function rosterFrom(orgStore: StoreFile): RosterEntry[] {
  const raw = stored<unknown>("mattstack.roster", orgStore.global);
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is RosterEntry => e !== null && typeof e === "object" && typeof (e as { username?: unknown }).username === "string");
}

export function rolesFrom(orgStore: StoreFile): OrgRoles {
  const raw = stored<{ admins?: unknown; teams?: unknown }>("mattstack.org", orgStore.global);
  const teams: OrgRoles["teams"] = {};
  if (raw?.teams !== null && typeof raw?.teams === "object" && !Array.isArray(raw.teams)) {
    for (const [name, value] of Object.entries(raw.teams as Record<string, { owners?: unknown } | null>)) {
      if (TEAM_NAME_RE.test(name)) teams[name] = { owners: strings(value?.owners) };
    }
  }
  return { admins: strings(raw?.admins), teams };
}

export function decideActiveTeam(input: {
  username: string | null;
  roster: RosterEntry[];
  setting: string | undefined;
  teamFolders: () => string[];
}): Pick<ActiveTeam, "team" | "reason" | "listedOn"> {
  const { username, roster, setting } = input;
  if (username === null) {
    if (setting !== undefined && TEAM_NAME_RE.test(setting) && input.teamFolders().includes(setting)) {
      return { team: setting, reason: "setting-only", listedOn: [] };
    }
    return { team: null, reason: "identity", listedOn: [] };
  }
  const entry = roster.find((e) => sameUser(e.username, username));
  // The roster is written by other people; a name that is not a plain folder name must never reach a path.
  const listedOn = [...new Set(strings(entry?.teams).filter((team) => TEAM_NAME_RE.test(team)))];
  if (listedOn.length === 0) return { team: null, reason: "no-team", listedOn };
  if (setting !== undefined && listedOn.includes(setting)) return { team: setting, reason: "chosen", listedOn };
  return { team: listedOn[0]!, reason: "first-team", listedOn };
}

export function activeTeamFrom(org: string, orgStore: StoreFile, userStore: StoreFile): ActiveTeam {
  const username = readForgeUsername(org);
  const setting = stored<unknown>("mattstack.activeTeam", userStore.global);
  const decision = decideActiveTeam({
    username,
    roster: rosterFrom(orgStore),
    setting: typeof setting === "string" ? setting : undefined,
    teamFolders: () => listTeamFolders(org),
  });
  return { org, username, ...decision };
}

export function activeTeam(): ActiveTeam {
  const org = currentOrg();
  if (org === null) return { org: null, team: null, reason: "no-org", username: null, listedOn: [] };
  return activeTeamFrom(org, readStore(orgSettingsPath(org)), readStore(userSettingsPath()));
}

export function readOrgRoster(org: string): RosterEntry[] {
  return rosterFrom(readStore(orgSettingsPath(org)));
}

export function readOrgRoles(org: string): OrgRoles {
  return rolesFrom(readStore(orgSettingsPath(org)));
}

/** The roster entries on the active team; everyone when this Mac has no active team. */
export function activeTeamRoster(): RosterEntry[] {
  const org = currentOrg();
  if (org === null) return [];
  const orgStore = readStore(orgSettingsPath(org));
  const { team } = activeTeamFrom(org, orgStore, readStore(userSettingsPath()));
  const roster = rosterFrom(orgStore);
  return team === null ? roster : roster.filter((e) => strings(e.teams).includes(team));
}

/** The active team's pack: the team's own name when its folder holds a pack that is not a base; else null. */
export function activeTeamPack(): string | null {
  const { org, team } = activeTeam();
  if (org === null || team === null) return null;
  try {
    const errors: ParseError[] = [];
    const fragment: unknown = parse(readFileSync(join(teamPackDir(org, team), "pack", "skills.jsonc"), "utf8"), errors, { allowTrailingComma: true });
    if (errors.length > 0 || fragment === null || typeof fragment !== "object" || Array.isArray(fragment)) return null;
    return (fragment as { base?: unknown }).base === true ? null : team;
  } catch {
    return null;
  }
}

/**
 * The full roster after an edit made in one view of it: the active team's
 * members, or everyone when `team` is null. The view changes only membership
 * (of `team`, or of the org when `team` is null) and the display `name`; every
 * other field comes from `full`, the store's current roster. `viewed` names
 * the members the view showed before the edit (default: `full`'s members of
 * the view), so an entry the view never showed is kept as it is.
 */
export function mergeTeamRoster(full: RosterEntry[], team: string | null, edited: RosterEntry[], viewed?: string[]): RosterEntry[] {
  const shown = viewed ?? full.filter((e) => team === null || strings(e.teams).includes(team)).map((e) => e.username);
  const wasShown = (username: string) => shown.some((v) => sameUser(v, username));
  const editOf = (username: string) => edited.find((e) => sameUser(e.username, username));
  const nameOf = (entry: RosterEntry) => (typeof entry.name === "string" && entry.name !== "" ? entry.name : undefined);
  const out: RosterEntry[] = [];
  for (const entry of full) {
    const edit = editOf(entry.username);
    const teams = strings(entry.teams);
    if (!edit) {
      if (!wasShown(entry.username)) out.push(entry);
      else if (team !== null) out.push(teams.includes(team) ? { ...entry, teams: teams.filter((t) => t !== team) } : entry);
      continue;
    }
    const next: RosterEntry = { ...entry };
    const name = nameOf(edit);
    if (name !== undefined) next.name = name;
    else if (wasShown(entry.username)) delete next.name;
    if (team !== null && !teams.includes(team)) next.teams = [...teams, team];
    out.push(next);
  }
  for (const added of edited) {
    if (full.some((entry) => sameUser(entry.username, added.username))) continue;
    const name = nameOf(added);
    out.push({ username: added.username, ...(name !== undefined ? { name } : {}), ...(team !== null ? { teams: [team] } : {}) });
  }
  return out;
}

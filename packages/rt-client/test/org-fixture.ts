import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { orgMarkerPath, orgSettingsPath, teamLocalPath, teamSettingsPath } from "../src/settings/paths.ts";

function writeJson(file: string, value: unknown): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return file;
}

/** The store a test seeds to put a value in the layer every member shares. HOME is read at call time. */
export function sharedStorePath(org: string): string {
  return orgSettingsPath(org);
}

export function writeSharedStore(org: string, value: unknown): string {
  return writeJson(sharedStorePath(org), value);
}

export interface SeedOrg {
  org?: string;
  settings?: Record<string, unknown>;
  teams?: Record<string, Record<string, unknown>>;
  /** Stored as this Mac's forge username for the org. */
  username?: string;
  roster?: { username: string; teams?: string[]; [key: string]: unknown }[];
  roles?: { admins: string[]; teams: Record<string, { owners: string[] }> };
}

/** Writes an org clone's marker, org store and team stores under the current HOME. Not a git repo. */
export function seedOrg(opts: SeedOrg = {}): { org: string; orgStore: string; teamStores: Record<string, string> } {
  const org = opts.org ?? "acme";
  writeJson(orgMarkerPath(org), { role: "org", org });
  const settings: Record<string, unknown> = { ...(opts.settings ?? {}) };
  if (opts.roster) settings["mattstack.roster"] = opts.roster;
  if (opts.roles) settings["mattstack.org"] = opts.roles;
  const orgStore = writeJson(orgSettingsPath(org), settings);
  const teamStores: Record<string, string> = {};
  for (const [team, value] of Object.entries(opts.teams ?? {})) teamStores[team] = writeJson(teamSettingsPath(org, team), value);
  if (opts.username !== undefined) writeJson(teamLocalPath(org), { forgeUsername: opts.username });
  return { org, orgStore, teamStores };
}

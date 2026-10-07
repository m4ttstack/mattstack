/**
 * Reading the four settings store files (RT-47).
 *
 * `readStore` is the shared "raw JSONC → {global, repos}" step every store
 * (user/org/team/machine) goes through before the resolver layers them by scope.
 * It uses jsonc-parser (`parse`) rather than lib/jsonc.ts's stripJsonc: this
 * is the one place in rt that also needs to WRITE these files back with
 * comments/formatting intact (via jsonc-parser's `modify`/`applyEdits`, added
 * alongside `setSetting` in resolve.ts), and both directions should go
 * through the same library. stripJsonc keeps its existing callers.
 *
 * A store file is honest-degrade, not throw-on-read: absent, empty, or
 * malformed all resolve to an empty store rather than crashing a caller that
 * just wants "whatever settings exist" (teammates run version-skewed
 * binaries; a store file with content this rt can't parse must not brick
 * every settings read).
 */

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "fs";
import { parse, type ParseError } from "jsonc-parser";
import { join } from "path";
import { orgSettingsPath, orgsDir, teamFoldersDir, teamSettingsPath } from "./paths.ts";

export interface StoreFile {
  /** Top-level keys other than "repos" — the global scope for this store. */
  global: Record<string, unknown>;
  /** The "repos" object, keyed by repo identity. Empty if absent. */
  repos: Record<string, Record<string, unknown>>;
  /** The path this store was read from (echoed back for provenance). */
  file: string;
  /** False only when the file does not exist at all. */
  exists: boolean;
}

const EMPTY_STORE = (file: string, exists: boolean): StoreFile => ({
  global: {},
  repos: {},
  file,
  exists,
});

/**
 * Reads and parses one settings store file. Never throws:
 *  - missing file → `{ exists: false }`, empty maps.
 *  - present but malformed (parse errors, or a root that isn't a JSON
 *    object) → `{ exists: true }`, empty maps, one console.warn.
 *  - present and well-formed → `{ exists: true }`, split into
 *    `global`/`repos`.
 */
export function readStore(file: string): StoreFile {
  if (!existsSync(file)) return EMPTY_STORE(file, false);

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    console.warn(`rt: failed to read settings store ${file}, ignoring: ${(err as Error).message}`);
    return EMPTY_STORE(file, true);
  }

  return parseStoreText(file, raw);
}

/** `readStore`'s parse step, for a caller that already holds the file's text. Never throws. */
export function parseStoreText(file: string, raw: string): StoreFile {
  if (raw.trim() === "") return EMPTY_STORE(file, true);

  const errors: ParseError[] = [];
  const root = parse(raw, errors, { allowTrailingComma: true });

  if (errors.length > 0 || root === undefined || typeof root !== "object" || Array.isArray(root)) {
    console.warn(`rt: malformed settings store ${file}, ignoring (treating as empty)`);
    return EMPTY_STORE(file, true);
  }

  const { repos, ...global } = root as Record<string, unknown>;
  const reposIsValid = repos !== undefined && typeof repos === "object" && repos !== null && !Array.isArray(repos);

  if (repos !== undefined && !reposIsValid) {
    console.warn(`rt: malformed "repos" section in settings store ${file}, ignoring repo sections (global keys still apply)`);
  }

  const reposValid = reposIsValid ? (repos as Record<string, Record<string, unknown>>) : {};

  return { global, repos: reposValid, file, exists: true };
}

export const TEAM_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Org clones on this Mac: folders under orgsDir() that hold
 * mattstack/org/settings.org.jsonc. A folder without that file (a clone
 * mid-setup, or an unrelated directory) is not an org as far as the resolver
 * is concerned.
 *
 * Honest-degrade like readStore, and for a sharper reason: this scan is on the
 * path of EVERY settings resolution, so one bad directory entry must never
 * brick `rt settings` or any reader behind it. A clone that was symlinked in
 * and later moved leaves a dangling symlink here, and the follow-the-link stat
 * that keeps symlinked clones working throws ENOENT on exactly that, so the
 * scan is guarded twice: around the readdir (an unreadable teams dir means no
 * orgs), and around EACH entry (a dangling link, an EACCES, or a stat that
 * loses a race with a concurrent move skips that entry and leaves the healthy
 * clones intact).
 */
export function listOrgs(): string[] {
  const dir = orgsDir();
  if (!existsSync(dir)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`rt: failed to list orgs in ${dir}, treating as none: ${(err as Error).message}`);
    return [];
  }
  const orgs: string[] = [];
  for (const entry of entries) {
    try {
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(join(dir, entry.name)).isDirectory());
      if (isDir && existsSync(orgSettingsPath(entry.name))) orgs.push(entry.name);
    } catch (err) {
      console.warn(`rt: skipping unreadable entry ${join(dir, entry.name)}: ${(err as Error).message}`);
    }
  }
  return orgs;
}

/** One org per Mac; with several clones the first by name is the one read. */
export function currentOrg(): string | null {
  return [...listOrgs()].sort()[0] ?? null;
}

export function listTeamFolders(org: string): string[] {
  try {
    return readdirSync(teamFoldersDir(org), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && TEAM_NAME_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The org store and every team folder's store that exists, for the one org on this Mac. */
export function sharedStoreFiles(): string[] {
  const org = currentOrg();
  if (org === null) return [];
  const teamFiles = listTeamFolders(org).map((team) => teamSettingsPath(org, team));
  return [orgSettingsPath(org), ...teamFiles.filter((file) => existsSync(file))];
}

/**
 * Where rendered husk-pack trees live and how a reader picks one. Kept apart
 * from render-cache.ts, which loads the compile, so the resolver and run
 * provenance can read the cache without it.
 */
import { join, normalize } from "node:path";
import { stripJsonc } from "../jsonc.ts";
import { compareVersions, ENGINE_PACK_REF, findInstalledPluginDir, findPluginVersionDirs } from "./installed-plugins.ts";

export type RenderStamp = { rtBuild: string; mattstack: string; inputHash: string };

export const STAMP_FILE = "render.json";

/** Siblings a render in flight writes and then renames away. */
export const IN_FLIGHT_RE = /\.(tmp|old)-/;

type TreeFs = { exists(p: string): boolean; readDir(p: string): string[] };

/** Where every member's rendered trees live: `~/.mattstack/rt/rendered`. */
export function renderRoot(home: string): string {
  return join(home, ".mattstack", "rt", "rendered");
}

export function treeDir(root: string, org: string, plugin: string, packVersion: string, mattstack: string): string {
  return join(root, org, plugin, packVersion, mattstack);
}

export function parseStamp(text: string | null): RenderStamp | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return null;
    const { rtBuild, mattstack, inputHash } = raw;
    return typeof rtBuild === "string" && typeof mattstack === "string" && typeof inputHash === "string" ? { rtBuild, mattstack, inputHash } : null;
  } catch {
    return null;
  }
}

/** A pack opts into husks with `"husks": true` in its own `pack/skills.jsonc`. */
export function isHuskPack(readFile: (p: string) => string | null, packDir: string): boolean {
  const text = readFile(join(packDir, "pack", "skills.jsonc"));
  if (text === null) return false;
  try {
    return (JSON.parse(stripJsonc(text)) as { husks?: unknown } | null)?.husks === true;
  } catch {
    return false;
  }
}

type RegistryFs = TreeFs & { readFile(p: string): string | null };

/**
 * The installed husk a rendered unit stands in for: `<copy>/<unitPath>` when
 * it is there, else any husk of the unit's name, since a door's husk sits in
 * `skills/` while the render serves its id from the base unit.
 */
export function installedHuskIn(fs: TreeFs, copy: string, unitPath: string): string | null {
  const leaf = unitPath.slice(unitPath.lastIndexOf("/") + 1);
  const attachments = join(copy, "attachments");
  const candidates = [join(copy, unitPath), join(copy, "skills", leaf), join(attachments, leaf), ...fs.readDir(attachments).map((group) => join(attachments, group, leaf))];
  return candidates.find((c) => fs.exists(c)) ?? null;
}

/**
 * For a folder inside a render tree (`<root>/<org>/<plugin>/<version>/<mattstack>/<unit>`),
 * the installed husk of that unit at that pack version; null outside the
 * render root, or without exactly one installed copy.
 */
export function installedHuskForTreeDir(fs: TreeFs, home: string, dir: string): string | null {
  const root = renderRoot(home);
  const text = normalize(dir);
  if (!text.startsWith(`${root}/`)) return null;
  const [, plugin, version, , ...unit] = text.slice(root.length + 1).split("/");
  if (!plugin || !version || unit.length === 0) return null;
  const copies = findPluginVersionDirs(fs, home, plugin, version);
  return copies.length === 1 ? installedHuskIn(fs, copies[0]!, unit.join("/")) : null;
}

/**
 * True when any org clone on this Mac carries a team pack that opts into
 * husks, read from files alone, so the daemon asks before it loads the
 * compile. Layouts 3 to 5 keep a team's pack at `mattstack/teams/<team>/plugin`.
 */
export function anyHuskPack(fs: RegistryFs, home: string): boolean {
  const orgs = join(home, ".mattstack", "orgs");
  return fs.readDir(orgs).some((org) => {
    const teams = join(orgs, org, "mattstack", "teams");
    return fs.readDir(teams).some((team) => isHuskPack(fs.readFile, join(teams, team, "plugin")));
  });
}

function manifestVersion(fs: RegistryFs, dir: string): string | null {
  try {
    const version = (JSON.parse(fs.readFile(join(dir, ".claude-plugin", "plugin.json")) ?? "null") as { version?: unknown } | null)?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * The mattstack plugin Claude Code loads, from its install registry
 * (`installed_plugins.json`), the user install first: renders, the resolver
 * and run provenance all name the installed mattstack through this, so they
 * agree on which tree is current. Without a registry entry, the newest
 * version folder in the plugin cache.
 */
export function activeMattstack(fs: RegistryFs, home: string): { dir: string; version: string } | null {
  try {
    const parsed = JSON.parse(fs.readFile(join(home, ".claude", "plugins", "installed_plugins.json")) ?? "null") as { plugins?: Record<string, unknown> } | null;
    const raw = parsed?.plugins?.[ENGINE_PACK_REF];
    const entries = (Array.isArray(raw) ? raw : []).filter((e): e is { installPath: string; scope?: unknown } => typeof e?.installPath === "string" && fs.exists(e.installPath));
    const entry = entries.find((e) => e.scope === "user") ?? entries[0];
    if (entry) {
      const version = manifestVersion(fs, entry.installPath);
      if (version !== null) return { dir: entry.installPath, version };
    }
  } catch {
    // an unreadable registry falls back to the cache folders
  }
  const dir = findInstalledPluginDir(fs, home, ENGINE_PACK_REF);
  if (dir === null) return null;
  return { dir, version: manifestVersion(fs, dir) ?? dir.slice(dir.lastIndexOf("/") + 1) };
}

/**
 * The rendered tree a reader uses for one installed pack version: the
 * installed mattstack's tree when there is one, else the newest. Only a
 * folder holding its stamp counts.
 */
export function pickRenderTree(fs: TreeFs, root: string, plugin: string, packVersion: string, mattstack: string | null): string | null {
  for (const org of fs.readDir(root).sort()) {
    const versionDir = join(root, org, plugin, packVersion);
    const trees = fs.readDir(versionDir).filter((name) => !IN_FLIGHT_RE.test(name) && fs.exists(join(versionDir, name, STAMP_FILE)));
    if (trees.length === 0) continue;
    const chosen = mattstack !== null && trees.includes(mattstack) ? mattstack : trees.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
    return join(versionDir, chosen);
  }
  return null;
}

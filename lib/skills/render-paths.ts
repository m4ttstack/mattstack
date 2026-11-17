/**
 * Where rendered husk-pack trees live and how a reader picks one. Kept apart
 * from render-cache.ts, which loads the compile, so the resolver and run
 * provenance can read the cache without it.
 */
import { join } from "node:path";
import { stripJsonc } from "../jsonc.ts";
import { compareVersions, ENGINE_PACK_REF, findInstalledPluginDir } from "./installed-plugins.ts";

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

/** The mattstack version installed in the plugin cache, or null without one. */
export function installedMattstack(fs: TreeFs, home: string): string | null {
  const dir = findInstalledPluginDir(fs, home, ENGINE_PACK_REF);
  return dir === null ? null : dir.slice(dir.lastIndexOf("/") + 1);
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

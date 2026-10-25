import { existsSync, lstatSync, readdirSync, readFileSync } from "fs";
import { UserActionableError } from "../errors.ts";
import { findPluginVersionDirs, type PluginFs } from "./installed-plugins.ts";
import { ID_RE, spellFrom, type PointerMap, type Target } from "./pointers.ts";
import { MAP_FILE } from "./unit-maps.ts";

export type ResolveFs = PluginFs & { readFile(p: string): string | null; isSymlink(p: string): boolean };
export type ResolveDeps = { fs: ResolveFs; home: string };
export type ResolveResult = { id: string; folder: string; covers: string[]; keys: Record<string, string> };

export const realResolveFs: ResolveFs = {
  exists: existsSync,
  readDir(p) {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
  readFile(p) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  isSymlink(p) {
    try {
      return lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  },
};

const PLUGIN_ID_RE = /^([^@]+)@([^:]+):(.+)$/;
const SKILLS_PREFIX = "skills:";

function refuse(code: string, message: string, why?: string, next?: string): UserActionableError {
  return new UserActionableError(code, message, {}, { ...(why ? { why } : {}), ...(next ? { next } : {}) });
}

function readMap(fs: ResolveFs, folder: string): PointerMap | null {
  const text = fs.readFile(`${folder}/${MAP_FILE}`);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<PointerMap> | null;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.dir !== "string" || !Array.isArray(parsed.covers) || !parsed.keys || typeof parsed.keys !== "object") return null;
    return { id: parsed.id, dir: parsed.dir, covers: parsed.covers, keys: parsed.keys };
  } catch {
    return null;
  }
}

function skillLink(home: string, name: string): string {
  return `${home}/.claude/skills/${name}`;
}

function assertLive(fs: ResolveFs, link: string): void {
  if (fs.isSymlink(link) && !fs.exists(link)) {
    throw refuse("skills-resolve-dead-link", `The skill link ${link} points at a folder that is gone.`, "Its target was moved or deleted.", "rt skills link");
  }
}

function noMap(id: string, folder: string, next: string): UserActionableError {
  return refuse("skills-resolve-no-map", `${id} has no readable pointer map.`, `${folder}/${MAP_FILE} is missing or damaged.`, next);
}

function pluginUnit(id: string, plugin: string, version: string, unit: string, deps: ResolveDeps): { folder: string; map: PointerMap } {
  const { fs, home } = deps;
  const roots = findPluginVersionDirs(fs, home, plugin, version);
  if (roots.length === 0) {
    const cache = `${home}/.claude/plugins/cache`;
    const found = [...new Set(fs.readDir(cache).filter((m) => !m.startsWith("temp_git_")).flatMap((m) => fs.readDir(`${cache}/${m}/${plugin}`)))].sort();
    const why = found.length > 0 ? `The installed versions are ${found.join(", ")}.` : `No version of ${plugin} is installed.`;
    throw refuse("skills-resolve-not-installed", `${plugin} ${version} is not installed, so ${id} cannot resolve.`, why, "/reload-plugins");
  }
  if (roots.length > 1) {
    throw refuse("skills-resolve-many-marketplaces", `${plugin} ${version} is installed from more than one marketplace.`, `Copies: ${roots.join(", ")}.`);
  }
  const root = roots[0]!;
  const candidates = [`${root}/skills/${unit}`, `${root}/attachments/${unit}`, ...fs.readDir(`${root}/attachments`).map((group) => `${root}/attachments/${group}/${unit}`)];
  const present = candidates.filter((c) => fs.exists(c));
  const matched = present.flatMap((c) => {
    const map = readMap(fs, c);
    return map && map.id === id ? [{ folder: c, map }] : [];
  });
  if (matched.length > 1) {
    throw refuse("skills-resolve-many-units", `More than one folder in ${plugin} ${version} claims ${id}.`, `Folders: ${matched.map((m) => m.folder).join(", ")}.`);
  }
  if (matched.length === 0) {
    if (present.length > 0) throw noMap(id, present[0]!, "rt skills sync");
    throw refuse("skills-resolve-no-unit", `${plugin} ${version} has no unit named ${unit}.`, `Nothing under ${root} carries ${id}.`);
  }
  const { map } = matched[0]!;
  return { folder: `${root}/${map.dir}`, map };
}

function skillsUnit(id: string, name: string, deps: ResolveDeps): { folder: string; map: PointerMap } {
  const folder = skillLink(deps.home, name);
  assertLive(deps.fs, folder);
  if (!deps.fs.exists(folder)) throw refuse("skills-resolve-no-skill", `No skill named ${name} is installed.`, `${folder} does not exist.`, "rt skills link");
  const map = readMap(deps.fs, folder);
  if (!map || map.id !== id) throw noMap(id, folder, "rt skills link");
  return { folder, map };
}

function targetPath(folder: string, dir: string, target: Target, deps: ResolveDeps): string {
  if (typeof target === "string") return `${folder}/${spellFrom(dir, target)}`;
  const link = skillLink(deps.home, target.skill);
  assertLive(deps.fs, link);
  return `${link}/${target.path}`;
}

/** Paths are joined as text: a `../` stays as written, and a skill link is never followed to its target. */
export function resolvePointers(id: string, deps: ResolveDeps): ResolveResult {
  if (!ID_RE.test(id)) {
    throw refuse("skills-resolve-bad-id", `${JSON.stringify(id)} is not a skill id.`, "A skill id is <plugin>@<version>:<unit> or skills:<name>.");
  }
  let unit: { folder: string; map: PointerMap };
  if (id.startsWith(SKILLS_PREFIX)) {
    unit = skillsUnit(id, id.slice(SKILLS_PREFIX.length), deps);
  } else {
    const [, plugin, version, leaf] = PLUGIN_ID_RE.exec(id)!;
    unit = pluginUnit(id, plugin!, version!, leaf!, deps);
  }
  const { folder, map } = unit;
  const fix = id.startsWith(SKILLS_PREFIX) ? "rt skills link" : "rt skills sync";
  const keys: Record<string, string> = {};
  for (const [key, target] of Object.entries(map.keys)) {
    const path = targetPath(folder, map.dir, target, deps);
    if (!deps.fs.exists(path)) {
      throw refuse("skills-resolve-missing-file", `The file behind @${key} is missing.`, `${path} does not exist in this copy of ${id}.`, fix);
    }
    keys[key] = path;
  }
  return { id, folder, covers: map.covers, keys };
}

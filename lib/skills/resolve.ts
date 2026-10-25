import { existsSync, lstatSync, readdirSync, readFileSync } from "fs";
import { posix } from "path";
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
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9:-]*$/;
const RELINK = "rt setup update";
const RELINK_WHY = "The link may point at an older copy of the skill; relinking points it at the copy installed now.";

function refuse(code: string, message: string, why?: string, next?: string): UserActionableError {
  return new UserActionableError(code, message, {}, { ...(why ? { why } : {}), ...(next ? { next } : {}) });
}

function ownerWhy(plugin: string): string {
  return `If ${plugin} is a team pack whose own build is out of date, its owner recompiles it with rt skills sync --pack ${plugin}.`;
}

type MapRead = { map: PointerMap } | { fault: string };

function readMap(fs: ResolveFs, folder: string): MapRead {
  const text = fs.readFile(`${folder}/${MAP_FILE}`);
  if (text === null) return { fault: `${folder} has no ${MAP_FILE}.` };
  try {
    const parsed = JSON.parse(text) as Partial<PointerMap> | null;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.dir !== "string" || !Array.isArray(parsed.covers) || !parsed.keys || typeof parsed.keys !== "object") {
      return { fault: `${folder}/${MAP_FILE} is damaged.` };
    }
    return { map: { id: parsed.id, dir: parsed.dir, covers: parsed.covers, keys: parsed.keys } };
  } catch {
    return { fault: `${folder}/${MAP_FILE} is damaged.` };
  }
}

function skillLink(home: string, name: string): string {
  return `${home}/.claude/skills/${name}`;
}

/**
 * Text containment. The OS applies a `..` after following a link, so a bound
 * that is a skill link has to hold every path that passes it: none may climb
 * back out through the link.
 */
function within(bound: string, path: string): boolean {
  return posix.normalize(path).startsWith(`${posix.normalize(bound)}/`);
}

function outside(id: string, where: string, path: string, fix: string): UserActionableError {
  return refuse("skills-resolve-outside", `The pointer map for ${id} points outside its own files at ${where}.`, `${path} is not inside this copy, so it is never read.`, fix);
}

function assertLive(fs: ResolveFs, link: string): void {
  if (fs.isSymlink(link) && !fs.exists(link)) {
    throw refuse("skills-resolve-dead-link", `The skill link ${link} points at a folder that is gone.`, "Its target was moved or deleted.", RELINK);
  }
}

/** `why` is the sentence every refusal about this copy's own files ends with. */
type Unit = { folder: string; map: PointerMap; bound: string; fix: string; why: string };

function marketplaceOf(versionDir: string): string {
  return posix.basename(posix.dirname(posix.dirname(versionDir)));
}

function pluginUnit(id: string, plugin: string, version: string, unit: string, deps: ResolveDeps): Unit {
  const { fs, home } = deps;
  const roots = findPluginVersionDirs(fs, home, plugin, version);
  if (roots.length === 0) {
    const cache = `${home}/.claude/plugins/cache`;
    const found = [...new Set(fs.readDir(cache).filter((m) => !m.startsWith("temp_git_")).flatMap((m) => fs.readDir(`${cache}/${m}/${plugin}`)))].sort();
    // An installed copy stamped with an older id is a stale build, which a reload cannot fix.
    const why = found.length > 0 ? `The installed versions are ${found.join(", ")}. ${ownerWhy(plugin)}` : `No version of ${plugin} is installed.`;
    throw refuse("skills-resolve-not-installed", `${plugin} ${version} is not installed, so ${id} cannot resolve.`, why, "/reload-plugins");
  }
  if (roots.length > 1) {
    const uninstalls = roots.map((r) => `claude plugin uninstall ${plugin}@${marketplaceOf(r)}`).join("; ");
    throw refuse(
      "skills-resolve-many-marketplaces",
      `${plugin} ${version} is installed from more than one marketplace.`,
      `Copies: ${roots.join(", ")}. Keep one and uninstall each of the others with its command: ${uninstalls}.`,
      "claude plugin list",
    );
  }
  const root = roots[0]!;
  const fix = `claude plugin update ${plugin}@${marketplaceOf(root)}`;
  const owner = ownerWhy(plugin);
  const candidates = [`${root}/skills/${unit}`, `${root}/attachments/${unit}`, ...fs.readDir(`${root}/attachments`).map((group) => `${root}/attachments/${group}/${unit}`)];
  const reads = candidates.filter((c) => fs.exists(c)).map((folder) => ({ folder, read: readMap(fs, folder) }));
  const matched = reads.flatMap(({ folder, read }) => ("map" in read && read.map.id === id ? [{ folder, map: read.map }] : []));
  if (matched.length > 1) {
    throw refuse("skills-resolve-many-units", `More than one folder in ${plugin} ${version} claims ${id}.`, `Folders: ${matched.map((m) => m.folder).join(", ")}. ${owner}`, fix);
  }
  if (matched.length === 0) {
    if (reads.length > 0) {
      const { folder, read } = reads[0]!;
      const found = "map" in read ? `The map in ${folder} is for ${read.map.id}.` : read.fault;
      throw refuse("skills-resolve-no-map", `${id} has no pointer map in this copy.`, `${found} ${owner}`, fix);
    }
    throw refuse("skills-resolve-no-unit", `${plugin} ${version} has no unit named ${unit}.`, `Nothing under ${root} carries ${id}. ${owner}`, fix);
  }
  const { folder, map } = matched[0]!;
  const sitsIn = folder.slice(root.length + 1);
  if (map.dir !== sitsIn) {
    throw refuse("skills-resolve-damaged-map", `The pointer map in ${folder} is damaged.`, `It names its folder as ${map.dir}, but it sits in ${sitsIn}. ${owner}`, fix);
  }
  return { folder, map, bound: root, fix, why: owner };
}

function skillsUnit(id: string, name: string, deps: ResolveDeps): Unit {
  const folder = skillLink(deps.home, name);
  assertLive(deps.fs, folder);
  if (!deps.fs.exists(folder)) throw refuse("skills-resolve-no-skill", `No skill named ${name} is installed.`, `${folder} does not exist.`, RELINK);
  const read = readMap(deps.fs, folder);
  if (!("map" in read)) throw refuse("skills-resolve-no-map", `${id} has no pointer map in this copy.`, `${read.fault} ${RELINK_WHY}`, RELINK);
  if (read.map.id !== id) throw refuse("skills-resolve-no-map", `${id} has no pointer map in this copy.`, `The map in ${folder} is for ${read.map.id}. ${RELINK_WHY}`, RELINK);
  return { folder, map: read.map, bound: folder, fix: RELINK, why: RELINK_WHY };
}

function targetPath(id: string, key: string, unit: Unit, target: Target, deps: ResolveDeps): string {
  if (typeof target === "string") {
    const path = `${unit.folder}/${spellFrom(unit.map.dir, target)}`;
    if (!within(unit.bound, path)) throw outside(id, `@${key}`, path, unit.fix);
    return path;
  }
  const link = skillLink(deps.home, target.skill);
  const path = `${link}/${target.path}`;
  if (!SKILL_NAME_RE.test(target.skill) || !within(link, path)) throw outside(id, `@${key}`, path, unit.fix);
  assertLive(deps.fs, link);
  return path;
}

/** Paths are joined as text: a `../` stays as written, and a skill link is never followed to its target. */
export function resolvePointers(id: string, deps: ResolveDeps): ResolveResult {
  if (!ID_RE.test(id)) {
    throw refuse("skills-resolve-bad-id", `${JSON.stringify(id)} is not a skill id.`, "A skill id is <plugin>@<version>:<unit> or skills:<name>.");
  }
  let unit: Unit;
  if (id.startsWith(SKILLS_PREFIX)) {
    unit = skillsUnit(id, id.slice(SKILLS_PREFIX.length), deps);
  } else {
    const [, plugin, version, leaf] = PLUGIN_ID_RE.exec(id)!;
    unit = pluginUnit(id, plugin!, version!, leaf!, deps);
  }
  const keys: Record<string, string> = {};
  for (const [key, target] of Object.entries(unit.map.keys)) keys[key] = targetPath(id, key, unit, target, deps);
  for (const [key, path] of Object.entries(keys)) {
    if (!deps.fs.exists(path)) {
      throw refuse("skills-resolve-missing-file", `The file behind @${key} is missing.`, `${path} does not exist in this copy of ${id}. ${unit.why}`, unit.fix);
    }
  }
  return { id, folder: unit.folder, covers: unit.map.covers, keys };
}

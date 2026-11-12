import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "fs";
import { posix } from "path";
import { UserActionableError } from "../errors.ts";
import { compareVersions, findPluginVersionDirs, type PluginFs } from "./installed-plugins.ts";
import { ID_RE, spellFrom, type PointerMap, type Target } from "./pointers.ts";
import { isIdSafeVersion, MAP_FILE } from "./unit-maps.ts";

/** `realPath` is null for a path that does not exist. */
export type ResolveFs = PluginFs & { readFile(p: string): string | null; isSymlink(p: string): boolean; realPath(p: string): string | null };
export type ResolveDeps = { fs: ResolveFs; home: string };
export type ResolveResult = { id: string; folder: string; covers: string[]; keys: Record<string, string>; pinned: boolean; warning?: string };

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
  realPath(p) {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  },
};

const PLUGIN_ID_RE = /^([^@:]+)(?:@([^:]+))?:(.+)$/;
const SKILLS_PREFIX = "skills:";
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9:-]*$/;
const RELINK = "rt setup update";
const UNPINNED_WARNING = "No skill folder was passed, so this run is not pinned to the version it loaded.";
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

function pluginCache(home: string): string {
  return `${home}/.claude/plugins/cache`;
}

/** True for a `dir` written as inside the plugin cache whose `..` takes it out. */
export function dirClimbsOutOfCache(dir: string, home: string): boolean {
  const cache = pluginCache(home);
  return posix.isAbsolute(dir) && dir.startsWith(`${cache}/`) && !within(cache, posix.normalize(dir));
}

/**
 * The version folder `dir` sits in, read from `<cache>/<market>/<plugin>/<version>/`.
 * A path is only looked up on disk once its text sits inside the cache, so
 * nothing outside it is touched.
 */
function versionOfDir(id: string, plugin: string, dir: string, deps: ResolveDeps): string | null {
  if (!posix.isAbsolute(dir)) return null;
  const cache = pluginCache(deps.home);
  const text = posix.normalize(dir);
  if (!within(cache, text)) return null;
  // The written path, not its normalized text: the OS follows a link before the `..` after it.
  const real = deps.fs.realPath(dir);
  const [base, path] = real === null ? [cache, text] : [deps.fs.realPath(cache) ?? cache, real];
  if (!within(base, path)) return null;
  const [, named, version] = path.slice(base.length + 1).split("/");
  if (!named || !version) return null;
  if (named !== plugin) {
    throw refuse("skills-resolve-wrong-folder", `The skill folder passed for ${id} belongs to ${named}, not ${plugin}.`, `${dir} is in ${named}'s plugin folder.`);
  }
  return version;
}

function manyMarketplaces(plugin: string, what: string, copies: { dir: string; market: string }[]): UserActionableError {
  const uninstalls = copies.map((c) => `claude plugin uninstall ${plugin}@${c.market}`).join("; ");
  return refuse(
    "skills-resolve-many-marketplaces",
    `${what} is installed from more than one marketplace.`,
    `Copies: ${copies.map((c) => c.dir).join(", ")}. Keep one and uninstall each of the others with its command: ${uninstalls}.`,
    "claude plugin list",
  );
}

function highestInstalled(id: string, plugin: string, deps: ResolveDeps): string {
  const cache = pluginCache(deps.home);
  const held = deps.fs
    .readDir(cache)
    .filter((m) => !m.startsWith("temp_git_"))
    .map((market) => ({ market, dir: `${cache}/${market}/${plugin}`, versions: deps.fs.readDir(`${cache}/${market}/${plugin}`).filter(isIdSafeVersion) }))
    .filter((h) => h.versions.length > 0);
  if (held.length === 0) throw refuse("skills-resolve-not-installed", `${plugin} is not installed, so ${id} cannot resolve.`, `No version of ${plugin} is installed.`, "/reload-plugins");
  if (held.length > 1) throw manyMarketplaces(plugin, plugin, held);
  return held[0]!.versions.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

function pluginUnit(id: string, plugin: string, version: string, unit: string, deps: ResolveDeps): Unit {
  const { fs, home } = deps;
  const roots = findPluginVersionDirs(fs, home, plugin, version);
  if (roots.length === 0) {
    const cache = pluginCache(home);
    const found = [...new Set(fs.readDir(cache).filter((m) => !m.startsWith("temp_git_")).flatMap((m) => fs.readDir(`${cache}/${m}/${plugin}`)))].sort();
    // An installed copy stamped with an older id is a stale build, which a reload cannot fix.
    const why = found.length > 0 ? `The installed versions are ${found.join(", ")}. ${ownerWhy(plugin)}` : `No version of ${plugin} is installed.`;
    throw refuse("skills-resolve-not-installed", `${plugin} ${version} is not installed, so ${id} cannot resolve.`, why, "/reload-plugins");
  }
  if (roots.length > 1) throw manyMarketplaces(plugin, `${plugin} ${version}`, roots.map((dir) => ({ dir, market: marketplaceOf(dir) })));
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
      // A group folder can share the unit's name and carry no map, so a map that parsed says more.
      const { folder, read } = reads.find(({ read }) => "map" in read) ?? reads[0]!;
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

/**
 * Paths are joined as text: a `../` stays as written, and a skill link is
 * never followed to its target. A `<plugin>:<unit>` id takes its version from
 * the plugin version folder `dir` sits in, so a run keeps reading the version
 * it loaded after a newer one installs.
 */
export function resolvePointers(id: string, deps: ResolveDeps, dir?: string): ResolveResult {
  if (!ID_RE.test(id)) {
    throw refuse("skills-resolve-bad-id", `${JSON.stringify(id)} is not a skill id.`, "A skill id is <plugin>:<unit>, <plugin>@<version>:<unit> or skills:<name>.");
  }
  let unit: Unit;
  let pinned = true;
  if (id.startsWith(SKILLS_PREFIX)) {
    unit = skillsUnit(id, id.slice(SKILLS_PREFIX.length), deps);
  } else {
    const [, plugin, stamped, leaf] = PLUGIN_ID_RE.exec(id)!;
    let version = stamped ?? (dir === undefined ? null : versionOfDir(id, plugin!, dir, deps));
    if (version === null) {
      pinned = false;
      version = highestInstalled(id, plugin!, deps);
    }
    unit = pluginUnit(id, plugin!, version, leaf!, deps);
  }
  const keys: Record<string, string> = {};
  for (const [key, target] of Object.entries(unit.map.keys)) keys[key] = targetPath(id, key, unit, target, deps);
  for (const [key, path] of Object.entries(keys)) {
    if (!deps.fs.exists(path)) {
      throw refuse("skills-resolve-missing-file", `The file behind @${key} is missing.`, `${path} does not exist in this copy of ${id}. ${unit.why}`, unit.fix);
    }
  }
  return { id, folder: unit.folder, covers: unit.map.covers, keys, pinned, ...(pinned ? {} : { warning: UNPINNED_WARNING }) };
}

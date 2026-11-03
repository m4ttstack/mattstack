import { chmodSync, existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, sep } from "path";
import { compareVersions } from "./installed-plugins.ts";
import { addDisableModelInvocation, PERSONAL_MARK, disableModelInvocationKey, removeDisableModelInvocation } from "./disable-model-invocation-line.ts";
import { registeredSkillRoots } from "./skill-roots.ts";
import { stripFrontmatter } from "./sources.ts";
import { getSetting } from "../settings/resolve.ts";

/** HOME as the process sees it now: bun freezes os.homedir() at startup, so a changed HOME would otherwise be missed. */
export function disableModelInvocationHome(): string {
  return process.env.HOME ?? homedir();
}

export const DISABLE_MODEL_INVOCATION_SETTING = "rt.skills.disableModelInvocation";

// Skills other skills invoke by name stay invocable: Claude Code blocks the Skill tool on a disabled one, so those handoffs would fail.
const NEVER_DISABLED = [
  { plugin: "mattstack", name: "model-tiering" },
  { plugin: "mattstack", name: "writing-style-conversational" },
];

export function neverDisabled(plugin: string, name: string): boolean {
  return NEVER_DISABLED.some((s) => s.plugin === plugin && s.name === name);
}

/** A fill a compiled verb invokes by name; frontmatter that does not parse provides nothing. */
export function providesContract(skillMd: string): boolean {
  try {
    const metadata = stripFrontmatter(skillMd).frontmatter.metadata;
    return typeof metadata === "object" && metadata !== null && Boolean((metadata as { provides?: unknown }).provides);
  } catch {
    return false;
  }
}

export function readDisableModelInvocationChoices(): Record<string, string[]> {
  const value = getSetting<unknown>(DISABLE_MODEL_INVOCATION_SETTING).value;
  const choices: Record<string, string[]> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return choices;
  for (const [key, names] of Object.entries(value)) {
    if (Array.isArray(names)) choices[key] = names.filter((n): n is string => typeof n === "string");
  }
  return choices;
}

export interface ReconcileResult {
  changed: string[];
  warnings: string[];
}

function real(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

export function disableModelInvocationConfigDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const candidates = [env.CLAUDE_CONFIG_DIR || join(home, ".claude")];
  const sessions = join(home, ".claude-swap-backup", "sessions");
  try {
    for (const name of readdirSync(sessions).sort()) candidates.push(join(sessions, name));
  } catch {
    // no swap backups on this machine
  }
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of candidates) {
    const plugins = real(join(dir, "plugins"));
    if (plugins === null || seen.has(plugins)) continue;
    seen.add(plugins);
    dirs.push(dir);
  }
  return dirs;
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function skillFiles(versionDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const add = (name: string, dir: string) => {
    if (!files.has(name)) files.set(name, join(dir, "SKILL.md"));
  };
  for (const root of registeredSkillRoots(versionDir)) {
    for (const top of subdirs(root)) {
      const topDir = join(root, top);
      if (existsSync(join(topDir, "SKILL.md"))) {
        add(top, topDir);
        continue;
      }
      for (const leaf of subdirs(topDir)) {
        if (existsSync(join(topDir, leaf, "SKILL.md"))) add(leaf, join(topDir, leaf));
      }
    }
  }
  return files;
}

function newestVersionDir(pluginDir: string): string | null {
  let best: string | null = null;
  for (const v of subdirs(pluginDir)) {
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best === null ? null : join(pluginDir, best);
}

// Claude Code names the folders it loads in installed_plugins.json; version folders can be hashes, so newest-by-number can be wrong.
function installedPaths(configDir: string, key: string, cacheReal: string): { inCache: string[]; outside: boolean } {
  const inCache = new Set<string>();
  let outside = false;
  try {
    const parsed = JSON.parse(readFileSync(join(configDir, "plugins", "installed_plugins.json"), "utf8")) as {
      plugins?: Record<string, unknown>;
    };
    const entries = parsed.plugins?.[key];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const path = entry?.installPath;
      if (typeof path !== "string") continue;
      const resolved = real(path);
      if (resolved === null) continue;
      if (resolved.startsWith(cacheReal + sep)) inCache.add(resolved);
      else outside = true;
    }
  } catch {
    // a missing or malformed registry means the newest folder is used
  }
  return { inCache: [...inCache], outside };
}

function atomicWrite(file: string, text: string, mode: number): void {
  const tmp = join(dirname(file), `.${basename(file)}.rt-tmp-${process.pid}`);
  try {
    writeFileSync(tmp, text);
    chmodSync(tmp, mode);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function reconcileSkill(file: string, chosen: boolean, cacheReal: string, out: ReconcileResult): void {
  try {
    const resolved = real(file);
    if (resolved === null) {
      out.warnings.push(`${file}: cannot be resolved, left alone`);
      return;
    }
    if (!resolved.startsWith(cacheReal + sep)) {
      out.warnings.push(`${file}: resolves outside plugins/cache, left alone`);
      return;
    }
    const before = readFileSync(file, "utf8");
    // Every skill of every plugin is read on each session start, so a file with no mark must cost no YAML parse.
    if (!chosen && !before.includes(PERSONAL_MARK)) return;
    if (providesContract(before)) return;
    let after: string | null;
    if (chosen) {
      after = addDisableModelInvocation(before);
      if (after === null) {
        out.warnings.push(`${file}: no frontmatter, disable-model-invocation not applied`);
        return;
      }
      const key = disableModelInvocationKey(before);
      if (after === before && key && key.value !== "true" && !key.comment?.startsWith(PERSONAL_MARK)) {
        out.warnings.push(`${file}: disable-model-invocation has an unusual value, so it was left alone`);
        return;
      }
    } else {
      after = removeDisableModelInvocation(before);
    }
    if (after === before) return;
    const { mode } = statSync(resolved);
    if ((mode & 0o200) === 0) {
      out.warnings.push(`${file}: read-only, left alone`);
      return;
    }
    atomicWrite(resolved, after, mode & 0o7777);
    out.changed.push(file);
  } catch (err) {
    out.warnings.push(`${file}: ${(err as Error).message}`);
  }
}

export function reconcileDisableModelInvocation(opts: {
  configDirs: string[];
  choices: Record<string, string[]>;
  beforeSkill?: (file: string) => void;
}): ReconcileResult {
  const out: ReconcileResult = { changed: [], warnings: [] };
  const seenCaches = new Set<string>();
  for (const configDir of opts.configDirs) {
    const cacheReal = real(join(configDir, "plugins", "cache"));
    if (cacheReal === null || seenCaches.has(cacheReal)) continue;
    seenCaches.add(cacheReal);
    for (const [key, names] of Object.entries(opts.choices)) {
      const at = key.lastIndexOf("@");
      if (at <= 0) continue;
      const plugin = key.slice(0, at);
      const marketplace = key.slice(at + 1);
      try {
        const { inCache, outside } = installedPaths(configDir, key, cacheReal);
        if (outside && names.length > 0) {
          const warning = `${key}: this plugin loads from a folder outside Claude's plugin cache, so rt left it alone and Claude can still invoke its skills`;
          if (!out.warnings.includes(warning)) out.warnings.push(warning);
        }
        const newest = inCache.length === 0 && !outside ? newestVersionDir(join(cacheReal, marketplace, plugin)) : null;
        const chosen = new Set(names);
        for (const versionDir of newest === null ? inCache : [newest]) {
          for (const [name, file] of skillFiles(versionDir)) {
            opts.beforeSkill?.(file);
            if (!existsSync(versionDir)) break;
            if (neverDisabled(plugin, name)) continue;
            reconcileSkill(file, chosen.has(name), cacheReal, out);
          }
        }
      } catch (err) {
        out.warnings.push(`${key}: ${(err as Error).message}`);
      }
    }
  }
  return out;
}

/** `choices` plus every plugin in the config dirs' caches with no names, so a reconcile strips marks the setting no longer vouches for. */
export function withInstalledPlugins(configDirs: string[], choices: Record<string, string[]>): Record<string, string[]> {
  const installed: Record<string, string[]> = {};
  for (const configDir of configDirs) {
    const cache = join(configDir, "plugins", "cache");
    for (const marketplace of subdirs(cache)) {
      for (const plugin of subdirs(join(cache, marketplace))) installed[`${plugin}@${marketplace}`] = [];
    }
  }
  return { ...installed, ...choices };
}

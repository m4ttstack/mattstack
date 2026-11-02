import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join, sep } from "path";
import { compareVersions } from "./installed-plugins.ts";
import { addDirectOnly, DIRECT_ONLY_MARK, removeDirectOnly, sourceSetsDirectOnly } from "./direct-only-line.ts";
import { registeredSkillRoots } from "./skill-roots.ts";

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

export function directOnlyConfigDirs(env: NodeJS.ProcessEnv, home: string): string[] {
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

function atomicWrite(file: string, text: string): void {
  const tmp = join(dirname(file), `.${basename(file)}.rt-tmp-${process.pid}`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function reconcileSkill(file: string, chosen: boolean, cacheReal: string, out: ReconcileResult): void {
  try {
    const resolved = real(file);
    if (resolved === null || !resolved.startsWith(cacheReal + sep)) {
      out.warnings.push(`${file}: resolves outside plugins/cache, left alone`);
      return;
    }
    const before = readFileSync(file, "utf8");
    let after: string | null;
    if (chosen) {
      after = addDirectOnly(before);
      if (after === null) {
        out.warnings.push(`${file}: no frontmatter, direct-only not applied`);
        return;
      }
      if (after === before && !before.includes(DIRECT_ONLY_MARK) && !sourceSetsDirectOnly(before)) {
        out.warnings.push(`${file}: disable-model-invocation has an unusual value, direct-only not applied`);
        return;
      }
    } else {
      after = removeDirectOnly(before);
    }
    if (after === before) return;
    atomicWrite(resolved, after);
    out.changed.push(file);
  } catch (err) {
    out.warnings.push(`${file}: ${(err as Error).message}`);
  }
}

export function reconcileDirectOnly(opts: { configDirs: string[]; choices: Record<string, string[]> }): ReconcileResult {
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
        const versionDir = newestVersionDir(join(cacheReal, marketplace, plugin));
        if (versionDir === null) continue;
        const chosen = new Set(names);
        for (const [name, file] of skillFiles(versionDir)) reconcileSkill(file, chosen.has(name), cacheReal, out);
      } catch (err) {
        out.warnings.push(`${key}: ${(err as Error).message}`);
      }
    }
  }
  return out;
}

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { rtDir } from "../rt-paths.ts";
import type { PluginListEntry } from "./sources.ts";

/** A backstop for a change no stamped file records, such as a folder plugin's own version. */
export const PLUGIN_LIST_CACHE_TTL_MS = 5 * 60_000;

export type PluginListCacheDeps = {
  now(): number;
  /** `[mtimeMs, size]`, or null for a file that is not there. */
  stamp(path: string): [number, number] | null;
  read(path: string): string | null;
  write(path: string, body: string): void;
  list(): PluginListEntry[];
};

/**
 * Every file whose change can change `claude plugin list --json` from this
 * cwd: the user's settings and install index, and each ancestor's project
 * settings, since project-scoped installs are listed by where Claude runs.
 */
export function pluginListInputs(configDir: string, cwd: string, claudeBin: string): string[] {
  const paths = [
    claudeBin,
    join(configDir, "settings.json"),
    join(configDir, "plugins", "installed_plugins.json"),
    join(configDir, "plugins", "known_marketplaces.json"),
  ];
  for (let dir = cwd; ; dir = dirname(dir)) {
    paths.push(join(dir, ".claude", "settings.json"), join(dir, ".claude", "settings.local.json"));
    if (dirname(dir) === dir) break;
  }
  return paths;
}

function isPluginList(value: unknown): value is PluginListEntry[] {
  return (
    Array.isArray(value) &&
    value.every((e) => typeof e === "object" && e !== null && typeof e.id === "string" && typeof e.installPath === "string")
  );
}

export function cachedPluginList(file: string, inputs: string[], deps: PluginListCacheDeps): PluginListEntry[] {
  const key = JSON.stringify(inputs.map((p) => [p, deps.stamp(p)]));
  const raw = deps.read(file);
  if (raw !== null) {
    try {
      const hit = JSON.parse(raw) as { key?: unknown; at?: unknown; list?: unknown };
      const fresh = typeof hit.at === "number" && deps.now() - hit.at < PLUGIN_LIST_CACHE_TTL_MS;
      if (hit.key === key && fresh && isPluginList(hit.list)) return hit.list;
    } catch {
      // an unreadable cache is a miss
    }
  }
  const list = deps.list();
  try {
    deps.write(file, JSON.stringify({ key, at: deps.now(), list }));
  } catch {
    // a cache that cannot be written only costs the next read a spawn
  }
  return list;
}

export function pluginListCacheFile(): string {
  return join(rtDir(), "cache", "claude-plugin-list.json");
}

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), ".claude");
}

export const livePluginListCacheDeps = (list: () => PluginListEntry[]): PluginListCacheDeps => ({
  now: () => Date.now(),
  stamp: (path) => {
    try {
      const s = statSync(path);
      return [s.mtimeMs, s.size];
    } catch {
      return null;
    }
  },
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  write: (path, body) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, path);
  },
  list,
});

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { rtDir } from "../rt-paths.ts";
import { warn } from "../ui/warn.ts";
import type { CheckResult } from "./run.ts";

export const CHECK_CACHE_TTL_MS = 3_600_000;

type Configured = Extract<CheckResult, { configured: true }>;
type Entry = { at: number; result: Configured };

export type CacheDeps = {
  now: () => number;
  read: (path: string) => string | null;
  write: (path: string, body: string) => void;
};

export const realCacheDeps: CacheDeps = {
  now: () => Date.now(),
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  write: (path, body) => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, path);
    } catch (err) {
      warn("check", `could not save the check result cache: ${err instanceof Error ? err.message : String(err)}`, {
        context: { path },
      });
    }
  },
};

export function cachePath(): string {
  return join(rtDir(), "check-results.json");
}

export function cacheKey(tree: string, sha: string, command: string): string {
  return JSON.stringify([tree, sha, command]);
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as { at?: unknown; result?: unknown };
  return typeof e.at === "number" && typeof e.result === "object" && e.result !== null;
}

function load(deps: CacheDeps): Record<string, Entry> {
  const raw = deps.read(cachePath());
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isEntry(v))) as Record<string, Entry>;
  } catch {
    return {};
  }
}

export function readCached(key: string, deps: CacheDeps): Configured | null {
  const entry = load(deps)[key];
  if (!entry || deps.now() - entry.at >= CHECK_CACHE_TTL_MS) return null;
  return { ...entry.result, fromCache: true };
}

export function writeCached(key: string, result: Configured, deps: CacheDeps): void {
  if (result.verdict !== "green" || result.dirty) return;
  const now = deps.now();
  const kept = Object.fromEntries(Object.entries(load(deps)).filter(([, e]) => now - e.at < CHECK_CACHE_TTL_MS));
  kept[key] = { at: now, result };
  deps.write(cachePath(), JSON.stringify(kept));
}

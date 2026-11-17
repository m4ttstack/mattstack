import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPackInto } from "../../commands/skills.ts";
import { readLock } from "./compiled-lock.ts";
import { zonePackDir, type ZoneInfo } from "./init.ts";
import { compareVersions } from "./installed-plugins.ts";
import { FragmentError, parseFragment } from "./manifest-merge.ts";
import { teamBindings, type MaterializeDeps } from "./materialize.ts";
import { inputHash } from "./render.ts";

export type RenderStamp = { rtBuild: string; mattstack: string; inputHash: string };

export type EnsureResult =
  | { ok: true; dir: string; stamp: RenderStamp; rendered: boolean }
  | { ok: false; reason: "missing" | "render-failed"; message: string; builtWith?: string };

const STAMP_FILE = "render.json";
const KEEP_PACK_VERSIONS = 3;
const KEEP_MATTSTACK_VERSIONS = 2;
/** Siblings a render in flight writes and then renames away; pruning never touches them. */
const IN_FLIGHT_RE = /\.(tmp|old)-/;

export function treeDir(root: string, org: string, plugin: string, packVersion: string, mattstack: string): string {
  return join(root, org, plugin, packVersion, mattstack);
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readStamp(dir: string): RenderStamp | null {
  const raw = readJson(join(dir, STAMP_FILE));
  if (!raw) return null;
  const { rtBuild, mattstack, inputHash: hash } = raw;
  return typeof rtBuild === "string" && typeof mattstack === "string" && typeof hash === "string" ? { rtBuild, mattstack, inputHash: hash } : null;
}

/** The org base pack the team pack's own fragment extends, in the same clone; null without one. */
function baseDirOf(zone: ZoneInfo, packDir: string): string | null {
  const path = join(packDir, "pack", "skills.jsonc");
  const fragment = parseFragment(readFileSync(path, "utf8"), path);
  return fragment.extends === undefined ? null : join(zone.orgDir, "mattstack", "org", "packs", fragment.extends);
}

const sameRender = (a: RenderStamp, b: RenderStamp) => a.rtBuild === b.rtBuild && a.inputHash === b.inputHash;

const suffix = () => `${process.pid}-${randomBytes(4).toString("hex")}`;

function isRaceLoss(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EEXIST" || code === "ENOTEMPTY";
}

/**
 * The rendered tree for the installed pack version. Only the clone holding
 * that version can render it; once the clone has moved on, an existing tree
 * is served as is and a missing one is reported.
 */
export async function ensureTree(opts: {
  root: string;
  zone: ZoneInfo;
  pack: string;
  installedVersion: string;
  mattstack: string;
  rtBuild: string;
  deps: MaterializeDeps;
  /** Renders against `<dir>/plugins/<name>` instead of the installed plugins. */
  mattstackDir?: string;
}): Promise<EnsureResult> {
  const packDir = zonePackDir(opts.zone);
  const manifest = readJson(join(packDir, ".claude-plugin", "plugin.json"));
  const plugin = typeof manifest?.name === "string" ? manifest.name : null;
  if (plugin === null) return { ok: false, reason: "render-failed", message: `${join(packDir, ".claude-plugin", "plugin.json")} names no plugin` };
  const dir = treeDir(opts.root, opts.zone.org, plugin, opts.installedVersion, opts.mattstack);
  const existing = readStamp(dir);

  if (manifest?.version !== opts.installedVersion) {
    if (existing) return { ok: true, dir, stamp: existing, rendered: false };
    return { ok: false, reason: "missing", message: `no rendered ${plugin} ${opts.installedVersion} for mattstack ${opts.mattstack}, and the org clone has moved past that version` };
  }

  const failed = (message: string): EnsureResult => {
    const builtWith = readLock(packDir).builtWith;
    return { ok: false, reason: "render-failed", message, ...(builtWith !== undefined ? { builtWith } : {}) };
  };
  const bindings = teamBindings(opts.deps, opts.zone, opts.pack);
  if ("error" in bindings) return failed(bindings.error);
  let baseDir: string | null;
  try {
    baseDir = baseDirOf(opts.zone, packDir);
  } catch (err) {
    if (err instanceof FragmentError) return failed(err.message);
    throw err;
  }
  const stamp: RenderStamp = { rtBuild: opts.rtBuild, mattstack: opts.mattstack, inputHash: inputHash(packDir, baseDir, bindings.text) };
  if (existing && sameRender(existing, stamp)) return { ok: true, dir, stamp: existing, rendered: false };

  const tmp = `${dir}.tmp-${suffix()}`;
  let old: string | null = null;
  mkdirSync(tmp, { recursive: true });
  try {
    const result = await renderPackInto({ packDir, manifestText: bindings.text, repoKey: bindings.repoKey, outRoot: tmp, mattstackDir: opts.mattstackDir });
    if (!result.ok) return failed(result.errors.join("\n"));
    if (result.mattstack !== opts.mattstack) return failed(`rendered with mattstack ${result.mattstack}, but mattstack ${opts.mattstack} is installed`);
    writeFileSync(join(tmp, STAMP_FILE), JSON.stringify(stamp, null, 2) + "\n");
    const now = readStamp(dir);
    if (now && sameRender(now, stamp)) return { ok: true, dir, stamp: now, rendered: false };
    // A folder with no readable stamp is moved aside too, or it would block every later render.
    if (existsSync(dir)) {
      try {
        old = `${dir}.old-${suffix()}`;
        renameSync(dir, old);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        old = null;
      }
    }
    try {
      renameSync(tmp, dir);
    } catch (err) {
      if (!isRaceLoss(err)) throw err;
      const winner = readStamp(dir);
      if (!winner) return failed(`another render left ${dir} without a readable ${STAMP_FILE}`);
      return { ok: true, dir, stamp: winner, rendered: false };
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (old !== null) rmSync(old, { recursive: true, force: true });
  }
  pruneTrees(opts.root, opts.zone.org, plugin, { installedVersion: opts.installedVersion, mattstack: opts.mattstack });
  return { ok: true, dir, stamp, rendered: true };
}

const settledDirs = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).filter((e) => e.isDirectory() && !IN_FLIGHT_RE.test(e.name)).map((e) => e.name);
const newestFirst = (names: string[]) => [...names].sort((a, b) => compareVersions(b, a));

/** Keeps the newest pack versions and, under each, the newest mattstack versions; the installed pair always stays. */
export function pruneTrees(root: string, org: string, plugin: string, keep: { installedVersion: string; mattstack: string }): void {
  const pluginDir = join(root, org, plugin);
  const kept = new Set(newestFirst(settledDirs(pluginDir)).slice(0, KEEP_PACK_VERSIONS));
  for (const packVersion of settledDirs(pluginDir)) {
    const versionDir = join(pluginDir, packVersion);
    const installed = packVersion === keep.installedVersion;
    if (!kept.has(packVersion) && !installed) {
      rmSync(versionDir, { recursive: true, force: true });
      continue;
    }
    const keepMattstack = new Set(kept.has(packVersion) ? newestFirst(settledDirs(versionDir)).slice(0, KEEP_MATTSTACK_VERSIONS) : []);
    if (installed) keepMattstack.add(keep.mattstack);
    for (const mattstack of settledDirs(versionDir)) {
      if (!keepMattstack.has(mattstack)) rmSync(join(versionDir, mattstack), { recursive: true, force: true });
    }
  }
}

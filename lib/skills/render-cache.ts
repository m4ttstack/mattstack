import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderPackInto } from "../../commands/skills.ts";
import { generatedMarketplaceRef } from "../setup/generated-marketplace.ts";
import { childEnv, runCapture } from "../subprocess.ts";
import { readLock } from "./compiled-lock.ts";
import { zonePackDir, type ZoneInfo } from "./init.ts";
import { compareVersions } from "./installed-plugins.ts";
import { FragmentError, parseFragment } from "./manifest-merge.ts";
import { teamBindings, type MaterializeDeps } from "./materialize.ts";
import { inputHash } from "./render.ts";
import type { PluginRoots } from "./sources.ts";
import { IN_FLIGHT_RE, parseStamp, STAMP_FILE, treeDir, type RenderStamp } from "./render-paths.ts";

export { renderRoot, treeDir, type RenderStamp } from "./render-paths.ts";

export type EnsureResult =
  | { ok: true; dir: string; stamp: RenderStamp; rendered: boolean }
  | { ok: false; reason: "missing" | "render-failed"; message: string; builtWith?: string };

const KEEP_PACK_VERSIONS = 3;
const KEEP_MATTSTACK_VERSIONS = 2;

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readStamp(dir: string): RenderStamp | null {
  try {
    return parseStamp(readFileSync(join(dir, STAMP_FILE), "utf8"));
  } catch {
    return null;
  }
}

/** The org base pack the team pack's own fragment extends, in the same clone; null without one. */
function baseDirOf(zone: ZoneInfo, packDir: string): string | null {
  const path = join(packDir, "pack", "skills.jsonc");
  const fragment = parseFragment(readFileSync(path, "utf8"), path);
  return fragment.extends === undefined ? null : join(zone.orgDir, "mattstack", "org", "packs", fragment.extends);
}

const sameRender = (a: RenderStamp, b: RenderStamp) => a.rtBuild === b.rtBuild && a.inputHash === b.inputHash;

export type CloneGit = (cwd: string, args: string[]) => Promise<{ code: number; stdout: string }>;

const GIT_TIMEOUT_MS = 10_000;

const realCloneGit: CloneGit = async (cwd, args) => {
  const r = await runCapture(["git", "-C", cwd, ...args], { timeoutMs: GIT_TIMEOUT_MS, env: { ...childEnv(), LC_ALL: "C" } });
  return { code: r.exitCode, stdout: r.stdout };
};

/** The branch a `git status --branch` header names; null when detached. */
function statusBranch(header: string): string | null {
  const text = header.replace(/^## /, "");
  if (text.startsWith("No commits yet on ")) return text.slice("No commits yet on ".length).trim();
  if (text.startsWith("HEAD (no branch)")) return null;
  return text.split(/\.\.\.| /)[0] ?? null;
}

/**
 * True when the clone's working copy is not what members installed: a change
 * not committed under the pack or its base, or a branch other than the data
 * branch installs read. A git that cannot answer is no evidence either way.
 */
async function cloneMovedOn(git: CloneGit, home: string, zone: ZoneInfo, fs: MaterializeDeps["fs"], dirs: string[]): Promise<boolean> {
  const status = await git(zone.orgDir, ["status", "--porcelain=v1", "--branch", "--untracked-files=all", "--", ...dirs.map((d) => relative(zone.orgDir, d))]);
  if (status.code !== 0) return false;
  const [header = "", ...changes] = status.stdout.split("\n");
  if (changes.some((line) => line.trim() !== "")) return true;
  return statusBranch(header) !== generatedMarketplaceRef({ readFile: fs.readFile, home }, zone.orgDir);
}

const suffix = () => `${process.pid}-${randomBytes(4).toString("hex")}`;

function isRaceLoss(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EEXIST" || code === "ENOTEMPTY";
}

/**
 * The rendered tree for the installed pack version. Only the clone holding
 * that version, committed on its data branch, renders over a tree; once the
 * clone has moved on, an existing tree is served as is. A missing tree at the
 * installed version renders from the working copy; at any other, it is
 * reported.
 */
export async function ensureTree(opts: {
  /** Whose plugin cache names the pack versions a running session may still load. */
  home: string;
  root: string;
  zone: ZoneInfo;
  pack: string;
  installedVersion: string;
  mattstack: string;
  rtBuild: string;
  deps: MaterializeDeps;
  /** Renders against `<dir>/plugins/<name>` instead of the installed plugins. */
  mattstackDir?: string;
  /** Plugin roots the caller lists, asked for only when a render runs, so it runs no `claude plugin list` of its own. */
  pluginRoots?: () => PluginRoots;
  git?: CloneGit;
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
  // Members render what was committed, so an edit not yet published never replaces a tree they share.
  if (existing && (await cloneMovedOn(opts.git ?? realCloneGit, opts.home, opts.zone, opts.deps.fs, baseDir === null ? [packDir] : [packDir, baseDir]))) {
    return { ok: true, dir, stamp: existing, rendered: false };
  }

  const tmp = `${dir}.tmp-${suffix()}`;
  let old: string | null = null;
  mkdirSync(tmp, { recursive: true });
  try {
    const result = await renderPackInto({ packDir, manifestText: bindings.text, repoKey: bindings.repoKey, outRoot: tmp, mattstackDir: opts.mattstackDir, pluginRoots: opts.pluginRoots?.() });
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
  pruneTrees(opts.root, opts.zone.org, plugin, { installedVersion: opts.installedVersion, mattstack: opts.mattstack, cached: cachedPackVersions(opts.home, plugin) });
  return { ok: true, dir, stamp, rendered: true };
}

const settledDirs = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).filter((e) => e.isDirectory() && !IN_FLIGHT_RE.test(e.name)).map((e) => e.name);
const newestFirst = (names: string[]) => [...names].sort((a, b) => compareVersions(b, a));

/** Every version of `plugin` with a folder in the plugin cache: a session started on one keeps loading it until it ends. */
export function cachedPackVersions(home: string, plugin: string): string[] {
  const cache = join(home, ".claude", "plugins", "cache");
  return settledDirs(cache)
    .filter((market) => !market.startsWith("temp_git_"))
    .flatMap((market) => settledDirs(join(cache, market, plugin)));
}

/**
 * Keeps the newest pack versions and, under each, the newest mattstack
 * versions; the installed pair always stays, and so does every version the
 * plugin cache still holds.
 */
export function pruneTrees(root: string, org: string, plugin: string, keep: { installedVersion: string; mattstack: string; cached?: string[] }): void {
  const pluginDir = join(root, org, plugin);
  const kept = new Set([...newestFirst(settledDirs(pluginDir)).slice(0, KEEP_PACK_VERSIONS), ...(keep.cached ?? [])]);
  for (const packVersion of settledDirs(pluginDir)) {
    const versionDir = join(pluginDir, packVersion);
    const installed = packVersion === keep.installedVersion;
    if (!kept.has(packVersion) && !installed) {
      rmSync(versionDir, { recursive: true, force: true });
      continue;
    }
    const keepMattstack = new Set(kept.has(packVersion) ? newestFirst(settledDirs(versionDir)).slice(0, KEEP_MATTSTACK_VERSIONS) : []);
    if (installed || keep.cached?.includes(packVersion)) keepMattstack.add(keep.mattstack);
    for (const mattstack of settledDirs(versionDir)) {
      if (!keepMattstack.has(mattstack)) rmSync(join(versionDir, mattstack), { recursive: true, force: true });
    }
  }
}

/** The roots a render compiles with, their mattstack set to the one activeMattstack names. */
export function withEngine(roots: PluginRoots, engine: { dir: string; version: string }): PluginRoots {
  return { ...roots, byName: { ...roots.byName, mattstack: { dir: engine.dir, version: engine.version } } };
}

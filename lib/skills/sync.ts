import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "fs";
import { join, relative, sep } from "path";
import { CLAUDE_BIN_FALLBACKS } from "../claude-bin.ts";
import type { PackInfo } from "./packs.ts";
import { installedVersionFor, type PluginListEntry } from "./sources.ts";

export type RunResult = { code: number; stdout: string; stderr: string };

export type SyncDeps = {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<RunResult>;
  claudeBin: string | null;
  checkPack: (packName: string) => Promise<{ drift: boolean; lintHits: number; strict: boolean }>;
  compilePack: (packName: string) => Promise<{ ok: boolean; errors: string[] }>;
  /** Regenerates every registered repo's per-pack files; a base pack the pack extends may have moved since the last install. Only the named pack's failures fail the step. */
  materialize(packName: string): Promise<{ ok: boolean; detail: string; warnings?: string[] }>;
  configDir: string;
  cswapSessionsDir: string;
  inTreeRoot: string | null;
};

export type SyncStep = { name: string; status: "ran" | "skipped" | "refused" | "failed"; detail: string };

export type SyncReport = {
  ok: boolean;
  pack: string;
  steps: SyncStep[];
  versions: {
    engine: { before: string | null; after: string | null };
    pack: { source: string; installedBefore: string | null; installedAfter: string | null };
  };
  warnings: string[];
  restartNeeded: boolean;
};

function writeManifestVersion(packDir: string, version: string): void {
  const path = join(packDir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...manifest, version }, null, 2) + "\n");
}

export function bumpPatchVersion(packDir: string): { before: string; after: string } {
  const path = join(packDir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  const before = manifest.version;
  const m = typeof before === "string" ? before.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  if (!m) throw new Error(`cannot bump non-semver version in ${path}: ${String(before)}`);
  const after = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  writeManifestVersion(packDir, after);
  return { before: before as string, after };
}

type Outcome = Pick<SyncStep, "status" | "detail">;

function ran(detail: string): Outcome {
  return { status: "ran", detail };
}
function skipped(detail: string): Outcome {
  return { status: "skipped", detail };
}
function refused(detail: string): Outcome {
  return { status: "refused", detail };
}
function failed(detail: string): Outcome {
  return { status: "failed", detail };
}

/** Every dep/subprocess call is fallible; a throw here becomes the step's own "failed" entry rather than an escaped rejection. */
async function tryStep(fn: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await fn();
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }
}

function stops(o: Outcome): boolean {
  return o.status === "refused" || o.status === "failed";
}

function pluginId(info: PackInfo): string {
  return `${info.name}@${info.marketplace}`;
}

function readManifestVersion(dir: string): string {
  const path = join(dir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  if (typeof manifest.version !== "string") throw new Error(`no "version" string in ${path}`);
  return manifest.version;
}

/** True only when pluginsPath is a symlink whose fully resolved target matches target. */
function isAlignedSymlink(pluginsPath: string, target: string): boolean {
  try {
    readlinkSync(pluginsPath);
  } catch {
    return false;
  }
  try {
    return existsSync(target) && realpathSync(pluginsPath) === realpathSync(target);
  } catch {
    return false;
  }
}

/** Unlike existsSync, true for a dangling symlink -- that entry must reach isAlignedSymlink (and its warning) rather than be skipped as absent. */
function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function realRoot(root: string | null): string | null {
  if (root === null) return null;
  try {
    return realpathSync(root);
  } catch {
    return null;
  }
}

/** Pack dirs arrive realpath'd, so the root is compared in the same form. */
function isInside(dir: string, root: string | null): boolean {
  if (root === null) return false;
  return dir === root || dir.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Claude Code installs an in-tree plugin from its git-subdir source's ref, never the checkout's working tree. */
const IN_TREE_REF = "main";

async function readInTreeVersion(deps: SyncDeps, root: string, dir: string): Promise<string> {
  const rel = relative(root, dir).split(sep).join("/");
  const spec = `${IN_TREE_REF}:${rel === "" ? "" : rel + "/"}.claude-plugin/plugin.json`;
  const res = await deps.run("git", ["show", spec], { cwd: root });
  if (res.code !== 0) throw new Error(`git show ${spec} failed in ${root}: ${res.stderr.trim()}`);
  const manifest = JSON.parse(res.stdout) as { version?: string };
  if (typeof manifest.version !== "string") throw new Error(`no "version" string in ${spec}`);
  return manifest.version;
}

async function inTreeBranchNote(deps: SyncDeps, root: string): Promise<string> {
  const res = await deps.run("git", ["branch", "--show-current"], { cwd: root });
  if (res.code !== 0) return `; could not read the shared checkout's branch (${res.stderr.trim()}); the in-tree plugin installs from ${IN_TREE_REF}`;
  const branch = res.stdout.trim();
  if (branch === IN_TREE_REF) return "";
  const where = branch === "" ? "is detached" : `is on "${branch}"`;
  return `; shared checkout ${root} ${where}, not ${IN_TREE_REF}; the in-tree plugin installs from ${IN_TREE_REF}`;
}

function guardSummary(engineInTree: boolean, packInTree: boolean, engineCache: string | null): string {
  if (engineCache !== null) {
    const packPart = packInTree ? "pack is in-tree, its git checks skipped" : "pack checkout clean on main";
    return `${packPart}; engine is the installed cache at ${engineCache}, never touched by git`;
  }
  if (engineInTree && packInTree) return "engine and pack are in-tree; git checks skipped";
  if (engineInTree) return "pack checkout clean on main; engine is in-tree, its git checks skipped";
  if (packInTree) return "engine checkout clean on main; pack is in-tree, its git checks skipped";
  return "engine and pack checkouts clean on main";
}

async function listInstalled(deps: SyncDeps): Promise<PluginListEntry[]> {
  const res = await deps.run(deps.claudeBin!, ["plugin", "list", "--json"]);
  if (res.code !== 0) throw new Error(`claude plugin list --json failed: ${res.stderr.trim()}`);
  return JSON.parse(res.stdout) as PluginListEntry[];
}

/**
 * The engine as sync sees it. `installedCache` marks an engine installed from
 * a non-directory marketplace: its dir is Claude Code's own plugin cache, so
 * sync never runs git in it; Claude Code refreshes it before the pack compiles.
 * `scope` is the chosen listing entry's install scope: the same id can sit at
 * user, project and local scope at once, and an update without it moves the
 * user copy.
 */
export type SyncEngine = PackInfo & { installedCache?: boolean; scope?: string };

/** The version of the one entry sync chose (last enabled match at that scope), never merely the first entry with the id. */
function chosenEntryVersion(list: PluginListEntry[], id: string, scope: string | undefined): string | null {
  const entry = list.findLast((e) => e.id === id && e.enabled !== false && (scope === undefined || e.scope === scope));
  return entry ? installedVersionFor([entry], id) : null;
}

export async function syncPack(pack: PackInfo, engine: SyncEngine, deps: SyncDeps): Promise<SyncReport> {
  const steps: SyncStep[] = [];
  const warnings: string[] = [];
  const sameCheckout = pack.dir === engine.dir;
  // A plugin inside the shared checkout installs from the git-subdir
  // source's ref (main), and update-machine owns that checkout, so only
  // read-only git runs there.
  const inTreeRoot = realRoot(deps.inTreeRoot);
  const engineCached = engine.installedCache === true && !sameCheckout;
  const engineInTree = !engineCached && isInside(engine.dir, inTreeRoot);
  const engineGit = !engineInTree && !engineCached;
  const packInTree = isInside(pack.dir, inTreeRoot);
  const packGit = !sameCheckout && !packInTree;

  let installedEngineBefore: string | null = null;
  let installedPackBefore: string | null = null;
  let installedEngineAfter: string | null = null;
  let installedPackAfter: string | null = null;
  let engineSourceVersion = "";
  let packSourceVersion = "";
  let bumpBefore: string | null = null;
  let bumpAfter: string | null = null;
  let drift = false;
  let branchNote = "";

  const finish = (): SyncReport => ({
    ok: !steps.some(stops),
    pack: pack.name,
    steps,
    versions: {
      engine: { before: installedEngineBefore, after: installedEngineAfter ?? installedEngineBefore },
      pack: { source: packSourceVersion, installedBefore: installedPackBefore, installedAfter: installedPackAfter ?? installedPackBefore },
    },
    warnings,
    restartNeeded: steps.some((s) => (s.name === "update-engine" || s.name === "update-pack") && s.status === "ran"),
  });

  // guards also seeds the installed-list "before" bookkeeping every later
  // step reads, so a throw during that seeding still resolves to a single
  // "guards" failure rather than an uncaught rejection. Manifest versions are
  // NOT read here -- pull-engine/pull-pack can move them, so they are read
  // fresh right after each pull instead (see below).
  const guards = await tryStep(async () => {
    if (!deps.claudeBin) {
      return refused(
        `claude binary not found; checked PATH, ${CLAUDE_BIN_FALLBACKS.join(", ")}; install the Claude CLI or put it on PATH, then re-run`,
      );
    }
    if (!pack.marketplace) {
      return refused(`pack "${pack.name}" has no marketplace; it must be installed from a directory marketplace to sync`);
    }
    if (!engine.marketplace) {
      return refused(`engine "${engine.name}" has no marketplace; install it from its marketplace and re-run`);
    }
    for (const rel of [".worktrees", join(".claude", "worktrees")]) {
      const dir = join(pack.dir, rel);
      if (existsSync(dir)) {
        return refused(`worktrees directory found at ${dir} (a directory-marketplace update copies the whole working tree); prune it and re-run`);
      }
    }

    if (engineGit) {
      const engineStatus = await deps.run("git", ["status", "--porcelain"], { cwd: engine.dir });
      if (engineStatus.code !== 0) return failed(`git status failed in ${engine.dir}: ${engineStatus.stderr.trim()}`);
      if (engineStatus.stdout.trim() !== "") {
        return refused(`engine checkout dirty at ${engine.dir}: "${engineStatus.stdout.trim()}"; commit or stash and re-run`);
      }
    }
    if (packGit) {
      const packStatus = await deps.run("git", ["status", "--porcelain"], { cwd: pack.dir });
      if (packStatus.code !== 0) return failed(`git status failed in ${pack.dir}: ${packStatus.stderr.trim()}`);
      if (packStatus.stdout.trim() !== "") {
        return refused(`pack checkout dirty at ${pack.dir}: "${packStatus.stdout.trim()}"; commit or stash and re-run`);
      }
    }

    if (engineGit) {
      const engineBranchRes = await deps.run("git", ["branch", "--show-current"], { cwd: engine.dir });
      if (engineBranchRes.code !== 0) return failed(`git branch --show-current failed in ${engine.dir}: ${engineBranchRes.stderr.trim()}`);
      const engineBranch = engineBranchRes.stdout.trim();
      if (engineBranch !== "main") {
        return refused(`engine checkout on branch "${engineBranch}"; check out main and re-run`);
      }
    }
    if (packGit) {
      const packBranchRes = await deps.run("git", ["branch", "--show-current"], { cwd: pack.dir });
      if (packBranchRes.code !== 0) return failed(`git branch --show-current failed in ${pack.dir}: ${packBranchRes.stderr.trim()}`);
      const packBranch = packBranchRes.stdout.trim();
      if (packBranch !== "main") {
        return refused(`pack checkout on branch "${packBranch}"; check out main and re-run`);
      }
    }

    if (inTreeRoot !== null && (engineInTree || packInTree)) {
      branchNote = await inTreeBranchNote(deps, inTreeRoot);
      if (branchNote !== "") warnings.push(branchNote.slice(2));
    }

    const list = await listInstalled(deps);
    installedEngineBefore = engineCached ? chosenEntryVersion(list, pluginId(engine), engine.scope) : installedVersionFor(list, pluginId(engine));
    installedPackBefore = installedVersionFor(list, pluginId(pack));

    return ran(guardSummary(engineInTree, packInTree, engineCached ? engine.dir : null));
  });
  steps.push({ name: "guards", ...guards });
  if (stops(guards)) return finish();

  const pullEngine = sameCheckout
    ? skipped("engine and pack share a checkout; pulled once as pull-pack")
    : await tryStep(async () => {
        if (engineCached) {
          engineSourceVersion = readManifestVersion(engine.dir);
          return skipped(`engine is the installed cache at ${engine.dir} (from the ${engine.marketplace} marketplace); never git-pulled, update-engine refreshes it`);
        }
        if (engineInTree) {
          engineSourceVersion = await readInTreeVersion(deps, inTreeRoot!, engine.dir);
          return skipped(`engine is in-tree at ${engine.dir}; kept current by update-machine${branchNote}`);
        }
        const res = await deps.run("git", ["pull", "--ff-only"], { cwd: engine.dir });
        if (res.code !== 0) return refused(`git pull --ff-only failed in ${engine.dir}: ${res.stderr.trim()}; resolve manually and re-run`);
        engineSourceVersion = readManifestVersion(engine.dir);
        return ran(res.stdout.trim() || "up to date");
      });
  steps.push({ name: "pull-engine", ...pullEngine });
  if (stops(pullEngine)) return finish();

  const pullPack = await tryStep(async () => {
    if (packInTree) {
      packSourceVersion = await readInTreeVersion(deps, inTreeRoot!, pack.dir);
      if (sameCheckout) engineSourceVersion = packSourceVersion;
      return skipped(`pack is in-tree at ${pack.dir}; kept current by update-machine${branchNote}`);
    }
    const res = await deps.run("git", ["pull", "--ff-only"], { cwd: pack.dir });
    if (res.code !== 0) return refused(`git pull --ff-only failed in ${pack.dir}: ${res.stderr.trim()}; resolve manually and re-run`);
    packSourceVersion = readManifestVersion(pack.dir);
    if (sameCheckout) engineSourceVersion = packSourceVersion;
    return ran(res.stdout.trim() || "up to date");
  });
  steps.push({ name: "pull-pack", ...pullPack });
  if (stops(pullPack)) return finish();

  /**
   * A cached engine older than the one the pack was last compiled against
   * would compile, recheck clean and push a downgrade, so the cache is brought
   * current through Claude Code (which owns it) before check ever runs, and a
   * refresh that fails stops the chain here. The update installs into a new
   * version folder, so the version is re-read from a fresh listing.
   */
  async function refreshCachedEngine(): Promise<Outcome> {
    const id = pluginId(engine);
    const stale = "sync stopped before compiling the pack against a stale engine";
    const market = await deps.run(deps.claudeBin!, ["plugin", "marketplace", "update", engine.marketplace!]);
    if (market.code !== 0) {
      return refused(`claude plugin marketplace update ${engine.marketplace} failed: ${market.stderr.trim()}; ${stale}`);
    }
    const scopeArgs = engine.scope ? ["--scope", engine.scope] : [];
    const update = await deps.run(deps.claudeBin!, ["plugin", "update", id, ...scopeArgs, "-y"]);
    if (update.code !== 0) return refused(`claude plugin update ${id} failed: ${update.stderr.trim()}; ${stale}`);
    installedEngineAfter = chosenEntryVersion(await listInstalled(deps), id, engine.scope);
    if (installedEngineAfter === null) return refused(`${id} is not in claude plugin list after its update; ${stale}`);
    engineSourceVersion = installedEngineAfter;
    if (installedEngineAfter === installedEngineBefore) return skipped(`engine already current at ${installedEngineAfter} in the ${engine.marketplace} marketplace`);
    return ran(`refreshed ${id} from the ${engine.marketplace} marketplace: ${installedEngineBefore ?? "unknown"} -> ${installedEngineAfter}`);
  }

  const updateEngine = await tryStep(async () => {
    if (sameCheckout) return skipped("engine and pack share a checkout; update handled as update-pack");
    if (engineCached) return refreshCachedEngine();
    if (installedEngineBefore === engineSourceVersion) return skipped(`engine already at ${engineSourceVersion}`);
    const id = pluginId(engine);
    const res = await deps.run(deps.claudeBin!, ["plugin", "update", id]);
    if (res.code !== 0) return failed(`claude plugin update ${id} failed: ${res.stderr.trim()}`);
    installedEngineAfter = engineSourceVersion;
    return ran(`updated ${id}`);
  });
  steps.push({ name: "update-engine", ...updateEngine });
  if (stops(updateEngine)) return finish();

  const materialize = await tryStep(async () => {
    const result = await deps.materialize(pack.name);
    warnings.push(...(result.warnings ?? []));
    return result.ok ? ran(result.detail) : failed(result.detail);
  });
  steps.push({ name: "materialize", ...materialize });
  if (stops(materialize)) return finish();

  const checkStep = await tryStep(async () => {
    const result = await deps.checkPack(pack.name);
    drift = result.drift;
    if (result.strict && result.lintHits > 0) {
      return refused(`mcp lint: ${result.lintHits} hits; run rt skills check --pack ${pack.name} and fix them before syncing`);
    }
    const lintNote = result.lintHits > 0
      ? ` mcp lint: ${result.lintHits} hits (advisory; set "strictLint": true in the pack's plugin.json to refuse on them)`
      : "";
    return ran(`drift=${drift}${lintNote}`);
  });
  steps.push({ name: "check", ...checkStep });
  if (stops(checkStep)) return finish();

  const noOp = !drift && installedPackBefore === packSourceVersion;
  if (noOp) return finish();

  const bump = await tryStep(async () => {
    if (!drift) return skipped("no drift; skipping version bump");
    if (packInTree) {
      return refused(
        `pack is in-tree at ${pack.dir} and its compiled output drifted; sync never bumps, compiles or commits inside the shared checkout, so recompile it and bump its plugin.json version in a pull request to the monorepo`,
      );
    }
    const { before, after } = bumpPatchVersion(pack.dir);
    bumpBefore = before;
    bumpAfter = after;
    packSourceVersion = after;
    return ran(`bumped ${before} -> ${after}`);
  });
  steps.push({ name: "bump", ...bump });
  if (stops(bump)) return finish();

  const compile = await tryStep(async () => {
    if (!drift) return skipped("no drift; skipping compile");
    const result = await deps.compilePack(pack.name);
    if (!result.ok) {
      // A refused compile must leave the checkout exactly as the dirty guard
      // found it (clean) so a re-run does not strand a bare-file bump the
      // guard cannot see committed anywhere -- revert the write-back, no git.
      if (bumpBefore) {
        writeManifestVersion(pack.dir, bumpBefore);
        packSourceVersion = bumpBefore;
      }
      return refused(`${result.errors.join("; ")}; reverted plugin.json to ${bumpBefore} so the checkout stays clean for the next run`);
    }
    return ran("compiled clean");
  });
  steps.push({ name: "compile", ...compile });
  if (stops(compile)) return finish();

  const recheck = await tryStep(async () => {
    if (!drift) return skipped("no drift; skipping recheck");
    const result = await deps.checkPack(pack.name);
    if (result.drift) {
      return refused(
        `content drift survives recompile; pack checkout carries an uncommitted version bump (${bumpBefore} -> ${bumpAfter}) and its compiled output; take the agent path (mattstack:editing-skills), continuing from this working tree`,
      );
    }
    return ran("drift resolved");
  });
  steps.push({ name: "recheck", ...recheck });
  if (stops(recheck)) return finish();

  const commitPush = await tryStep(async () => {
    if (!drift) return skipped("no drift; skipping commit");
    const addPaths = [join(".claude-plugin", "plugin.json"), "skills", "attachments"].filter((rel) => existsSync(join(pack.dir, rel)));
    const add = await deps.run("git", ["add", "--", ...addPaths], { cwd: pack.dir });
    if (add.code !== 0) return failed(`git add failed: ${add.stderr.trim()}`);
    const commit = await deps.run("git", ["commit", "-m", `skills sync: ${pack.name} v${bumpAfter}`], { cwd: pack.dir });
    if (commit.code !== 0) return failed(`git commit failed: ${commit.stderr.trim()}`);
    const push = await deps.run("git", ["push"], { cwd: pack.dir });
    if (push.code !== 0) return failed(`git push failed: ${push.stderr.trim()}`);
    return ran(`committed and pushed v${bumpAfter}`);
  });
  steps.push({ name: "commit-push", ...commitPush });
  if (stops(commitPush)) return finish();

  // Reached only when drift is true, or drift is false with installedPackBefore
  // !== packSourceVersion (the noOp return above already exited the other case) --
  // an update is always due here, so there is no further skip to check.
  const updatePack = await tryStep(async () => {
    const id = pluginId(pack);
    const res = await deps.run(deps.claudeBin!, ["plugin", "update", id]);
    if (res.code !== 0) return failed(`claude plugin update ${id} failed: ${res.stderr.trim()}`);
    return ran(`updated ${id}`);
  });
  steps.push({ name: "update-pack", ...updatePack });
  if (stops(updatePack)) return finish();

  const verifyInstalled = await tryStep(async () => {
    const list = await listInstalled(deps);
    installedPackAfter = installedVersionFor(list, pluginId(pack));
    installedEngineAfter = installedVersionFor(list, pluginId(engine));
    if (installedPackAfter !== packSourceVersion) {
      return failed(`installed version ${installedPackAfter ?? "unknown"} does not match source version ${packSourceVersion} after update`);
    }
    return ran(`installed matches source at ${packSourceVersion}`);
  });
  steps.push({ name: "verify-installed", ...verifyInstalled });
  if (stops(verifyInstalled)) return finish();

  const cswapSweep = await tryStep(async () => {
    if (!existsSync(deps.cswapSessionsDir)) return skipped(`no cswap sessions directory at ${deps.cswapSessionsDir}`);
    const target = join(deps.configDir, "plugins");
    let flagged = 0;
    for (const entry of readdirSync(deps.cswapSessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginsPath = join(deps.cswapSessionsDir, entry.name, "plugins");
      if (!pathExists(pluginsPath)) continue;
      if (!isAlignedSymlink(pluginsPath, target)) {
        flagged++;
        warnings.push(`cswap session "${entry.name}" plugins dir (${pluginsPath}) does not point at ${target}`);
      }
    }
    return ran(flagged === 0 ? "no divergent sessions" : `${flagged} divergent session(s)`);
  });
  steps.push({ name: "cswap-sweep", ...cswapSweep });

  return finish();
}

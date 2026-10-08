import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "fs";
import { dirname, join, posix, relative, sep } from "path";
import { CLAUDE_BIN_FALLBACKS } from "../claude-bin.ts";
import { fullyInScope, needsStaging, outOfScopeSides, packRelative, packSideChanges, parsePorcelain, parsePorcelainEntries, pendingSignature, pruneEmptiedDirs, touchesPack, withHashes, type HashedFile, type PendingFile, type PorcelainEntry } from "./changes.ts";
import { layoutAbove, markerAtRef, updateSentence } from "../team/org-layout.ts";
import { ORG_MARKER_REL, parseMarker } from "../team/org-marker.ts";
import type { PackInfo } from "./packs.ts";
import { installedVersionFor, type PluginListEntry } from "./sources.ts";

export type RunResult = { code: number; stdout: string; stderr: string };

export type SyncDeps = {
  mayCompile(packName: string): boolean;
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<RunResult>;
  claudeBin: string | null;
  checkPack: (packName: string) => Promise<{ drift: boolean; lintHits: number; strict: boolean }>;
  /** `written` and `removed` are the pack-relative files the compile touched: the version commit holds exactly these and the manifest. */
  compilePack: (packName: string) => Promise<{ ok: boolean; errors: string[]; written: string[]; removed: string[] }>;
  /** Regenerates every registered repo's per-pack files; a base pack the pack extends may have moved since the last install. Only the named pack's failures fail the step. */
  materialize(packName: string): Promise<{ ok: boolean; detail: string; warnings?: string[] }>;
  configDir: string;
  cswapSessionsDir: string;
  inTreeRoot: string | null;
  /** Where org clones live: a pack inside one follows whatever branch that clone has checked out. */
  orgsRoot?: string | null;
};

/**
 * Set only on a pull-pack the org layout gate held; a caller tells the hold
 * from a failed pull by this, never by the sentence. A symbol key, so the
 * --json envelope (JSON.stringify) never carries it.
 */
export const LAYOUT_HOLD: unique symbol = Symbol("layoutHold");

export type SyncStep = { name: string; status: "ran" | "skipped" | "refused" | "failed"; detail: string; [LAYOUT_HOLD]?: true };

/** `expect` is the signature `rt skills changes` printed: the sync refuses when the pack's pending changes no longer match it. */
export type SyncOptions = { commitPending?: boolean; expect?: string };

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
  if (!m) throw new Error(`The version in ${path} is not semver (${String(before)}), so rt cannot bump it`);
  const after = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  writeManifestVersion(packDir, after);
  return { before: before as string, after };
}

type Outcome = Pick<SyncStep, "status" | "detail" | typeof LAYOUT_HOLD>;

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

const hitCount = (n: number): string => `${n} ${n === 1 ? "hit" : "hits"}`;
/** git's own messages often end in a period already. */
const ended = (text: string): string => (text.endsWith(".") ? text : `${text}.`);
const sentenceCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function pluginId(info: PackInfo): string {
  return `${info.name}@${info.marketplace}`;
}

function manifestVersionOrNull(dir: string): string | null {
  try {
    return readManifestVersion(dir);
  } catch {
    return null;
  }
}

function readManifestVersion(dir: string): string {
  const path = join(dir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  if (typeof manifest.version !== "string") throw new Error(`${path} has no version`);
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

/**
 * The top of the git checkout holding dir, when that checkout carries an org
 * marker: its pull must pass the same layout gate the daemon's team pull does.
 */
function orgCloneTop(dir: string): string | null {
  let at = realRoot(dir) ?? dir;
  for (;;) {
    if (existsSync(join(at, ".git"))) {
      const marker = join(at, ORG_MARKER_REL);
      return existsSync(marker) && parseMarker(readFileSync(marker, "utf8")).kind === "org" ? at : null;
    }
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/** Pack dirs arrive realpath'd, so the root is compared in the same form. */
function isInside(dir: string, root: string | null): boolean {
  if (root === null) return false;
  return dir === root || dir.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Whether dir sits inside the shared checkout, compared by realpath on both sides so a symlinked path still matches. */
export function insideCheckout(dir: string, root: string | null): boolean {
  return isInside(realRoot(dir) ?? dir, realRoot(root));
}

/** Claude Code installs an in-tree plugin from its git-subdir source's ref, never the checkout's working tree. */
const IN_TREE_REF = "main";

async function readInTreeVersion(deps: SyncDeps, root: string, dir: string): Promise<string> {
  const rel = relative(root, dir).split(sep).join("/");
  const spec = `${IN_TREE_REF}:${rel === "" ? "" : rel + "/"}.claude-plugin/plugin.json`;
  const res = await deps.run("git", ["show", spec], { cwd: root });
  if (res.code !== 0) throw new Error(`git show ${spec} failed in ${root}: ${res.stderr.trim()}`);
  const manifest = JSON.parse(res.stdout) as { version?: string };
  if (typeof manifest.version !== "string") throw new Error(`${spec} has no version`);
  return manifest.version;
}

async function inTreeBranchNote(deps: SyncDeps, root: string): Promise<string> {
  const res = await deps.run("git", ["branch", "--show-current"], { cwd: root });
  if (res.code !== 0) return `; rt could not read the shared checkout's branch (${res.stderr.trim()}), and the plugin installs from ${IN_TREE_REF}`;
  const branch = res.stdout.trim();
  if (branch === IN_TREE_REF) return "";
  const where = branch === "" ? "is detached" : `is on ${branch}`;
  return `; the shared checkout at ${root} ${where}, not ${IN_TREE_REF}, and the plugin installs from ${IN_TREE_REF}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function guardSummary(engineInTree: boolean, packInTree: boolean, engineCache: string | null, pendingCount: number): string {
  const base = guardBase(engineInTree, packInTree, engineCache);
  return pendingCount > 0 ? `${base}, apart from ${plural(pendingCount, "pack file")} waiting to commit` : base;
}

function guardBase(engineInTree: boolean, packInTree: boolean, engineCache: string | null): string {
  if (engineCache !== null) {
    const packPart = packInTree ? "the pack is in the shared checkout, so its git checks are skipped" : "pack checkout clean on main";
    return `${packPart}; the engine is Claude Code's installed cache at ${engineCache}, which git never touches`;
  }
  if (engineInTree && packInTree) return "the engine and the pack are in the shared checkout, so git checks are skipped";
  if (engineInTree) return "pack checkout clean on main; the engine is in the shared checkout, so its git checks are skipped";
  if (packInTree) return "engine checkout clean on main; the pack is in the shared checkout, so its git checks are skipped";
  return "engine and pack checkouts clean on main";
}

function hashPending<T extends PendingFile>(deps: SyncDeps, dir: string, files: T[]): Promise<(T & { hash: string | null })[]> {
  return withHashes(dir, files, async (paths) => {
    const res = await deps.run("git", ["hash-object", "--", ...paths], { cwd: dir });
    if (res.code !== 0) throw new Error(`git hash-object failed in ${dir}: ${res.stderr.trim()}`);
    return res.stdout;
  });
}

/** The signature over files already hashed, worked out the way `rt skills changes` works it out. */
async function signatureOf(deps: SyncDeps, dir: string, hashed: HashedFile[]): Promise<string> {
  const side = await packSideChanges(dir, async (rel) => {
    const res = await deps.run("git", ["show", `HEAD:./${rel}`], { cwd: dir });
    return res.code === 0 ? res.stdout : null;
  });
  return pendingSignature({ files: hashed, ...side });
}

async function signPending(deps: SyncDeps, dir: string, files: PendingFile[]): Promise<string> {
  return signatureOf(deps, dir, await hashPending(deps, dir, files));
}

/** Every pending file in the pack's repo, spelled from the pack the way the guard spells it. */
async function readRepoPending(deps: SyncDeps, dir: string, prefix: string): Promise<PorcelainEntry[]> {
  const status = await deps.run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: dir });
  if (status.code !== 0) throw new Error(`git status failed in ${dir}: ${status.stderr.trim()}`);
  return packRelative(parsePorcelainEntries(status.stdout), prefix);
}

function sameEntry(a: HashedFile, b: HashedFile): boolean {
  return a.path === b.path && (a.from ?? null) === (b.from ?? null) && a.status === b.status && a.hash === b.hash;
}

const MANIFEST_REL = ".claude-plugin/plugin.json";

const literal = (path: string): string => `:(literal)${path}`;

/** git add refuses an ignored path named outright. */
async function ignoredUntracked(deps: SyncDeps, dir: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const res = await deps.run("git", ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...paths.map(literal)], { cwd: dir });
  if (res.code !== 0) throw new Error(`git ls-files failed in ${dir}: ${res.stderr.trim()}`);
  return new Set(res.stdout.split("\0").filter(Boolean));
}

const ZERO_ID = /^0+$/;

/**
 * Every path the index holds a change for, spelled from the pack, with the
 * blob id the index now has there (null where the index drops the path, a
 * rename's source included). `--no-relative` keeps a staged file outside the
 * pack in the list even when diff.relative is set.
 */
async function stagedBlobs(deps: SyncDeps, dir: string, prefix: string): Promise<Map<string, string | null>> {
  const res = await deps.run("git", ["diff", "--cached", "--raw", "-z", "--no-relative", "--no-abbrev"], { cwd: dir });
  if (res.code !== 0) throw new Error(`git diff --cached failed in ${dir}: ${res.stderr.trim()}`);
  const fields = res.stdout.split("\0");
  const rel = (p: string) => (prefix === "" ? p : posix.relative(prefix, p));
  const blobs = new Map<string, string | null>();
  for (let i = 0; i < fields.length; ) {
    const meta = fields[i++] ?? "";
    if (!meta.startsWith(":")) continue;
    const [, , , dstId = "", status = ""] = meta.slice(1).split(" ");
    const now = ZERO_ID.test(dstId) ? null : dstId;
    if (status.startsWith("R")) {
      blobs.set(rel(fields[i++]!), null);
      blobs.set(rel(fields[i++]!), now);
    } else if (status.startsWith("C")) {
      i++;
      blobs.set(rel(fields[i++]!), now);
    } else blobs.set(rel(fields[i++]!), now);
  }
  return blobs;
}

/**
 * The staged paths a commit made now would carry without anyone having seen
 * them: a path rt never staged, or one whose staged content is not what rt
 * recorded when it staged it (null: rt staged it gone).
 */
async function unseenStaged(deps: SyncDeps, dir: string, prefix: string, expected: Map<string, string | null>): Promise<string[]> {
  return [...(await stagedBlobs(deps, dir, prefix))].filter(([path, blob]) => !expected.has(path) || expected.get(path) !== blob).map(([path]) => path);
}

/** What the index must hold for each staged entry: its content id at its path, and nothing at a rename's source. */
function expectedBlobs(files: HashedFile[]): Map<string, string | null> {
  const expected = new Map<string, string | null>();
  for (const f of files) {
    if (f.from !== undefined) expected.set(f.from, null);
    expected.set(f.path, f.hash);
  }
  return expected;
}

/** `sha` is null when rt could not tell which commit git made; `short` is what git's own summary line printed, if anything. */
type CommitId = { sha: string | null; short: string | null };

/**
 * The commit `git commit` just made, from its own "[main 1a2b3c4] ..." line:
 * reading HEAD afterwards could name a commit another process made on top.
 */
async function madeCommit(deps: SyncDeps, dir: string, stdout: string): Promise<CommitId> {
  const short = /^\[[^\]]* ([0-9a-f]{7,})\]/m.exec(stdout)?.[1] ?? null;
  if (short === null) return { sha: null, short };
  const full = await deps.run("git", ["rev-parse", "--verify", `${short}^{commit}`], { cwd: dir });
  const sha = full.code === 0 ? full.stdout.trim() : "";
  // A ref named like the short sha resolves ahead of the object itself.
  return { sha: sha.startsWith(short) ? sha : null, short };
}

function shownPath(f: PendingFile): string {
  return f.from === undefined ? f.path : `${f.from} -> ${f.path}`;
}

/** Every pending file that touches the pack, pack-relative, read the way `rt skills changes` reads them. */
async function readPackDirPending(deps: SyncDeps, dir: string): Promise<PendingFile[]> {
  const status = await deps.run("git", ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"], { cwd: dir });
  if (status.code !== 0) throw new Error(`git status failed in ${dir}: ${status.stderr.trim()}`);
  const prefix = await deps.run("git", ["rev-parse", "--show-prefix"], { cwd: dir });
  if (prefix.code !== 0) throw new Error(`git rev-parse --show-prefix failed in ${dir}: ${prefix.stderr.trim()}`);
  return packRelative(parsePorcelain(status.stdout), prefix.stdout.trim()).filter(touchesPack);
}

function changedSinceShown(pack: string): Outcome {
  return refused(`The ${pack} pack changed since its pending changes were shown, so rt synced nothing. Look over the changes again, then sync`);
}

async function listInstalled(deps: SyncDeps): Promise<PluginListEntry[]> {
  const res = await deps.run(deps.claudeBin!, ["plugin", "list", "--json"]);
  if (res.code !== 0) throw new Error(`Listing Claude Code's plugins failed: ${res.stderr.trim()}`);
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

export async function syncPack(pack: PackInfo, engine: SyncEngine, deps: SyncDeps, opts: SyncOptions = {}): Promise<SyncReport> {
  const mayWritePack = deps.mayCompile(pack.name);
  const NOT_YOURS = "This pack is out of date, but only its team's owners recompile it";
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
  let pending: PorcelainEntry[] = [];
  let pendingHashed: HashedFile[] = [];
  let packPrefix: string | null = null;
  let published = false;
  let staged: HashedFile[] = [];
  let compiled: { written: string[]; removed: string[] } = { written: [], removed: [] };
  let builtBlobs = new Map<string, string | null>();
  /** rt's own commits this run, oldest first. */
  const made: (CommitId & { subject: string })[] = [];

  /** Where the pack sits in its repo, read once: git diff and status print repo-root paths. */
  const prefixOfPack = async (): Promise<string> => {
    if (packPrefix !== null) return packPrefix;
    const res = await deps.run("git", ["rev-parse", "--show-prefix"], { cwd: pack.dir });
    if (res.code !== 0) throw new Error(`git rev-parse --show-prefix failed in ${pack.dir}: ${res.stderr.trim()}`);
    packPrefix = res.stdout.trim();
    return packPrefix;
  };

  /** Only ever names the directory in a refusal that must still reach abandon, so a failed read names the pack instead. */
  const repoRootOf = async (): Promise<string> => {
    const res = await deps.run("git", ["rev-parse", "--show-toplevel"], { cwd: pack.dir });
    return res.code === 0 ? res.stdout.trim() : pack.dir;
  };

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
        `Claude Code is not on your PATH or at ${CLAUDE_BIN_FALLBACKS.join(", ")}. Install it, then run this again`,
      );
    }
    if (!pack.marketplace) {
      return refused(`The ${pack.name} pack was not installed from a directory marketplace, so rt has nothing to sync it from`);
    }
    if (!engine.marketplace) {
      return refused(`The ${engine.name} engine was not installed from a marketplace. Install it from one, then run this again`);
    }
    for (const rel of [".worktrees", join(".claude", "worktrees")]) {
      const dir = join(pack.dir, rel);
      if (existsSync(dir)) {
        return refused(`There is a worktrees folder at ${dir}, and an update would copy it into the plugin. Remove it, then run this again`);
      }
    }

    if (engineGit) {
      const engineStatus = await deps.run("git", ["status", "--porcelain"], { cwd: engine.dir });
      if (engineStatus.code !== 0) return failed(`git status failed in ${engine.dir}: ${engineStatus.stderr.trim()}`);
      if (engineStatus.stdout.trim() !== "") {
        return refused(`The engine checkout at ${engine.dir} has uncommitted changes (${engineStatus.stdout.trim()}). Commit or stash them, then run this again`);
      }
    }
    if (packGit) {
      const fullStatus = opts.commitPending || opts.expect !== undefined;
      const statusArgs = fullStatus ? ["status", "--porcelain=v1", "--untracked-files=all"] : ["status", "--porcelain"];
      const packStatus = await deps.run("git", statusArgs, { cwd: pack.dir });
      if (packStatus.code !== 0) return failed(`git status failed in ${pack.dir}: ${packStatus.stderr.trim()}`);
      if (packStatus.stdout.trim() !== "") {
        if (!mayWritePack) return refused(`This pack has changes, but only its team's owners can commit them. Undo them with rt skills discard --pack ${pack.name}`);
        if (!opts.commitPending) return refused(`The pack checkout at ${pack.dir} has uncommitted changes (${packStatus.stdout.trim()}). Commit or stash them, then run this again`);
        // The status covers the whole repo, so a dirty file beside a pack
        // that sits in a subdirectory still refuses rather than riding along
        // in the commit.
        const prefix = await deps.run("git", ["rev-parse", "--show-prefix"], { cwd: pack.dir });
        if (prefix.code !== 0) return failed(`git rev-parse --show-prefix failed in ${pack.dir}: ${prefix.stderr.trim()}`);
        packPrefix = prefix.stdout.trim();
        pending = packRelative(parsePorcelainEntries(packStatus.stdout), packPrefix);
        const outside = pending.flatMap(outOfScopeSides);
        if (outside.length > 0) {
          return refused(`The pack checkout at ${pack.dir} has changes outside the pack: ${outside.join(", ")}. Commit or stash those, then run this again`);
        }
      }
      // Hashed and signed from this same read, so what passes the check is
      // what commit-pending compares the pack against after the pull.
      if (fullStatus) {
        pendingHashed = await hashPending(deps, pack.dir, pending);
        if (opts.expect !== undefined && (await signatureOf(deps, pack.dir, pendingHashed)) !== opts.expect) return changedSinceShown(pack.name);
      }
    } else if ((opts.commitPending || opts.expect !== undefined) && packInTree) {
      const inPackDir = await readPackDirPending(deps, pack.dir);
      if (opts.commitPending && inPackDir.length > 0) {
        return refused(`The ${pack.name} pack is in the shared checkout at ${pack.dir} and has changes that are not synced. rt never commits there: commit them in a pull request to the monorepo`);
      }
      if (opts.expect !== undefined && (await signPending(deps, pack.dir, inPackDir.filter(fullyInScope))) !== opts.expect) return changedSinceShown(pack.name);
    } else if (opts.expect !== undefined) {
      const inPackDir = await readPackDirPending(deps, pack.dir);
      if ((await signPending(deps, pack.dir, inPackDir.filter(fullyInScope))) !== opts.expect) return changedSinceShown(pack.name);
    }

    if (engineGit) {
      const engineBranchRes = await deps.run("git", ["branch", "--show-current"], { cwd: engine.dir });
      if (engineBranchRes.code !== 0) return failed(`git branch --show-current failed in ${engine.dir}: ${engineBranchRes.stderr.trim()}`);
      const engineBranch = engineBranchRes.stdout.trim();
      if (engineBranch !== "main") {
        return refused(`The engine checkout is on ${engineBranch}, not main. Switch it to main, then run this again`);
      }
    }
    if (packGit) {
      const packBranchRes = await deps.run("git", ["branch", "--show-current"], { cwd: pack.dir });
      if (packBranchRes.code !== 0) return failed(`git branch --show-current failed in ${pack.dir}: ${packBranchRes.stderr.trim()}`);
      const packBranch = packBranchRes.stdout.trim();
      if (packBranch === "") {
        return refused("The pack checkout has no branch checked out. Switch it to a branch, then run this again");
      }
      if (packBranch !== "main" && !isInside(realRoot(pack.dir) ?? pack.dir, realRoot(deps.orgsRoot ?? null))) {
        return refused(`The pack checkout is on ${packBranch}, not main. Switch it to main, then run this again`);
      }
    }

    if (inTreeRoot !== null && (engineInTree || packInTree)) {
      branchNote = await inTreeBranchNote(deps, inTreeRoot);
      if (branchNote !== "") warnings.push(sentenceCase(branchNote.slice(2)));
    }

    const list = await listInstalled(deps);
    installedEngineBefore = engineCached ? chosenEntryVersion(list, pluginId(engine), engine.scope) : installedVersionFor(list, pluginId(engine));
    installedPackBefore = installedVersionFor(list, pluginId(pack));

    return ran(guardSummary(engineInTree, packInTree, engineCached ? engine.dir : null, pending.length));
  });
  steps.push({ name: "guards", ...guards });
  if (stops(guards)) return finish();

  const pullEngine = sameCheckout
    ? skipped("The engine and the pack share a checkout, so it is pulled once, with the pack")
    : await tryStep(async () => {
        if (engineCached) {
          engineSourceVersion = readManifestVersion(engine.dir);
          return skipped(`The engine is Claude Code's installed cache from the ${engine.marketplace} marketplace, so rt never pulls it; the next step refreshes it`);
        }
        if (engineInTree) {
          engineSourceVersion = await readInTreeVersion(deps, inTreeRoot!, engine.dir);
          return skipped(`The engine is in the shared checkout at ${engine.dir}, which rt keeps current when it updates this Mac${branchNote}`);
        }
        const res = await deps.run("git", ["pull", "--ff-only"], { cwd: engine.dir });
        if (res.code !== 0) return refused(`Pulling ${engine.dir} failed: ${res.stderr.trim()}. Sort it out by hand, then run this again`);
        engineSourceVersion = readManifestVersion(engine.dir);
        return ran(res.stdout.trim() || "up to date");
      });
  steps.push({ name: "pull-engine", ...pullEngine });
  if (stops(pullEngine)) return finish();

  const pullPack = await tryStep(async () => {
    if (packInTree) {
      packSourceVersion = await readInTreeVersion(deps, inTreeRoot!, pack.dir);
      if (sameCheckout) engineSourceVersion = packSourceVersion;
      return skipped(`The pack is in the shared checkout at ${pack.dir}, which rt keeps current when it updates this Mac${branchNote}`);
    }
    const pullFailed = (stderr: string) => refused(`Pulling ${pack.dir} failed: ${stderr.trim()}. Sort it out by hand, then run this again`);
    const clone = orgCloneTop(pack.dir);
    let res: RunResult;
    if (clone !== null) {
      const fetched = await deps.run("git", ["fetch"], { cwd: clone });
      if (fetched.code !== 0) return pullFailed(fetched.stderr);
      const branch = await deps.run("git", ["branch", "--show-current"], { cwd: clone });
      if (branch.code !== 0) return pullFailed(branch.stderr);
      const tip = `refs/remotes/origin/${branch.stdout.trim()}`;
      const shown = await deps.run("git", ["show", markerAtRef(tip)], { cwd: clone });
      let hold: { layout: number } | null;
      try {
        hold = layoutAbove(shown);
      } catch (e) {
        return pullFailed(e instanceof Error ? e.message : String(e));
      }
      if (hold) return { ...refused(updateSentence(hold.layout)), [LAYOUT_HOLD]: true };
      // A merge of the gated ref, not a pull: a pull fetches again and could land a newer tip the gate never read.
      res = await deps.run("git", ["merge", "--ff-only", tip], { cwd: clone });
    } else {
      res = await deps.run("git", ["pull", "--ff-only"], { cwd: pack.dir });
    }
    if (res.code !== 0) return pullFailed(res.stderr);
    packSourceVersion = readManifestVersion(pack.dir);
    if (sameCheckout) engineSourceVersion = packSourceVersion;
    return ran(res.stdout.trim() || "up to date");
  });
  steps.push({ name: "pull-pack", ...pullPack });
  if (stops(pullPack)) return finish();

  // Staging only, after the pull: the commit waits for commit-push, so a stop
  // anywhere before it leaves the edits uncommitted, where changes and discard
  // still see them, and never strands an unpushed local commit.
  if (opts.commitPending) {
    const commitPending = await tryStep(async () => {
      if (pending.length === 0) return skipped("nothing waiting to commit");
      // Read again because the pull can settle a pending entry (a deletion
      // upstream made too), which git add would then fail to match. An entry
      // may only drop out: one that is new or reads differently now was never
      // listed to whoever asked for this.
      const now = await hashPending(deps, pack.dir, await readRepoPending(deps, pack.dir, await prefixOfPack()));
      const moved = now.filter((e) => !pendingHashed.some((was) => sameEntry(was, e)));
      if (moved.length > 0) {
        return refused(`The ${pack.name} pack changed while rt was syncing it (${moved.map(shownPath).join(", ")}), so rt staged and committed nothing. Look over the changes again, then sync`);
      }
      if (now.length === 0) return skipped("the pull already holds every pending change");
      const toStage = needsStaging(now).filter((f) => f.status !== "??" || pathExists(join(pack.dir, f.path)));
      if (toStage.length > 0) {
        const add = await deps.run("git", ["add", "--", ...toStage.map((f) => literal(f.path))], { cwd: pack.dir });
        if (add.code !== 0) return failed(`git add failed: ${add.stderr.trim()}`);
      }
      published = true;
      staged = now;
      return ran(`staged ${plural(now.length, "file")}`);
    });
    steps.push({ name: "commit-pending", ...commitPending });
    if (stops(commitPending)) return finish();
  }

  /**
   * A cached engine older than the one the pack was last compiled against
   * would compile, recheck clean and push a downgrade, so the cache is brought
   * current through Claude Code (which owns it) before check ever runs, and a
   * refresh that fails stops the chain here. The update installs into a new
   * version folder, so the version is re-read from a fresh listing.
   */
  async function refreshCachedEngine(): Promise<Outcome> {
    const id = pluginId(engine);
    const stopped = "rt stopped so the pack is not compiled against an old engine";
    const market = await deps.run(deps.claudeBin!, ["plugin", "marketplace", "update", engine.marketplace!]);
    if (market.code !== 0) {
      return refused(`Updating the ${engine.marketplace} marketplace failed: ${market.stderr.trim()}. ${stopped}`);
    }
    const scopeArgs = engine.scope ? ["--scope", engine.scope] : [];
    const update = await deps.run(deps.claudeBin!, ["plugin", "update", id, ...scopeArgs, "-y"]);
    if (update.code !== 0) return refused(`Updating ${id} failed: ${update.stderr.trim()}. ${stopped}`);
    installedEngineAfter = chosenEntryVersion(await listInstalled(deps), id, engine.scope);
    if (installedEngineAfter === null) return refused(`${id} is not installed after its update. ${stopped}`);
    engineSourceVersion = installedEngineAfter;
    if (installedEngineAfter === installedEngineBefore) return skipped(`engine already current at ${installedEngineAfter} in the ${engine.marketplace} marketplace`);
    return ran(`refreshed ${id} from the ${engine.marketplace} marketplace: ${installedEngineBefore ?? "unknown"} -> ${installedEngineAfter}`);
  }

  const updateEngine = await tryStep(async () => {
    if (sameCheckout) return skipped("The engine and the pack share a checkout, so it is updated once, with the pack");
    if (engineCached) return refreshCachedEngine();
    if (installedEngineBefore === engineSourceVersion) return skipped(`engine already at ${engineSourceVersion}`);
    const id = pluginId(engine);
    const res = await deps.run(deps.claudeBin!, ["plugin", "update", id]);
    if (res.code !== 0) return failed(`Updating ${id} failed: ${res.stderr.trim()}`);
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
      return refused(`This pack is strict, and mcp lint found ${hitCount(result.lintHits)}. Fix them before syncing`);
    }
    const lintNote = result.lintHits > 0 ? `; mcp lint found ${hitCount(result.lintHits)}, advisory for this pack` : "";
    return ran(`${drift ? "the compiled skills are out of date" : "the compiled skills are current"}${lintNote}`);
  });
  steps.push({ name: "check", ...checkStep });
  if (stops(checkStep)) return finish();

  // A published commit can leave check with no drift to report, yet the
  // installed cache is keyed by version, so it must still bump, push and update.
  const rebuild = drift || published;
  const noOp = !rebuild && installedPackBefore === packSourceVersion;
  if (noOp) return finish();
  const mine = !rebuild || mayWritePack;

  const bump = await tryStep(async () => {
    if (!mine) return skipped(NOT_YOURS);
    if (!rebuild) return skipped("nothing changed, so the version stays");
    if (packInTree) {
      return refused(
        `This pack is in the shared checkout at ${pack.dir}, and its compiled skills are out of date. rt never bumps, compiles or commits there: recompile it and bump its version in a pull request to the monorepo`,
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
    if (!mine) return skipped(NOT_YOURS);
    if (!rebuild) return skipped("nothing changed, so there is nothing to recompile");
    const result = await deps.compilePack(pack.name);
    if (!result.ok) {
      // A refused compile must leave the checkout as the guard found it
      // (clean, or holding only the pending edits commit-pending staged) so a
      // re-run does not strand a bare-file bump the guard cannot see committed
      // anywhere -- revert the write-back, no git.
      if (bumpBefore) {
        writeManifestVersion(pack.dir, bumpBefore);
        packSourceVersion = bumpBefore;
      }
      const leftAs = published ? "your pack edits are still staged, not committed" : "the checkout stays clean";
      return refused(`${result.errors.join("; ")}. rt put the version back to ${bumpBefore}, so ${leftAs}`);
    }
    compiled = { written: result.written, removed: result.removed };
    const built = await hashPending(deps, pack.dir, [MANIFEST_REL, ...compiled.written].map((path) => ({ path, status: "" })));
    builtBlobs = new Map([...built.map((f): [string, string | null] => [f.path, f.hash]), ...compiled.removed.map((path): [string, null] => [path, null])]);
    return ran("compiled clean");
  });
  steps.push({ name: "compile", ...compile });
  if (stops(compile)) return finish();

  const recheck = await tryStep(async () => {
    if (!mine) return skipped(NOT_YOURS);
    if (!rebuild) return skipped("nothing changed, so there is nothing to check again");
    const result = await deps.checkPack(pack.name);
    if (result.drift) {
      return refused(
        `The compiled skills are still out of date after a recompile. The checkout keeps the uncommitted version bump (${bumpBefore} -> ${bumpAfter}) and the compiled output; finish by hand with the mattstack:editing-skills skill, from this working tree`,
      );
    }
    return ran("now current");
  });
  steps.push({ name: "recheck", ...recheck });
  if (stops(recheck)) return finish();

  const pendingSubject = `skills: ${pack.name} pending changes`;
  const versionSubject = `skills sync: ${pack.name} v${bumpAfter}`;

  /**
   * Moves HEAD back past rt's own commits in one compare-and-move, so it only
   * happens while HEAD is still exactly rt's newest commit and that commit
   * sits directly on rt's oldest; the index is left alone. Null once undone,
   * else why the commits stay.
   */
  async function undoCommits(): Promise<string | null> {
    if (made.length === 0) return null;
    const newest = made.at(-1)!.sha;
    const base = made[0]!.sha;
    const it = made.length === 1 ? "it" : "them";
    if (newest === null || base === null) return `rt left ${it} in place`;
    if (made.length > 1) {
      // The move names the oldest commit's parent as the target, which would
      // rewind a commit someone else made between rt's two.
      const parent = await deps.run("git", ["rev-parse", "--verify", `${newest}^1`], { cwd: pack.dir });
      if (parent.code !== 0) return `rt could not read what its newest commit sits on (${parent.stderr.trim()}), so it left them in place`;
      if (parent.stdout.trim() !== base) return "a commit rt did not make sits between them, so rt left them in place";
    }
    const undone = made.map((c) => (c.subject === versionSubject ? `v${bumpAfter}` : "pending changes")).join(" and ");
    const move = await deps.run("git", ["update-ref", "-m", `rt skills sync: undo ${pack.name} ${undone}`, "HEAD", `${base}~1`, newest], { cwd: pack.dir });
    if (move.code === 0) {
      made.length = 0;
      return null;
    }
    const head = await deps.run("git", ["rev-parse", "HEAD"], { cwd: pack.dir });
    if (head.code !== 0) return `rt could not read HEAD (${head.stderr.trim()}), so it left ${it} in place`;
    if (head.stdout.trim() !== newest) return `HEAD has moved past ${it}, so rt left ${it} in place`;
    return `rt could not undo ${it} (${move.stderr.trim()})`;
  }

  const keptCommits = (why: string, pushed: boolean): string => {
    const names = made.map((c) => `${c.sha?.slice(0, 12) ?? c.short ?? ""} (${c.subject})`.trimStart());
    const one = names.length === 1;
    const hold = published ? "your pack edits stay in rt's" : "the version bump and the rebuilt skills are in rt's";
    const unpushed = pushed ? "" : `, which ${one ? "is" : "are"} not pushed`;
    return `${hold} ${one ? "commit" : "commits"} ${names.join(" and ")}${unpushed}; ${why}`;
  };

  /**
   * Leaves only the person's own work behind once a commit or push will not
   * happen: rt undoes its own commits, takes back its version staging, puts
   * the manifest and every file compile wrote or removed back the way the
   * pending tree holds them (HEAD plus the person's staged edits), and
   * deletes what compile added. A path in `unseen` is someone else's now, so
   * it is left as found. `versionStaged` is what rt's own staging landed in
   * the index, so a failed add passes nothing.
   */
  async function abandon(lead: string, unseen: string[], versionStaged: string[], outcome: (detail: string) => Outcome, next: string, pushed = false): Promise<Outcome> {
    const skip = new Set(unseen);
    const pendingCommit = made[0]?.subject === pendingSubject ? made[0].sha : null;
    const toUndo = made.length;
    const kept = await undoCommits();
    const pushNote = pushed ? "The push may have reached the remote, and the next sync's pull will show it" : "rt pushed nothing";
    const rtThen = pushed ? "; rt " : " and ";
    if (kept !== null && made.some((c) => c.subject === versionSubject)) {
      const built = published ? "; the version bump and the rebuilt skills are in them" : "";
      return outcome(`${ended(lead)} ${pushNote}${pushed ? "; " : ", and "}${keptCommits(kept, pushed)}${built}. ${next}`);
    }
    const commitNote = kept === null ? "" : `; ${keptCommits(kept, pushed)}`;
    const undone = toUndo > 0 && kept === null ? `undid its ${toUndo === 1 ? "commit" : "commits"}, but ` : "";

    const ours = versionStaged.filter((p) => !skip.has(p));
    if (ours.length > 0) {
      const source = pendingCommit ?? "HEAD";
      const reset = await deps.run("git", ["reset", "-q", source, "--", ...ours.map(literal)], { cwd: pack.dir });
      if (reset.code !== 0) {
        const edits = published && kept === null ? ", and your pack edits are still staged, not committed" : "";
        return outcome(
          `${ended(lead)} ${pushNote}${rtThen}${undone}could not take its own version staging back out of the index (${reset.stderr.trim()}), so that staging is still in the index: ${ours.join(", ")}; the worktree keeps the version bump (${bumpBefore} -> ${bumpAfter}) and the rebuilt skills${edits}${commitNote}. ${next}`,
        );
      }
    }

    const touched = [MANIFEST_REL, ...compiled.written, ...compiled.removed];
    const leftAsFound = touched.filter((p) => skip.has(p));
    const ownTouched = touched.filter((p) => !skip.has(p));
    try {
      const listed = ownTouched.length === 0 ? { code: 0, stdout: "", stderr: "" } : await deps.run("git", ["ls-files", "-z", "--", ...ownTouched.map(literal)], { cwd: pack.dir });
      if (listed.code !== 0) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
      const indexed = new Set(listed.stdout.split("\0").filter(Boolean));
      if (indexed.size > 0) {
        const restore = await deps.run("git", ["restore", "--worktree", "--", ...[...indexed].map(literal)], { cwd: pack.dir });
        if (restore.code !== 0) throw new Error(`git restore failed: ${restore.stderr.trim()}`);
      }
      const added = compiled.written.filter((p) => !skip.has(p) && !indexed.has(p));
      for (const path of added) rmSync(join(pack.dir, path), { force: true });
      pruneEmptiedDirs(pack.dir, added);
      if (!skip.has(MANIFEST_REL)) packSourceVersion = bumpBefore ?? packSourceVersion;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return outcome(`${ended(lead)} ${pushNote}${rtThen}${undone}could not put the build back (${why}): the checkout keeps the version bump (${bumpBefore} -> ${bumpAfter}) and the compiled output${commitNote}. ${next}`);
    }

    const which = leftAsFound.length === 1 ? "it" : "them";
    const putBack =
      leftAsFound.length === 0
        ? "put the version and the rebuilt skills back"
        : ownTouched.length > 0
          ? `put back what it built, except ${leftAsFound.join(", ")}, which it left as it found ${which}`
          : `left what it built as it found it (${leftAsFound.join(", ")})`;
    const stillBumped = skip.has(MANIFEST_REL) && bumpAfter !== null && manifestVersionOrNull(pack.dir) === bumpAfter ? `; ${MANIFEST_REL} still carries rt's version bump (${bumpBefore} -> ${bumpAfter})` : "";
    const left = kept !== null ? keptCommits(kept, pushed) : published ? "your pack edits are still staged, not committed" : "nothing is committed";
    return outcome(`${ended(lead)} ${pushNote}${rtThen}${putBack}${stillBumped}, so ${left}. ${next}`);
  }

  const unstage = "Unstage those, then run this again";
  const unseenLead = (unseen: string[]) => `The index in ${pack.dir} holds changes rt did not stage: ${unseen.join(", ")}`;

  const commitPush = await tryStep(async () => {
    if (!mine) return skipped(NOT_YOURS);
    if (!rebuild) return skipped("nothing changed, so there is nothing to commit");
    const stop = (what: string, versionStaged: string[], pushed = false): Promise<Outcome> => abandon(what, [], versionStaged, failed, "Run this again once that is sorted", pushed);
    /** The build is already in the worktree, so a read that throws must still go through abandon. */
    const readOrStop = async <T>(versionStaged: string[], read: () => Promise<T>): Promise<T | Outcome> => {
      try {
        return await read();
      } catch (e) {
        return stop(e instanceof Error ? e.message : String(e), versionStaged);
      }
    };
    /** Refuses when the commit's tree is not the index snapshot taken just before it: whatever was staged meanwhile rode in. */
    const rodeIn = async (sha: string, snapshot: string, what: string, versionStaged: string[]): Promise<Outcome | null> => {
      const tree = await deps.run("git", ["rev-parse", `${sha}^{tree}`], { cwd: pack.dir });
      if (tree.code === 0 && tree.stdout.trim() === snapshot) return null;
      const diff = await deps.run("git", ["diff", "--name-only", "-z", "--no-renames", "--no-relative", snapshot, `${sha}^{tree}`], { cwd: pack.dir });
      const paths = diff.stdout.split("\0").filter(Boolean);
      const prefix = await prefixOfPack();
      const where = prefix === "" ? pack.dir : await repoRootOf();
      const fromPack = paths.map((p) => (prefix === "" ? p : posix.relative(prefix, p)));
      return abandon(`Something was staged in ${where} while rt committed ${what}: ${paths.join(", ") || "rt could not tell what"}`, fromPack, versionStaged, refused, unstage);
    };
    // git commit takes the whole index, so each commit first checks the
    // index holds exactly what rt staged for it, content included, and then
    // that the commit holds exactly the index it checked.
    if (published) {
      const snapshot = await deps.run("git", ["write-tree"], { cwd: pack.dir });
      if (snapshot.code !== 0) return stop(`git write-tree failed: ${snapshot.stderr.trim()}`, []);
      const unseen = await readOrStop([], async () => unseenStaged(deps, pack.dir, await prefixOfPack(), expectedBlobs(staged)));
      if (!Array.isArray(unseen)) return unseen;
      if (unseen.length > 0) return abandon(unseenLead(unseen), unseen, [], refused, unstage);
      const pendingCommit = await deps.run("git", ["commit", "-m", pendingSubject], { cwd: pack.dir });
      if (pendingCommit.code !== 0) return stop(`git commit failed: ${pendingCommit.stderr.trim()}`, []);
      const id = await madeCommit(deps, pack.dir, pendingCommit.stdout);
      made.push({ subject: pendingSubject, ...id });
      if (id.sha === null) return abandon("rt could not tell which commit git made for your pack edits", [], [], refused, "Look over the commit, then run this again");
      const rode = await rodeIn(id.sha, snapshot.stdout.trim(), "your pack edits", []);
      if (rode !== null) return rode;
    }
    // Only the files this run's compile wrote or removed, by literal name: a
    // file dropped into a compiled folder meanwhile stays out of the commit.
    const ignored = await readOrStop([], () => ignoredUntracked(deps, pack.dir, compiled.written));
    if (!(ignored instanceof Set)) return ignored;
    const addPaths = [MANIFEST_REL, ...compiled.written.filter((p) => !ignored.has(p))];
    const versionStaged = [...addPaths, ...compiled.removed];
    const add = await deps.run("git", ["add", "--", ...addPaths.map(literal)], { cwd: pack.dir });
    if (add.code !== 0) return stop(`git add failed: ${add.stderr.trim()}`, []);
    if (compiled.removed.length > 0) {
      const rm = await deps.run("git", ["rm", "--cached", "--ignore-unmatch", "--quiet", "--", ...compiled.removed.map(literal)], { cwd: pack.dir });
      if (rm.code !== 0) return stop(`git rm failed: ${rm.stderr.trim()}`, addPaths);
    }
    const snapshot = await deps.run("git", ["write-tree"], { cwd: pack.dir });
    if (snapshot.code !== 0) return stop(`git write-tree failed: ${snapshot.stderr.trim()}`, versionStaged);
    const unseen = await readOrStop(versionStaged, async () => unseenStaged(deps, pack.dir, await prefixOfPack(), new Map(versionStaged.map((p) => [p, builtBlobs.get(p) ?? null]))));
    if (!Array.isArray(unseen)) return unseen;
    if (unseen.length > 0) return abandon(unseenLead(unseen), unseen, versionStaged, refused, unstage);
    if (published) {
      // The version commit must sit directly on the pending commit, or the
      // undo could not take both back without rewinding what landed between.
      const head = await deps.run("git", ["rev-parse", "HEAD"], { cwd: pack.dir });
      if (head.code !== 0) return stop(`git rev-parse HEAD failed: ${head.stderr.trim()}`, versionStaged);
      if (head.stdout.trim() !== made[0]!.sha) {
        return abandon(`Something was committed in ${pack.dir} on top of rt's commit of your pack edits`, [], versionStaged, refused, "Look over the commits, then run this again");
      }
    }
    const commit = await deps.run("git", ["commit", "-m", versionSubject], { cwd: pack.dir });
    if (commit.code !== 0) return stop(`git commit failed: ${commit.stderr.trim()}`, versionStaged);
    const id = await madeCommit(deps, pack.dir, commit.stdout);
    made.push({ subject: versionSubject, ...id });
    if (id.sha === null) return abandon("rt could not tell which commit git made for the version bump", [], versionStaged, refused, "Look over the commit, then run this again");
    const rode = await rodeIn(id.sha, snapshot.stdout.trim(), "the version bump", versionStaged);
    if (rode !== null) return rode;
    const push = await deps.run("git", ["push"], { cwd: pack.dir });
    if (push.code !== 0) return stop(`git push failed: ${push.stderr.trim()}`, versionStaged, true);
    return ran(`committed and pushed v${bumpAfter}`);
  });
  steps.push({ name: "commit-push", ...commitPush });
  if (stops(commitPush)) return finish();

  // Reached only when rebuild is true, or the installed pack lags the source
  // (the noOp return above already exited the other case) -- an update is
  // due unless a member's drifted source already matches its installed copy.
  const notInstalled = `${pack.name} is not installed on this Mac`;
  const updatePack = await tryStep(async () => {
    if (installedPackBefore === null) return skipped(notInstalled);
    if (!mine && installedPackBefore === packSourceVersion) return skipped("the installed copy already matches the source");
    const id = pluginId(pack);
    const res = await deps.run(deps.claudeBin!, ["plugin", "update", id]);
    if (res.code !== 0) return failed(`Updating ${id} failed: ${res.stderr.trim()}`);
    return ran(`updated ${id}`);
  });
  steps.push({ name: "update-pack", ...updatePack });
  if (stops(updatePack)) return finish();

  const verifyInstalled = await tryStep(async () => {
    if (installedPackBefore === null) return skipped(notInstalled);
    const list = await listInstalled(deps);
    installedPackAfter = installedVersionFor(list, pluginId(pack));
    installedEngineAfter = installedVersionFor(list, pluginId(engine));
    if (installedPackAfter !== packSourceVersion) {
      return failed(`The installed copy is at ${installedPackAfter ?? "unknown"}, but the source is at ${packSourceVersion}`);
    }
    return ran(`the installed copy matches the source at ${packSourceVersion}`);
  });
  steps.push({ name: "verify-installed", ...verifyInstalled });
  if (stops(verifyInstalled)) return finish();

  const cswapSweep = await tryStep(async () => {
    if (!existsSync(deps.cswapSessionsDir)) return skipped(`no cswap sessions folder at ${deps.cswapSessionsDir}`);
    const target = join(deps.configDir, "plugins");
    let flagged = 0;
    for (const entry of readdirSync(deps.cswapSessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginsPath = join(deps.cswapSessionsDir, entry.name, "plugins");
      if (!pathExists(pluginsPath)) continue;
      if (!isAlignedSymlink(pluginsPath, target)) {
        flagged++;
        warnings.push(`The ${entry.name} cswap account's plugins folder (${pluginsPath}) does not point at ${target}`);
      }
    }
    return ran(flagged === 0 ? "every cswap account links the current plugins" : `${flagged} cswap ${flagged === 1 ? "account links" : "accounts link"} another plugins folder`);
  });
  steps.push({ name: "cswap-sweep", ...cswapSweep });

  return finish();
}

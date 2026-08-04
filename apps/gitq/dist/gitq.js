import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/cli/main.ts
import { parseArgs } from "node:util";

// src/cli/context.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
var exec = promisify(execFile);
async function createContext(startDir, args, flags) {
  const [{ stdout: top }, { stdout: gitDir }, common] = await Promise.all([
    exec("git", ["rev-parse", "--show-toplevel"], { cwd: startDir }),
    exec("git", ["rev-parse", "--absolute-git-dir"], { cwd: startDir }),
    exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: startDir })
  ]);
  return {
    repoRoot: top.trim(),
    gitDir: gitDir.trim(),
    commonDir: realpathSync(common.stdout.trim()),
    json: flags.json === true,
    args,
    flags
  };
}

// src/cli/output.ts
function emit(ctx, humanText, jsonValue) {
  if (ctx.json)
    console.log(JSON.stringify(jsonValue, null, 2));
  else
    console.log(humanText);
}
function fail(message) {
  console.error(`gitq: ${message}`);
  return 1;
}

// src/core/persistence.ts
import { join as join2 } from "node:path";
import { rename as rename2 } from "node:fs/promises";
import { realpathSync as realpathSync2, existsSync } from "node:fs";
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// src/core/config-paths.ts
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
var HOME_CONFIG_DIR = join(homedir(), ".config", "gitq");
var HOME_WORK_SLOT_ROOT = join(homedir(), ".cache", "gitq", "work");
var envConfigDir = process.env.GITQ_CONFIG_DIR;
var DEFAULT_CONFIG_DIR = envConfigDir ? resolve(envConfigDir) : HOME_CONFIG_DIR;
var _configDir = DEFAULT_CONFIG_DIR;
function repoHash(repoPath) {
  return createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}
function getStacksDir() {
  return join(_configDir, "stacks");
}
function getSettingsFilePath() {
  return join(_configDir, "settings.json");
}
function getOperationLogFilePath() {
  return join(_configDir, "operation-log.json");
}
function getWorkSlotRoot() {
  const configDir = resolve(_configDir);
  return configDir === resolve(HOME_CONFIG_DIR) ? HOME_WORK_SLOT_ROOT : join(configDir, "work");
}
var STACKS_DIR = join(DEFAULT_CONFIG_DIR, "stacks");
var SETTINGS_PATH = join(DEFAULT_CONFIG_DIR, "settings.json");
var REPOS_PATH = join(DEFAULT_CONFIG_DIR, "repos.json");
var OPERATION_LOG_PATH = join(DEFAULT_CONFIG_DIR, "operation-log.json");

// src/core/json-store.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return fallback;
    }
    throw err;
  }
}
async function writeJsonAtomic(filePath, data) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmp, filePath);
}

// src/core/lockfile.ts
import { mkdir as mkdir2, readFile as readFile2, unlink, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";
function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withFileLock(filePath, fn, opts = {}) {
  const lockPath = `${filePath}.lock`;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const retryMs = opts.retryMs ?? 25;
  const staleMs = opts.staleMs ?? 1e4;
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;
  const deadline = Date.now() + timeoutMs;
  await mkdir2(dirname2(filePath), { recursive: true });
  for (;; ) {
    try {
      await writeFile2(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { flag: "wx" });
      break;
    } catch {
      let broke = false;
      try {
        const holder = JSON.parse(await readFile2(lockPath, "utf-8"));
        const age = Date.now() - (holder.acquiredAt ?? 0);
        if (age > staleMs && typeof holder.pid === "number" && !isPidAlive(holder.pid)) {
          await unlink(lockPath).catch(() => {});
          broke = true;
        }
      } catch {}
      if (!broke) {
        if (Date.now() > deadline)
          throw new Error(`could not acquire lock ${lockPath}`);
        await sleep(retryMs);
      }
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}

// src/core/persistence.ts
var exec2 = promisify2(execFile2);
async function resolveRepoIdentity(repoPath) {
  try {
    const { stdout } = await exec2("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repoPath });
    return realpathSync2(stdout.trim());
  } catch {
    return repoPath;
  }
}
function getStorePath(identity) {
  return join2(getStacksDir(), `${repoHash(identity)}.json`);
}
function emptyStore(repoPath) {
  return { repoPath, remoteUrl: "", stacks: [] };
}
async function loadStore(repoPath) {
  const identity = await resolveRepoIdentity(repoPath);
  const identityFile = getStorePath(identity);
  const legacyFile = getStorePath(repoPath);
  let store = await readJson(identityFile, null);
  if (identity !== repoPath && existsSync(legacyFile)) {
    const legacy = await readJson(legacyFile, emptyStore(repoPath));
    if (store === null) {
      store = { ...legacy, commonDir: identity };
      await writeJsonAtomic(identityFile, store);
      console.error(`gitq: migrated stack store for ${repoPath} to repo identity ${identity}`);
    } else {
      const known = new Set(store.stacks.map((s) => s.stackName));
      const incoming = legacy.stacks.filter((s) => !known.has(s.stackName));
      const skipped = legacy.stacks.length - incoming.length;
      if (incoming.length > 0) {
        store = { ...store, stacks: [...store.stacks, ...incoming] };
        await writeJsonAtomic(identityFile, store);
      }
      console.error(`gitq: merged ${incoming.length} stack(s) from a legacy store at ${repoPath}` + (skipped > 0 ? ` (${skipped} skipped as duplicate names)` : ""));
    }
    await rename2(legacyFile, legacyFile + ".bak").catch(() => {});
  }
  if (store === null)
    store = emptyStore(repoPath);
  if (!store.commonDir && identity !== repoPath)
    store.commonDir = identity;
  for (const stack of store.stacks) {
    if (!stack.stackName) {
      stack.stackName = stack.id;
    }
  }
  return store;
}
async function updateStore(repoPath, mutate) {
  const identity = await resolveRepoIdentity(repoPath);
  const file = getStorePath(identity);
  return withFileLock(file, async () => {
    const current = await readJson(file, null) ?? emptyStore(repoPath);
    const next = mutate(current);
    const stamped = identity !== repoPath ? { ...next, commonDir: identity } : next;
    await writeJsonAtomic(file, stamped);
    return stamped;
  });
}

// src/cli/slots.ts
import { execFile as execFile4 } from "node:child_process";
import { promisify as promisify3 } from "node:util";

// src/core/worktrees.ts
import { basename, dirname as dirname3, join as join4 } from "node:path";

// src/core/git-shell.ts
import { execFile as execFile3 } from "node:child_process";
import { existsSync as existsSync2, readFileSync } from "node:fs";
import { join as join3 } from "node:path";
var _onCommand = null;
function setCommandHook(cb) {
  _onCommand = cb;
}
function git(args, cwd) {
  const hook = _onCommand;
  const start = hook ? performance.now() : 0;
  return new Promise((resolve2, reject) => {
    execFile3("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (hook)
          hook("git", args, cwd, 1, Math.round(performance.now() - start));
        const message = `git ${args.join(" ")} failed: ${stderr.trim() || err.message}`;
        reject(Object.assign(new Error(message), { stderr: stderr.trim() }));
        return;
      }
      if (hook)
        hook("git", args, cwd, 0, Math.round(performance.now() - start));
      resolve2({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}
function splitNulPaths(stdout) {
  return stdout ? stdout.split("\x00").filter(Boolean) : [];
}
function parseMergeTreeConflicts(output) {
  const conflicts = [];
  const reContent = /CONFLICT \(([^)]+)\): Merge conflict in (\S+)/g;
  const reOther = /CONFLICT \(([^)]+)\): (\S+)/g;
  let m;
  while ((m = reContent.exec(output)) !== null) {
    conflicts.push({ kind: m[1], file: m[2] });
  }
  while ((m = reOther.exec(output)) !== null) {
    const file = m[2];
    if (file === "Merge")
      continue;
    if (conflicts.some((c) => c.file === file))
      continue;
    conflicts.push({ kind: m[1], file });
  }
  return conflicts.length > 0 ? conflicts : [{ file: "unknown", kind: "conflict" }];
}
var AMBIGUOUS_OBJECT_ID = /short (?:object ID|SHA1) \S+ is ambiguous/i;
async function objectType(cwd, sha) {
  try {
    const { stdout } = await git(["cat-file", "-t", sha], cwd);
    return stdout;
  } catch {
    return null;
  }
}
var GitShell = {
  async getCurrentBranch(cwd) {
    const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    return stdout;
  },
  async getBranchHead(cwd, branch) {
    const { stdout } = await git(["rev-parse", branch], cwd);
    return stdout;
  },
  async resolveRef(cwd, ref) {
    try {
      const { stdout } = await git(["rev-parse", "--verify", `${ref}^{commit}`], cwd);
      return { kind: "resolved", sha: stdout };
    } catch (err) {
      const stderr = err?.stderr ?? "";
      if (!AMBIGUOUS_OBJECT_ID.test(stderr))
        return { kind: "unknown" };
      const candidates = await GitShell.disambiguate(cwd, ref);
      if (candidates.length < 2)
        return { kind: "unknown" };
      return { kind: "ambiguous", candidates };
    }
  },
  async disambiguate(cwd, prefix) {
    let matches;
    try {
      const { stdout } = await git(["rev-parse", `--disambiguate=${prefix}`], cwd);
      matches = stdout.split(`
`).filter(Boolean);
    } catch {
      return [];
    }
    const types = await Promise.all(matches.map((sha) => objectType(cwd, sha)));
    return matches.filter((_, i) => types[i] === "commit" || types[i] === "tag");
  },
  async getMergeBase(cwd, a, b) {
    const { stdout } = await git(["merge-base", a, b], cwd);
    return stdout;
  },
  async branchExists(cwd, branch) {
    try {
      await git(["rev-parse", "--verify", branch], cwd);
      return true;
    } catch {
      return false;
    }
  },
  async createBranch(cwd, name, from) {
    await git(["checkout", "-b", name, from], cwd);
  },
  async branchAt(cwd, name, from) {
    await git(["branch", name, from], cwd);
  },
  async checkoutBranch(cwd, branch) {
    await git(["checkout", branch], cwd);
  },
  async rebaseOnto(cwd, newBase, oldBase, branch) {
    await git(["rebase", "--onto", newBase, oldBase, branch], cwd);
  },
  async pushForceWithLease(cwd, branch, remote = "origin") {
    await git(["push", "--force-with-lease", remote, branch], cwd);
  },
  async worktreeList(cwd) {
    const { stdout } = await git(["worktree", "list", "--porcelain"], cwd);
    const out = [];
    let current = { branch: null };
    for (const line of stdout.split(`
`)) {
      if (line.startsWith("worktree ")) {
        current = { path: line.slice("worktree ".length), branch: null };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch refs/heads/")) {
        current.branch = line.slice("branch refs/heads/".length);
      } else if (line.trim() === "" && current.path && current.head) {
        out.push({ path: current.path, head: current.head, branch: current.branch });
        current = { branch: null };
      }
    }
    if (current.path && current.head) {
      out.push({ path: current.path, head: current.head, branch: current.branch });
    }
    return out;
  },
  async worktreeAddDetached(cwd, path, ref) {
    await git(["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", path, ref], cwd);
  },
  async disableWorktreeHooks(worktreePath) {
    await git(["config", "extensions.worktreeConfig", "true"], worktreePath);
    await git(["config", "--worktree", "core.hooksPath", "/dev/null"], worktreePath);
  },
  async detachAt(cwd, ref) {
    await git(["checkout", "--detach", ref], cwd);
  },
  async rebaseOntoDetached(cwd, newBase, oldBase) {
    await git(["rebase", "--onto", newBase, oldBase], cwd);
  },
  async updateRefCas(cwd, branch, newSha, expectedOldSha) {
    await git(["update-ref", `refs/heads/${branch}`, newSha, expectedOldSha], cwd);
  },
  async isDirty(cwd) {
    const { stdout } = await git(["status", "--porcelain"], cwd);
    return stdout.length > 0;
  },
  async hasUnstagedChanges(cwd) {
    try {
      await git(["diff", "--quiet"], cwd);
      return false;
    } catch {
      return true;
    }
  },
  async hasStagedChanges(cwd) {
    try {
      await git(["diff", "--cached", "--quiet"], cwd);
      return false;
    } catch {
      return true;
    }
  },
  async log(cwd, branch, n = 20) {
    const { stdout } = await git(["log", "--oneline", `-${n}`, branch], cwd);
    return stdout ? stdout.split(`
`) : [];
  },
  async getRepoRoot(cwd) {
    const { stdout } = await git(["rev-parse", "--show-toplevel"], cwd);
    return stdout;
  },
  async getRemoteUrl(cwd, remote = "origin") {
    const { stdout } = await git(["remote", "get-url", remote], cwd);
    return stdout;
  },
  async mergeTree(cwd, branch1, branch2) {
    const { stdout } = await git(["merge-tree", "--write-tree", branch1, branch2], cwd);
    return stdout;
  },
  async mergeTreeWithBase(cwd, branch1, branch2, mergeBase) {
    const { stdout } = await git(["merge-tree", "--write-tree", `--merge-base=${mergeBase}`, branch1, branch2], cwd);
    return stdout;
  },
  async mergeTreeDryRun(cwd, branch1, branch2, mergeBase) {
    const args = mergeBase ? ["merge-tree", "--write-tree", `--merge-base=${mergeBase}`, branch1, branch2] : ["merge-tree", "--write-tree", branch1, branch2];
    return new Promise((resolve2) => {
      execFile3("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (!err) {
          resolve2(null);
          return;
        }
        resolve2(parseMergeTreeConflicts(stdout));
      });
    });
  },
  async logDetailed(cwd, branch, n = 50) {
    const { stdout } = await git(["log", "--format=%H %s", `-${n}`, branch], cwd);
    if (!stdout)
      return [];
    return stdout.split(`
`).map((line) => {
      const spaceIdx = line.indexOf(" ");
      return {
        sha: line.slice(0, spaceIdx),
        subject: line.slice(spaceIdx + 1)
      };
    });
  },
  async resetHard(cwd, ref) {
    await git(["reset", "--hard", ref], cwd);
  },
  async diff(cwd, base, head) {
    const { stdout } = await git(["diff", `${base}...${head}`], cwd);
    return stdout;
  },
  async diffWorkingTree(cwd) {
    const { stdout } = await git(["diff", "HEAD"], cwd);
    return stdout;
  },
  getRebaseProgress(cwd) {
    try {
      let gitDir = join3(cwd, ".git");
      try {
        const content = readFileSync(gitDir, "utf-8").trim();
        if (content.startsWith("gitdir: ")) {
          const relative = content.slice("gitdir: ".length);
          gitDir = relative.startsWith("/") ? relative : join3(cwd, relative);
        }
      } catch {}
      const rebaseDir = join3(gitDir, "rebase-merge");
      if (!existsSync2(rebaseDir))
        return null;
      const current = parseInt(readFileSync(join3(rebaseDir, "msgnum"), "utf-8").trim(), 10);
      const total = parseInt(readFileSync(join3(rebaseDir, "end"), "utf-8").trim(), 10);
      return { current, total };
    } catch {
      return null;
    }
  },
  async listConflictedFiles(cwd) {
    const { stdout } = await git(["diff", "--name-only", "--diff-filter=U"], cwd);
    return stdout ? stdout.split(`
`).filter(Boolean) : [];
  },
  async listConflictedFilesWithTypes(cwd) {
    const { stdout } = await git(["status", "--porcelain"], cwd);
    if (!stdout)
      return [];
    return stdout.split(`
`).filter((line) => {
      const xy = line.slice(0, 2);
      return xy === "DD" || xy === "AU" || xy === "UD" || xy === "UA" || xy === "DU" || xy === "AA" || xy === "UU";
    }).map((line) => ({
      type: line.slice(0, 2),
      file: line.slice(3)
    }));
  },
  async rebaseContinue(cwd) {
    await git(["-c", "core.editor=true", "rebase", "--continue"], cwd);
  },
  async rebaseAbort(cwd) {
    await git(["rebase", "--abort"], cwd);
  },
  async rebaseSkip(cwd) {
    await git(["rebase", "--skip"], cwd);
  },
  async checkoutOurs(cwd, file) {
    await git(["checkout", "--ours", "--", file], cwd);
  },
  async checkoutTheirs(cwd, file) {
    await git(["checkout", "--theirs", "--", file], cwd);
  },
  async stageAll(cwd) {
    await git(["add", "-A"], cwd);
  },
  async checkoutMerge(cwd, file) {
    await git(["checkout", "-m", "--", file], cwd);
  },
  async hasStagedDiff(cwd) {
    try {
      const { stdout } = await git(["diff", "--cached", "--quiet", "HEAD"], cwd);
      return false;
    } catch {
      return true;
    }
  },
  isRebaseInProgress(cwd) {
    try {
      let gitDir = join3(cwd, ".git");
      try {
        const content = readFileSync(gitDir, "utf-8").trim();
        if (content.startsWith("gitdir: ")) {
          const relative = content.slice("gitdir: ".length);
          gitDir = relative.startsWith("/") ? relative : join3(cwd, relative);
        }
      } catch {}
      return existsSync2(join3(gitDir, "rebase-merge")) || existsSync2(join3(gitDir, "rebase-apply"));
    } catch {
      return false;
    }
  },
  getStoppedSha(cwd) {
    try {
      let gitDir = join3(cwd, ".git");
      try {
        const content = readFileSync(gitDir, "utf-8").trim();
        if (content.startsWith("gitdir: ")) {
          const relative = content.slice("gitdir: ".length);
          gitDir = relative.startsWith("/") ? relative : join3(cwd, relative);
        }
      } catch {}
      const stoppedPath = join3(gitDir, "rebase-merge", "stopped-sha");
      if (existsSync2(stoppedPath)) {
        return readFileSync(stoppedPath, "utf-8").trim();
      }
      return null;
    } catch {
      return null;
    }
  },
  async getCommitDiffAddedLines(cwd, sha, file) {
    try {
      const { stdout } = await git(["diff", `${sha}~1`, sha, "--", file], cwd);
      if (!stdout)
        return [];
      return stdout.split(`
`).filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1));
    } catch {
      return [];
    }
  },
  async showFile(cwd, revision, file) {
    return git(["show", `${revision}:${file}`], cwd);
  },
  async fetch(cwd, remote = "origin") {
    await git(["fetch", remote], cwd);
  },
  async renameBranch(cwd, oldName, newName) {
    await git(["branch", "-m", oldName, newName], cwd);
  },
  async getFilesChangedInRange(cwd, fromRef, toRef) {
    const { stdout } = await git(["diff", "--name-only", "-z", fromRef, toRef], cwd);
    return splitNulPaths(stdout);
  },
  async stash(cwd) {
    await git(["stash", "push", "-u"], cwd);
  },
  async stashPop(cwd) {
    await git(["stash", "pop"], cwd);
  },
  async stashDrop(cwd) {
    await git(["stash", "drop"], cwd);
  },
  async checkoutFileFromRef(cwd, ref, filePath) {
    await git(["checkout", ref, "--", filePath], cwd);
  },
  async amendNoEdit(cwd) {
    await git(["commit", "--amend", "--no-edit", "--allow-empty"], cwd);
  },
  async getChangedFiles(cwd) {
    const [modResult, stagedResult, untrackedResult, delResult, delStagedResult] = await Promise.all([
      git(["diff", "--name-only", "-z"], cwd),
      git(["diff", "--name-only", "-z", "--cached"], cwd),
      git(["ls-files", "--others", "--exclude-standard", "-z"], cwd),
      git(["diff", "--name-only", "-z", "--diff-filter=D"], cwd),
      git(["diff", "--name-only", "-z", "--cached", "--diff-filter=D"], cwd)
    ]);
    return {
      modified: splitNulPaths(modResult.stdout),
      staged: splitNulPaths(stagedResult.stdout),
      untracked: splitNulPaths(untrackedResult.stdout),
      deleted: [
        ...new Set([...splitNulPaths(delResult.stdout), ...splitNulPaths(delStagedResult.stdout)])
      ]
    };
  },
  async getIndexEntries(cwd, files) {
    const entries = new Map;
    if (files.length === 0)
      return entries;
    const { stdout } = await git(["--literal-pathspecs", "ls-files", "-s", "-z", "--", ...files], cwd);
    for (const record of splitNulPaths(stdout)) {
      const tab = record.indexOf("\t");
      if (tab === -1)
        continue;
      const [mode, sha, stage] = record.slice(0, tab).split(" ");
      if (!mode || !sha || stage !== "0")
        continue;
      entries.set(record.slice(tab + 1), { mode, sha });
    }
    return entries;
  },
  async setIndexEntry(cwd, file, entry) {
    await git(["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.sha},${file}`], cwd);
  },
  async removeIndexEntry(cwd, file) {
    await git(["update-index", "--force-remove", "--", file], cwd);
  },
  async add(cwd, files) {
    await git(["add", ...files], cwd);
  },
  async cherryPick(cwd, base, head) {
    await git(["cherry-pick", `${base}..${head}`], cwd);
  },
  async deleteBranch(cwd, branch) {
    await git(["branch", "-D", branch], cwd);
  },
  async diffNameOnly(cwd, base, head) {
    const { stdout } = await git(["diff", "--name-only", "-z", base, head], cwd);
    return splitNulPaths(stdout);
  },
  async checkoutFiles(cwd, ref, files) {
    await git(["checkout", ref, "--", ...files], cwd);
  },
  async commit(cwd, message) {
    await git(["commit", "-m", message], cwd);
    const { stdout } = await git(["rev-parse", "HEAD"], cwd);
    return stdout;
  },
  async rm(cwd, files) {
    await git(["rm", "-f", ...files], cwd);
  },
  async lsTree(cwd, ref) {
    const { stdout } = await git(["ls-tree", "-r", "--name-only", "-z", ref], cwd);
    return splitNulPaths(stdout);
  },
  async lsTreePath(cwd, ref, path) {
    const { stdout } = await git(["ls-tree", "-r", "--name-only", "-z", ref, "--", path], cwd);
    return splitNulPaths(stdout);
  },
  async diffNameStatus(cwd, ref1, ref2) {
    const fields = splitNulPaths((await git(["diff", "--name-status", "-z", ref1, ref2], cwd)).stdout);
    const entries = [];
    for (let i = 0;i < fields.length; ) {
      const status = fields[i].charAt(0);
      const path = fields[i + 1];
      if (path === undefined)
        break;
      if (status === "R" || status === "C") {
        const to = fields[i + 2];
        if (to === undefined)
          break;
        entries.push({ status, path, to });
        i += 3;
      } else {
        entries.push({ status, path });
        i += 2;
      }
    }
    return entries;
  },
  async listLocalBranches(cwd) {
    const { stdout } = await git(["branch", "--list", "--format=%(refname:short)"], cwd);
    return stdout ? stdout.split(`
`).filter(Boolean) : [];
  },
  async listWorktrees(cwd) {
    const { stdout } = await git(["worktree", "list", "--porcelain"], cwd);
    const entries = [];
    let current = {};
    for (const line of stdout.split(`
`)) {
      if (line.startsWith("worktree ")) {
        if (current.path)
          entries.push(current);
        current = { path: line.slice(9), head: "", branch: null, bare: false, locked: false };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice(5);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        current.bare = true;
      } else if (line === "locked" || line.startsWith("locked ")) {
        current.locked = true;
      } else if (line === "detached") {
        current.branch = null;
      }
    }
    if (current.path)
      entries.push(current);
    return entries;
  },
  async getCommonDir(cwd) {
    const { stdout } = await git(["rev-parse", "--git-common-dir"], cwd);
    const { resolve: resolve2 } = await import("node:path");
    const commonDir = resolve2(cwd, stdout);
    const parent = resolve2(commonDir, "..");
    return parent;
  },
  async isAncestor(cwd, ancestor, descendant) {
    try {
      await git(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
      return true;
    } catch {
      return false;
    }
  },
  async getMergeBaseForkPoint(cwd, upstream, branch) {
    try {
      const { stdout } = await git(["merge-base", "--fork-point", upstream, branch], cwd);
      return stdout || null;
    } catch {
      return null;
    }
  },
  async cherry(cwd, upstream, head) {
    const { stdout } = await git(["cherry", "-v", upstream, head], cwd);
    if (!stdout)
      return [];
    return stdout.split(`
`).filter(Boolean).map((line) => {
      const unique = line.startsWith("+");
      const sha = line.slice(2, line.indexOf(" ", 2));
      return { sha, unique };
    });
  },
  async catFileType(cwd, sha) {
    try {
      const { stdout } = await git(["cat-file", "-t", sha], cwd);
      return stdout || null;
    } catch {
      return null;
    }
  },
  async branchDivergence(cwd, branch, remote = "origin") {
    const remoteBranch = `${remote}/${branch}`;
    let localHead;
    try {
      localHead = await GitShell.getBranchHead(cwd, branch);
    } catch {
      return { state: "local-gone", localHead: null, remoteHead: null, ahead: 0, behind: 0 };
    }
    let remoteHead;
    try {
      remoteHead = await GitShell.getBranchHead(cwd, remoteBranch);
    } catch {
      return { state: "remote-gone", localHead, remoteHead: null, ahead: 0, behind: 0 };
    }
    if (localHead === remoteHead) {
      return { state: "identical", localHead, remoteHead, ahead: 0, behind: 0 };
    }
    const ahead = await GitShell.revCount(cwd, remoteBranch, branch);
    const behind = await GitShell.revCount(cwd, branch, remoteBranch);
    if (behind === 0)
      return { state: "ahead", localHead, remoteHead, ahead, behind };
    if (ahead === 0)
      return { state: "behind", localHead, remoteHead, ahead, behind };
    return { state: "diverged", localHead, remoteHead, ahead, behind };
  },
  async revCount(cwd, from, to) {
    try {
      const { stdout } = await git(["rev-list", "--count", `${from}..${to}`], cwd);
      return parseInt(stdout, 10) || 0;
    } catch {
      return 0;
    }
  },
  async resetBranchToRemote(cwd, branch, remote = "origin") {
    const remoteBranch = `${remote}/${branch}`;
    const current = await GitShell.getCurrentBranch(cwd);
    if (current === branch) {
      await git(["reset", "--hard", remoteBranch], cwd);
    } else {
      await git(["branch", "-f", branch, remoteBranch], cwd);
    }
  },
  async logOneLine(cwd, range) {
    const { stdout } = await git(["log", "--format=%H %s", range], cwd);
    if (!stdout)
      return [];
    return stdout.split(`
`).filter(Boolean).map((line) => {
      const spaceIdx = line.indexOf(" ");
      return {
        sha: line.slice(0, spaceIdx),
        message: line.slice(spaceIdx + 1)
      };
    });
  }
};

// src/core/worktrees.ts
var WORK_SLOT_RE = /^gitq-\d+$/;
async function getWorktreeMap(anyCwd) {
  const raw = await GitShell.worktreeList(anyCwd);
  const out = [];
  for (let i = 0;i < raw.length; i++) {
    const wt = raw[i];
    const dirty = await GitShell.isDirty(wt.path).catch(() => true);
    const rebaseInProgress = GitShell.isRebaseInProgress(wt.path);
    out.push({
      path: wt.path,
      name: basename(wt.path),
      head: wt.head,
      branch: wt.branch,
      dirty,
      rebaseInProgress,
      isWorkSlot: WORK_SLOT_RE.test(basename(wt.path)),
      isPrimary: i === 0
    });
  }
  return out;
}
function findSlotForBranch(map, branch) {
  const holders = map.filter((s) => s.branch === branch);
  return holders.find((s) => !s.isWorkSlot) ?? holders[0];
}
function describeSlot(slot) {
  return `${slot.isWorkSlot ? "work slot" : "slot"} "${slot.name}" (${slot.path})`;
}
function workSlotRoot(commonDir, map) {
  const primary = map.find((s) => s.isPrimary);
  if (primary) {
    const parent = dirname3(primary.path);
    const pooled = map.some((s) => !s.isPrimary && !s.isWorkSlot && dirname3(s.path) === parent);
    if (pooled)
      return parent;
  }
  return join4(getWorkSlotRoot(), repoHash(commonDir));
}
async function ensureWorkSlot(anyCwd, commonDir, map) {
  const free = map.find((s) => s.isWorkSlot && s.branch === null && !s.rebaseInProgress);
  if (free) {
    await GitShell.disableWorktreeHooks(free.path);
    return free.path;
  }
  const root = workSlotRoot(commonDir, map);
  const used = new Set(map.filter((s) => s.isWorkSlot).map((s) => s.name));
  let n = 1;
  while (used.has(`gitq-${n}`))
    n++;
  const path = join4(root, `gitq-${n}`);
  await GitShell.worktreeAddDetached(anyCwd, path, "HEAD");
  await GitShell.disableWorktreeHooks(path);
  return path;
}
async function getMaxWorkSlots() {
  const settings = await readJson(getSettingsFilePath(), {});
  const n = settings.maxWorkSlots;
  return typeof n === "number" && n >= 1 ? Math.floor(n) : 3;
}

// src/core/leases.ts
import { join as join5 } from "node:path";
function leasesPath(commonDir) {
  return join5(commonDir, "gitq", "leases.json");
}
function defaultIsPidAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function withRegistry(commonDir, fn) {
  const path = leasesPath(commonDir);
  return withFileLock(path, async () => {
    const file = await readJson(path, { leases: [] });
    const { file: next, result } = await fn(file);
    await writeJsonAtomic(path, next);
    return result;
  });
}
async function listLeases(commonDir, opts = {}) {
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive2;
  const { leases } = await readJson(leasesPath(commonDir), { leases: [] });
  return leases.filter((l) => l.state === "parked" || isPidAlive(l.pid));
}
async function findLease(commonDir, stackId, opts = {}) {
  return (await listLeases(commonDir, opts)).find((l) => l.stackId === stackId) ?? null;
}
async function acquireLease(commonDir, lease, opts = {}) {
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive2;
  return withRegistry(commonDir, async (file) => {
    const live = file.leases.filter((l) => l.state === "parked" || isPidAlive(l.pid));
    const stackHolder = live.find((l) => l.stackId === lease.stackId);
    if (stackHolder) {
      return { file: { leases: live }, result: { ok: false, reason: "stack-leased", holder: stackHolder } };
    }
    const slotHolder = live.find((l) => l.slotPath === lease.slotPath);
    if (slotHolder) {
      return { file: { leases: live }, result: { ok: false, reason: "slot-leased", holder: slotHolder } };
    }
    live.push({ ...lease, pid: process.pid, acquiredAt: Date.now(), state: "running" });
    return { file: { leases: live }, result: { ok: true } };
  });
}
async function parkLease(commonDir, stackId) {
  await withRegistry(commonDir, async (file) => ({
    file: {
      leases: file.leases.map((l) => l.stackId === stackId ? { ...l, state: "parked" } : l)
    },
    result: undefined
  }));
}
async function releaseLease(commonDir, stackId) {
  await withRegistry(commonDir, async (file) => ({
    file: { leases: file.leases.filter((l) => l.stackId !== stackId) },
    result: undefined
  }));
}

// src/cli/slots.ts
var exec3 = promisify3(execFile4);
async function slotGitDir(slotPath) {
  const { stdout } = await exec3("git", ["rev-parse", "--absolute-git-dir"], { cwd: slotPath });
  return stdout.trim();
}
async function requireStackFree(ctx, stackId) {
  const lease = await findLease(ctx.commonDir, stackId);
  if (lease) {
    return fail(`stack has a ${lease.state} ${lease.action} lease on ${lease.slotPath}; finish it first: gitq continue (or gitq abort)`);
  }
  return null;
}
async function withLeasedSlot(ctx, stack, action, fn) {
  const map = await getWorktreeMap(ctx.repoRoot);
  const leases = await listLeases(ctx.commonDir);
  const leasedPaths = new Set(leases.map((l) => l.slotPath));
  const free = map.find((s) => s.isWorkSlot && s.branch === null && !s.rebaseInProgress && !leasedPaths.has(s.path));
  let slotPath;
  if (free) {
    slotPath = free.path;
  } else {
    const workSlotCount = map.filter((s) => s.isWorkSlot).length;
    const max = await getMaxWorkSlots();
    if (workSlotCount >= max && leasedPaths.size >= workSlotCount) {
      return fail(`all ${workSlotCount} work slots are busy (max ${max}); finish or abort a cascade, or raise maxWorkSlots in settings.json`);
    }
    slotPath = await ensureWorkSlot(ctx.repoRoot, ctx.commonDir, map);
  }
  await GitShell.disableWorktreeHooks(slotPath);
  const acquired = await acquireLease(ctx.commonDir, { slotPath, stackId: stack.id, action });
  if (!acquired.ok) {
    const h = acquired.holder;
    return fail(`stack has a ${h.state} ${h.action} lease on ${h.slotPath}; finish it first: gitq continue (or gitq abort)`);
  }
  let code;
  try {
    code = await fn(slotPath);
  } catch (err) {
    await releaseLease(ctx.commonDir, stack.id);
    throw err;
  }
  if (code === 2) {
    await parkLease(ctx.commonDir, stack.id);
  } else {
    await releaseLease(ctx.commonDir, stack.id);
  }
  return code;
}
async function worktreesForJson(ctx) {
  const [map, leases] = await Promise.all([getWorktreeMap(ctx.repoRoot), listLeases(ctx.commonDir)]);
  return map.map((s) => {
    const lease = leases.find((l) => l.slotPath === s.path) ?? null;
    return {
      path: s.path,
      name: s.name,
      branch: s.branch,
      dirty: s.dirty,
      isWorkSlot: s.isWorkSlot,
      lease: lease ? { stackId: lease.stackId, action: lease.action, state: lease.state } : null
    };
  });
}
async function findParkedLease(ctx, stackId) {
  const leases = (await listLeases(ctx.commonDir)).filter((l) => l.state === "parked");
  if (stackId) {
    const match = leases.find((l) => l.stackId === stackId);
    return match ? { lease: match } : { error: "no parked cascade for that stack" };
  }
  if (leases.length === 0)
    return { error: "nothing to continue (no parked cascade)" };
  if (leases.length > 1)
    return { error: "multiple parked cascades; pass --stack to pick one" };
  return { lease: leases[0] };
}

// src/cli/commands/stacks.ts
async function stacksCommand(ctx) {
  const store = await loadStore(ctx.repoRoot);
  const worktrees = await worktreesForJson(ctx);
  const human = store.stacks.length === 0 ? "no stacks" : store.stacks.map((s) => `${s.stackName} (root ${s.root}): ${s.nodes.map((n) => n.branch).join(" -> ") || "empty"}`).join(`
`);
  emit(ctx, human, { stacks: store.stacks, worktrees });
  return 0;
}

// src/core/stack-manager.ts
class StackError extends Error {
  constructor(message) {
    super(message);
    this.name = "StackError";
  }
}
function createNode(branch, parent) {
  return {
    branch,
    parent,
    mrIid: null,
    mrUrl: null,
    mrTitle: null,
    status: "local-only",
    lastKnownHead: null,
    forkPoint: null,
    diffStats: null,
    pipelineStatus: "unknown",
    unresolvedThreads: 0
  };
}
var StackManager = {
  createStack(name, root) {
    return { id: crypto.randomUUID(), stackName: name, root, nodes: [] };
  },
  findNode(stack, branch) {
    return stack.nodes.find((n) => n.branch === branch);
  },
  getChildren(stack, branch) {
    return stack.nodes.filter((n) => n.parent === branch);
  },
  getDescendants(stack, branch) {
    const result = [];
    const queue = [branch];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current)
        break;
      const children = stack.nodes.filter((n) => n.parent === current);
      for (const child of children) {
        result.push(child);
        queue.push(child.branch);
      }
    }
    return result;
  },
  toposort(stack) {
    return StackManager.getDescendants(stack, stack.root);
  },
  addNode(stack, branch, parentBranch) {
    if (StackManager.findNode(stack, branch)) {
      throw new StackError(`Branch "${branch}" already exists in stack "${stack.id}"`);
    }
    if (parentBranch !== stack.root && !StackManager.findNode(stack, parentBranch)) {
      throw new StackError(`Parent branch "${parentBranch}" not found in stack "${stack.id}"`);
    }
    return {
      ...stack,
      nodes: [...stack.nodes, createNode(branch, parentBranch)]
    };
  },
  removeNode(stack, branch) {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }
    const children = StackManager.getChildren(stack, branch);
    if (children.length > 0) {
      throw new StackError(`Cannot remove "${branch}" — it has ${children.length} child branch(es). Remove or re-parent them first.`);
    }
    return {
      ...stack,
      nodes: stack.nodes.filter((n) => n.branch !== branch)
    };
  },
  moveNode(stack, branch, newParent) {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }
    if (newParent !== stack.root && !StackManager.findNode(stack, newParent)) {
      throw new StackError(`New parent "${newParent}" not found in stack "${stack.id}"`);
    }
    const descendants = StackManager.getDescendants(stack, branch);
    if (descendants.some((d) => d.branch === newParent)) {
      throw new StackError(`Cannot move "${branch}" under "${newParent}" — would create a cycle`);
    }
    return {
      ...stack,
      nodes: stack.nodes.map((n) => n.branch === branch ? { ...n, parent: newParent } : n)
    };
  },
  updateNodeStatus(stack, branch, status) {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }
    return {
      ...stack,
      nodes: stack.nodes.map((n) => n.branch === branch ? { ...n, status } : n)
    };
  },
  updateNode(stack, branch, patch) {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }
    return {
      ...stack,
      nodes: stack.nodes.map((n) => n.branch === branch ? { ...n, ...patch } : n)
    };
  },
  renameBranch(stack, oldBranch, newBranch) {
    const node = StackManager.findNode(stack, oldBranch);
    if (!node) {
      throw new StackError(`Branch "${oldBranch}" not found in stack "${stack.id}"`);
    }
    if (StackManager.findNode(stack, newBranch)) {
      throw new StackError(`Branch "${newBranch}" already exists in stack "${stack.id}"`);
    }
    return {
      ...stack,
      nodes: stack.nodes.map((n) => {
        if (n.branch === oldBranch)
          return { ...n, branch: newBranch };
        if (n.parent === oldBranch)
          return { ...n, parent: newBranch };
        return n;
      })
    };
  },
  toggleUnmanaged(stack, branch) {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
    }
    return {
      ...stack,
      nodes: stack.nodes.map((n) => n.branch === branch ? { ...n, unmanaged: !n.unmanaged } : n)
    };
  },
  validate(stack) {
    const issues = [];
    const branchNames = new Set(stack.nodes.map((n) => n.branch));
    for (const node of stack.nodes) {
      if (node.parent !== stack.root && !branchNames.has(node.parent)) {
        issues.push(`Node "${node.branch}" references missing parent "${node.parent}"`);
      }
      if (node.branch === node.parent) {
        issues.push(`Node "${node.branch}" is its own parent`);
      }
    }
    if (branchNames.size !== stack.nodes.length) {
      issues.push("Stack contains duplicate branch names");
    }
    return issues;
  }
};

// src/core/stack-diagnostics.ts
async function collectSnapshot(cwd, stack) {
  const [currentBranch, isDirty, hasStagedChanges] = await Promise.all([
    GitShell.getCurrentBranch(cwd).catch(() => ""),
    GitShell.isDirty(cwd).catch(() => false),
    GitShell.hasStagedChanges(cwd).catch(() => false)
  ]);
  const rebaseInProgress = GitShell.isRebaseInProgress(cwd);
  const branchEntries = await Promise.all(stack.nodes.map(async (node) => {
    const div = await GitShell.branchDivergence(cwd, node.branch).catch(() => ({
      state: "remote-gone",
      localHead: null,
      remoteHead: null,
      ahead: 0,
      behind: 0
    }));
    let upToDateWithParent = true;
    try {
      const parentRef = node.parent === stack.root ? `origin/${stack.root}` : node.parent;
      const parentHead = await GitShell.getBranchHead(cwd, parentRef);
      upToDateWithParent = await GitShell.isAncestor(cwd, parentHead, node.branch);
    } catch {}
    let tombstoneDrifted = null;
    const parentNode = stack.nodes.find((n) => n.branch === node.parent);
    if (parentNode?.status === "merged" && parentNode.lastKnownHead) {
      try {
        const isAnc = await GitShell.isAncestor(cwd, parentNode.lastKnownHead, node.branch);
        tombstoneDrifted = !isAnc;
      } catch {
        tombstoneDrifted = null;
      }
    }
    return [
      node.branch,
      {
        branch: node.branch,
        existsOnRemote: div.state !== "remote-gone",
        upToDateWithParent,
        tombstoneDrifted,
        divergence: { state: div.state, ahead: div.ahead, behind: div.behind }
      }
    ];
  }));
  return {
    currentBranch,
    isDirty,
    hasStagedChanges,
    rebaseInProgress,
    branches: new Map(branchEntries)
  };
}
function diagnoseStack(snapshot, stack, liveMrStates) {
  const nodes = new Map;
  const edges = [];
  const globalBlocks = [];
  if (snapshot.isDirty)
    globalBlocks.push("Working tree has uncommitted changes");
  if (snapshot.rebaseInProgress)
    globalBlocks.push("Rebase in progress — continue or abort first");
  for (const node of stack.nodes) {
    const bs = snapshot.branches.get(node.branch);
    nodes.set(node.branch, classifyNode(stack, node, bs ?? null, snapshot, globalBlocks, liveMrStates));
  }
  for (const node of stack.nodes) {
    const bs = snapshot.branches.get(node.branch);
    edges.push(classifyEdge(stack, node, bs ?? null, nodes));
  }
  const banner = classifyBanner(stack, nodes, snapshot);
  return { nodes, edges, banner, globalBlocks };
}
function classifyNode(stack, node, bs, snapshot, globalBlocks, liveMrStates) {
  const children = StackManager.getChildren(stack, node.branch);
  const hasChildren = children.length > 0;
  const blocked = globalBlocks.length > 0 ? { reason: globalBlocks[0] } : null;
  if (snapshot.rebaseInProgress && snapshot.currentBranch === node.branch) {
    return {
      branch: node.branch,
      situation: "rebase-in-progress",
      statusLine: "Rebase in progress — resolve conflicts, then continue",
      badge: { label: "Conflicts", variant: "negative" },
      primaryAction: { id: "continue-rebase", label: "Continue Rebase", variant: "primary" },
      secondaryActions: [{ id: "abort-rebase", label: "Abort Rebase", variant: "negative" }],
      blocked: null,
      removal: { allowed: false, reason: "Rebase in progress" }
    };
  }
  if (bs?.divergence.state === "diverged") {
    return {
      branch: node.branch,
      situation: "local-remote-diverged",
      statusLine: `Local and remote have diverged (${bs.divergence.ahead} ahead, ${bs.divergence.behind} behind)`,
      badge: { label: "Diverged", variant: "caution" },
      primaryAction: { id: "reset-to-remote", label: "Reset to remote", variant: "primary" },
      secondaryActions: [{ id: "sync-stack", label: "Force push local", variant: "negative" }],
      blocked,
      removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
    };
  }
  if (bs?.divergence.state === "remote-gone" && node.status !== "local-only") {
    const wasMerged = node.status === "merged" || liveMrStates?.get(node.branch) === "merged";
    return {
      branch: node.branch,
      situation: "branch-deleted-remote",
      statusLine: wasMerged ? "Merged and removed from remote" : "Branch was deleted on remote",
      badge: { label: wasMerged ? "Merged" : "Deleted", variant: wasMerged ? "merge" : "negative" },
      primaryAction: { id: "remove-branch", label: "Remove from stack", variant: "neutral" },
      secondaryActions: wasMerged ? [] : [{ id: "sync-stack", label: "Re-push", variant: "primary" }],
      blocked,
      removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
    };
  }
  const parentNode = stack.nodes.find((n) => n.branch === node.parent);
  if (node.status === "drift" && parentNode?.status === "merged") {
    return {
      branch: node.branch,
      situation: "drift-parent-merged",
      statusLine: "MR target drifted — parent was merged",
      badge: { label: "Needs sync", variant: "merge" },
      primaryAction: { id: "sync-stack", label: "Sync Stack", variant: "primary" },
      secondaryActions: [],
      blocked,
      removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
    };
  }
  if (parentNode?.status === "merged" && bs?.tombstoneDrifted === true) {
    return {
      branch: node.branch,
      situation: "parent-merged-drifted",
      statusLine: "Parent merged — needs drift reconciliation",
      badge: { label: "Needs sync", variant: "merge" },
      primaryAction: { id: "cascade-merged", label: "Sync Stack", variant: "primary" },
      secondaryActions: [],
      blocked,
      removal: { allowed: false, reason: "Parent merged — cascade rebase needed first" }
    };
  }
  if (parentNode?.status === "merged") {
    return {
      branch: node.branch,
      situation: "parent-merged",
      statusLine: "Parent branch was merged",
      badge: { label: "Needs sync", variant: "merge" },
      primaryAction: { id: "cascade-merged", label: "Sync Stack", variant: "primary" },
      secondaryActions: [],
      blocked,
      removal: { allowed: false, reason: "Parent merged — cascade rebase needed first" }
    };
  }
  if (node.status === "merged") {
    if (hasChildren) {
      return {
        branch: node.branch,
        situation: "parent-merged",
        statusLine: `Merged — ${children.length} child${children.length > 1 ? "ren" : ""} need${children.length === 1 ? "s" : ""} sync`,
        badge: { label: "Merged", variant: "merge" },
        primaryAction: { id: "cascade-merged", label: "Sync Stack", variant: "primary" },
        secondaryActions: [],
        blocked,
        removal: { allowed: false, reason: `${children.length} children need cascade rebase first` }
      };
    }
    return {
      branch: node.branch,
      situation: "parent-merged",
      statusLine: "Merged — safe to remove",
      badge: { label: "Merged", variant: "merge" },
      primaryAction: { id: "remove-branch", label: "Remove from stack", variant: "neutral" },
      secondaryActions: [],
      blocked: null,
      removal: { allowed: true }
    };
  }
  if (bs && !bs.upToDateWithParent) {
    return {
      branch: node.branch,
      situation: "behind-parent",
      statusLine: "Behind parent — needs rebase",
      badge: { label: "Behind", variant: "caution" },
      primaryAction: { id: "sync-stack", label: "Sync Stack", variant: "primary" },
      secondaryActions: [],
      blocked,
      removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
    };
  }
  if (node.status === "drift") {
    return {
      branch: node.branch,
      situation: "drift",
      statusLine: "MR target doesn't match stack parent",
      badge: { label: "Drift", variant: "negative" },
      primaryAction: { id: "retarget-mr", label: "Fix MR target", variant: "primary" },
      secondaryActions: [],
      blocked,
      removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
    };
  }
  if (node.status === "local-only") {
    return {
      branch: node.branch,
      situation: "local-only",
      statusLine: "Not published",
      badge: { label: "Local", variant: "neutral" },
      primaryAction: { id: "publish-stack", label: "Publish", variant: "primary" },
      secondaryActions: [],
      blocked,
      removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
    };
  }
  if (node.pipelineStatus === "failed") {
    return {
      branch: node.branch,
      situation: "ci-failed",
      statusLine: "Pipeline failed",
      badge: { label: "CI Failed", variant: "negative" },
      primaryAction: null,
      secondaryActions: [],
      blocked,
      removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
    };
  }
  const threads = node.unresolvedThreads;
  if (threads === null || threads > 0) {
    return {
      branch: node.branch,
      situation: "has-threads",
      statusLine: threads === null ? "unresolved threads: unknown" : `${threads} unresolved thread${threads > 1 ? "s" : ""}`,
      badge: {
        label: threads === null ? "threads?" : `${threads} thread${threads > 1 ? "s" : ""}`,
        variant: "caution"
      },
      primaryAction: null,
      secondaryActions: [],
      blocked,
      removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
    };
  }
  return {
    branch: node.branch,
    situation: "synced",
    statusLine: "Synced",
    badge: null,
    primaryAction: null,
    secondaryActions: [],
    blocked,
    removal: hasChildren ? { allowed: false, reason: `Has ${children.length} child branch${children.length > 1 ? "es" : ""}` } : { allowed: true }
  };
}
function classifyEdge(stack, node, bs, nodeDirectives) {
  const source = node.parent;
  const target = node.branch;
  const directive = nodeDirectives.get(node.branch);
  const situation = directive?.situation ?? "synced";
  switch (situation) {
    case "drift-parent-merged":
    case "parent-merged":
    case "parent-merged-drifted":
      return {
        source,
        target,
        color: "var(--color-negative-high-contrast)",
        dashed: false,
        dimmed: false,
        badge: { icon: "git-merge", label: "Needs sync", message: "Parent branch was merged. Use Sync Stack to update.", variant: "merge" }
      };
    case "drift":
      return {
        source,
        target,
        color: "var(--color-negative-high-contrast)",
        dashed: false,
        dimmed: false,
        badge: { icon: "alert-triangle", label: "Drift", message: "MR target doesn't match the stack parent.", variant: "negative" }
      };
    case "behind-parent":
      return {
        source,
        target,
        color: "var(--color-negative-high-contrast)",
        dashed: false,
        dimmed: false,
        badge: { icon: "alert-triangle", label: "Behind", message: "This branch is behind its parent. Sync Stack to update.", variant: "negative" }
      };
    case "local-remote-diverged":
      return {
        source,
        target,
        color: "var(--color-negative-high-contrast)",
        dashed: false,
        dimmed: false,
        badge: { icon: "alert-triangle", label: "Diverged", message: "Local and remote have diverged.", variant: "negative" }
      };
    case "local-only":
      return {
        source,
        target,
        color: "var(--color-gray-40)",
        dashed: true,
        dimmed: false,
        badge: null
      };
    default:
      if (node.status === "merged") {
        return {
          source,
          target,
          color: "var(--color-gray-40)",
          dashed: false,
          dimmed: true,
          badge: { icon: "git-merge", label: "Merged", message: "This branch was merged.", variant: "merge" }
        };
      }
      return {
        source,
        target,
        color: "var(--color-emphasis-high-contrast)",
        dashed: false,
        dimmed: false,
        badge: null
      };
  }
}
function classifyBanner(stack, nodeDirectives, snapshot) {
  if (snapshot.rebaseInProgress) {
    return { kind: "rebase-in-progress" };
  }
  const mergedWithChildren = stack.nodes.filter((n) => n.status === "merged" && StackManager.getChildren(stack, n.branch).length > 0);
  if (mergedWithChildren.length > 0) {
    return { kind: "merged", branches: mergedWithChildren.map((n) => n.branch), canDismiss: false };
  }
  const mergedLeaves = stack.nodes.filter((n) => n.status === "merged" && StackManager.getChildren(stack, n.branch).length === 0);
  if (mergedLeaves.length > 0) {
    return { kind: "merged", branches: mergedLeaves.map((n) => n.branch), canDismiss: true };
  }
  const behindNodes = Array.from(nodeDirectives.values()).filter((d) => d.situation === "behind-parent");
  if (behindNodes.length > 0) {
    return {
      kind: "behind-trunk",
      message: `${behindNodes.length} branch${behindNodes.length > 1 ? "es are" : " is"} behind — Sync Stack to update`
    };
  }
  const drifted = stack.nodes.filter((n) => n.status === "drift");
  if (drifted.length > 0) {
    return { kind: "drift", branches: drifted.map((n) => ({ branch: n.branch, parent: n.parent })) };
  }
  return null;
}

// src/cli/commands/diagnose.ts
async function diagnoseCommand(ctx) {
  const store = await loadStore(ctx.repoRoot);
  const worktrees = await worktreesForJson(ctx);
  const stacks = [];
  for (const stack of store.stacks) {
    const snapshot = await collectSnapshot(ctx.repoRoot, stack);
    const diagnostics = diagnoseStack(snapshot, stack);
    const nodes = Array.from(diagnostics.nodes.values()).map((n) => ({
      ...n,
      checkedOutIn: worktrees.find((w) => !w.isWorkSlot && w.branch === n.branch)?.name ?? null
    }));
    stacks.push({
      stackName: stack.stackName,
      diagnostics: {
        nodes,
        edges: diagnostics.edges,
        banner: diagnostics.banner,
        globalBlocks: diagnostics.globalBlocks
      }
    });
  }
  const human = stacks.map((s) => `${s.stackName}:
` + s.diagnostics.nodes.map((n) => `  ${n.branch}: ${n.situation}${n.checkedOutIn ? ` [in ${n.checkedOutIn}]` : ""}`).join(`
`)).join(`
`);
  emit(ctx, human || "no stacks", { stacks, worktrees });
  return 0;
}

// src/core/error-utils.ts
function toErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// src/core/rebase-engine.ts
function normalizeMergeTreeKind(kind) {
  switch (kind) {
    case "modify/delete":
      return "UD";
    case "delete/modify":
      return "DU";
    case "content":
      return "UU";
    case "file location":
      return "AU";
    case "add/add":
      return "AA";
    default:
      return kind;
  }
}
async function preflight(cwd, stack, branches) {
  const dirty = await GitShell.isDirty(cwd);
  const staged = await GitShell.hasStagedChanges(cwd);
  const conflictBranches = [];
  const threadWarnings = [];
  const driftWarnings = [];
  for (const branch of branches) {
    const node = StackManager.findNode(stack, branch);
    if (!node)
      continue;
    if (node.unresolvedThreads === null || node.unresolvedThreads > 0) {
      threadWarnings.push({ branch: node.branch, count: node.unresolvedThreads });
    }
    const directParent = stack.nodes.find((n) => n.branch === node.parent);
    const tombstone = directParent?.status === "merged" ? directParent.lastKnownHead : null;
    if (tombstone) {
      const drift = await reconcileDrift(cwd, tombstone, branch, node.forkPoint ?? null, directParent.branch);
      if (drift.drifted) {
        driftWarnings.push({ branch, mergedParent: directParent.branch });
      }
    }
    if (!dirty) {
      const parentHead = await resolveParentHead(cwd, stack, node);
      if (!parentHead)
        continue;
      const conflicts = await GitShell.mergeTreeDryRun(cwd, parentHead, branch, tombstone);
      if (conflicts) {
        const typedConflicts = conflicts.map((c) => ({
          file: c.file,
          type: normalizeMergeTreeKind(c.kind)
        }));
        conflictBranches.push({ branch, files: typedConflicts });
      }
    }
  }
  return { dirty, hasStagedChanges: staged, conflictBranches, threadWarnings, driftWarnings };
}
function resolveLiveAncestor(stack, branch) {
  let current = branch;
  while (current !== stack.root) {
    const node = stack.nodes.find((n) => n.branch === current);
    if (!node || node.status !== "merged")
      break;
    current = node.parent;
  }
  return current;
}
async function resolveParentHead(cwd, stack, node) {
  try {
    const directParent = stack.nodes.find((n) => n.branch === node.parent);
    if (directParent?.status === "merged") {
      const liveAncestor = resolveLiveAncestor(stack, node.parent);
      const effectiveRef = liveAncestor === stack.root ? `origin/${stack.root}` : liveAncestor;
      return await GitShell.getBranchHead(cwd, effectiveRef);
    }
    if (node.parent === stack.root) {
      try {
        return await GitShell.getBranchHead(cwd, `origin/${stack.root}`);
      } catch {}
    }
    return await GitShell.getBranchHead(cwd, node.parent);
  } catch {
    return null;
  }
}
async function reconcileDrift(cwd, tombstone, branch, storedForkPoint, parentRef) {
  try {
    const isAnc = await GitShell.isAncestor(cwd, tombstone, branch);
    if (isAnc)
      return { drifted: false };
    if (storedForkPoint) {
      const valid = await validateTombstone(cwd, storedForkPoint);
      if (valid)
        return { drifted: true, forkPoint: storedForkPoint };
    }
    if (parentRef) {
      const reflogFP = await GitShell.getMergeBaseForkPoint(cwd, parentRef, branch);
      if (reflogFP)
        return { drifted: true, forkPoint: reflogFP };
    }
    const forkPoint = await GitShell.getMergeBase(cwd, tombstone, branch);
    return { drifted: true, forkPoint };
  } catch {
    return { drifted: false };
  }
}
async function cherryPickReconcile(cwd, tombstone, branch, parentBranch) {
  try {
    const reflogFP = await GitShell.getMergeBaseForkPoint(cwd, parentBranch, branch);
    if (reflogFP) {
      return RebaseEngine.rebaseSingle(cwd, tombstone, reflogFP, branch);
    }
    const entries = await GitShell.cherry(cwd, tombstone, branch);
    if (entries.length === 0) {
      return { branch, success: true };
    }
    const uniqueSHAs = entries.filter((e) => e.unique).map((e) => e.sha);
    if (uniqueSHAs.length === 0) {
      await GitShell.checkoutBranch(cwd, branch);
      await GitShell.resetHard(cwd, tombstone);
      return { branch, success: true };
    }
    const oldestUnique = uniqueSHAs[0];
    const forkForUnique = `${oldestUnique}~1`;
    return RebaseEngine.rebaseSingle(cwd, tombstone, forkForUnique, branch);
  } catch (err) {
    return { branch, success: false, error: toErrorMessage(err) };
  }
}
async function validateTombstone(cwd, sha) {
  const objType = await GitShell.catFileType(cwd, sha);
  return objType ? sha : null;
}
function resolveOldBase(stack, node, mergedBranch) {
  if (node.parent === mergedBranch) {
    const mergedNode = StackManager.findNode(stack, mergedBranch);
    return mergedNode?.lastKnownHead ?? null;
  }
  const parentNode = StackManager.findNode(stack, node.parent);
  return parentNode?.lastKnownHead ?? null;
}
function makeTombstoneResolver(cwd, mergedBranch) {
  return async (stack, node) => {
    const oldBase = resolveOldBase(stack, node, mergedBranch);
    if (!oldBase) {
      return {
        kind: "error",
        message: `No lastKnownHead found for parent "${node.parent}" — cannot determine rebase base`
      };
    }
    const valid = await validateTombstone(cwd, oldBase);
    if (!valid) {
      return {
        kind: "error",
        message: `Tombstone ${oldBase.slice(0, 8)} for "${node.parent}" has been garbage-collected — cannot rebase`
      };
    }
    return { kind: "rebase", oldBase };
  };
}
function makeCascadeResolvers(cwd, stack, rootTarget, preRebaseHeads = {}) {
  const resolveParentRef = (node) => {
    const liveAncestor = resolveLiveAncestor(stack, node.parent);
    return liveAncestor === stack.root ? rootTarget : liveAncestor;
  };
  const resolveBase = async (_stack, node) => {
    try {
      const parentNode = stack.nodes.find((n) => n.branch === node.parent);
      if (parentNode?.status === "merged") {
        let tombstone = null;
        try {
          tombstone = await GitShell.getBranchHead(cwd, parentNode.branch);
        } catch {}
        if (!tombstone)
          tombstone = parentNode.lastKnownHead;
        if (tombstone) {
          return { kind: "rebase", oldBase: tombstone };
        }
      }
      const parentRef = resolveParentRef(node);
      const parentHead = await GitShell.getBranchHead(cwd, parentRef);
      const oldParentHead = parentNode ? preRebaseHeads[node.parent] : undefined;
      const oldBase = oldParentHead ? await GitShell.getMergeBase(cwd, node.branch, oldParentHead) : await GitShell.getMergeBase(cwd, node.branch, parentRef);
      if (oldBase === parentHead)
        return { kind: "skip" };
      return { kind: "rebase", oldBase };
    } catch {
      return { kind: "skip" };
    }
  };
  return { resolveParentRef, resolveBase };
}
async function isFullyRedundant(cwd, targetBase, branch) {
  try {
    const entries = await GitShell.cherry(cwd, targetBase, branch);
    if (entries.length === 0)
      return true;
    return entries.every((e) => !e.unique);
  } catch {
    return false;
  }
}
async function finalizeBranchRef(cwd, branch, oldHead, newHead) {
  try {
    const map = await getWorktreeMap(cwd);
    const owner = findSlotForBranch(map, branch);
    if (owner) {
      const fresh = await GitShell.isDirty(owner.path).catch(() => true);
      const stillOnOld = await GitShell.getBranchHead(owner.path, "HEAD") === oldHead;
      if (fresh || owner.rebaseInProgress || !stillOnOld) {
        return {
          branch,
          success: false,
          error: `branch is checked out in ${describeSlot(owner)} which is ${fresh ? "dirty" : owner.rebaseInProgress ? "mid-rebase" : "not on the branch head"}; commit or stash there, or free the slot, then retry`
        };
      }
      await GitShell.updateRefCas(cwd, branch, newHead, oldHead);
      await GitShell.resetHard(owner.path, newHead);
      return { branch, success: true };
    }
    await GitShell.updateRefCas(cwd, branch, newHead, oldHead);
    return { branch, success: true };
  } catch (err) {
    return { branch, success: false, error: toErrorMessage(err) };
  }
}
async function doCascadeLoop(cwd, initialStack, nodes, resolveBase, resolveNewBase, pauseContext, preRebaseHeads = {}, workDir) {
  let updatedStack = initialStack;
  const results = [];
  const rebasedBranches = [];
  for (let i = 0;i < nodes.length; i++) {
    const node = nodes[i];
    if (!node)
      continue;
    if (node.unmanaged)
      continue;
    const baseResult = await resolveBase(initialStack, node);
    if (baseResult.kind === "skip") {
      continue;
    }
    if (baseResult.kind === "error") {
      results.push({ branch: node.branch, success: false, error: baseResult.message });
      break;
    }
    try {
      preRebaseHeads[node.branch] = await GitShell.getBranchHead(cwd, node.branch);
    } catch {}
    let reconciled = null;
    const directParent = initialStack.nodes.find((n) => n.branch === node.parent);
    if (directParent?.status === "merged") {
      let tombstone = null;
      try {
        tombstone = await GitShell.getBranchHead(cwd, directParent.branch);
      } catch {
        tombstone = directParent.lastKnownHead;
      }
      if (tombstone) {
        if (workDir) {
          const startHead = preRebaseHeads[node.branch] ?? await GitShell.getBranchHead(cwd, node.branch);
          const alreadyReconciled = await GitShell.isAncestor(cwd, tombstone, startHead).catch(() => false);
          if (!alreadyReconciled) {
            if (await isFullyRedundant(cwd, tombstone, startHead)) {
              reconciled = { head: tombstone, base: tombstone };
            } else {
              let fp = await GitShell.getMergeBaseForkPoint(cwd, directParent.branch, node.branch).catch(() => null);
              if (!fp && node.forkPoint && await validateTombstone(cwd, node.forkPoint)) {
                fp = node.forkPoint;
              }
              if (!fp) {
                fp = await GitShell.getMergeBase(cwd, tombstone, startHead).catch(() => null);
              }
              if (fp) {
                try {
                  await GitShell.detachAt(workDir, startHead);
                  await GitShell.rebaseOntoDetached(workDir, tombstone, fp);
                  reconciled = {
                    head: await GitShell.getBranchHead(workDir, "HEAD"),
                    base: tombstone
                  };
                } catch (err) {
                  const typedConflicts = await GitShell.listConflictedFilesWithTypes(workDir).catch(() => []);
                  const conflictFiles = typedConflicts.length > 0 ? typedConflicts.map((c) => c.file) : await GitShell.listConflictedFiles(workDir).catch(() => []);
                  if (conflictFiles.length > 0) {
                    return {
                      results,
                      updatedStack,
                      state: "paused",
                      pauseInfo: {
                        currentBranch: node.branch,
                        conflictFiles,
                        remainingBranches: nodes.slice(i + 1).map((n) => n.branch),
                        completedBranches: results.filter((r) => r.success).map((r) => r.branch),
                        mergedBranch: pauseContext.mergedBranch,
                        newBase: pauseContext.newBase,
                        currentTarget: tombstone,
                        phase: "reconcile",
                        conflictTypes: typedConflicts,
                        preRebaseHeads: { ...preRebaseHeads },
                        worktreePath: workDir
                      }
                    };
                  }
                  results.push({ branch: node.branch, success: false, error: toErrorMessage(err) });
                  break;
                }
              }
            }
          }
        } else {
          const reflogFP = await GitShell.getMergeBaseForkPoint(cwd, directParent.branch, node.branch).catch(() => null);
          if (reflogFP) {
            const reconResult = await RebaseEngine.rebaseSingle(cwd, tombstone, reflogFP, node.branch);
            if (!reconResult.success) {
              const typedConflicts = await GitShell.listConflictedFilesWithTypes(cwd).catch(() => []);
              const conflictFiles = typedConflicts.length > 0 ? typedConflicts.map((c) => c.file) : await GitShell.listConflictedFiles(cwd).catch(() => []);
              if (conflictFiles.length > 0) {
                const completedBranches = results.filter((r) => r.success).map((r) => r.branch);
                const remainingBranches = nodes.slice(i + 1).map((n) => n.branch);
                return {
                  results,
                  updatedStack,
                  state: "paused",
                  pauseInfo: {
                    currentBranch: node.branch,
                    conflictFiles,
                    remainingBranches,
                    completedBranches,
                    mergedBranch: pauseContext.mergedBranch,
                    newBase: pauseContext.newBase,
                    currentTarget: tombstone,
                    phase: "reconcile",
                    conflictTypes: typedConflicts,
                    preRebaseHeads: { ...preRebaseHeads },
                    treePath: cwd
                  }
                };
              }
              results.push(reconResult);
              break;
            }
          } else {
            const drift = await reconcileDrift(cwd, tombstone, node.branch, node.forkPoint ?? null, directParent.branch);
            if (drift.drifted) {
              const redundant = await isFullyRedundant(cwd, tombstone, node.branch);
              if (redundant) {
                await GitShell.checkoutBranch(cwd, node.branch);
                await GitShell.resetHard(cwd, tombstone);
              } else {
                const reconResult = await cherryPickReconcile(cwd, tombstone, node.branch, directParent.branch);
                if (!reconResult.success) {
                  const typedConflicts = await GitShell.listConflictedFilesWithTypes(cwd).catch(() => []);
                  const conflictFiles = typedConflicts.length > 0 ? typedConflicts.map((c) => c.file) : await GitShell.listConflictedFiles(cwd).catch(() => []);
                  if (conflictFiles.length > 0) {
                    const completedBranches = results.filter((r) => r.success).map((r) => r.branch);
                    const remainingBranches = nodes.slice(i + 1).map((n) => n.branch);
                    return {
                      results,
                      updatedStack,
                      state: "paused",
                      pauseInfo: {
                        currentBranch: node.branch,
                        conflictFiles,
                        remainingBranches,
                        completedBranches,
                        mergedBranch: pauseContext.mergedBranch,
                        newBase: pauseContext.newBase,
                        currentTarget: tombstone,
                        phase: "reconcile",
                        conflictTypes: typedConflicts,
                        preRebaseHeads: { ...preRebaseHeads },
                        treePath: cwd
                      }
                    };
                  }
                  results.push(reconResult);
                  break;
                }
              }
            }
          }
        }
      }
    }
    if (node.status === "merged") {
      results.push({ branch: node.branch, success: true });
      continue;
    }
    const targetBase = resolveNewBase(node);
    const cascadeRedundant = await isFullyRedundant(cwd, targetBase, reconciled?.head ?? node.branch);
    if (cascadeRedundant) {
      if (workDir) {
        const oldHead = preRebaseHeads[node.branch];
        const targetSha = await GitShell.getBranchHead(cwd, targetBase);
        const ff = oldHead ? await finalizeBranchRef(cwd, node.branch, oldHead, targetSha) : { branch: node.branch, success: false, error: "missing pre-rebase head for fast-forward" };
        results.push(ff);
        if (!ff.success)
          break;
      } else {
        await GitShell.checkoutBranch(cwd, node.branch);
        await GitShell.resetHard(cwd, targetBase);
        results.push({ branch: node.branch, success: true });
      }
    } else if (workDir) {
      const oldHead = preRebaseHeads[node.branch] ?? await GitShell.getBranchHead(cwd, node.branch);
      let rebased = true;
      try {
        if (reconciled) {
          await GitShell.detachAt(workDir, reconciled.head);
          await GitShell.rebaseOntoDetached(workDir, targetBase, reconciled.base);
        } else {
          await GitShell.detachAt(workDir, oldHead);
          await GitShell.rebaseOntoDetached(workDir, targetBase, baseResult.oldBase);
        }
      } catch (err) {
        rebased = false;
        const typedConflicts = await GitShell.listConflictedFilesWithTypes(workDir).catch(() => []);
        const conflictFiles = typedConflicts.length > 0 ? typedConflicts.map((c) => c.file) : await GitShell.listConflictedFiles(workDir).catch(() => []);
        if (conflictFiles.length > 0) {
          const completedBranches = results.filter((r) => r.success).map((r) => r.branch);
          const remainingBranches = nodes.slice(i + 1).map((n) => n.branch);
          return {
            results,
            updatedStack,
            state: "paused",
            pauseInfo: {
              currentBranch: node.branch,
              conflictFiles,
              remainingBranches,
              completedBranches,
              mergedBranch: pauseContext.mergedBranch,
              newBase: pauseContext.newBase,
              currentTarget: targetBase,
              phase: "cascade",
              conflictTypes: typedConflicts,
              preRebaseHeads: { ...preRebaseHeads },
              worktreePath: workDir
            }
          };
        }
        results.push({ branch: node.branch, success: false, error: toErrorMessage(err) });
        break;
      }
      if (rebased) {
        const newHead = await GitShell.getBranchHead(workDir, "HEAD");
        const fin = await finalizeBranchRef(cwd, node.branch, oldHead, newHead);
        await GitShell.detachAt(workDir, newHead).catch(() => {});
        results.push(fin);
        if (!fin.success)
          break;
      }
    } else {
      const result = await RebaseEngine.rebaseSingle(cwd, targetBase, baseResult.oldBase, node.branch);
      results.push(result);
      if (!result.success) {
        const typedConflicts = await GitShell.listConflictedFilesWithTypes(cwd).catch(() => []);
        const conflictFiles = typedConflicts.length > 0 ? typedConflicts.map((c) => c.file) : await GitShell.listConflictedFiles(cwd).catch(() => []);
        if (conflictFiles.length > 0) {
          const completedBranches = results.filter((r) => r.success).map((r) => r.branch);
          const remainingBranches = nodes.slice(i + 1).map((n) => n.branch);
          return {
            results,
            updatedStack,
            state: "paused",
            pauseInfo: {
              currentBranch: node.branch,
              conflictFiles,
              remainingBranches,
              completedBranches,
              mergedBranch: pauseContext.mergedBranch,
              newBase: pauseContext.newBase,
              currentTarget: targetBase,
              phase: "cascade",
              conflictTypes: typedConflicts,
              preRebaseHeads: { ...preRebaseHeads }
            }
          };
        }
        break;
      }
    }
    try {
      const newHead = await GitShell.getBranchHead(cwd, node.branch);
      updatedStack = StackManager.updateNode(updatedStack, node.branch, {
        lastKnownHead: newHead
      });
      rebasedBranches.push(node.branch);
    } catch {}
  }
  return { results, updatedStack, state: "completed", rebasedBranches };
}
async function unresolvedTrunkMessage(cwd, trunk, remoteTrunk) {
  let hasRemote = true;
  try {
    await GitShell.getRemoteUrl(cwd);
  } catch {
    hasRemote = false;
  }
  const cause = hasRemote ? `"${trunk}" was never pushed to origin, or this remote's fetch refspec does not cover it; if it was never pushed: git push -u origin ${trunk}` : 'this repo has no remote named "origin"; gitq always syncs onto origin/<root>';
  return `cannot sync: ${remoteTrunk} does not resolve after fetching origin (${cause}). nothing was rebased`;
}
var RebaseEngine = {
  preflight,
  async rebaseSingle(cwd, newBase, oldBase, branch) {
    try {
      await GitShell.rebaseOnto(cwd, newBase, oldBase, branch);
      return { branch, success: true };
    } catch (err) {
      return { branch, success: false, error: toErrorMessage(err) };
    }
  },
  async needsRebase(cwd, stack, branch) {
    const node = StackManager.findNode(stack, branch);
    if (!node)
      return false;
    try {
      const parentHead = await GitShell.getBranchHead(cwd, node.parent);
      const mergeBase = await GitShell.getMergeBase(cwd, branch, node.parent);
      return mergeBase !== parentHead;
    } catch {
      return false;
    }
  },
  async cascadeRebase(cwd, stack, mergedBranch, newBase, workDir) {
    const descendants = StackManager.getDescendants(stack, mergedBranch);
    return doCascadeLoop(cwd, stack, descendants, makeTombstoneResolver(cwd, mergedBranch), (node) => node.parent === mergedBranch ? newBase : node.parent, { mergedBranch, newBase }, {}, workDir);
  },
  async continueCascade(cwd, stack, pauseInfo, workDir) {
    const treeDir = workDir ?? pauseInfo.worktreePath ?? cwd;
    try {
      await GitShell.rebaseContinue(treeDir);
    } catch {
      const conflictFiles = await GitShell.listConflictedFiles(treeDir).catch(() => []);
      if (conflictFiles.length > 0) {
        const typedConflicts = await GitShell.listConflictedFilesWithTypes(treeDir).catch(() => []);
        const progress = GitShell.getRebaseProgress(treeDir);
        return {
          results: [],
          updatedStack: stack,
          state: "paused",
          pauseInfo: {
            ...pauseInfo,
            conflictFiles,
            conflictTypes: typedConflicts,
            commitIndex: progress?.current,
            commitTotal: progress?.total
          }
        };
      }
      return {
        results: [
          { branch: pauseInfo.currentBranch, success: false, error: "rebase --continue failed" }
        ],
        updatedStack: stack,
        state: "completed"
      };
    }
    let updatedStack = stack;
    let firstResult = { branch: pauseInfo.currentBranch, success: true };
    if (pauseInfo.phase === "reconcile") {
      const node = StackManager.findNode(stack, pauseInfo.currentBranch);
      if (node) {
        const parentNode = StackManager.findNode(stack, node.parent);
        const tombstone = pauseInfo.currentTarget ?? parentNode?.lastKnownHead;
        if (tombstone) {
          const useTombstone2 = pauseInfo.mergedBranch !== null;
          const targetBase = useTombstone2 && node.parent === pauseInfo.mergedBranch ? pauseInfo.newBase : makeCascadeResolvers(cwd, stack, pauseInfo.newBase).resolveParentRef(node);
          if (pauseInfo.worktreePath) {
            try {
              await GitShell.rebaseOntoDetached(treeDir, targetBase, tombstone);
            } catch {
              const typedConflicts = await GitShell.listConflictedFilesWithTypes(treeDir).catch(() => []);
              const conflictFiles = typedConflicts.length > 0 ? typedConflicts.map((c) => c.file) : await GitShell.listConflictedFiles(treeDir).catch(() => []);
              if (conflictFiles.length > 0) {
                const progress = GitShell.getRebaseProgress(treeDir);
                return {
                  results: [],
                  updatedStack,
                  state: "paused",
                  pauseInfo: {
                    ...pauseInfo,
                    conflictFiles,
                    phase: "cascade",
                    currentTarget: targetBase,
                    conflictTypes: typedConflicts,
                    commitIndex: progress?.current,
                    commitTotal: progress?.total
                  }
                };
              }
              return {
                results: [{
                  branch: pauseInfo.currentBranch,
                  success: false,
                  error: "main rebase failed after reconciliation"
                }],
                updatedStack: stack,
                state: "completed"
              };
            }
          } else {
            const mainResult = await RebaseEngine.rebaseSingle(treeDir, targetBase, tombstone, node.branch);
            if (!mainResult.success) {
              const conflictFiles = await GitShell.listConflictedFiles(treeDir).catch(() => []);
              if (conflictFiles.length > 0) {
                const typedConflicts = await GitShell.listConflictedFilesWithTypes(treeDir).catch(() => []);
                const progress = GitShell.getRebaseProgress(treeDir);
                return {
                  results: [firstResult],
                  updatedStack,
                  state: "paused",
                  pauseInfo: {
                    ...pauseInfo,
                    conflictFiles,
                    phase: "cascade",
                    currentTarget: targetBase,
                    conflictTypes: typedConflicts,
                    commitIndex: progress?.current,
                    commitTotal: progress?.total
                  }
                };
              }
              return { results: [firstResult, mainResult], updatedStack, state: "completed" };
            }
          }
        }
      }
    }
    if (pauseInfo.worktreePath) {
      const newHead = await GitShell.getBranchHead(treeDir, "HEAD");
      const oldHead = pauseInfo.preRebaseHeads?.[pauseInfo.currentBranch];
      if (!oldHead) {
        return {
          results: [{
            branch: pauseInfo.currentBranch,
            success: false,
            error: "missing pre-rebase head for finalization — cannot safely move the branch ref"
          }],
          updatedStack: stack,
          state: "completed"
        };
      }
      const fin = await finalizeBranchRef(cwd, pauseInfo.currentBranch, oldHead, newHead);
      await GitShell.detachAt(treeDir, newHead).catch(() => {});
      if (!fin.success) {
        return { results: [fin], updatedStack: stack, state: "completed" };
      }
      firstResult = fin;
    }
    const results = [firstResult];
    const rebasedBranches = [];
    const isNode = StackManager.findNode(stack, pauseInfo.currentBranch) !== undefined;
    if (isNode) {
      try {
        const newHead = await GitShell.getBranchHead(cwd, pauseInfo.currentBranch);
        updatedStack = StackManager.updateNode(updatedStack, pauseInfo.currentBranch, {
          lastKnownHead: newHead
        });
        rebasedBranches.push(pauseInfo.currentBranch);
      } catch {}
    }
    if (pauseInfo.remainingBranches.length === 0) {
      return { results, updatedStack, state: "completed", rebasedBranches };
    }
    const remainingNodes = pauseInfo.remainingBranches.map((b) => StackManager.findNode(updatedStack, b)).filter((n) => n !== undefined);
    const useTombstone = pauseInfo.mergedBranch !== null;
    const resumeHeads = { ...pauseInfo.preRebaseHeads ?? {} };
    const cascadeResolvers = makeCascadeResolvers(cwd, stack, pauseInfo.newBase, resumeHeads);
    const resolver = useTombstone ? makeTombstoneResolver(cwd, pauseInfo.mergedBranch ?? "") : cascadeResolvers.resolveBase;
    const newBaseResolver = useTombstone ? (node) => node.parent === pauseInfo.mergedBranch ? pauseInfo.newBase : node.parent : (node) => cascadeResolvers.resolveParentRef(node);
    const cascadeResult = await doCascadeLoop(cwd, stack, remainingNodes, resolver, newBaseResolver, { mergedBranch: pauseInfo.mergedBranch, newBase: pauseInfo.newBase }, resumeHeads, treeDir === cwd ? undefined : treeDir);
    const combined = {
      results: [...results, ...cascadeResult.results],
      updatedStack: cascadeResult.updatedStack,
      state: cascadeResult.state,
      rebasedBranches: [...rebasedBranches, ...cascadeResult.rebasedBranches ?? []]
    };
    if (cascadeResult.pauseInfo) {
      combined.pauseInfo = cascadeResult.pauseInfo;
    }
    return combined;
  },
  async abortCascade(cwd, workDir) {
    await GitShell.rebaseAbort(workDir ?? cwd);
  },
  async restackFrom(cwd, stack, branch, workDir, seedHeads) {
    const descendants = StackManager.getDescendants(stack, branch);
    if (descendants.length === 0) {
      return { results: [], updatedStack: stack, state: "completed" };
    }
    const preRebaseHeads = { ...seedHeads ?? {} };
    const { resolveBase } = makeCascadeResolvers(cwd, stack, branch, preRebaseHeads);
    return doCascadeLoop(cwd, stack, descendants, resolveBase, (node) => node.parent, { mergedBranch: null, newBase: branch }, preRebaseHeads, workDir);
  },
  async syncLocalStack(cwd, stack, workDir) {
    const trunk = stack.root;
    const remoteTrunk = `origin/${trunk}`;
    try {
      await GitShell.fetch(cwd);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch from remote: ${detail}`);
    }
    try {
      await GitShell.getBranchHead(cwd, remoteTrunk);
    } catch {
      throw new Error(await unresolvedTrunkMessage(cwd, trunk, remoteTrunk));
    }
    const preRebaseHeads = {};
    const { resolveParentRef, resolveBase } = makeCascadeResolvers(cwd, stack, remoteTrunk, preRebaseHeads);
    const allNodes = StackManager.toposort(stack);
    return doCascadeLoop(cwd, stack, allNodes, resolveBase, (node) => resolveParentRef(node), { mergedBranch: null, newBase: remoteTrunk }, preRebaseHeads, workDir);
  }
};

// src/cli/commands/preflight.ts
async function preflightCommand(ctx) {
  const store = await loadStore(ctx.repoRoot);
  const worktrees = await worktreesForJson(ctx);
  const stacks = [];
  for (const stack of store.stacks) {
    const branches = stack.nodes.map((n) => n.branch);
    const report = await RebaseEngine.preflight(ctx.repoRoot, stack, branches);
    const slotConflicts = branches.flatMap((branch) => {
      const owner = worktrees.find((w) => !w.isWorkSlot && w.branch === branch);
      return owner ? [{ branch, slot: owner.name, dirty: owner.dirty }] : [];
    });
    stacks.push({ stackName: stack.stackName, report, slotConflicts });
  }
  const human = stacks.map((s) => {
    const conflicts = s.report.conflictBranches.map((c) => `  ${c.branch}: ${c.files.map((f) => `${f.type} ${f.file}`).join(", ")}`).join(`
`);
    const slotConflicts = s.slotConflicts.length > 0 ? `
slot conflicts:
${s.slotConflicts.map((c) => `  ${c.branch}: ${c.slot}${c.dirty ? " (dirty)" : ""}`).join(`
`)}` : "";
    return `${s.stackName}: dirty=${s.report.dirty}
${conflicts || "  no predicted conflicts"}${slotConflicts}`;
  }).join(`
`);
  emit(ctx, human || "no stacks", { stacks, worktrees });
  return 0;
}

// src/core/operation-log.ts
import { randomUUID } from "node:crypto";
var MAX_ENTRIES = 50;
var OperationLog = {
  create(operation, stack, branchSnapshots, repoPath) {
    return {
      id: randomUUID(),
      timestamp: Date.now(),
      operation,
      commands: [],
      branchSnapshots,
      stackSnapshot: structuredClone(stack),
      ...repoPath ? { repoPath } : {}
    };
  },
  addCommand(entry, command, args, cwd, exitCode, duration) {
    return {
      ...entry,
      commands: [...entry.commands, { command, args, cwd, exitCode, duration }]
    };
  },
  commandHook(entry) {
    return (command, args, cwd, exitCode, duration) => {
      entry.commands.push({ command, args, cwd, exitCode, duration });
    };
  },
  async save(entry) {
    await withFileLock(getOperationLogFilePath(), async () => {
      let entries;
      try {
        entries = await readJson(getOperationLogFilePath(), []);
      } catch {
        entries = [];
      }
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) {
        entries = entries.slice(entries.length - MAX_ENTRIES);
      }
      await writeJsonAtomic(getOperationLogFilePath(), entries);
    });
  },
  async load() {
    try {
      return await readJson(getOperationLogFilePath(), []);
    } catch {
      return [];
    }
  },
  async getLastEntry() {
    const entries = await OperationLog.load();
    return entries.length > 0 ? entries[entries.length - 1] ?? null : null;
  }
};
function entryBelongsToRepo(entry, identity) {
  if (entry.commonDir === undefined && entry.repoPath === undefined)
    return true;
  return entry.commonDir === identity || entry.repoPath === identity;
}

// src/cli/commands/log.ts
async function logCommand(ctx) {
  const all = await OperationLog.load();
  const entries = all.filter((e) => entryBelongsToRepo(e, ctx.commonDir));
  const otherRepoCount = all.length - entries.length;
  const lines = entries.map((e) => {
    const branches = Object.keys(e.branchSnapshots).join(", ") || "no branches";
    return `${new Date(e.timestamp).toISOString()} ${e.operation} (${branches})`;
  });
  let human = lines.join(`
`) || "no operations";
  if (otherRepoCount > 0) {
    human += `
(${otherRepoCount} operation(s) from other repos hidden)`;
  }
  emit(ctx, human, { entries, otherRepoCount });
  return 0;
}

// src/cli/commands/crud.ts
function pickStack(store, flags) {
  const name = typeof flags.stack === "string" ? flags.stack : null;
  if (name) {
    const found = store.stacks.find((s) => s.stackName === name);
    if (!found)
      throw new Error(`no stack named ${name} (have: ${store.stacks.map((s) => s.stackName).join(", ") || "none"})`);
    return found;
  }
  if (store.stacks.length === 1)
    return store.stacks[0];
  throw new Error(`--stack required (have: ${store.stacks.map((s) => s.stackName).join(", ") || "none"})`);
}
function replaceStack(store, updated) {
  return { ...store, stacks: store.stacks.map((s) => s.id === updated.id ? updated : s) };
}
async function trackCommand(ctx) {
  const [stackName] = ctx.args;
  const root = typeof ctx.flags.root === "string" ? ctx.flags.root : null;
  if (!stackName || !root)
    return fail("usage: gitq track <stackName> --root <branch>");
  const store = await loadStore(ctx.repoRoot);
  if (store.stacks.some((s) => s.stackName === stackName))
    return fail(`stack ${stackName} already exists`);
  const stack = StackManager.createStack(stackName, root);
  await updateStore(ctx.repoRoot, (fresh) => ({ ...fresh, stacks: [...fresh.stacks, stack] }));
  emit(ctx, `tracked ${stackName} (root ${root})`, { stack });
  return 0;
}
async function untrackCommand(ctx) {
  const [stackName] = ctx.args;
  if (!stackName)
    return fail("usage: gitq untrack <stackName>");
  const store = await loadStore(ctx.repoRoot);
  const stack = store.stacks.find((s) => s.stackName === stackName);
  if (!stack) {
    return fail(`no stack named ${stackName} (have: ${store.stacks.map((s) => s.stackName).join(", ") || "none"})`);
  }
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  await updateStore(ctx.repoRoot, (fresh) => ({
    ...fresh,
    stacks: fresh.stacks.filter((s) => s.stackName !== stackName)
  }));
  emit(ctx, `untracked ${stackName}`, { removed: stackName });
  return 0;
}
async function addCommand(ctx) {
  const [branch] = ctx.args;
  const parent = typeof ctx.flags.parent === "string" ? ctx.flags.parent : null;
  if (!branch || !parent)
    return fail("usage: gitq add <branch> --parent <branch> [--stack <name>]");
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  const updated = StackManager.addNode(stack, branch, parent);
  await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, updated));
  emit(ctx, `added ${branch} under ${parent}`, { stack: updated });
  return 0;
}
async function removeCommand(ctx) {
  const [branch] = ctx.args;
  if (!branch)
    return fail("usage: gitq remove <branch> [--stack <name>]");
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  const updated = StackManager.removeNode(stack, branch);
  await updateStore(ctx.repoRoot, (fresh) => replaceStack(fresh, updated));
  emit(ctx, `removed ${branch}`, { stack: updated });
  return 0;
}

// src/cli/pause-file.ts
import { join as join6 } from "node:path";
import { unlink as unlink2 } from "node:fs/promises";
function pausePath(gitDir) {
  return join6(gitDir, "gitq-pause.json");
}
async function readPause(gitDir) {
  return readJson(pausePath(gitDir), null);
}
async function writePause(gitDir, pause) {
  await writeJsonAtomic(pausePath(gitDir), pause);
}
async function clearPause(gitDir) {
  await unlink2(pausePath(gitDir)).catch(() => {});
}
async function requireNoPause(ctx) {
  if (await readPause(ctx.gitDir)) {
    return fail("a cascade is paused here; resolve it first: gitq continue (or gitq abort)");
  }
  return null;
}

// src/cli/op-log.ts
async function snapshotBranches(cwd, stack) {
  const snapshots = {};
  const branches = new Set([stack.root, ...stack.nodes.map((n) => n.branch)]);
  for (const branch of branches) {
    try {
      snapshots[branch] = await GitShell.getBranchHead(cwd, branch);
    } catch {}
  }
  return snapshots;
}
async function withOperationLog(ctx, stack, operation, fn, shouldLog = (code) => code === 0) {
  const snapshots = await snapshotBranches(ctx.repoRoot, stack);
  const entry = { ...OperationLog.create(operation, stack, snapshots, ctx.repoRoot), commonDir: ctx.commonDir };
  setCommandHook(OperationLog.commandHook(entry));
  let exitCode;
  try {
    exitCode = await fn();
  } finally {
    setCommandHook(null);
  }
  if (shouldLog(exitCode)) {
    await OperationLog.save(entry).catch(() => {});
  }
  return exitCode;
}

// src/cli/commands/cascade.ts
async function finishCascade(ctx, stackId, result, workDir) {
  const pauseDir = await slotGitDir(workDir);
  if (result.state === "paused" && result.pauseInfo) {
    await writePause(pauseDir, { stackId, pauseInfo: result.pauseInfo });
    await updateStore(ctx.repoRoot, (store) => ({
      ...store,
      stacks: store.stacks.map((s) => s.id === stackId ? result.updatedStack : s)
    }));
    const types = (result.pauseInfo.conflictTypes ?? []).map((c) => `${c.type} ${c.file}`).join(`
  `);
    const rebaseTree = result.pauseInfo.worktreePath ?? result.pauseInfo.treePath ?? ctx.repoRoot;
    emit(ctx, `paused on ${result.pauseInfo.currentBranch} in ${rebaseTree} (commit ${result.pauseInfo.commitIndex ?? "?"}/${result.pauseInfo.commitTotal ?? "?"}):
  ${types}
resolve with git in that worktree, stage, then: gitq continue (or gitq abort)`, { state: "paused", pauseInfo: result.pauseInfo });
    return 2;
  }
  await updateStore(ctx.repoRoot, (store) => ({
    ...store,
    stacks: store.stacks.map((s) => s.id === stackId ? result.updatedStack : s)
  }));
  await clearPause(pauseDir);
  emit(ctx, `${result.state}: ${result.results.map((r) => `${r.branch} ${r.success ? "ok" : `FAILED (${r.error})`}`).join(", ")}`, {
    state: result.state,
    results: result.results,
    rebasedBranches: result.rebasedBranches ?? []
  });
  return result.results.every((r) => r.success) ? 0 : 1;
}
async function syncCommand(ctx) {
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  return withLeasedSlot(ctx, stack, "sync", (workDir) => withOperationLog(ctx, stack, "sync", async () => {
    const result = await RebaseEngine.syncLocalStack(ctx.repoRoot, stack, workDir);
    return finishCascade(ctx, stack.id, result, workDir);
  }, (code) => code !== 2));
}
async function continueCommand(ctx) {
  const store = await loadStore(ctx.repoRoot);
  const named = typeof ctx.flags.stack === "string" ? store.stacks.find((s) => s.stackName === ctx.flags.stack)?.id : undefined;
  const located = await findParkedLease(ctx, named);
  if ("error" in located)
    return fail(located.error);
  const { lease } = located;
  const pauseDir = await slotGitDir(lease.slotPath);
  const pause = await readPause(pauseDir);
  if (!pause)
    return fail(`lease found but no pause file in ${lease.slotPath}; run: gitq abort`);
  const stack = store.stacks.find((s) => s.id === pause.stackId);
  if (!stack)
    return fail(`paused stack ${pause.stackId} no longer exists`);
  return withOperationLog(ctx, stack, "sync", async () => {
    const result = await RebaseEngine.continueCascade(ctx.repoRoot, stack, pause.pauseInfo, pause.pauseInfo.worktreePath ?? pause.pauseInfo.treePath);
    const code = await finishCascade(ctx, stack.id, result, lease.slotPath);
    if (code !== 2) {
      await GitShell.detachAt(lease.slotPath, "HEAD").catch(() => {});
      await releaseLease(ctx.commonDir, stack.id);
    }
    return code;
  }, (code) => code !== 2);
}
async function abortCommand(ctx) {
  const store = await loadStore(ctx.repoRoot);
  const named = typeof ctx.flags.stack === "string" ? store.stacks.find((s) => s.stackName === ctx.flags.stack)?.id : undefined;
  const located = await findParkedLease(ctx, named);
  if ("error" in located)
    return fail(located.error);
  const { lease } = located;
  const pauseDir = await slotGitDir(lease.slotPath);
  const pause = await readPause(pauseDir);
  await RebaseEngine.abortCascade(ctx.repoRoot, pause?.pauseInfo.worktreePath ?? pause?.pauseInfo.treePath);
  await clearPause(pauseDir);
  await GitShell.detachAt(lease.slotPath, "HEAD").catch(() => {});
  await releaseLease(ctx.commonDir, lease.stackId);
  emit(ctx, "aborted", { state: "aborted" });
  return 0;
}

// src/core/absorb.ts
import { readFile as readFile3, writeFile as writeFile3, mkdir as mkdir3, rm, lstat, readlink, symlink, chmod } from "node:fs/promises";
import { join as join7, dirname as dirname4 } from "node:path";
async function buildBranchFileCache(cwd, stack) {
  const nodesReversed = [...StackManager.toposort(stack)].reverse();
  const cache = new Map;
  for (const node of nodesReversed) {
    try {
      const files = await GitShell.getFilesChangedInRange(cwd, node.parent, node.branch);
      cache.set(node.branch, new Set(files));
    } catch {
      cache.set(node.branch, new Set);
    }
  }
  return { nodesReversed, cache };
}
async function attributeFiles(cwd, stack, changedFiles) {
  const { nodesReversed, cache } = await buildBranchFileCache(cwd, stack);
  const byBranch = new Map;
  const unattributed = [];
  for (const file of changedFiles) {
    let target = null;
    for (const node of nodesReversed) {
      const branchFiles = cache.get(node.branch);
      if (branchFiles?.has(file)) {
        target = node.branch;
        break;
      }
    }
    if (!target) {
      unattributed.push(file);
      continue;
    }
    const existing = byBranch.get(target) ?? [];
    existing.push(file);
    byBranch.set(target, existing);
  }
  return { byBranch, unattributed };
}
async function previewAbsorb(cwd, stack) {
  const currentBranch = await GitShell.getCurrentBranch(cwd);
  const changedResult = await GitShell.getChangedFiles(cwd);
  const allChanged = [
    ...new Set([...changedResult.modified, ...changedResult.staged, ...changedResult.untracked])
  ];
  if (allChanged.length === 0) {
    return { attributed: {}, unattributed: [], currentBranch };
  }
  const { byBranch, unattributed } = await attributeFiles(cwd, stack, allChanged);
  return { attributed: Object.fromEntries(byBranch), unattributed, currentBranch };
}
async function snapshotEntry(cwd, file, isDeleted) {
  const filePath = join7(cwd, file);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch (err) {
    if (isDeleted)
      return { kind: "deleted" };
    throw new Error(toErrorMessage(err));
  }
  if (stat.isSymbolicLink())
    return { kind: "symlink", target: await readlink(filePath) };
  return { kind: "file", content: await readFile3(filePath), mode: stat.mode & 4095 };
}
async function snapshotChanges(cwd, files, changed, indexStateFor) {
  const deleted = new Set(changed.deleted ?? []);
  const entries = new Map;
  const unreadable = [];
  for (const file of files) {
    try {
      entries.set(file, await snapshotEntry(cwd, file, deleted.has(file)));
    } catch (err) {
      unreadable.push(`${file} (${toErrorMessage(err)})`);
    }
  }
  if (unreadable.length > 0) {
    throw new Error(`absorb refused to start: ${unreadable.length} changed file(s) could not be read, ` + `and stashing would leave them nowhere to come back from: ${unreadable.join("; ")}. ` + "Nothing was stashed, committed, or removed.");
  }
  const indexStates = await snapshotIndexStates(cwd, indexStateFor, new Set(changed.staged));
  const snapshots = new Map;
  for (const [file, entry] of entries) {
    snapshots.set(file, { entry, index: indexStates.get(file) ?? { kind: "unstaged" } });
  }
  return snapshots;
}
async function snapshotIndexStates(cwd, files, staged) {
  const states = new Map;
  const stagedFiles = files.filter((f) => staged.has(f));
  if (stagedFiles.length === 0)
    return states;
  let entries = null;
  try {
    entries = await GitShell.getIndexEntries(cwd, stagedFiles);
  } catch {}
  for (const file of stagedFiles) {
    if (!entries) {
      states.set(file, { kind: "restage" });
      continue;
    }
    const entry = entries.get(file);
    states.set(file, entry ? { kind: "blob", entry } : { kind: "removal" });
  }
  return states;
}
async function writeEntry(cwd, file, entry) {
  const filePath = join7(cwd, file);
  if (entry.kind === "deleted") {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir3(dirname4(filePath), { recursive: true });
  await rm(filePath, { force: true });
  if (entry.kind === "symlink") {
    await symlink(entry.target, filePath);
    return;
  }
  await writeFile3(filePath, entry.content);
  await chmod(filePath, entry.mode);
}
async function restoreIndexState(cwd, file, index) {
  if (index.kind === "unstaged")
    return;
  if (index.kind === "restage") {
    await GitShell.add(cwd, [file]);
    return;
  }
  if (index.kind === "removal") {
    await GitShell.removeIndexEntry(cwd, file);
    return;
  }
  try {
    await GitShell.setIndexEntry(cwd, file, index.entry);
  } catch {
    await GitShell.add(cwd, [file]);
  }
}
async function restoreUnattributed(cwd, files, snapshots) {
  const failures = [];
  for (const file of files) {
    const snapshot = snapshots.get(file);
    if (!snapshot) {
      failures.push({ file, error: "no snapshot was taken" });
      continue;
    }
    try {
      await writeEntry(cwd, file, snapshot.entry);
      await restoreIndexState(cwd, file, snapshot.index);
    } catch (err) {
      failures.push({ file, error: toErrorMessage(err) });
    }
  }
  return failures;
}
async function absorb(cwd, stack, excludedFiles, workDir) {
  const currentBranch = await GitShell.getCurrentBranch(cwd);
  const changedResult = await GitShell.getChangedFiles(cwd);
  const excludeSet = new Set(excludedFiles ?? []);
  const allChanged = [
    ...new Set([...changedResult.modified, ...changedResult.staged, ...changedResult.untracked])
  ].filter((f) => !excludeSet.has(f));
  if (allChanged.length === 0) {
    return { absorbed: false, reason: "no-changes", attributions: [], unattributed: [] };
  }
  const { byBranch: fileMap, unattributed } = await attributeFiles(cwd, stack, allChanged);
  if (fileMap.size === 0) {
    return { absorbed: false, reason: "nothing-attributable", attributions: [], unattributed };
  }
  const snapshots = await snapshotChanges(cwd, allChanged, changedResult, unattributed);
  const preAmendHeads = new Map;
  for (const node of StackManager.toposort(stack)) {
    try {
      const head = await GitShell.getBranchHead(cwd, node.branch);
      preAmendHeads.set(node.branch, head);
    } catch {}
  }
  try {
    preAmendHeads.set(stack.root, await GitShell.getBranchHead(cwd, stack.root));
  } catch {}
  await GitShell.stash(cwd);
  const attributions = [];
  const orderedBranches = StackManager.toposort(stack).map((n) => n.branch);
  let updatedStack = stack;
  let abortNeeded = false;
  for (const branch of orderedBranches) {
    const files = fileMap.get(branch);
    if (!files || files.length === 0)
      continue;
    try {
      await GitShell.checkoutBranch(cwd, branch);
      for (const file of files) {
        const snapshot = snapshots.get(file);
        if (snapshot)
          await writeEntry(cwd, file, snapshot.entry);
      }
      await GitShell.add(cwd, files);
      await GitShell.amendNoEdit(cwd);
      const newHead = await GitShell.getBranchHead(cwd, branch);
      const node = StackManager.findNode(updatedStack, branch);
      if (node) {
        updatedStack = StackManager.updateNode(updatedStack, branch, {
          lastKnownHead: newHead
        });
      }
      attributions.push({ branch, files, success: true });
    } catch (err) {
      attributions.push({ branch, files, success: false, error: toErrorMessage(err) });
      abortNeeded = true;
      break;
    }
  }
  if (abortNeeded) {
    const recovery = await unwindFailedAmend(cwd, currentBranch);
    const aborted = { absorbed: false, attributions, unattributed };
    if (recovery)
      aborted.recovery = recovery;
    return aborted;
  }
  await GitShell.checkoutBranch(cwd, currentBranch);
  const affectedBranches = new Set(attributions.filter((a) => a.success).map((a) => a.branch));
  let cascadeResult;
  let restoreFailures = [];
  try {
    if (affectedBranches.size > 0) {
      cascadeResult = await cascadeAfterAbsorb(cwd, updatedStack, preAmendHeads, affectedBranches, workDir);
      if (cascadeResult) {
        updatedStack = cascadeResult.updatedStack;
      }
    }
  } finally {
    restoreFailures = await restoreUnattributed(cwd, unattributed, snapshots);
  }
  if (restoreFailures.length === 0) {
    try {
      await GitShell.stashDrop(cwd);
    } catch {}
  }
  const result = { absorbed: true, attributions, unattributed, updatedStack };
  if (cascadeResult)
    result.cascadeResult = cascadeResult;
  if (restoreFailures.length > 0) {
    const listed = restoreFailures.map((f) => `${f.file} (${f.error})`).join("; ");
    result.recovery = `absorb could not put ${restoreFailures.length} unattributed file(s) back: ${listed}. ` + "It kept the stash holding them rather than dropping it: recover with " + "`git stash pop` (inspect it first with `git stash show -p stash@{0}`).";
  }
  return result;
}
async function unwindFailedAmend(cwd, originalBranch) {
  const problems = [];
  let onOriginalBranch = true;
  try {
    await GitShell.checkoutBranch(cwd, originalBranch);
  } catch (err) {
    onOriginalBranch = false;
    const actual = await GitShell.getCurrentBranch(cwd).catch(() => "an unknown revision");
    problems.push(`could not check ${originalBranch} back out (${toErrorMessage(err)}) — you are on ${actual}`);
  }
  if (onOriginalBranch) {
    try {
      await GitShell.stashPop(cwd);
    } catch (err) {
      problems.push(`could not pop the stash holding your dirty tree (${toErrorMessage(err)})`);
    }
  } else {
    problems.push("left the stash alone rather than popping your dirty tree onto the wrong branch");
  }
  if (problems.length === 0)
    return null;
  return `absorb could not clean up after the failed amend: ${problems.join("; ")}. ` + "Your uncommitted work is retained in stash@{0} — inspect it with " + "`git stash show -p stash@{0}`, then get it back with `git checkout -f " + originalBranch + "` " + "(the failed amend can leave staged files in the way, and the stash holds them too) " + "and `git stash pop`.";
}
async function cascadeAfterAbsorb(cwd, stack, preAmendHeads, amendedBranches, workDir) {
  const allNodes = StackManager.toposort(stack);
  let updatedStack = stack;
  const results = [];
  for (const node of allNodes) {
    if (node.unmanaged)
      continue;
    const parentAmended = amendedBranches.has(node.parent);
    const selfAmended = amendedBranches.has(node.branch);
    if (!parentAmended && !selfAmended)
      continue;
    const oldParentHead = preAmendHeads.get(node.parent);
    if (!oldParentHead)
      continue;
    let newParentHead;
    try {
      newParentHead = await GitShell.getBranchHead(cwd, node.parent);
    } catch {
      continue;
    }
    if (oldParentHead === newParentHead)
      continue;
    let result;
    if (workDir) {
      const nodeOldHead = await GitShell.getBranchHead(cwd, node.branch);
      try {
        await GitShell.detachAt(workDir, nodeOldHead);
        await GitShell.rebaseOntoDetached(workDir, newParentHead, oldParentHead);
        const newHead = await GitShell.getBranchHead(workDir, "HEAD");
        result = await finalizeBranchRef(cwd, node.branch, nodeOldHead, newHead);
        await GitShell.detachAt(workDir, newHead).catch(() => {});
      } catch (err) {
        const message = toErrorMessage(err);
        await GitShell.rebaseAbort(workDir).catch(() => {});
        await GitShell.detachAt(workDir, "HEAD").catch(() => {});
        result = { branch: node.branch, success: false, error: message };
      }
    } else {
      result = await RebaseEngine.rebaseSingle(cwd, newParentHead, oldParentHead, node.branch);
    }
    results.push(result);
    if (!result.success)
      break;
    try {
      const newHead = await GitShell.getBranchHead(cwd, node.branch);
      updatedStack = StackManager.updateNode(updatedStack, node.branch, {
        lastKnownHead: newHead
      });
    } catch {}
    amendedBranches.add(node.branch);
  }
  return { results, updatedStack, state: "completed" };
}
var AbsorbEngine = {
  attributeFiles,
  previewAbsorb,
  absorb
};

// src/core/git-guards.ts
var DIRTY_TREE_MSG = "Working tree has uncommitted changes. Commit or stash first.";
async function assertCleanTree(cwd) {
  if (await GitShell.isDirty(cwd)) {
    throw new StackError(DIRTY_TREE_MSG);
  }
}

// src/core/branch-splitter.ts
import picomatch from "picomatch";
var BranchSplitter = {
  async tailSplit(cwd, stack, sourceBranch, newBranchName, splitAfterSha) {
    const sourceNode = StackManager.findNode(stack, sourceBranch);
    if (!sourceNode) {
      throw new Error(`Branch "${sourceBranch}" not found in stack "${stack.id}"`);
    }
    if (StackManager.findNode(stack, newBranchName) || newBranchName === stack.root) {
      throw new Error(`Branch "${newBranchName}" already exists in stack "${stack.id}"`);
    }
    if (!await GitShell.branchExists(cwd, sourceBranch)) {
      throw new Error(`Branch "${sourceBranch}" is in stack "${stack.id}" but does not exist in this repository`);
    }
    const resolution = await GitShell.resolveRef(cwd, splitAfterSha);
    if (resolution.kind === "ambiguous") {
      const shown = resolution.candidates.map((c) => c.slice(0, 10)).join(", ");
      throw new Error(`Commit "${splitAfterSha}" is an ambiguous abbreviation${shown ? ` (matches ${shown})` : ""}; use more characters`);
    }
    if (resolution.kind === "unknown") {
      throw new Error(`Commit "${splitAfterSha}" does not resolve to a commit in this repository`);
    }
    const splitSha = resolution.sha;
    if (!await GitShell.isAncestor(cwd, splitSha, sourceBranch)) {
      throw new Error(`Commit "${splitAfterSha}" not found in branch "${sourceBranch}"`);
    }
    const forkPoint = await GitShell.getMergeBase(cwd, sourceBranch, sourceNode.parent).catch(() => null);
    if (forkPoint && await GitShell.isAncestor(cwd, splitSha, forkPoint)) {
      throw new Error(`Commit "${splitAfterSha}" (${splitSha.slice(0, 10)}) is at or below where "${sourceBranch}" forks ` + `from "${sourceNode.parent}", so splitting there would rewind "${sourceBranch}" past its own base ` + `and move "${sourceNode.parent}"'s commits onto "${newBranchName}". Note that "HEAD~n" counts back ` + `from the checked-out branch, not from "${sourceBranch}": use "${sourceBranch}~n" instead.`);
    }
    const movedCommits = (await GitShell.logOneLine(cwd, `${splitSha}..${sourceBranch}`)).map((c) => c.sha);
    if (movedCommits.length === 0) {
      throw new Error("No commits to split — the split point is already at HEAD");
    }
    const sourceHead = await GitShell.getBranchHead(cwd, sourceBranch);
    await GitShell.branchAt(cwd, newBranchName, sourceHead);
    const fin = await finalizeBranchRef(cwd, sourceBranch, sourceHead, splitSha);
    if (!fin.success) {
      await GitShell.deleteBranch(cwd, newBranchName).catch(() => {});
      throw new Error(fin.error ?? "could not rewind the source branch");
    }
    let updatedStack = StackManager.addNode(stack, newBranchName, sourceBranch);
    const sourceChildren = StackManager.getChildren(stack, sourceBranch);
    for (const child of sourceChildren) {
      updatedStack = StackManager.moveNode(updatedStack, child.branch, newBranchName);
    }
    const newSourceHead = await GitShell.getBranchHead(cwd, sourceBranch);
    updatedStack = StackManager.updateNode(updatedStack, sourceBranch, {
      lastKnownHead: newSourceHead
    });
    updatedStack = StackManager.updateNode(updatedStack, newBranchName, {
      lastKnownHead: sourceHead
    });
    return {
      newBranch: newBranchName,
      movedCommits,
      updatedStack
    };
  },
  async getCommitLog(cwd, branch, n = 50) {
    return GitShell.logDetailed(cwd, branch, n);
  },
  async getChangedFileList(cwd, branch, parentBranch) {
    const mergeBase = await GitShell.getMergeBase(cwd, branch, parentBranch);
    return GitShell.diffNameOnly(cwd, mergeBase, branch);
  },
  async splitByFile(cwd, stack, branch, filePatterns, newBranchName, workDir) {
    const node = StackManager.findNode(stack, branch);
    if (!node) {
      throw new Error(`Branch "${branch}" not found in stack "${stack.id}"`);
    }
    if (StackManager.findNode(stack, newBranchName) || newBranchName === stack.root) {
      throw new Error(`Branch "${newBranchName}" already exists in stack "${stack.id}"`);
    }
    const parentBranch = node.parent;
    const mergeBase = await GitShell.getMergeBase(cwd, branch, parentBranch);
    const allFiles = await GitShell.diffNameOnly(cwd, mergeBase, branch);
    if (allFiles.length === 0) {
      throw new Error(`Branch "${branch}" has no changed files relative to "${parentBranch}"`);
    }
    const matcher = picomatch(filePatterns);
    const movedFiles = allFiles.filter((f) => matcher(f));
    const remainingFiles = allFiles.filter((f) => !matcher(f));
    if (movedFiles.length === 0) {
      throw new Error(`No files match the patterns: ${filePatterns.join(", ")}`);
    }
    let newBranchHead;
    let newSourceHead;
    if (!workDir) {
      await assertCleanTree(cwd);
      await GitShell.createBranch(cwd, newBranchName, mergeBase);
      await GitShell.checkoutFiles(cwd, branch, movedFiles);
      await GitShell.add(cwd, movedFiles);
      newBranchHead = await GitShell.commit(cwd, `Split from ${branch}: ${movedFiles.length} file(s)`);
      await GitShell.checkoutBranch(cwd, branch);
      if (remainingFiles.length === 0) {
        await GitShell.resetHard(cwd, mergeBase);
      } else {
        const mergeBaseTree = new Set(await GitShell.lsTree(cwd, mergeBase));
        const filesToRestore = movedFiles.filter((f) => mergeBaseTree.has(f));
        const filesToDelete = movedFiles.filter((f) => !mergeBaseTree.has(f));
        if (filesToRestore.length > 0) {
          await GitShell.checkoutFiles(cwd, mergeBase, filesToRestore);
          await GitShell.add(cwd, filesToRestore);
        }
        if (filesToDelete.length > 0) {
          await GitShell.rm(cwd, filesToDelete);
        }
        await GitShell.amendNoEdit(cwd);
      }
      newSourceHead = await GitShell.getBranchHead(cwd, branch);
    } else {
      const branchHead = await GitShell.getBranchHead(cwd, branch);
      await GitShell.detachAt(workDir, mergeBase);
      await GitShell.checkoutFiles(workDir, branch, movedFiles);
      await GitShell.add(workDir, movedFiles);
      newBranchHead = await GitShell.commit(workDir, `Split from ${branch}: ${movedFiles.length} file(s)`);
      await GitShell.branchAt(cwd, newBranchName, newBranchHead);
      if (remainingFiles.length === 0) {
        newSourceHead = mergeBase;
      } else {
        await GitShell.detachAt(workDir, branchHead);
        const mergeBaseTree = new Set(await GitShell.lsTree(cwd, mergeBase));
        const filesToRestore = movedFiles.filter((f) => mergeBaseTree.has(f));
        const filesToDelete = movedFiles.filter((f) => !mergeBaseTree.has(f));
        if (filesToRestore.length > 0) {
          await GitShell.checkoutFiles(workDir, mergeBase, filesToRestore);
          await GitShell.add(workDir, filesToRestore);
        }
        if (filesToDelete.length > 0) {
          await GitShell.rm(workDir, filesToDelete);
        }
        await GitShell.amendNoEdit(workDir);
        newSourceHead = await GitShell.getBranchHead(workDir, "HEAD");
      }
      const fin = await finalizeBranchRef(cwd, branch, branchHead, newSourceHead);
      await GitShell.detachAt(workDir, newSourceHead).catch(() => {});
      if (!fin.success) {
        await GitShell.deleteBranch(cwd, newBranchName).catch(() => {});
        throw new Error(fin.error ?? "could not rewrite the source branch");
      }
    }
    let updatedStack = StackManager.addNode(stack, newBranchName, parentBranch);
    updatedStack = StackManager.updateNode(updatedStack, newBranchName, {
      lastKnownHead: newBranchHead
    });
    updatedStack = StackManager.updateNode(updatedStack, branch, {
      lastKnownHead: newSourceHead
    });
    return {
      sourceBranch: branch,
      newBranch: newBranchName,
      movedFiles,
      remainingFiles,
      newStack: updatedStack
    };
  }
};

// src/core/branch-fold.ts
async function foldBranch(cwd, stack, branch, workDir) {
  const node = StackManager.findNode(stack, branch);
  if (!node) {
    throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
  }
  const parentBranch = node.parent;
  if (!workDir) {
    await assertCleanTree(cwd);
    await GitShell.checkoutBranch(cwd, parentBranch);
    const parentHead2 = await GitShell.getBranchHead(cwd, parentBranch);
    const branchHead2 = await GitShell.getBranchHead(cwd, branch);
    if (branchHead2 !== parentHead2) {
      const mergeBase = await GitShell.getMergeBase(cwd, parentBranch, branch);
      await GitShell.rebaseOnto(cwd, parentBranch, mergeBase, branch);
      await GitShell.checkoutBranch(cwd, parentBranch);
      await GitShell.resetHard(cwd, branch);
    }
    await GitShell.deleteBranch(cwd, branch);
    const children2 = StackManager.getChildren(stack, branch);
    let updatedStack2 = stack;
    for (const child of children2) {
      updatedStack2 = StackManager.moveNode(updatedStack2, child.branch, parentBranch);
    }
    updatedStack2 = StackManager.removeNode(updatedStack2, branch);
    const newParentHead = await GitShell.getBranchHead(cwd, parentBranch);
    if (StackManager.findNode(updatedStack2, parentBranch)) {
      updatedStack2 = StackManager.updateNode(updatedStack2, parentBranch, {
        lastKnownHead: newParentHead
      });
    }
    return {
      foldedBranch: branch,
      intoParent: parentBranch,
      reParentedChildren: children2.map((c) => c.branch),
      newStack: updatedStack2
    };
  }
  const map = await getWorktreeMap(cwd);
  const owner = findSlotForBranch(map, branch);
  if (owner && owner.dirty) {
    throw new StackError(`Branch "${branch}" is checked out in ${describeSlot(owner)} which is dirty; ` + `commit or stash there first (folding deletes the branch)`);
  }
  const parentHead = await GitShell.getBranchHead(cwd, parentBranch);
  const branchHead = await GitShell.getBranchHead(cwd, branch);
  let foldedHead = branchHead;
  if (branchHead !== parentHead) {
    const mergeBase = await GitShell.getMergeBase(cwd, parentBranch, branch);
    try {
      await GitShell.detachAt(workDir, branchHead);
      await GitShell.rebaseOntoDetached(workDir, parentHead, mergeBase);
    } catch {
      const files = await GitShell.listConflictedFiles(workDir).catch(() => []);
      await GitShell.rebaseAbort(workDir).catch(() => {});
      await GitShell.detachAt(workDir, "HEAD").catch(() => {});
      throw new StackError(`Folding "${branch}" into "${parentBranch}" hit a rebase conflict` + `${files.length > 0 ? ` (${files.join(", ")})` : ""}; nothing was changed. ` + `Sync the stack first, then retry`);
    }
    foldedHead = await GitShell.getBranchHead(workDir, "HEAD");
  }
  const fin = await finalizeBranchRef(cwd, parentBranch, parentHead, foldedHead);
  await GitShell.detachAt(workDir, foldedHead).catch(() => {});
  if (!fin.success)
    throw new StackError(fin.error ?? "could not move the parent ref");
  if (owner) {
    try {
      await GitShell.checkoutBranch(owner.path, parentBranch);
    } catch {
      await GitShell.detachAt(owner.path, foldedHead);
    }
  }
  await GitShell.deleteBranch(cwd, branch);
  const children = StackManager.getChildren(stack, branch);
  let updatedStack = stack;
  for (const child of children) {
    updatedStack = StackManager.moveNode(updatedStack, child.branch, parentBranch);
  }
  updatedStack = StackManager.removeNode(updatedStack, branch);
  if (StackManager.findNode(updatedStack, parentBranch)) {
    updatedStack = StackManager.updateNode(updatedStack, parentBranch, {
      lastKnownHead: foldedHead
    });
  }
  return {
    foldedBranch: branch,
    intoParent: parentBranch,
    reParentedChildren: children.map((c) => c.branch),
    newStack: updatedStack
  };
}

// src/core/reparent.ts
async function reparentBranch(cwd, stack, branch, newParentBranch, workDir) {
  const node = StackManager.findNode(stack, branch);
  if (!node) {
    throw new StackError(`Branch "${branch}" not found in stack "${stack.id}"`);
  }
  const oldParent = node.parent;
  if (oldParent === newParentBranch) {
    return {
      branch,
      oldParent,
      newParent: newParentBranch,
      cascadeResult: null,
      newStack: stack
    };
  }
  if (newParentBranch !== stack.root && !StackManager.findNode(stack, newParentBranch)) {
    throw new StackError(`New parent "${newParentBranch}" not found in stack "${stack.id}"`);
  }
  const descendants = StackManager.getDescendants(stack, branch);
  if (descendants.some((d) => d.branch === newParentBranch)) {
    throw new StackError(`Cannot reparent "${branch}" under "${newParentBranch}" — would create a cycle`);
  }
  if (!workDir)
    await assertCleanTree(cwd);
  const oldBase = await GitShell.getMergeBase(cwd, branch, oldParent);
  const newParentHead = await GitShell.getBranchHead(cwd, newParentBranch);
  const oldHead = await GitShell.getBranchHead(cwd, branch);
  if (workDir) {
    try {
      await GitShell.detachAt(workDir, oldHead);
      await GitShell.rebaseOntoDetached(workDir, newParentHead, oldBase);
    } catch {
      const files = await GitShell.listConflictedFiles(workDir).catch(() => []);
      await GitShell.rebaseAbort(workDir).catch(() => {});
      await GitShell.detachAt(workDir, "HEAD").catch(() => {});
      throw new StackError(`Reparenting "${branch}" onto "${newParentBranch}" hit a rebase conflict` + `${files.length > 0 ? ` (${files.join(", ")})` : ""}; nothing was moved. ` + `Sync the stack or resolve the divergence first, then retry`);
    }
    const newHead = await GitShell.getBranchHead(workDir, "HEAD");
    const fin = await finalizeBranchRef(cwd, branch, oldHead, newHead);
    await GitShell.detachAt(workDir, newHead).catch(() => {});
    if (!fin.success)
      throw new StackError(fin.error ?? "could not move the branch ref");
  } else {
    await GitShell.rebaseOnto(cwd, newParentHead, oldBase, branch);
  }
  const newBranchHead = await GitShell.getBranchHead(cwd, branch);
  let newStack = StackManager.moveNode(stack, branch, newParentBranch);
  newStack = StackManager.updateNode(newStack, branch, { lastKnownHead: newBranchHead });
  let cascadeResult = null;
  if (descendants.length > 0) {
    cascadeResult = await RebaseEngine.restackFrom(cwd, newStack, branch, workDir, {
      [branch]: oldHead
    });
    newStack = cascadeResult.updatedStack;
  }
  return { branch, oldParent, newParent: newParentBranch, cascadeResult, newStack };
}

// src/core/branch-rename.ts
async function renameBranch(cwd, stack, oldBranch, newBranch) {
  await GitShell.renameBranch(cwd, oldBranch, newBranch);
  const updatedStack = StackManager.renameBranch(stack, oldBranch, newBranch);
  return { updatedStack };
}

// src/core/branch-reset.ts
async function resetToRemote(cwd, stack, branch) {
  if (!StackManager.findNode(stack, branch)) {
    throw new StackError(`branch "${branch}" is not tracked in stack "${stack.id}"; nothing was reset`);
  }
  await assertCleanTree(cwd);
  const remoteRef = `origin/${branch}`;
  const remoteHead = await GitShell.getBranchHead(cwd, remoteRef);
  if (await GitShell.branchExists(cwd, `refs/heads/${branch}`)) {
    const localHead = await GitShell.getBranchHead(cwd, branch);
    const fin = await finalizeBranchRef(cwd, branch, localHead, remoteHead);
    if (!fin.success)
      throw new StackError(fin.error ?? `could not reset "${branch}" to ${remoteRef}`);
  } else {
    await GitShell.branchAt(cwd, branch, remoteHead);
  }
  const updatedStack = StackManager.updateNode(stack, branch, {
    lastKnownHead: remoteHead
  });
  return { updatedStack, newHead: remoteHead };
}

// src/cli/commands/surgery.ts
function replaceStack2(store, updated) {
  return { ...store, stacks: store.stacks.map((s) => s.id === updated.id ? updated : s) };
}
function refuseIfCheckedOutElsewhere(ctx, map, branch) {
  const owner = findSlotForBranch(map, branch);
  if (owner && owner.path !== ctx.repoRoot) {
    const advice = owner.isWorkSlot ? "gitq leaves its slots detached, so free that slot first" : "run this from that worktree or free the branch first";
    return fail(`branch "${branch}" is checked out in ${describeSlot(owner)}; ${advice}`);
  }
  return null;
}
async function absorbCommand(ctx) {
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  if (ctx.flags.preview === true) {
    const preview2 = await AbsorbEngine.previewAbsorb(ctx.repoRoot, stack);
    const attributedCount = Object.keys(preview2.attributed).length;
    emit(ctx, `absorb preview: ${attributedCount} branch(es) attributed, ${preview2.unattributed.length} file(s) left in the worktree`, { stack, result: preview2 });
    return 0;
  }
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  const preview = await AbsorbEngine.previewAbsorb(ctx.repoRoot, stack);
  const map = await getWorktreeMap(ctx.repoRoot);
  for (const attributedBranch of Object.keys(preview.attributed)) {
    const preGuard = refuseIfCheckedOutElsewhere(ctx, map, attributedBranch);
    if (preGuard !== null)
      return preGuard;
  }
  if (Object.keys(preview.attributed).length === 0) {
    const reason = preview.unattributed.length === 0 ? "no-changes" : "nothing-attributable";
    const result = {
      absorbed: false,
      reason,
      attributions: [],
      unattributed: preview.unattributed
    };
    emit(ctx, `nothing absorbed (${reason})`, { stack, result });
    return 0;
  }
  return withLeasedSlot(ctx, stack, "absorb", (workDir) => withOperationLog(ctx, stack, "absorb", async () => {
    const result = await AbsorbEngine.absorb(ctx.repoRoot, stack, undefined, workDir);
    const updatedStack = result.updatedStack ?? stack;
    if (result.updatedStack) {
      await updateStore(ctx.repoRoot, (fresh) => replaceStack2(fresh, updatedStack));
    }
    const cascadeFailure = result.cascadeResult?.results.find((r) => !r.success);
    if (cascadeFailure) {
      await GitShell.rebaseAbort(ctx.repoRoot).catch(() => {});
      return fail(`absorb restack conflicted on ${cascadeFailure.branch}; aborted the rebase (branch edits kept). run gitq sync to restack with full conflict handling`);
    }
    const failed = result.attributions.some((a) => !a.success);
    const headline = result.absorbed ? `absorbed: ${result.attributions.map((a) => `${a.branch} (${a.files.length})`).join(", ")}` : `nothing absorbed${result.reason ? ` (${result.reason})` : ""}`;
    emit(ctx, result.recovery ? `${headline}
${result.recovery}` : headline, {
      stack: updatedStack,
      result
    });
    return failed || result.recovery ? 1 : 0;
  }));
}
async function splitCommand(ctx) {
  const [branch] = ctx.args;
  const name = typeof ctx.flags.name === "string" ? ctx.flags.name : null;
  const at = typeof ctx.flags.at === "string" ? ctx.flags.at : null;
  const files = typeof ctx.flags.files === "string" ? ctx.flags.files : null;
  if (!branch || !name || !at && !files || at && files) {
    return fail("usage: gitq split <branch> --at <rev> --name <newBranch> | gitq split <branch> --files <glob[,glob...]> --name <newBranch> [--stack <name>]");
  }
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  if (at) {
    return withOperationLog(ctx, stack, "split", async () => {
      const result = await BranchSplitter.tailSplit(ctx.repoRoot, stack, branch, name, at);
      await updateStore(ctx.repoRoot, (fresh) => replaceStack2(fresh, result.updatedStack));
      emit(ctx, `split ${branch}: moved ${result.movedCommits.length} commit(s) to ${result.newBranch}`, {
        stack: result.updatedStack,
        result
      });
      return 0;
    });
  }
  return withLeasedSlot(ctx, stack, "split", (workDir) => withOperationLog(ctx, stack, "split", async () => {
    const patterns = files.split(",").map((p) => p.trim()).filter(Boolean);
    const result = await BranchSplitter.splitByFile(ctx.repoRoot, stack, branch, patterns, name, workDir);
    await updateStore(ctx.repoRoot, (fresh) => replaceStack2(fresh, result.newStack));
    emit(ctx, `split ${branch}: moved ${result.movedFiles.length} file(s) to ${result.newBranch}`, {
      stack: result.newStack,
      result
    });
    return 0;
  }));
}
async function foldCommand(ctx) {
  const [branch] = ctx.args;
  if (!branch)
    return fail("usage: gitq fold <branch> [--stack <name>]");
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  return withLeasedSlot(ctx, stack, "fold", (workDir) => withOperationLog(ctx, stack, "fold", async () => {
    const result = await foldBranch(ctx.repoRoot, stack, branch, workDir);
    await updateStore(ctx.repoRoot, (fresh) => replaceStack2(fresh, result.newStack));
    emit(ctx, `folded ${result.foldedBranch} into ${result.intoParent}`, { stack: result.newStack, result });
    return 0;
  }));
}
async function reparentCommand(ctx) {
  const [branch] = ctx.args;
  const onto = typeof ctx.flags.onto === "string" ? ctx.flags.onto : null;
  if (!branch || !onto)
    return fail("usage: gitq reparent <branch> --onto <newParent> [--stack <name>]");
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  return withLeasedSlot(ctx, stack, "reparent", (workDir) => withOperationLog(ctx, stack, "reparent", async () => {
    const result = await reparentBranch(ctx.repoRoot, stack, branch, onto, workDir);
    if (result.cascadeResult?.state === "paused") {
      return finishCascade(ctx, stack.id, result.cascadeResult, workDir);
    }
    await updateStore(ctx.repoRoot, (fresh) => replaceStack2(fresh, result.newStack));
    emit(ctx, `reparented ${result.branch} from ${result.oldParent} onto ${result.newParent}`, {
      stack: result.newStack,
      result
    });
    const cascadeResults = result.cascadeResult?.results ?? [];
    return cascadeResults.every((r) => r.success) ? 0 : 1;
  }, (code) => code !== 2));
}
async function renameCommand(ctx) {
  const [oldBranch, newBranch] = ctx.args;
  if (!oldBranch || !newBranch)
    return fail("usage: gitq rename <old> <new> [--stack <name>]");
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  const map = await getWorktreeMap(ctx.repoRoot);
  const preGuard = refuseIfCheckedOutElsewhere(ctx, map, oldBranch);
  if (preGuard !== null)
    return preGuard;
  return withOperationLog(ctx, stack, "rename", async () => {
    const result = await renameBranch(ctx.repoRoot, stack, oldBranch, newBranch);
    await updateStore(ctx.repoRoot, (fresh) => replaceStack2(fresh, result.updatedStack));
    emit(ctx, `renamed ${oldBranch} to ${newBranch}`, { stack: result.updatedStack, result });
    return 0;
  });
}
async function resetCommand(ctx) {
  const [branch] = ctx.args;
  if (!branch)
    return fail("usage: gitq reset <branch> [--stack <name>]");
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  const map = await getWorktreeMap(ctx.repoRoot);
  const preGuard = refuseIfCheckedOutElsewhere(ctx, map, branch);
  if (preGuard !== null)
    return preGuard;
  const result = await resetToRemote(ctx.repoRoot, stack, branch);
  await updateStore(ctx.repoRoot, (fresh) => replaceStack2(fresh, result.updatedStack));
  emit(ctx, `reset ${branch} to origin/${branch} (${result.newHead})`, { stack: result.updatedStack, result });
  return 0;
}

// src/cli/commands/forge.ts
import { readFileSync as readFileSync3 } from "node:fs";

// src/core/forge-helpers.ts
function indexBySource(prs) {
  const map = new Map;
  for (const pr of prs) {
    map.set(pr.sourceBranch, pr);
  }
  return map;
}
function cleanProjectPath(projectPath) {
  return projectPath.trim().replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
}
function normalizeHost(host) {
  const cleaned = host.trim().toLowerCase().replace(/^www\./, "");
  return cleaned === "" ? null : cleaned;
}
function comparableHost(host) {
  const cleaned = normalizeHost(host);
  return cleaned !== null && cleaned.includes(".") ? cleaned : null;
}
function sameProject(a, b) {
  if (a.path.toLowerCase() !== b.path.toLowerCase())
    return false;
  return a.host === null || b.host === null || a.host === b.host;
}
function projectPathFromRemoteUrl(remoteUrl) {
  return projectScopeFromRemoteUrl(remoteUrl)?.path ?? null;
}
function projectScopeFromRemoteUrl(remoteUrl) {
  const parsed = parseRemoteUrl(remoteUrl);
  if (parsed === null)
    return null;
  return scope(parsed.host === null ? null : comparableHost(parsed.host), parsed.path);
}
function hostFromRemoteUrl(remoteUrl) {
  return parseRemoteUrl(remoteUrl)?.host ?? null;
}
function parseRemoteUrl(remoteUrl) {
  const scpMatch = remoteUrl.includes("://") ? null : remoteUrl.match(/^[^/]*@([^/:]+):(.+)$/);
  if (scpMatch)
    return { host: normalizeHost(scpMatch[1] ?? ""), path: scpMatch[2] ?? "" };
  try {
    const url = new URL(remoteUrl);
    return { host: normalizeHost(url.hostname), path: url.pathname };
  } catch {
    return remoteUrl.includes("/") ? { host: null, path: remoteUrl } : null;
  }
}
function scope(host, rawPath) {
  const path = cleanProjectPath(rawPath);
  return path === "" ? null : { host, path };
}
function projectPathFromWebUrl(webUrl) {
  return projectScopeFromWebUrl(webUrl)?.path ?? null;
}
function projectScopeFromWebUrl(webUrl) {
  if (!webUrl)
    return null;
  let url;
  try {
    url = new URL(webUrl);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const host = comparableHost(url.hostname);
  const dashIdx = parts.indexOf("-");
  if (dashIdx >= 2 && parts[dashIdx + 1] === "merge_requests") {
    return scope(host, parts.slice(0, dashIdx).join("/"));
  }
  const pullIdx = parts.indexOf("pull");
  if (pullIdx >= 2)
    return scope(host, parts.slice(0, pullIdx).join("/"));
  return null;
}
function normalizeProjectScope(wanted) {
  return typeof wanted === "string" ? scope(null, wanted) : scope(wanted.host, wanted.path);
}
function filterPRsToProject(prs, wanted) {
  const target = normalizeProjectScope(wanted);
  if (target === null)
    return [];
  return prs.filter((pr) => {
    const prScope = projectScopeFromWebUrl(pr.webUrl);
    return prScope !== null && sameProject(prScope, target);
  });
}
function discoverStacksFromPRs(prs) {
  const byRepoAndAuthor = new Map;
  const unidentified = [];
  for (const pr of prs) {
    const author = pr.author?.username;
    if (!pr.repositoryId || !author) {
      unidentified.push([pr]);
      continue;
    }
    const key = `${pr.repositoryId}\x00${author}`;
    const bucket = byRepoAndAuthor.get(key);
    if (bucket)
      bucket.push(pr);
    else
      byRepoAndAuthor.set(key, [pr]);
  }
  return [...byRepoAndAuthor.values(), ...unidentified].flatMap(discoverStacksInRepo);
}
function discoverStacksInRepo(prs) {
  const prBySource = indexBySource(prs);
  const childrenOf = new Map;
  for (const pr of prs) {
    const children = childrenOf.get(pr.targetBranch) ?? [];
    children.push(pr.sourceBranch);
    childrenOf.set(pr.targetBranch, children);
  }
  const sourceBranches = new Set(prs.map((pr) => pr.sourceBranch));
  const roots = new Set;
  for (const pr of prs) {
    if (!sourceBranches.has(pr.targetBranch)) {
      roots.add(pr.targetBranch);
    }
  }
  const stacks = [];
  for (const root of roots) {
    const directChildren = childrenOf.get(root) ?? [];
    for (const child of directChildren) {
      const branches = [];
      const mrMap = new Map;
      const queue = [child];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current)
          break;
        branches.push(current);
        const pr = prBySource.get(current);
        if (pr)
          mrMap.set(current, pr);
        const grandchildren = childrenOf.get(current) ?? [];
        for (const gc of grandchildren) {
          queue.push(gc);
        }
      }
      if (branches.length >= 2) {
        stacks.push({ root, branches, mrMap });
      }
    }
  }
  return stacks;
}
function normalizePipelineStatus(status) {
  switch (status) {
    case "success":
      return "success";
    case "failed":
    case "canceled":
      return "failed";
    case "running":
      return "running";
    case "pending":
    case "created":
    case "waiting_for_resource":
    case "preparing":
    case "scheduled":
      return "pending";
    default:
      return "unknown";
  }
}
function mapDiffStats(prDiffStats) {
  if (!prDiffStats)
    return null;
  return {
    additions: prDiffStats.additions,
    deletions: prDiffStats.deletions,
    filesChanged: prDiffStats.filesChanged
  };
}

// src/core/forge-sync.ts
var ForgeSync = {
  async discoverStacks(provider, scope2) {
    const { kept } = await fetchOpenPRsForProject(provider, scope2);
    return discoverStacksFromPRs(kept);
  },
  async reconcile(provider, stack, scope2, prefetchedPRs) {
    const allPRs = prsForProject(prefetchedPRs ?? await provider.fetchPullRequests(), scope2, "reconcile");
    const prBySource = indexBySource(allPRs);
    const drifts = [];
    const localOnly = [];
    const trackedBranches = new Set(stack.nodes.map((n) => n.branch));
    trackedBranches.add(stack.root);
    for (const node of stack.nodes) {
      const pr = prBySource.get(node.branch);
      if (!pr) {
        localOnly.push(node.branch);
        continue;
      }
      if (pr.targetBranch !== node.parent) {
        drifts.push({
          branch: node.branch,
          localParent: node.parent,
          forgeTarget: pr.targetBranch,
          mrIid: pr.iid
        });
      }
    }
    const unmatchedMRs = [];
    for (const pr of allPRs) {
      if (pr.state === "opened" && trackedBranches.has(pr.targetBranch) && !trackedBranches.has(pr.sourceBranch)) {
        unmatchedMRs.push(pr);
      }
    }
    return { drifts, localOnly, unmatchedMRs };
  },
  async populateNodeData(provider, stack, scope2, prefetchedPRs, cwd) {
    const allPRs = prsForProject(prefetchedPRs ?? await provider.fetchPullRequests(), scope2, "populateNodeData");
    const prBySource = indexBySource(allPRs);
    let updated = stack;
    for (const node of stack.nodes) {
      const pr = prBySource.get(node.branch);
      if (!pr)
        continue;
      const status = pr.state === "merged" ? "merged" : pr.targetBranch !== node.parent ? "drift" : "synced";
      let lastKnownHead;
      if (status === "merged" && !node.lastKnownHead) {
        if (cwd) {
          try {
            lastKnownHead = await GitShell.getBranchHead(cwd, node.branch);
          } catch {}
        }
        if (!lastKnownHead && pr.sha)
          lastKnownHead = pr.sha;
      }
      updated = StackManager.updateNode(updated, node.branch, {
        mrIid: pr.iid,
        mrUrl: pr.webUrl,
        mrTitle: pr.title || null,
        diffStats: mapDiffStats(pr.diffStats),
        pipelineStatus: normalizePipelineStatus(pr.pipeline?.status),
        unresolvedThreads: pr.unresolvedThreadCount,
        status,
        ...lastKnownHead ? { lastKnownHead } : {}
      });
    }
    return updated;
  },
  async importFromForge(provider, repoPath, remoteUrl) {
    const scope2 = projectScopeFromRemoteUrl(remoteUrl);
    if (!scope2) {
      throw new Error(`cannot read a project path from remote "${remoteUrl}"; import keeps only the MRs of the project the remote points at`);
    }
    const { fetched, kept } = await fetchOpenPRsForProject(provider, scope2);
    const discovered = discoverStacksFromPRs(kept).sort((a, b) => `${a.root}\x00${[...a.branches].sort().join(",")}`.localeCompare(`${b.root}\x00${[...b.branches].sort().join(",")}`));
    const usedIds = new Set;
    const stacks = discovered.map((ds) => {
      const stackId = deriveStackId(ds, usedIds);
      usedIds.add(stackId);
      let stack = StackManager.createStack(stackId, ds.root);
      for (const branch of ds.branches) {
        const pr = ds.mrMap.get(branch);
        const parent = pr?.targetBranch ?? ds.root;
        stack = StackManager.addNode(stack, branch, parent);
        stack = StackManager.updateNode(stack, branch, {
          mrIid: pr?.iid ?? null,
          mrUrl: pr?.webUrl ?? null,
          mrTitle: pr?.title || null,
          status: pr ? "synced" : "local-only",
          diffStats: mapDiffStats(pr?.diffStats ?? null),
          pipelineStatus: normalizePipelineStatus(pr?.pipeline?.status),
          unresolvedThreads: pr ? pr.unresolvedThreadCount : 0
        });
      }
      return stack;
    });
    return {
      store: { repoPath, remoteUrl, stacks },
      openMRs: fetched.length,
      scopedMRs: kept.length,
      projectPath: scope2.path
    };
  },
  async publishStack(provider, stack, projectPath, cwd, descriptions) {
    const sorted = StackManager.toposort(stack);
    const publishedIids = sorted.filter((n) => n.status !== "merged" && n.mrIid !== null).map((n) => n.mrIid);
    const prByIid = new Map;
    if (publishedIids.length > 0) {
      const prs = await provider.fetchPullRequests({ iids: publishedIids, projectPath });
      for (const pr of prs)
        prByIid.set(pr.iid, pr);
    }
    const results = [];
    const skipped = [];
    let updatedStack = stack;
    for (const node of sorted) {
      const desc = descriptions?.[node.branch];
      const meta = metaUpdate(desc);
      const targetBranch = resolveLiveTarget(updatedStack, node.parent);
      if (node.mrIid === null) {
        if (node.status !== "local-only")
          continue;
        try {
          if (cwd) {
            await GitShell.pushForceWithLease(cwd, node.branch);
          }
          const input = {
            projectPath,
            title: desc?.title ?? node.branch,
            sourceBranch: node.branch,
            targetBranch,
            draft: true
          };
          if (desc?.body) {
            input.description = desc.body;
          }
          const pr2 = await provider.createPullRequest(input);
          const head = cwd ? await GitShell.getBranchHead(cwd, node.branch).catch(() => null) : null;
          updatedStack = StackManager.updateNode(updatedStack, node.branch, {
            mrIid: pr2.iid,
            mrUrl: pr2.webUrl,
            status: "synced",
            ...head ? { lastKnownHead: head } : {}
          });
          results.push({
            branch: node.branch,
            success: true,
            action: "created",
            mrIid: pr2.iid,
            mrUrl: pr2.webUrl ?? undefined,
            targetBranch
          });
        } catch (err) {
          results.push({
            branch: node.branch,
            success: false,
            action: "created",
            error: toErrorMessage(err),
            targetBranch
          });
          break;
        }
        continue;
      }
      if (node.status === "merged")
        continue;
      const pr = prByIid.get(node.mrIid);
      if (!pr) {
        skipped.push({
          branch: node.branch,
          mrIid: node.mrIid,
          reason: "mr-unreadable",
          detail: `MR !${node.mrIid} was not returned by the forge`
        });
        continue;
      }
      if (pr.state !== "opened") {
        skipped.push({
          branch: node.branch,
          mrIid: node.mrIid,
          reason: "mr-not-open",
          detail: `MR !${node.mrIid} is ${pr.state}`
        });
        continue;
      }
      if (pr.sourceBranch !== node.branch) {
        skipped.push({
          branch: node.branch,
          mrIid: node.mrIid,
          reason: "source-branch-mismatch",
          detail: `MR !${node.mrIid} is for ${pr.sourceBranch}, not ${node.branch}`
        });
        continue;
      }
      const needsRetarget = pr.targetBranch !== targetBranch;
      if (!needsRetarget && !meta)
        continue;
      try {
        if (needsRetarget) {
          updatedStack = await ForgeSync.retargetMR(provider, updatedStack, node.branch, projectPath);
        }
        if (meta) {
          await provider.updatePullRequest(projectPath, node.mrIid, meta);
        }
        const changes = [];
        if (needsRetarget)
          changes.push("target");
        if (meta)
          changes.push("metadata");
        results.push({
          branch: node.branch,
          success: true,
          action: "updated",
          changes,
          mrIid: node.mrIid,
          mrUrl: node.mrUrl ?? pr.webUrl ?? undefined,
          targetBranch
        });
      } catch (err) {
        results.push({
          branch: node.branch,
          success: false,
          action: "updated",
          error: toErrorMessage(err),
          targetBranch
        });
      }
    }
    return { results, skipped, updatedStack };
  },
  async retargetMR(provider, stack, branch, projectPath) {
    const node = StackManager.findNode(stack, branch);
    if (!node)
      throw new Error(`Branch "${branch}" not found in stack`);
    if (!node.mrIid)
      throw new Error(`Branch "${branch}" has no MR to retarget`);
    await provider.updatePullRequest(projectPath, node.mrIid, {
      targetBranch: resolveLiveTarget(stack, node.parent)
    });
    return StackManager.updateNode(stack, branch, { status: "synced" });
  },
  async discoverTeamStacks(provider, scope2) {
    const { kept: openPRs } = await fetchOpenPRsForProject(provider, scope2);
    const byAuthor = new Map;
    for (const pr of openPRs) {
      if (!pr.author)
        continue;
      const key = pr.author.username;
      if (!byAuthor.has(key)) {
        byAuthor.set(key, {
          author: { username: pr.author.username, name: pr.author.name, avatarUrl: pr.author.avatarUrl },
          prs: []
        });
      }
      byAuthor.get(key)?.prs.push(pr);
    }
    const teamStacks = [];
    for (const { author, prs } of byAuthor.values()) {
      const stacks = discoverStacksFromPRs(prs);
      if (stacks.length > 0) {
        teamStacks.push({ author, stacks });
      }
    }
    return teamStacks;
  },
  async syncStack(provider, stack, scope2) {
    const target = requireScope(scope2, "syncStack");
    const allPRs = filterPRsToProject(await provider.fetchPullRequests({ state: ["opened", "merged"] }), target);
    const oldStatuses = new Map(stack.nodes.map((n) => [n.branch, n.status]));
    const oldPipelines = new Map(stack.nodes.map((n) => [n.branch, n.pipelineStatus]));
    const updatedStack = await ForgeSync.populateNodeData(provider, stack, target, allPRs);
    const reconcile = await ForgeSync.reconcile(provider, updatedStack, target, allPRs);
    const prBySource = indexBySource(allPRs);
    return {
      updatedStack,
      reconcile,
      ...await detectSyncChanges(provider, updatedStack, oldStatuses, oldPipelines, prBySource)
    };
  }
};
function resolveLiveTarget(stack, parent) {
  let current = parent;
  while (current !== stack.root) {
    const node = stack.nodes.find((n) => n.branch === current);
    if (!node || node.status !== "merged")
      break;
    current = node.parent;
  }
  return current;
}
function metaUpdate(desc) {
  if (!desc)
    return null;
  const update = {};
  if (desc.title !== undefined)
    update.title = desc.title;
  if (desc.body !== undefined)
    update.description = desc.body;
  return Object.keys(update).length > 0 ? update : null;
}
function requireScope(scope2, operation) {
  const target = scope2 === null ? null : normalizeProjectScope(scope2);
  if (!target) {
    throw new Error(`${operation} needs the project scope of the repo it is syncing; without one, another project's MR on the same branch name can supply this stack's data`);
  }
  return target;
}
function prsForProject(prs, scope2, operation) {
  return filterPRsToProject(prs, requireScope(scope2, operation));
}
async function fetchOpenPRsForProject(provider, scope2) {
  const prs = await provider.fetchPullRequests();
  const fetched = prs.filter((pr) => pr.state === "opened");
  return { fetched, kept: scope2 ? filterPRsToProject(fetched, scope2) : fetched };
}
async function detectSyncChanges(provider, updatedStack, oldStatuses, oldPipelines, prBySource) {
  const newlyMerged = [];
  const pipelineChanges = [];
  const vanished = [];
  for (const node of updatedStack.nodes) {
    if (node.status === "merged" && oldStatuses.get(node.branch) !== "merged") {
      newlyMerged.push(node.branch);
    }
    const oldPipeline = oldPipelines.get(node.branch);
    if (oldPipeline && oldPipeline !== node.pipelineStatus && node.pipelineStatus !== "unknown") {
      pipelineChanges.push({ branch: node.branch, from: oldPipeline, to: node.pipelineStatus });
    }
    if (oldStatuses.get(node.branch) === "synced" && !prBySource.has(node.branch)) {
      vanished.push({ branch: node.branch, mrIid: node.mrIid, mrUrl: node.mrUrl });
    }
  }
  const deletedBranches = (await Promise.all(vanished.map(async ({ branch, mrIid, mrUrl }) => {
    if (mrIid != null && mrUrl) {
      const projectPath = projectPathFromWebUrl(mrUrl);
      if (projectPath) {
        try {
          const mr = await provider.fetchSingleMR(projectPath, mrIid, null);
          if (mr?.state === "merged")
            return { branch, reason: "merged", mrIid };
          if (mr?.state === "closed")
            return { branch, reason: "closed", mrIid };
          if (mr)
            return null;
        } catch {}
      }
    }
    return { branch, reason: "deleted", mrIid };
  }))).filter((d) => d !== null);
  return { newlyMerged, pipelineChanges, deletedBranches };
}
function deriveStackId(ds, usedIds) {
  const targets = new Set;
  for (const branch of ds.branches) {
    const pr2 = ds.mrMap.get(branch);
    if (pr2?.targetBranch)
      targets.add(pr2.targetBranch);
  }
  const leaves = ds.branches.filter((b) => !targets.has(b)).sort();
  const tip = leaves[0] ?? ds.branches[ds.branches.length - 1] ?? ds.root;
  const pr = ds.mrMap.get(tip);
  let base = pr?.title ?? tip;
  base = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!base)
    base = "stack";
  let id = base;
  let counter = 2;
  while (usedIds.has(id)) {
    id = `${base}-${counter++}`;
  }
  return id;
}

// src/cli/provider.ts
import { createProvider } from "@mattstack/glance";

// src/core/secrets.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join8 } from "node:path";
var TOKEN_ENV = {
  gitlab: "GITLAB_TOKEN",
  github: "GITHUB_TOKEN"
};
var SECRETS_KEY = {
  gitlab: "gitlabToken",
  github: "githubToken"
};
function resolveForgeToken(forge, opts = {}) {
  const env = opts.env ?? process.env;
  if (opts.tokenEnv)
    return env[opts.tokenEnv] ?? null;
  const fromEnv = env[TOKEN_ENV[forge]];
  if (fromEnv)
    return fromEnv;
  const file = opts.secretsFile ?? join8(homedir2(), ".rt", "secrets.json");
  try {
    const parsed = JSON.parse(readFileSync2(file, "utf8"));
    return parsed[SECRETS_KEY[forge]] ?? null;
  } catch {
    return null;
  }
}
function tokenSourceHint(forge, tokenEnv) {
  if (tokenEnv)
    return `set ${tokenEnv}`;
  return `set ${TOKEN_ENV[forge]} or add ${SECRETS_KEY[forge]} to ~/.rt/secrets.json`;
}

// src/core/forges.ts
var FORGE_SLUGS = ["gitlab", "github"];
var KNOWN_HOSTS = {
  "github.com": "github",
  "gitlab.com": "gitlab"
};
function resolveForge(host, overrides = {}) {
  const wanted = host.toLowerCase();
  const entry = Object.entries(overrides).find(([key]) => key.toLowerCase() === wanted);
  if (entry) {
    const [key, override] = entry;
    if (!isForgeSlug(override.provider)) {
      throw new Error(`forges["${key}"].provider is "${override.provider}"; it must be one of ${FORGE_SLUGS.join(", ")}`);
    }
    if (!override.baseUrl && !wanted.includes(".")) {
      throw new Error(`forges["${key}"] needs a baseUrl: "${key}" is an ssh alias, not a host the forge answers on`);
    }
    return {
      slug: override.provider,
      baseUrl: (override.baseUrl ?? `https://${wanted}`).replace(/\/+$/, ""),
      host: wanted,
      tokenEnv: override.tokenEnv ?? null
    };
  }
  const known = KNOWN_HOSTS[wanted];
  return known ? { slug: known, baseUrl: `https://${wanted}`, host: wanted, tokenEnv: null } : null;
}
function isForgeSlug(value) {
  return typeof value === "string" && FORGE_SLUGS.includes(value);
}
async function readForgeOverrides() {
  const settings = await readJson(getSettingsFilePath(), {});
  return settings.forges ?? {};
}

// src/cli/provider.ts
async function createForgeProvider(remoteUrl, opts = {}) {
  const host = hostFromRemoteUrl(remoteUrl);
  if (!host) {
    throw new Error(`no forge host in remote "${remoteUrl}"; gitq reads the forge from the remote's host, so this repo needs one that names an instance`);
  }
  const forge = resolveForge(host, opts.overrides ?? await readForgeOverrides());
  if (!forge) {
    const entry = host.includes(".") ? '{"provider": "gitlab"}' : '{"provider": "gitlab", "baseUrl": "https://gitlab.example.com"}';
    throw new Error(`cannot tell which forge "${host}" is (from remote ${remoteUrl}); name it in ${getSettingsFilePath()} as {"forges": {"${host}": ${entry}}}`);
  }
  const token = resolveForgeToken(forge.slug, {
    ...opts.env ? { env: opts.env } : {},
    ...opts.secretsFile ? { secretsFile: opts.secretsFile } : {},
    tokenEnv: forge.tokenEnv
  });
  if (!token) {
    throw new Error(`no ${forge.slug} token for ${forge.host} (${tokenSourceHint(forge.slug, forge.tokenEnv)})`);
  }
  return { provider: createProvider(forge.slug, forge.baseUrl, token), projectPath: extractProjectPath(remoteUrl) };
}
function extractProjectPath(remoteUrl) {
  return projectPathFromRemoteUrl(remoteUrl) ?? remoteUrl.replace(/\.git$/, "");
}

// src/cli/commands/forge.ts
async function parseMrMeta(path) {
  let raw;
  try {
    raw = readFileSync3(path, "utf8");
  } catch {
    return `invalid --mr-meta: cannot read ${path}`;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `invalid --mr-meta: ${path} is not valid JSON`;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "invalid --mr-meta: expected a JSON object of {branch: {title, description}}";
  }
  const descriptions = {};
  for (const [branch, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.title !== "string" || typeof value.description !== "string") {
      return `invalid --mr-meta: entry "${branch}" must be {"title": string, "description": string}`;
    }
    const entry = value;
    const normalized = {};
    if (entry.title !== "")
      normalized.title = entry.title;
    if (entry.description !== "")
      normalized.body = entry.description;
    if (normalized.title !== undefined || normalized.body !== undefined) {
      descriptions[branch] = normalized;
    }
  }
  return descriptions;
}
function formatPublishResult(r) {
  if (!r.success)
    return `${r.branch}: FAILED (${r.error})`;
  if (r.action === "updated") {
    const changes = (r.changes ?? []).map((c) => c === "target" ? `retargeted to ${r.targetBranch}` : "title/description");
    const detail = changes.length > 0 ? ` (${changes.join(", ")})` : "";
    return `${r.branch}: updated${detail} ${r.mrUrl}`;
  }
  return `${r.branch}: created ${r.mrUrl}`;
}
function formatPublishSkip(s) {
  return `${s.branch}: skipped (${s.detail})`;
}
async function publishCommand(ctx) {
  const mrMetaPath = typeof ctx.flags["mr-meta"] === "string" ? ctx.flags["mr-meta"] : null;
  let descriptions;
  if (mrMetaPath) {
    const result2 = await parseMrMeta(mrMetaPath);
    if (typeof result2 === "string")
      return fail(result2);
    descriptions = result2;
  }
  const store = await loadStore(ctx.repoRoot);
  const stack = pickStack(store, ctx.flags);
  const guarded = await requireStackFree(ctx, stack.id);
  if (guarded !== null)
    return guarded;
  const remoteUrl = store.remoteUrl || await GitShell.getRemoteUrl(ctx.repoRoot);
  const { provider, projectPath } = await createForgeProvider(remoteUrl);
  const result = await ForgeSync.publishStack(provider, stack, projectPath, ctx.repoRoot, descriptions);
  await updateStore(ctx.repoRoot, (fresh) => ({
    ...fresh,
    remoteUrl,
    stacks: fresh.stacks.map((s) => s.id === result.updatedStack.id ? result.updatedStack : s)
  }));
  const ok = result.results.every((r) => r.success);
  const lines = [...result.results.map(formatPublishResult), ...result.skipped.map(formatPublishSkip)];
  const human = lines.length ? lines.join(`
`) : "nothing to publish (no branches to create or update)";
  emit(ctx, human, {
    results: result.results,
    skipped: result.skipped,
    updatedStack: result.updatedStack
  });
  return ok ? 0 : 1;
}
async function importCommand(ctx) {
  if ((await listLeases(ctx.commonDir)).length > 0) {
    return fail("cascades are active; finish or abort them first");
  }
  const existing = await loadStore(ctx.repoRoot);
  const replace = ctx.flags.replace === true;
  if (existing.stacks.length > 0 && !replace) {
    return fail(`import would discard ${existing.stacks.length} locally tracked stack(s) and re-mint stack ids; pass --replace to overwrite the local store`);
  }
  const remoteUrl = await GitShell.getRemoteUrl(ctx.repoRoot);
  const { provider } = await createForgeProvider(remoteUrl);
  const { store, openMRs, scopedMRs, projectPath } = await ForgeSync.importFromForge(provider, ctx.repoRoot, remoteUrl);
  await updateStore(ctx.repoRoot, () => store);
  if (scopedMRs === 0 && openMRs > 0) {
    console.error(`gitq: none of the ${openMRs} open MR(s) the forge returned belong to ${projectPath} (read from remote ${remoteUrl}); if the project was renamed or transferred, update the remote and import again`);
  }
  emit(ctx, `imported ${store.stacks.length} stack(s)`, { store });
  return 0;
}

// src/core/undo.ts
var REVERSIBLE_OPERATIONS = new Set([
  "cascade-rebase",
  "reparent",
  "absorb",
  "sync"
]);
function canUndo(entry) {
  return REVERSIBLE_OPERATIONS.has(entry.operation);
}
async function undo(cwd, entry) {
  if (!canUndo(entry)) {
    return {
      success: false,
      restoredBranches: [],
      restoredStack: entry.stackSnapshot,
      error: `Operation "${entry.operation}" is not reversible`
    };
  }
  const branches = Object.keys(entry.branchSnapshots);
  if (branches.length === 0) {
    return {
      success: false,
      restoredBranches: [],
      restoredStack: entry.stackSnapshot,
      error: "No branch snapshots to restore"
    };
  }
  const originalBranch = await GitShell.getCurrentBranch(cwd);
  const restoredBranches = [];
  const skippedBranches = [];
  for (const branch of branches) {
    const sha = entry.branchSnapshots[branch];
    if (!sha)
      continue;
    const exists = await GitShell.branchExists(cwd, branch);
    if (!exists) {
      skippedBranches.push(branch);
      continue;
    }
    await GitShell.checkoutBranch(cwd, branch);
    await GitShell.resetHard(cwd, sha);
    restoredBranches.push(branch);
  }
  try {
    await GitShell.checkoutBranch(cwd, originalBranch);
  } catch {}
  const result = {
    success: true,
    restoredBranches,
    restoredStack: structuredClone(entry.stackSnapshot)
  };
  if (skippedBranches.length > 0) {
    result.error = `Skipped deleted branches: ${skippedBranches.join(", ")}`;
  }
  return result;
}

// src/cli/commands/undo.ts
function dropMissingNodes(stack, missingBranches) {
  let next = stack;
  for (const node of StackManager.toposort(stack)) {
    if (!missingBranches.has(node.branch))
      continue;
    const current = StackManager.findNode(next, node.branch);
    if (!current)
      continue;
    for (const child of StackManager.getChildren(next, node.branch)) {
      next = StackManager.moveNode(next, child.branch, current.parent);
    }
    next = StackManager.removeNode(next, node.branch);
  }
  return next;
}
async function undoCommand(ctx) {
  const paused = await requireNoPause(ctx);
  if (paused !== null)
    return paused;
  const entries = await OperationLog.load();
  const entry = [...entries].reverse().find((e) => entryBelongsToRepo(e, ctx.commonDir));
  if (!entry)
    return fail("nothing to undo (no operations for this repo)");
  if (!canUndo(entry))
    return fail(`cannot undo "${entry.operation}" (not reversible)`);
  const guarded = await requireStackFree(ctx, entry.stackSnapshot.id);
  if (guarded !== null)
    return guarded;
  const result = await undo(ctx.repoRoot, entry);
  let skippedBranches = [];
  let restoredStack = result.restoredStack;
  if (result.success) {
    const unconfirmed = Object.keys(entry.branchSnapshots).filter((branch) => !result.restoredBranches.includes(branch));
    const checks = await Promise.all(unconfirmed.map(async (branch) => [branch, await GitShell.branchExists(ctx.repoRoot, branch)]));
    skippedBranches = checks.filter(([, exists]) => !exists).map(([branch]) => branch);
    if (skippedBranches.length > 0) {
      restoredStack = dropMissingNodes(restoredStack, new Set(skippedBranches));
    }
    const store = await loadStore(ctx.repoRoot);
    if (store.stacks.some((s) => s.id === restoredStack.id)) {
      await updateStore(ctx.repoRoot, (fresh) => ({
        ...fresh,
        stacks: fresh.stacks.map((s) => s.id === restoredStack.id ? restoredStack : s)
      }));
    }
  }
  const skippedNote = skippedBranches.length > 0 ? `; dropped from stack (branch no longer exists): ${skippedBranches.join(", ")}` : "";
  const human = result.success ? `undone: restored ${result.restoredBranches.join(", ") || "no branches"}${skippedNote}${result.error ? ` (${result.error})` : ""}` : `undo failed: ${result.error ?? "unknown error"}`;
  emit(ctx, human, { ...result, restoredStack, skippedBranches });
  return result.success ? 0 : 1;
}

// src/cli/main.ts
var COMMANDS = {
  stacks: stacksCommand,
  diagnose: diagnoseCommand,
  preflight: preflightCommand,
  log: logCommand,
  track: trackCommand,
  untrack: untrackCommand,
  add: addCommand,
  remove: removeCommand,
  sync: syncCommand,
  continue: continueCommand,
  abort: abortCommand,
  absorb: absorbCommand,
  split: splitCommand,
  fold: foldCommand,
  reparent: reparentCommand,
  rename: renameCommand,
  reset: resetCommand,
  publish: publishCommand,
  import: importCommand,
  undo: undoCommand
};
var HELP_FLAGS = new Set(["--help", "-h"]);
var USAGE = {
  stacks: "gitq stacks [--json]",
  diagnose: "gitq diagnose [--json]",
  preflight: "gitq preflight [--json]",
  log: "gitq log [--json]",
  track: "gitq track <stackName> --root <branch> [--json]",
  untrack: "gitq untrack <stackName> [--json]",
  add: "gitq add <branch> --parent <branch> [--stack <name>] [--json]",
  remove: "gitq remove <branch> [--stack <name>] [--json]",
  sync: "gitq sync [--stack <name>] [--json]",
  continue: "gitq continue [--stack <name>] [--json]",
  abort: "gitq abort [--stack <name>] [--json]",
  absorb: "gitq absorb [--preview] [--stack <name>] [--json]",
  split: "gitq split <branch> (--at <sha> | --files <glob[,glob...]>) --name <newBranch> [--stack <name>] [--json]",
  fold: "gitq fold <branch> [--stack <name>] [--json]",
  reparent: "gitq reparent <branch> --onto <branch> [--stack <name>] [--json]",
  rename: "gitq rename <oldBranch> <newBranch> [--stack <name>] [--json]",
  reset: "gitq reset <branch> [--stack <name>] [--json]",
  publish: "gitq publish [--mr-meta <path>] [--stack <name>] [--json]",
  import: "gitq import [--replace] [--json]",
  undo: "gitq undo [--json]"
};
function helpText(command) {
  const named = command !== undefined ? USAGE[command] : undefined;
  if (named)
    return `usage: ${named}`;
  const width = Math.max(...Object.keys(USAGE).map((name) => name.length));
  const rows = Object.entries(USAGE).map(([name, line]) => `  ${name.padEnd(width)}  ${line}`);
  return [
    "usage: gitq <command> [args] [--json] [-C <path>]",
    "",
    "commands:",
    ...rows,
    "",
    "every command also accepts --json and -C <path>."
  ].join(`
`);
}
async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    options: {
      C: { type: "string" },
      json: { type: "boolean" },
      stack: { type: "string" },
      root: { type: "string" },
      parent: { type: "string" },
      onto: { type: "string" },
      at: { type: "string" },
      name: { type: "string" },
      files: { type: "string" },
      preview: { type: "boolean" },
      "mr-meta": { type: "string" },
      replace: { type: "boolean" }
    }
  });
  const [name, ...rest] = positionals.map(String);
  if (argv.some((arg) => HELP_FLAGS.has(arg))) {
    console.log(helpText(name));
    return 0;
  }
  if (!name)
    return fail(`usage: gitq <command> [args] [--json] [-C <path>]. commands: ${Object.keys(COMMANDS).join(", ")}`);
  const command = COMMANDS[name];
  if (!command)
    return fail(`unknown command: ${name}`);
  const startDir = typeof values.C === "string" ? values.C : process.cwd();
  try {
    const ctx = await createContext(startDir, rest, values);
    return await command(ctx);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
export {
  main,
  helpText,
  USAGE,
  COMMANDS
};

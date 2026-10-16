import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { rtCommand, type Commands } from "../../packages/rt-client/src/index.ts";
import { explainError } from "../explain-error.ts";
import { loadRepoIndex } from "../repo-index.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { createRealProbes } from "../setup/probes.ts";
import { forgeFromRemote } from "../setup/team-settings.ts";
import { forgeArgv } from "../team/forge.ts";
import { GIT_GLOBAL_OPTS } from "../skills/mcp-lint.ts";
import { childEnv, runCapture } from "../subprocess.ts";
import { resolveRepoTarget } from "./mr-target.ts";
import { checkOptional, err, MR_TARGET_PROPS, ok, type McpToolDef, type ToolResult } from "./shared.ts";
import { checkRegisteredTree, gitChildEnv, realTreeGuardDeps, type TreeGuardDeps } from "./tree-guard.ts";

export { gitChildEnv };

// A ceiling at the tree's parent: a tree whose .git is gone fails rather
// than letting git find the repo around it.
export function syncChildEnv(base: Record<string, string | undefined>, cwd: string): Record<string, string | undefined> {
  return gitChildEnv(base, { GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: dirname(cwd), RT_BATCH: "1", RT_SKIP_SETUP: "1" });
}

export type GitRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const realGitRunner: GitRunner = async (args, cwd) => {
  const r = await runCapture(["git", ...args], { cwd, stderr: "pipe", timeoutMs: 120_000, env: gitChildEnv(childEnv(), { GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: dirname(cwd) }) });
  return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
};

const PROTECTED = new Set(["main", "master"]);
const DETACHED = "refusing to push a detached HEAD";

const HEADS = "refs/heads/";

// The short form prints `heads/<b>` when a tag or other ref shares the name,
// and that string names a different ref in a refspec, so the name is always
// the full ref with its prefix stripped.
export async function currentBranch(cwd: string, git: GitRunner): Promise<string | null> {
  const r = await git(["symbolic-ref", "--quiet", "HEAD"], cwd);
  if (r.code !== 0) return null;
  const full = r.stdout.trim();
  if (!full.startsWith(HEADS) || full.length === HEADS.length) return null;
  return full.slice(HEADS.length);
}

/** Every name the remote's default branch may have, or null when none is
    known, which callers must refuse rather than treat as "no default".
    `refs/remotes/<remote>/HEAD` can be missing, or stale after the server's
    default moves (a fetch never updates it), so the remote is asked too and
    both answers are protected. `primary` prefers the remote's answer, the
    order rt sync resolves its rebase target in. */
async function remoteDefault(cwd: string, git: GitRunner, remote = "origin"): Promise<{ names: string[]; primary: string } | null> {
  const prefix = `refs/remotes/${remote}/`;
  const sym = await git(["symbolic-ref", "--quiet", `${prefix}HEAD`], cwd);
  const symRef = sym.code === 0 ? sym.stdout.trim() : "";
  const local = symRef.startsWith(prefix) && symRef.length > prefix.length ? symRef.slice(prefix.length) : null;
  const ls = await git(["ls-remote", "--symref", "--end-of-options", remote, "HEAD"], cwd);
  const match = ls.code === 0 ? ls.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m) : null;
  const asked = match ? match[1]! : null;
  const primary = asked ?? local;
  if (primary === null) return null;
  return { names: [...new Set([asked, local].filter((n): n is string => n !== null))], primary };
}

// git follows a push rejection with several `hint:` lines, which would push
// the `! [rejected]` line out of a plain last-3-lines tail.
function detail(r: { stderr: string; stdout: string }): string {
  return (r.stderr.trim() || r.stdout.trim()).split("\n").filter((l) => !l.startsWith("hint:")).slice(-3).join(" ");
}

/** The branch a tool may push from: never detached, never main/master or the
    remote default. An origin whose default cannot be determined refuses
    rather than falling through as "no default", so a repo defaulting to
    develop or trunk is protected exactly like one defaulting to main. */
export async function pushableBranch(cwd: string, git: GitRunner): Promise<{ branch: string; defaultBranch: string } | { error: string }> {
  const branch = await currentBranch(cwd, git);
  if (branch === null) return { error: DETACHED };
  return checkPushable(cwd, git, branch);
}

async function checkPushable(cwd: string, git: GitRunner, branch: string): Promise<{ branch: string; defaultBranch: string } | { error: string }> {
  if (PROTECTED.has(branch)) return { error: `refusing to push ${branch}: the default branch and main/master are never pushed by a tool` };
  const def = await remoteDefault(cwd, git);
  if (def === null) return { error: `refusing to push ${branch}: origin's default branch could not be determined` };
  if (def.names.includes(branch)) return { error: `refusing to push ${branch}: the default branch and main/master are never pushed by a tool` };
  return { branch, defaultBranch: def.primary };
}

export type OpenMrLookup =
  | { ok: true; mr: { iid: number; url: string | null; pipelineId: number | null } | null }
  | { ok: false; error: string };

const MR_LOOKUP_TIMEOUT_MS = 30_000;

export async function realOpenMr(repoName: string, branch: string, command: typeof rtCommand = rtCommand): Promise<OpenMrLookup> {
  const r = await command<Commands["mr:live-by-branch"]["data"]>("mr:live-by-branch", { repoName, branches: [branch] }, { timeoutMs: MR_LOOKUP_TIMEOUT_MS });
  if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "branch lookup failed") };
  const pr = r.data.byBranch[branch];
  if (!pr) return { ok: true, mr: null };
  const pipeline = /:(\d+)$/.exec(pr.pipeline?.id ?? "");
  return { ok: true, mr: { iid: pr.iid, url: pr.webUrl, pipelineId: pipeline ? Number(pipeline[1]) : null } };
}

// Read before the push, so a CI watch can tell the pipeline the push starts
// from the one already there. A forge that cannot answer never blocks the push.
async function priorPipeline(openMr: (branch: string) => Promise<OpenMrLookup>, branch: string): Promise<Record<string, unknown>> {
  const found = await openMr(branch);
  if (!found.ok) return { mr: null, priorPipelineId: null, mrLookup: "unavailable", mrLookupError: found.error };
  if (!found.mr) return { mr: null, priorPipelineId: null, mrLookup: "read" };
  return { mr: { iid: found.mr.iid, url: found.mr.url }, priorPipelineId: found.mr.pipelineId, mrLookup: "read" };
}

// A bare `git push` obeys push.default, which under `matching` pushes every
// matching branch (main included) and under `simple` fails on a renamed
// upstream; an explicit refspec pushes exactly one ref either way.
export async function gitPush(
  cwd: string,
  opts: { forceWithLease?: boolean; setUpstream?: boolean },
  git: GitRunner,
  openMr?: (branch: string) => Promise<OpenMrLookup>,
): Promise<ToolResult> {
  const b = await pushableBranch(cwd, git);
  if ("error" in b) return err(b.error);
  const branch = b.branch;
  // push.followTags or push.recurseSubmodules in config would send refs
  // beyond the one refspec.
  const args = ["push", "--no-follow-tags", "--recurse-submodules=no"];
  // A lease alone checks against origin/<branch> as last fetched, and any
  // fetch (git_rebase fetches first) moves that ref, so the lease passes
  // over remote commits HEAD never saw; --force-if-includes refuses those.
  if (opts.forceWithLease) args.push("--force-with-lease", "--force-if-includes");
  const asOrigin = `pass setUpstream: true to push it as origin/${branch}`;
  let remote: string;
  let remoteBranch: string;
  if (opts.setUpstream) {
    remote = "origin";
    remoteBranch = branch;
    args.push("-u");
  } else {
    const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);
    if (upstream.code !== 0) return err(`${branch} has no upstream; ${asOrigin}`);
    const full = upstream.stdout.trim();
    const slash = full.indexOf("/");
    if (slash <= 0) return err(`cannot read the upstream of ${branch}: ${full}`);
    remote = full.slice(0, slash);
    remoteBranch = full.slice(slash + 1);
    // `git checkout -b feat/x origin/main` tracks main, and a stacked child
    // tracking origin/<parent> would fast-forward the parent with the child's
    // commits, so the refspec only ever lands on the branch's own name.
    if (remoteBranch !== branch) return err(`refusing to push ${branch}: its upstream is ${full}, a different branch name; ${asOrigin}`);
    // pushableBranch checked origin's default only; another remote can
    // default to a name origin treats as an ordinary branch.
    const remoteDef = await remoteDefault(cwd, git, remote);
    if (remoteDef === null) return err(`refusing to push ${branch}: its upstream is ${full}, whose remote's default branch could not be determined`);
    if (remoteDef.names.includes(remoteBranch)) return err(`refusing to push ${branch}: its upstream ${full} is ${remote}'s default branch; ${asOrigin}`);
  }
  // A remote name comes from config and may start with a dash.
  args.push("--end-of-options", remote, `HEAD:refs/heads/${remoteBranch}`);
  const head = await git(["rev-parse", "--verify", "HEAD"], cwd);
  if (head.code !== 0) return err(`git rev-parse --verify HEAD failed: ${detail(head)}`);
  const before = openMr ? await priorPipeline(openMr, branch) : {};
  const r = await git(args, cwd);
  if (r.code !== 0) return err(`git push failed: ${detail(r)}`);
  return ok({ pushed: true, branch, sha: head.stdout.trim(), forceWithLease: opts.forceWithLease === true, upstream: `${remote}/${remoteBranch}`, ...before });
}

export async function gitPull(cwd: string, git: GitRunner): Promise<ToolResult> {
  const r = await git(["pull", "--ff-only"], cwd);
  if (r.code !== 0) return err(`git pull --ff-only failed (a diverged branch is never merged or rebased here): ${detail(r)}`);
  return ok({ pulled: true, output: r.stdout.trim() });
}

async function remoteOf(ref: string, cwd: string, git: GitRunner): Promise<{ remote: string | null } | { error: string }> {
  const slash = ref.indexOf("/");
  if (slash <= 0) return { remote: null };
  const remotes = await git(["remote"], cwd);
  if (remotes.code !== 0) return { error: `git remote failed: ${detail(remotes)}` };
  const head = ref.slice(0, slash);
  return { remote: lines(remotes.stdout).includes(head) ? head : null };
}

// onto is placed after --end-of-options so git never parses it as an option
// (`--exec=<cmd>` would run that command); a dash-leading value would parse
// as an option anywhere --end-of-options is missing, so it is refused even here.
export async function gitRebase(cwd: string, opts: { onto?: string; abort?: boolean }, git: GitRunner): Promise<ToolResult> {
  if (opts.abort && opts.onto !== undefined) return err("pass onto or abort, not both");
  if (opts.abort) {
    const r = await git(["rebase", "--abort"], cwd);
    return r.code === 0 ? ok({ status: "aborted" }) : err(`git rebase --abort failed: ${detail(r)}`);
  }
  if (typeof opts.onto !== "string" || opts.onto === "") return err('"onto" (a branch or ref) is required unless abort: true');
  if (opts.onto.startsWith("-") || /\s/.test(opts.onto)) return err('"onto" must be a branch or ref name, not an option');
  const of = await remoteOf(opts.onto, cwd, git);
  if ("error" in of) return err(of.error);
  const fetched = of.remote;
  if (fetched !== null) {
    const f = await git(["fetch", fetched], cwd);
    if (f.code !== 0) return err(`git fetch ${fetched} failed: ${detail(f)}`);
  }
  const r = await git(["rebase", "--end-of-options", opts.onto], cwd);
  if (r.code === 0) return ok({ status: "ok", onto: opts.onto, fetched });
  const conflicted = await git(["diff", "--name-only", "--diff-filter=U"], cwd);
  const files = conflicted.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (files.length > 0) return ok({ status: "conflict", onto: opts.onto, files });
  return err(`git rebase ${opts.onto} failed: ${detail(r)}`);
}

type ConfigRead = { status: "set"; value: string } | { status: "unset" } | { status: "error"; detail: string };

// `git config --get*` exits 1 when the key is absent, and anything else nonzero
// means the config could not be read at all (a corrupt file, a lock), which is
// never the same thing as "not configured".
async function readConfig(cwd: string, git: GitRunner, args: string[]): Promise<ConfigRead> {
  const r = await git(["config", ...args], cwd);
  if (r.code === 0) return { status: "set", value: r.stdout.trim() };
  if (r.code === 1) return { status: "unset" };
  return { status: "error", detail: `git config ${args.join(" ")} failed: ${detail(r)}` };
}

// rt sync pushes a src-only refspec (`origin <branch>`), so git takes the
// destination ref from config: remote.origin.push, or push.default
// upstream/tracking with a branch.<b>.merge naming another branch, sends that
// push to a different branch than the one checked here.
async function pushDestinationRedirected(cwd: string, git: GitRunner, branch: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const originPush = await readConfig(cwd, git, ["--get-all", "remote.origin.push"]);
  if (originPush.status === "error") return { ok: false, error: originPush.detail };
  if (originPush.status === "set") return { ok: false, error: `refusing to sync ${branch}: remote.origin.push redirects pushes to another ref` };

  const pushDefault = await readConfig(cwd, git, ["--get", "push.default"]);
  if (pushDefault.status === "error") return { ok: false, error: pushDefault.detail };
  if (pushDefault.status === "unset" || (pushDefault.value !== "upstream" && pushDefault.value !== "tracking")) return { ok: true };

  const merge = await readConfig(cwd, git, ["--get", `branch.${branch}.merge`]);
  if (merge.status === "error") return { ok: false, error: merge.detail };
  const expected = `refs/heads/${branch}`;
  if (merge.status === "unset" || merge.value !== expected) {
    return { ok: false, error: `refusing to sync ${branch}: push.default is ${pushDefault.value} and branch.${branch}.merge is not ${expected}, so the push could land elsewhere` };
  }
  return { ok: true };
}

// rt sync interpolates the branch name into shell command strings, and git
// accepts `$`, `(`, `;`, `|` and `${IFS}` in branch names. A dash-leading
// name (`refs/heads/--mirror` can exist) would parse as a git option there.
const SHELL_SAFE_BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._\/-]*$/;

// A paused rebase detaches HEAD, so this runs before the detached-HEAD
// refusal to give the error that says how to get out. `--git-path` answers
// relative to cwd in a main checkout and absolutely in a linked worktree.
async function rebaseInProgress(cwd: string, git: GitRunner, exists: (p: string) => boolean): Promise<{ inProgress: boolean } | { error: string }> {
  const r = await git(["rev-parse", "--git-path", "rebase-merge", "--git-path", "rebase-apply"], cwd);
  if (r.code !== 0) return { error: `git rev-parse --git-path failed: ${detail(r)}` };
  const paths = lines(r.stdout);
  if (paths.length !== 2) return { error: `git rev-parse --git-path returned an unreadable answer: ${detail(r)}` };
  return { inProgress: paths.some((p) => exists(resolve(cwd, p))) };
}

// Porcelain v1 is `XY path`, or `XY orig -> path` for a rename.
function porcelainPaths(stdout: string): string[] {
  return stdout.split("\n").filter((l) => l.length > 3).map((l) => l.slice(3).split(" -> ").at(-1)!);
}

export async function branchSyncPreflight(cwd: string, git: GitRunner, exists: (p: string) => boolean = existsSync): Promise<{ ok: true; diverged: boolean } | { ok: false; error: string; dirty?: string[] }> {
  const rebasing = await rebaseInProgress(cwd, git, exists);
  if ("error" in rebasing) return { ok: false, error: rebasing.error };
  if (rebasing.inProgress) return { ok: false, error: "a rebase is in progress; finish it with git rebase --continue or git_rebase {abort: true}" };
  const current = await currentBranch(cwd, git);
  if (current === null) return { ok: false, error: DETACHED.replace("push", "sync") };
  // rt sync reads the short form and pushes `origin <that>`, so a short name
  // that differs from the branch lands on whatever ref it resolves to.
  const short = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  if (short.code !== 0) return { ok: false, error: `git symbolic-ref --short HEAD failed: ${detail(short)}` };
  if (short.stdout.trim() !== current) {
    return { ok: false, error: `refusing to sync ${JSON.stringify(current)}: the branch name is ambiguous with a tag or other ref of the same name, which rt sync cannot sync safely` };
  }
  const b = await checkPushable(cwd, git, current);
  if ("error" in b) return { ok: false, error: b.error.replace("push", "sync") };
  const { branch, defaultBranch } = b;
  if (!SHELL_SAFE_BRANCH.test(branch)) {
    return { ok: false, error: `refusing to sync ${JSON.stringify(branch)}: the branch name has characters rt sync cannot pass safely (only letters, digits, ".", "_", "/" and "-")` };
  }

  // rt sync refuses the same tree (untracked files count there too), but only
  // after its own checks, and its refusal reads as a failure.
  const status = await git(["status", "--porcelain"], cwd);
  if (status.code !== 0) return { ok: false, error: `git status --porcelain failed: ${detail(status)}` };
  const dirty = porcelainPaths(status.stdout);
  if (dirty.length > 0) return { ok: false, dirty, error: `refusing to sync ${branch}: the tree has uncommitted changes, which the rebase could lose: ${dirty.join(", ")}` };

  const redirect = await pushDestinationRedirected(cwd, git, branch);
  if (!redirect.ok) return { ok: false, error: redirect.error };

  const fetched = await git(["fetch", "origin"], cwd);
  if (fetched.code !== 0) return { ok: false, error: `git fetch origin failed: ${detail(fetched)}` };
  const shadowed = await shadowedRemoteName(cwd, git, branch, [`origin/${branch}`, `origin/${defaultBranch}`]);
  if (shadowed !== null) return { ok: false, error: shadowed };

  // Full refs, since git resolves a short `origin/<b>` to refs/heads/origin/<b>
  // before refs/remotes/origin/<b>.
  const remoteRef = `refs/remotes/origin/${branch}`;
  const defaultRef = `refs/remotes/origin/${defaultBranch}`;
  const remote = await git(["rev-parse", "--verify", "--quiet", remoteRef], cwd);
  if (remote.code === 1) return { ok: true, diverged: false };
  if (remote.code !== 0) return { ok: false, error: `git rev-parse --verify ${remoteRef} failed: ${detail(remote)}` };

  const counts = await git(["rev-list", "--left-right", "--count", `${remoteRef}...HEAD`], cwd);
  if (counts.code !== 0) return { ok: false, error: `git rev-list --left-right --count failed: ${detail(counts)}` };
  const [behindStr, aheadStr] = counts.stdout.trim().split(/\s+/);
  const behind = Number(behindStr);
  const ahead = Number(aheadStr);
  if (!Number.isInteger(behind) || behind < 0 || !Number.isInteger(ahead) || ahead < 0) {
    return { ok: false, error: `git rev-list --left-right --count returned an unreadable count: ${detail(counts)}` };
  }
  if (behind === 0) return { ok: true, diverged: false };
  // rt sync force-pushes a branch that is only behind without fast-forwarding it.
  if (ahead === 0) return { ok: false, error: `origin/${branch} has commits this tree lacks; run git_pull first` };

  // Commits reachable from the default branch are never unpushed work, the
  // same exclusion rt sync's reset applies.
  const unpushedCmd = await git(["rev-list", "--cherry-pick", "--right-only", "--no-merges", `${remoteRef}...HEAD`, `^${defaultRef}`], cwd);
  if (unpushedCmd.code !== 0) return { ok: false, error: `git rev-list --cherry-pick failed: ${detail(unpushedCmd)}` };
  const unpushed = lines(unpushedCmd.stdout);
  if (unpushed.length > 0) return { ok: false, error: `refusing to reset ${branch} to origin: local commits with no equivalent on origin would be lost: ${unpushed.join(", ")}` };

  const newer = await localIsNewerRewrite(cwd, git, remoteRef, defaultRef);
  if ("error" in newer) return { ok: false, error: newer.error };
  if (newer.localNewer) {
    const remoteOnlyCmd = await git(["rev-list", "--cherry-pick", "--left-only", "--no-merges", `${remoteRef}...HEAD`, `^${defaultRef}`], cwd);
    if (remoteOnlyCmd.code !== 0) return { ok: false, error: `git rev-list --cherry-pick --left-only failed: ${detail(remoteOnlyCmd)}` };
    const remoteOnly = lines(remoteOnlyCmd.stdout);
    if (remoteOnly.length > 0) return { ok: false, error: `origin/${branch} has commits this tree lacks; rt sync would keep the local rewrite and force-push over them: ${remoteOnly.join(", ")}` };
  }
  return { ok: true, diverged: true };
}

// rt sync reads the short `origin/<b>` names, which a local branch, tag or
// top-level ref of the same name outranks, so its counts and force-push
// would be taken against the local ref instead of origin's.
async function shadowedRemoteName(cwd: string, git: GitRunner, branch: string, shortNames: string[]): Promise<string | null> {
  for (const shortName of shortNames) {
    for (const ref of [`refs/heads/${shortName}`, `refs/tags/${shortName}`, `refs/${shortName}`]) {
      const r = await git(["rev-parse", "--verify", "--quiet", ref], cwd);
      if (r.code === 1) continue;
      if (r.code === 0) return `refusing to sync ${branch}: a local ref named ${shortName} (${ref}) shadows the remote-tracking ref, which rt sync cannot sync safely`;
      return `git rev-parse --verify ${ref} failed: ${detail(r)}`;
    }
  }
  return null;
}

function lines(s: string): string[] {
  return s.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

// rt sync's reset keeps the local side, and force-pushes it, when the local
// fork point from the default branch is strictly newer than origin's; any
// commit only origin has is then dropped. Unlike rt sync, a failed probe
// here refuses instead of falling through.
async function localIsNewerRewrite(cwd: string, git: GitRunner, remoteRef: string, defaultRef: string): Promise<{ localNewer: boolean } | { error: string }> {
  const localBase = await git(["merge-base", "HEAD", defaultRef], cwd);
  if (localBase.code !== 0) return { error: `git merge-base HEAD ${defaultRef} failed: ${detail(localBase)}` };
  const remoteBase = await git(["merge-base", remoteRef, defaultRef], cwd);
  if (remoteBase.code !== 0) return { error: `git merge-base ${remoteRef} ${defaultRef} failed: ${detail(remoteBase)}` };
  const local = localBase.stdout.trim();
  const remote = remoteBase.stdout.trim();
  if (local === remote) return { localNewer: false };
  const anc = await git(["merge-base", "--is-ancestor", remote, local], cwd);
  if (anc.code === 0) return { localNewer: true };
  if (anc.code === 1) return { localNewer: false };
  return { error: `git merge-base --is-ancestor failed: ${detail(anc)}` };
}

const SYNC_TIMEOUT_MS = 300_000;

export const realSyncRunner = async (cwd: string): Promise<{ code: number; stdout: string; stderr: string }> => {
  const [exe, ...rest] = rtSelfArgv();
  const r = await runCapture([exe!, ...rest, "sync", "--json", "--no-agent"], { cwd, stderr: "pipe", timeoutMs: SYNC_TIMEOUT_MS, env: syncChildEnv(childEnv(), cwd) });
  return { code: r.timedOut ? 124 : r.exitCode, stdout: r.stdout, stderr: r.stderr };
};

export type BranchSyncKind = "synced" | "up-to-date" | "dirty-tree" | "conflict" | "stacked-refused" | "push-refused" | "error";

export interface BranchSyncResult {
  kind: BranchSyncKind;
  branch: string | null;
  /** The branch ref, never HEAD: a paused rebase detaches HEAD but leaves the branch where it was. */
  oldHead: string | null;
  newHead: string | null;
  pushed: boolean;
  refusal: string | null;
  [extra: string]: unknown;
}

async function refSha(cwd: string, git: GitRunner, ref: string): Promise<string | null> {
  const r = await git(["rev-parse", "--verify", "--quiet", ref], cwd);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

function parseJson(stdout: string): Record<string, unknown> {
  try {
    const body = JSON.parse(stdout) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// rt sync --json ends a failure with its title first (commands/sync.ts
// compactFailure), after any warning lines; these are the titles of its own
// uncommitted-changes refusal and of a push that failed after the rebase.
const UNCOMMITTED_TITLE = /^\[refused\] You have uncommitted changes/;
const PUSH_FAILED_TITLE = /^(\[failed\] )?Could not push /;

/** The failure rt sync ended on, from its title line down, read per line so a warning above it cannot hide the title. */
function syncFailure(stderr: string): { kind: "dirty-tree" | "push-refused"; text: string } | null {
  const lines = stderr.trim().split("\n").filter((l) => !l.startsWith("hint:"));
  for (let i = lines.length - 1; i >= 0; i--) {
    const kind = UNCOMMITTED_TITLE.test(lines[i]!) ? "dirty-tree" : PUSH_FAILED_TITLE.test(lines[i]!) ? "push-refused" : null;
    if (kind) return { kind, text: lines.slice(i).join(" ") };
  }
  return null;
}

export async function branchSync(cwd: string, deps: Pick<GitToolDeps, "git" | "sync">): Promise<BranchSyncResult> {
  const branch = await currentBranch(cwd, deps.git);
  const head = () => (branch === null ? Promise.resolve(null) : refSha(cwd, deps.git, `refs/heads/${branch}`));
  const oldHead = await head();
  const ended = async (kind: BranchSyncKind, refusal: string | null, extra: Record<string, unknown> = {}): Promise<BranchSyncResult> =>
    ({ ...extra, kind, branch, oldHead, newHead: await head(), pushed: false, refusal });

  const pre = await branchSyncPreflight(cwd, deps.git);
  if (!pre.ok) return pre.dirty ? ended("dirty-tree", pre.error, { paths: pre.dirty }) : ended("error", pre.error);
  const r = await deps.sync(cwd);
  const body = parseJson(r.stdout);
  if (r.code === 0) {
    const newHead = await head();
    const moved = newHead !== oldHead;
    const pushed = moved && newHead !== null && (await refSha(cwd, deps.git, `refs/remotes/origin/${branch}`)) === newHead;
    return { kind: moved ? "synced" : "up-to-date", branch, oldHead, newHead, pushed, refusal: null, divergedFromOrigin: pre.diverged, status: "synced" };
  }
  if (r.code === 3) return ended("conflict", null, { ...body, status: "conflict" });
  if (r.code === 4 && typeof body.hint === "string") {
    const text = typeof body.tool === "string" && body.tool !== "" ? `${body.hint}. Run: ${body.tool}` : body.hint;
    return ended("stacked-refused", text, { stackCheck: body });
  }
  if (r.code === 124) return ended("error", `rt sync timed out after ${SYNC_TIMEOUT_MS / 1000}s`);
  if (r.code === -1 && r.stderr.trim() === "") return ended("error", "could not start rt sync");
  const known = r.code === 1 && typeof body.error !== "string" ? syncFailure(r.stderr) : null;
  if (known) return ended(known.kind, known.text);
  const said = typeof body.error === "string" ? body.error : detail(r);
  return ended("error", `rt sync refused (exit ${r.code}): ${said}`);
}

export interface SweepMr {
  iid: number;
  branch: string;
  url: string | null;
}

export type AuthoredMrs = { ok: true; mrs: SweepMr[]; complete: boolean } | { ok: false; error: string };
export type RepoTrees = { ok: true; trees: Array<{ path: string; branch: string | null }> } | { ok: false; error: string };

export interface SweepIo {
  checkout: (identity: string) => string | undefined;
  originOf: (checkout: string) => Promise<string | null>;
  gh: (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  command: typeof rtCommand;
}

const SWEEP_LIST_LIMIT = 200;

function realSweepIo(): SweepIo {
  const p = createRealProbes();
  return {
    checkout: (identity) => loadRepoIndex()[identity],
    originOf: async (checkout) => {
      const r = await realGitRunner(["remote", "get-url", "origin"], checkout);
      return r.code === 0 ? r.stdout.trim() || null : null;
    },
    gh: (args, cwd) => p.exec([...forgeArgv(p, "gh"), ...args], { cwd, timeoutMs: MR_LOOKUP_TIMEOUT_MS }),
    command: rtCommand,
  };
}

function ghPrs(stdout: string): SweepMr[] | null {
  try {
    const rows = JSON.parse(stdout) as unknown;
    if (!Array.isArray(rows)) return null;
    const mrs = (rows as Array<{ number?: unknown; headRefName?: unknown; url?: unknown }>).map((row) => ({ iid: row.number, branch: row.headRefName, url: row.url }));
    return mrs.every((mr) => Number.isInteger(mr.iid) && typeof mr.branch === "string" && typeof mr.url === "string") ? (mrs as SweepMr[]) : null;
  } catch {
    return null;
  }
}

// The daemon's MR reads are GitLab only, so a GitHub repo asks gh, which
// names the signed-in user as @me the way GitLab's author: me does.
export async function realAuthoredOpenMrs(identity: string, io: SweepIo = realSweepIo()): Promise<AuthoredMrs> {
  const checkout = io.checkout(identity);
  if (!checkout) return { ok: false, error: `${identity} has no registered checkout` };
  const origin = await io.originOf(checkout);
  if (origin === null) return { ok: false, error: `${checkout} has no origin remote` };
  const forge = forgeFromRemote(origin);
  if (!forge) return { ok: false, error: `origin ${origin} is not a GitHub or GitLab remote` };
  if (forge.provider === "github") {
    const r = await io.gh(["pr", "list", "--state", "open", "--author", "@me", "--limit", String(SWEEP_LIST_LIMIT), "--json", "number,headRefName,url"], checkout);
    if (r.code !== 0) return { ok: false, error: `gh pr list failed: ${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).split("\n")[0]}` };
    const mrs = ghPrs(r.stdout);
    if (mrs === null) return { ok: false, error: "gh pr list answered with something other than a list of pull requests" };
    return { ok: true, mrs, complete: mrs.length < SWEEP_LIST_LIMIT };
  }
  const r = await io.command<Commands["mr:list-live"]["data"]>("mr:list-live", { repoName: identity, author: "me", state: "opened", limit: SWEEP_LIST_LIMIT }, { timeoutMs: MR_LOOKUP_TIMEOUT_MS });
  if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "MR listing failed") };
  return { ok: true, mrs: r.data.mrs.map((mr) => ({ iid: mr.iid, branch: mr.sourceBranch, url: mr.webUrl ?? null })), complete: !r.data.truncated };
}

export async function realRepoTrees(identity: string, command: typeof rtCommand = rtCommand): Promise<RepoTrees> {
  const r = await command<Commands["worktree:list"]["data"]>("worktree:list", { repoName: identity }, { timeoutMs: MR_LOOKUP_TIMEOUT_MS });
  if (!r.ok || !r.data) return { ok: false, error: explainError(r.error ?? "worktree listing failed") };
  return { ok: true, trees: (r.data.trees ?? []).map((t) => ({ path: t.path, branch: t.branch ?? null })) };
}

export async function realResolveRepo(repoName: unknown): Promise<{ ok: true; identity: string } | { ok: false; error: string }> {
  if (typeof repoName !== "string") return { ok: false, error: '"repoName" must be a string' };
  const target = await resolveRepoTarget({ repoName });
  return target.ok ? { ok: true, identity: target.identity } : { ok: false, error: target.error };
}

/** Sequential, and never aborts a paused rebase: rt sync --json leaves a conflict paused, and each tree is its own checkout. */
export async function branchSyncSweep(
  repoName: unknown,
  deps: GitToolDeps,
  progress?: () => void,
  syncTree: (tree: string) => Promise<BranchSyncResult> = (tree) => branchSync(tree, deps),
): Promise<ToolResult> {
  const repo = await deps.resolveRepo(repoName);
  if (!repo.ok) return err(repo.error);
  const [mrs, trees] = await Promise.all([deps.authoredOpenMrs(repo.identity), deps.repoTrees(repo.identity)]);
  if (!mrs.ok) return err(`could not list your open merge requests: ${mrs.error}`);
  if (!trees.ok) return err(`could not list the repo's worktrees: ${trees.error}`);
  const results: Array<BranchSyncResult & { tree: string; mr: { iid: number; url: string | null } }> = [];
  const noTree: Array<{ branch: string; mr: { iid: number; url: string | null } }> = [];
  for (const mr of mrs.mrs) {
    const ref = { iid: mr.iid, url: mr.url };
    const tree = trees.trees.find((t) => t.branch === mr.branch);
    if (!tree) {
      noTree.push({ branch: mr.branch, mr: ref });
      continue;
    }
    progress?.();
    // The daemon's tree list can lag a checkout switch, and branch_sync syncs
    // whatever is checked out, so the tree's own answer decides.
    const refused = (refusal: string) => results.push({ kind: "error", branch: mr.branch, oldHead: null, newHead: null, pushed: false, refusal, tree: tree.path, mr: ref });
    const admitted = checkRegisteredTree(tree.path, deps.guard);
    if (!admitted.ok) { refused(admitted.error); continue; }
    if (admitted.repoName !== repo.identity || admitted.resolvedFrom !== undefined) {
      refused(`${tree.path} is not a root of ${repo.identity}, so the sweep left it alone`);
      continue;
    }
    const live = await currentBranch(admitted.path, deps.git);
    if (live !== mr.branch) {
      refused(`${tree.path} now has ${live ?? "a detached HEAD"} checked out, not ${mr.branch}, so the sweep left it alone`);
      continue;
    }
    results.push({ ...(await syncTree(admitted.path)), tree: admitted.path, mr: ref });
  }
  return ok({ repoName: repo.identity, results, noTree, complete: mrs.complete });
}

export interface GitToolDeps {
  git: GitRunner;
  guard: TreeGuardDeps;
  sync: (cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** repoName is the identity the tree guard admitted the tree under. */
  openMr: (repoName: string, branch: string) => Promise<OpenMrLookup>;
  resolveRepo: (repoName: unknown) => Promise<{ ok: true; identity: string } | { ok: false; error: string }>;
  /** The caller's own open MRs on the repo; complete is false when the forge may have cut the list short. */
  authoredOpenMrs: (identity: string) => Promise<AuthoredMrs>;
  repoTrees: (identity: string) => Promise<RepoTrees>;
}

export const realGitToolDeps: GitToolDeps = {
  git: realGitRunner,
  guard: realTreeGuardDeps,
  sync: realSyncRunner,
  openMr: (repoName, branch) => realOpenMr(repoName, branch),
  resolveRepo: realResolveRepo,
  authoredOpenMrs: (identity) => realAuthoredOpenMrs(identity),
  repoTrees: (identity) => realRepoTrees(identity),
};

const TREE_PROP = { tree: { type: "string", description: "Absolute path of a checkout or worktree of a repo registered with rt, or a directory inside one, which resolves to that tree's root (the result's tree)." } };

export function gitToolDefs(deps: GitToolDeps): McpToolDef[] {
  // The tree a tool ran in rides on its result, since a subdirectory resolves to its root.
  const guarded = (fn: (path: string, input: Record<string, unknown>, repoName: string) => Promise<ToolResult>) => async (input: Record<string, unknown>): Promise<ToolResult> => {
    const tree = checkRegisteredTree(input.tree, deps.guard);
    if (!tree.ok) return err(tree.error);
    const r = await fn(tree.path, input, tree.repoName);
    return r.ok && r.body !== null && typeof r.body === "object" && !Array.isArray(r.body) ? ok({ ...r.body, tree: tree.path }) : r;
  };
  return [
    {
      name: "git_push",
      description: "Push the tree's current branch as exactly one ref (HEAD to refs/heads/<branch>; no tags, no submodules) to the same-named branch on its upstream's remote, or to origin/<branch> with setUpstream: true, which also makes that the upstream. Force is only ever --force-with-lease --force-if-includes. Refuses a detached HEAD; main, master and origin's default branch, and any push when origin's default cannot be read; a branch with no upstream unless setUpstream: true; an upstream with a different branch name, or one that is its own remote's default branch, or whose remote's default branch cannot be read (setUpstream: true pushes as origin/<branch> instead). Returns the pushed sha and, read from GitLab just before the push, the branch's open MR (mr: {iid, url} or null) and that MR's latest pipeline id (priorPipelineId), so a CI watch can tell the push's pipeline from the one already there. mrLookup is \"unavailable\" when the forge could not be read (a GitHub repo, the daemon down), in which case mr: null is not proof there is none; the push goes ahead either way.",
      inputSchema: { type: "object", properties: { ...TREE_PROP, forceWithLease: { type: "boolean" }, setUpstream: { type: "boolean" } }, required: ["tree"], additionalProperties: false },
      shellForms: ["git push", "rt git push"],
      handler: guarded(async (path, input, repoName) => {
        const bad = checkOptional(input, [{ name: "forceWithLease", type: "boolean" }, { name: "setUpstream", type: "boolean" }]);
        if (bad) return err(bad);
        return gitPush(path, { forceWithLease: input.forceWithLease === true, setUpstream: input.setUpstream === true }, deps.git, (branch) => deps.openMr(repoName, branch));
      }),
    },
    {
      name: "git_pull",
      description: "Fast-forward the tree's current branch from its upstream (--ff-only). A diverged branch is an error, never a merge or rebase.",
      inputSchema: { type: "object", properties: { ...TREE_PROP }, required: ["tree"], additionalProperties: false },
      shellForms: ["git pull", "rt git pull"],
      handler: guarded(async (path) => gitPull(path, deps.git)),
    },
    {
      name: "git_rebase",
      description: "Rebase the tree's current branch onto a named branch or ref; a remote-tracking ref (origin/<branch>) is fetched first. On a conflict it returns status conflict with the conflicted files and leaves the tree mid-rebase for you to resolve (then finish with git rebase --continue in Bash), or pass abort: true to abort one in progress.",
      inputSchema: { type: "object", properties: { ...TREE_PROP, onto: { type: "string" }, abort: { type: "boolean" } }, required: ["tree"], additionalProperties: false },
      shellForms: ["rt git rebase", { id: "git-rebase", pattern: new RegExp(`(?<![\\w-])git${GIT_GLOBAL_OPTS}\\s+rebase\\b(?!\\s+--(continue|skip)\\b)`), example: "git rebase origin/main", note: 'onto: "origin/<default>" (it fetches), or abort: true' }],
      handler: guarded(async (path, input) => {
        const bad = checkOptional(input, [{ name: "onto", type: "string" }, { name: "abort", type: "boolean" }]);
        if (bad) return err(bad);
        return gitRebase(path, { onto: input.onto as string | undefined, abort: input.abort === true }, deps.git);
      }),
    },
    {
      name: "branch_sync",
      description: "Bring the tree's branch current in one call through rt sync: fetch origin; if the branch diverged from origin only because GitLab rebased it (every local commit has a patch-equivalent on origin), reset to origin; rebase onto the default branch; push with --force-with-lease when anything changed. A branch only ahead of origin is not refused, but like any branch it is pushed only when the reset or rebase actually changed it; a branch already at the default branch's tip is left alone, so use git_push to publish new commits. Refuses up front, naming the commits where there are any: a diverged branch whose local commits have no equivalent on origin (the reset would lose them); a branch only behind origin (run git_pull first); origin commits a kept local rewrite would force-push over; a rebase already in progress; a detached HEAD; main, master or the default branch; a branch name rt sync cannot pass safely or that is ambiguous with a tag or other ref; a local ref shadowing origin/<branch> or origin/<default>; a push destination redirected by git config; a gitq stack member, or a branch whose stack membership cannot be verified. Returns {kind, branch, oldHead, newHead, pushed, refusal}, oldHead and newHead being the branch ref before and after. kind is synced (the branch moved; pushed says origin now has it), up-to-date (nothing moved or was pushed), dirty-tree (uncommitted or untracked changes, listed in paths; nothing ran), conflict (rt sync's bundle, the rebase left paused; nothing was pushed, though newHead differs from oldHead when rt sync first reset a GitLab-rebased branch to origin), stacked-refused (stackCheck carries the stack refusal, and refusal names the tool to run), push-refused (the rebase landed locally but the push failed) or error (any other refusal or failure, its reason in refusal).",
      inputSchema: { type: "object", properties: { ...TREE_PROP }, required: ["tree"], additionalProperties: false },
      shellForms: ["rt sync"],
      handler: guarded(async (path) => ok(await branchSync(path, deps))),
    },
    {
      name: "branch_sync_sweep",
      description: `Run branch_sync, one branch at a time, on every branch of yours with an open MR in the repo that has a local worktree. A conflict on one branch leaves that rebase paused for you and the sweep moves on to the next. Your open MRs are read from GitLab (author: me) or GitHub (gh pr list --author @me). Returns {repoName, results, noTree, complete}: results holds one branch_sync result per branch (kind, branch, oldHead, newHead, pushed, refusal), each with its tree and mr {iid, url}; noTree lists your open-MR branches that have no worktree, which the sweep skips; complete is false when the forge may have cut the MR list short. Opens no gate and pushes only what branch_sync itself pushes. repoName is the repo's serialized identity, an absolute path to a local checkout or worktree, or a repo label that matches exactly one registered repo.`,
      inputSchema: { type: "object", properties: { repoName: MR_TARGET_PROPS.repoName }, required: ["repoName"], additionalProperties: false },
      shellForms: { none: "rt sync all syncs every worktree and aborts a conflict; no shell command sweeps only your open-MR branches and leaves a conflict paused" },
      handler: async (input, _env, _signal, progress) => branchSyncSweep(input.repoName, deps, progress),
    },
  ];
}

import { basename, isAbsolute, join } from "path";
import type { Commands, WorktreeSyncData } from "../../../packages/rt-client/src/index.ts";
import { explainError } from "../../explain-error.ts";
import { rtSelfArgv } from "../../rt-self.ts";
import { childEnv, runCapture } from "../../subprocess.ts";

/** The daemon's own entry is lib/daemon.ts from source, so Bun.main there is not the CLI. */
const CLI_ENTRY = join(import.meta.dir, "..", "..", "..", "cli.ts");

/** rt sync's own five-minute ceiling plus the checks around it. */
const BRANCH_SYNC_TIMEOUT_MS = 330_000;

export type SyncResult = Pick<WorktreeSyncData, "kind" | "pushed" | "oldHead" | "newHead" | "refusal">;

type Run = (argv: [string, ...string[]], opts: { cwd: string; timeoutMs: number; stderr: "pipe"; env: Record<string, string | undefined>; onStderrLine?: (line: string) => void }) => Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: boolean }>;

const syncError = (refusal: string): SyncResult => ({ kind: "error", pushed: false, oldHead: null, newHead: null, refusal });

/** The branch at `path`; under a paused rebase HEAD is detached, so the
    branch is the one rebase-merge (or rebase-apply) recorded. */
export async function treeBranch(path: string, run: Run = runCapture): Promise<string | null> {
  const opts = { cwd: path, timeoutMs: 10_000, stderr: "pipe" as const, env: childEnv() };
  const head = await run(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], opts);
  if (head.exitCode === 0 && head.stdout.trim()) return head.stdout.trim();
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const p = await run(["git", "rev-parse", "--git-path", `${dir}/head-name`], opts);
    const file = p.stdout.trim();
    if (p.exitCode !== 0 || !file) continue;
    try {
      const name = (await Bun.file(isAbsolute(file) ? file : join(path, file)).text()).trim();
      if (name) return name.replace(/^refs\/heads\//, "");
    } catch { /* no rebase of this kind here */ }
  }
  return null;
}

export async function runBranchSync(path: string, onLine?: (line: string) => void, run: Run = runCapture): Promise<SyncResult> {
  const [exe, ...rest] = rtSelfArgv({ main: CLI_ENTRY });
  const r = await run([exe!, ...rest, "worktree", "branch-sync", ...(onLine ? ["--progress"] : [])], {
    cwd: path,
    timeoutMs: BRANCH_SYNC_TIMEOUT_MS,
    stderr: "pipe",
    env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0", RT_BATCH: "1", RT_SKIP_SETUP: "1" },
    ...(onLine ? { onStderrLine: onLine } : {}),
  });
  if (r.timedOut) return syncError(`rt sync timed out after ${BRANCH_SYNC_TIMEOUT_MS / 1000}s`);
  try {
    const body = JSON.parse(r.stdout) as SyncResult;
    if (typeof body?.kind === "string") return body;
  } catch { /* falls through to the error below */ }
  return syncError(`rt sync gave no result (exit ${r.exitCode}): ${r.stderr.trim().split("\n").slice(-1)[0] ?? ""}`);
}

type Reply<C extends keyof Commands> = { ok: true; data: Commands[C]["data"] } | { ok: false; error: string };

export interface WorktreeSyncDeps {
  check: (payload: Commands["worktree:provision-check"]["payload"]) => Promise<Reply<"worktree:provision-check">>;
  provision: (payload: Commands["worktree:provision"]["payload"]) => Promise<Reply<"worktree:provision">>;
  dispose: (payload: { repoName: string; tree: string }) => Promise<unknown>;
  /** Whether `path` is one of `repoName`'s registered worktrees. */
  knownTree: (repoName: string, path: string) => boolean;
  /** The branch checked out at `path`, or the one a paused rebase there is rebasing. */
  treeBranch: (path: string) => Promise<string | null>;
  sync: (path: string, onLine?: (line: string) => void) => Promise<SyncResult>;
  /** Each output line of the sync as it happens, in rt's plain `[status] title  hint` form. */
  line?: (event: { repoName: string; branch: string; line: string }) => void;
}

const before = (kind: WorktreeSyncData["kind"], path: string | null, refusal: string, log: string[] = []): WorktreeSyncData =>
  ({ kind, path, provisioned: false, pushed: false, oldHead: null, newHead: null, refusal, log });

// A paused rebase is what the doctor picks up, and after a failed push the
// rebased commits exist only in this tree.
const KEEPS_TREE = new Set<WorktreeSyncData["kind"]>(["conflict", "push-refused"]);

// branch_sync's own refusal text; a retry after a failed doctor launch lands
// on the rebase the last sync paused.
const REBASE_IN_PROGRESS = /^a rebase is in progress/;
const resumable = (r: SyncResult): SyncResult =>
  r.kind === "error" && REBASE_IN_PROGRESS.test(r.refusal ?? "") ? { ...r, kind: "conflict", refusal: null } : r;

export function createWorktreeSyncHandler(deps: WorktreeSyncDeps) {
  return async (payload: any): Promise<Reply<"worktree:sync">> => {
    const repoName = payload?.repoName;
    const branch = payload?.branch;
    if (typeof repoName !== "string" || !repoName) return { ok: false, error: "repoName is required" };
    if (typeof branch !== "string" || !branch) return { ok: false, error: "branch is required" };
    const log: string[] = [];
    const say = (line: string) => {
      log.push(line);
      deps.line?.({ repoName, branch, line });
    };
    // A cleanup that fails is reported, never thrown: the sync's own result
    // still has to reach the caller, and the tree may be left behind.
    const disposeOrSay = async (tree: string): Promise<string | null> => {
      try {
        await deps.dispose({ repoName, tree });
        return null;
      } catch (err) {
        const left = `could not remove worktree ${tree}: ${err instanceof Error ? err.message : String(err)}`;
        say(`[warning] Could not remove worktree ${tree}  ${err instanceof Error ? err.message : String(err)}`);
        return left;
      }
    };

    // A paused rebase detaches HEAD, so the registry may no longer list the
    // tree under its branch; the caller names it instead.
    const named = typeof payload?.tree === "string" && payload.tree ? payload.tree : null;
    if (named && !deps.knownTree(repoName, named)) return { ok: true, data: before("no-tree", null, `${named} is not one of this repo's worktrees`) };
    if (named) {
      const on = await deps.treeBranch(named);
      if (on !== branch) return { ok: true, data: before("no-tree", null, `${named} has ${on ?? "no branch"} checked out, not ${branch}`) };
    }
    const check = named ? null : await deps.check({ repoName, branch });
    if (check && !check.ok) return { ok: true, data: before("no-tree", null, explainError(check.error)) };
    const attached = check?.data.attached ?? [];
    if (attached.length > 1) return { ok: true, data: before("no-tree", null, explainError("branch-duplicated")) };

    let path: string;
    let created: string | null = null;
    const existing = named ?? attached[0]?.path;
    if (existing) {
      path = existing;
      say(`[ok] Syncing in worktree ${attached[0]?.tree ?? basename(existing)}`);
    } else {
      say(`[running] Making a worktree for ${branch}`);
      const made = await deps.provision({ repoName, branch, disposal: "merge" });
      if (!made.ok) return { ok: true, data: before("no-tree", null, explainError(made.error), log) };
      path = made.data.path;
      created = made.data.tree;
      say(`[ok] Made worktree ${created}`);
      // Provision cuts a branch it finds nowhere from the default branch,
      // which would read as "already up to date".
      if (made.data.branchState === "new") {
        const gone = `${branch} is not on origin or this Mac`;
        const left = await disposeOrSay(created);
        return { ok: true, data: before("no-tree", null, left ? `${gone}; ${left}` : gone, log) };
      }
    }

    const r = resumable(await deps.sync(path, say));
    if (created && !KEEPS_TREE.has(r.kind)) {
      const left = await disposeOrSay(created);
      if (!left) say(`[ok] Removed worktree ${created}`);
    }
    return {
      ok: true,
      data: { kind: r.kind, path, provisioned: created !== null, pushed: r.pushed, oldHead: r.oldHead, newHead: r.newHead, refusal: r.refusal, log },
    };
  };
}

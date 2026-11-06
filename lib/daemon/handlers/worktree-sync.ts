import { basename, join } from "path";
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

    // A paused rebase detaches HEAD, so the registry may no longer list the
    // tree under its branch; the caller names it instead.
    const named = typeof payload?.tree === "string" && payload.tree ? payload.tree : null;
    if (named && !deps.knownTree(repoName, named)) return { ok: true, data: before("no-tree", null, `${named} is not one of this repo's worktrees`) };
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
        await deps.dispose({ repoName, tree: created });
        return { ok: true, data: before("no-tree", null, `${branch} is not on origin or this Mac`, log) };
      }
    }

    const r = resumable(await deps.sync(path, say));
    if (created && !KEEPS_TREE.has(r.kind)) {
      await deps.dispose({ repoName, tree: created });
      say(`[ok] Removed worktree ${created}`);
    }
    return {
      ok: true,
      data: { kind: r.kind, path, provisioned: created !== null, pushed: r.pushed, oldHead: r.oldHead, newHead: r.newHead, refusal: r.refusal, log },
    };
  };
}

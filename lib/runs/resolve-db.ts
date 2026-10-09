/**
 * Where a run verb's run DB comes from. On the environment path (the switch
 * off, or a Claude session no binding names) RT_RUN_DB wins; when it is unset
 * (every agent Bash call is a fresh shell, so the export rarely survives) the
 * run that recorded this session, else the newest running run whose worktree
 * holds the cwd, is the one the caller meant.
 *
 * A verified caller writes only to a run it owns (resolveOwnedRun): the run's
 * `session-key` names the caller's binding, or its legacy `claude-session`
 * is proven the caller's through the session store. A directory match or an
 * explicit path never grants a write; reads may still find a run by
 * directory. Scans every run DB under the runs root on each call; prune keeps
 * that set small.
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, type Dirent } from "fs";
import { join, resolve as resolvePath, sep } from "path";
import type { CallerContext, Outcome, SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import { resolveLegacySession } from "../agent-integrations/legacy.ts";
import { getStateDb } from "../state/db.ts";
import { SESSION_KEY_FIELD } from "./identity.ts";
import { runsRoot } from "./paths.ts";

export type RunDbSource = "env" | "session" | "worktree";

export type RunDbResolution =
  | { ok: true; db: string; resolved: RunDbSource }
  | { ok: false; error: string };

type RunOwner = { sessionKey: string | null; claudeSession: string | null; claudeSessionAt: number | null };
type RunRecord = { runId: string; db: string; status: string; startedAt: number; session: string | null; worktree: string | null; owner: RunOwner };

function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((d: Dirent) => d.isDirectory()).map((d: Dirent) => d.name);
  } catch {
    return [];
  }
}

function readRun(dbPath: string): RunRecord | null {
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }
  try {
    const run = db.query("SELECT id, status, started_at FROM runs LIMIT 1").get() as { id: string; status: string; started_at: number } | undefined;
    if (!run) return null;
    const row = (key: string) => db.query("SELECT value, at FROM fields WHERE key=?").get(key) as { value: string; at: number } | undefined;
    const claude = row("claude-session");
    return {
      runId: String(run.id), db: dbPath, status: run.status, startedAt: Number(run.started_at),
      session: claude?.value ?? null, worktree: row("worktree")?.value ?? null,
      owner: { sessionKey: row(SESSION_KEY_FIELD)?.value ?? null, claudeSession: claude?.value ?? null, claudeSessionAt: claude ? Number(claude.at) : null },
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function runningRuns(root: string): RunRecord[] {
  const out: RunRecord[] = [];
  for (const repo of dirs(root)) {
    for (const id of dirs(join(root, repo))) {
      const run = readRun(join(root, repo, id, "state.db"));
      if (run?.status === "running") out.push({ ...run, runId: id });
    }
  }
  // Run ids sort by start time within a repo dir, so they break a same-millisecond tie the same way.
  return out.sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId));
}

function holds(worktree: string, cwd: string): boolean {
  const tree = resolvePath(worktree);
  const dir = resolvePath(cwd);
  return dir === tree || dir.startsWith(`${tree}${sep}`);
}

/**
 * A verified `caller` replaces the environment's session rung with the runs
 * it owns; the directory rung stays, since only a write needs ownership.
 */
export function resolveRunDb(env: NodeJS.ProcessEnv, cwd: string, caller?: CallerContext, deps: OwnershipDeps = {}): RunDbResolution {
  if (env.RT_RUN_DB) return { ok: true, db: env.RT_RUN_DB, resolved: "env" };
  const running = runningRuns(env.RT_RUNS_ROOT ?? runsRoot());
  const session = env.CLAUDE_CODE_SESSION_ID;
  const bySession = caller
    ? running.filter((r) => runOwnership(r.owner, caller.binding, deps) === "owned")
    : session ? running.filter((r) => r.session === session) : [];
  if (bySession.length === 1) return { ok: true, db: bySession[0]!.db, resolved: "session" };
  const byTree = running.filter((r) => r.worktree !== null && holds(r.worktree, cwd));
  const newest = byTree.at(-1);
  if (newest) return { ok: true, db: newest.db, resolved: "worktree" };
  const hint = bySession.length > 1 ? `; candidates: ${bySession.map((r) => r.runId).join(", ")}` : "";
  return { ok: false, error: `RT_RUN_DB is not set and no running run matches this session or directory${hint}` };
}

/**
 * owned: the run names this binding. foreign: it names another binding.
 * unowned: it names no session. unproven: it names a Claude session that the
 * session store cannot tie to any binding, so no caller may claim it.
 */
export type RunOwnership = "owned" | "foreign" | "unowned" | "unproven";

export type OwnershipDeps = { stateDb?: Database };

/**
 * A legacy run carries only `claude-session`, written from the environment,
 * so its owner is proven by provenance: a Claude binding with that native id,
 * directly or through the session store's legacy records. Nothing else (the
 * directory, recency) stands in for a missing proof.
 */
export function runOwnership(owner: Pick<RunOwner, "sessionKey" | "claudeSession">, binding: SessionBinding, deps: OwnershipDeps = {}): RunOwnership {
  if (owner.sessionKey !== null) return owner.sessionKey === binding.key ? "owned" : "foreign";
  if (owner.claudeSession === null || owner.claudeSession === "") return "unowned";
  if (binding.native.harness === "claude" && binding.native.value === owner.claudeSession) return "owned";
  let proven: Outcome<SessionBinding>;
  try {
    proven = resolveLegacySession(owner.claudeSession, "claude", deps.stateDb ?? getStateDb());
  } catch {
    return "unproven";
  }
  if (!proven.ok) return "unproven";
  return proven.data.key === binding.key ? "owned" : "foreign";
}

/** Records the proven owner's key with the `at` of the field that proved it, so the migration never reads as pipeline activity. */
function adoptLegacyOwner(run: RunRecord, binding: SessionBinding): void {
  if (run.owner.sessionKey !== null) return;
  const db = new Database(run.db);
  try {
    db.run("PRAGMA busy_timeout=5000");
    db.run(
      "INSERT OR IGNORE INTO fields (run_id, key, value, produced_by, at) SELECT id, ?, ?, 'run', ? FROM runs",
      [SESSION_KEY_FIELD, binding.key, run.owner.claudeSessionAt ?? Date.now()],
    );
  } finally {
    db.close();
  }
}

export type OwnedRunDeps = OwnershipDeps & {
  /** The runs root; RT_RUNS_ROOT or the default when omitted. */
  root?: string;
  /** Picks among several owned running runs: the one whose worktree holds it. */
  cwd?: string;
};

function fail<T>(code: "ambiguous" | "invalid" | "refused", message: string): Outcome<T> {
  return { ok: false, error: { code, message } };
}

function owned(run: RunRecord, binding: SessionBinding, deps: OwnershipDeps): Outcome<{ db: string; runId: string }> {
  switch (runOwnership(run.owner, binding, deps)) {
    case "owned":
      adoptLegacyOwner(run, binding);
      return { ok: true, data: { db: run.db, runId: run.runId } };
    case "unowned":
      return fail("ambiguous", `run ${run.runId} records no owning session, so no session may write to it`);
    case "unproven":
      return fail("refused", `run ${run.runId} names a Claude session that cannot be proven to be this one, so this session may not write to it`);
    case "foreign":
      return fail("refused", `run ${run.runId} belongs to another session`);
  }
}

/** Every running run `binding` owns, oldest first. */
export function ownedRunningRuns(binding: SessionBinding, deps: OwnedRunDeps = {}): { db: string; runId: string }[] {
  return runningRuns(deps.root ?? runsRoot())
    .filter((r) => runOwnership(r.owner, binding, deps) === "owned")
    .map((r) => ({ db: r.db, runId: r.runId }));
}

/**
 * The run a verified caller may write to: `explicitDb` when the caller owns
 * it, else its one owned running run (the one whose worktree holds `cwd`
 * when it owns several). A legacy run proven the caller's gains its
 * `session-key` here. Anything less refuses; the newest run in a directory
 * is never a stand-in.
 */
export function resolveOwnedRun(context: CallerContext, explicitDb?: string, deps: OwnedRunDeps = {}): Outcome<{ db: string; runId: string }> {
  if (explicitDb) {
    if (!existsSync(explicitDb)) return fail("invalid", `run DB not found: ${explicitDb}`);
    const run = readRun(explicitDb);
    if (!run) return fail("invalid", `run DB ${explicitDb} has no run record`);
    return owned(run, context.binding, deps);
  }
  const mine = runningRuns(deps.root ?? runsRoot()).filter((r) => runOwnership(r.owner, context.binding, deps) === "owned");
  const here = mine.length > 1 && deps.cwd !== undefined ? mine.filter((r) => r.worktree !== null && holds(r.worktree, deps.cwd!)) : mine;
  if (here.length === 1) return owned(here[0]!, context.binding, deps);
  if (mine.length === 0) return fail("ambiguous", "no running run belongs to this session; pass the runDb run_start returned");
  return fail("ambiguous", `this session owns more than one running run; pass the runDb run_start returned; candidates: ${mine.map((r) => r.runId).join(", ")}`);
}

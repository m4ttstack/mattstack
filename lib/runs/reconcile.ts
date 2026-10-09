/**
 * Reconciliation: only a person can decide a run is dead, and the record has
 * to stop claiming otherwise. The write itself goes through write.ts like
 * every other mutation.
 *
 * A session that ended can only say its own open stage stopped: the stage is
 * marked abandoned and the run stays running for a person to resume or end.
 */
import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import type { SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import { ownedRunningRuns, type OwnedRunDeps } from "./resolve-db.ts";
import { isPathComponent, runsRoot } from "./store.ts";
import { abandonRunningStages, fieldSet, openRunDb, runStatus } from "./write.ts";

export const SESSION_ENDED_REASON = "the session that owned this run ended";

/**
 * Marks the running stage of every running run `binding` owns abandoned, and
 * returns those runs' ids. Another session's run and a stage that already
 * ended are left as they are.
 */
export function abandonSessionStages(binding: SessionBinding, deps: OwnedRunDeps & { now?: number } = {}): string[] {
  const abandoned: string[] = [];
  for (const run of ownedRunningRuns(binding, deps)) {
    const db = openRunDb(run.db);
    try {
      const marked = abandonRunningStages(db, SESSION_ENDED_REASON, deps.now ?? Date.now());
      if (marked.ok && marked.stages > 0) abandoned.push(run.runId);
    } finally {
      db.close();
    }
  }
  return abandoned;
}

export type AbandonResult = { ok: true } | { ok: false; error: string };

export function abandonRun(repo: string, runId: string, reason: string): AbandonResult {
  if (!isPathComponent(repo) || !isPathComponent(runId)) return { ok: false, error: "invalid run path" };
  const path = join(runsRoot(), repo, runId, "state.db");
  if (!existsSync(path)) return { ok: false, error: `no run ${runId} in ${repo}` };

  let db: Database | undefined;
  try {
    db = openRunDb(path);
    const row = db.query("SELECT status FROM runs LIMIT 1").get() as { status: string } | undefined;
    if (!row) return { ok: false, error: "run row missing" };
    if (row.status !== "running") return { ok: false, error: `run already ${row.status}` };

    const now = Date.now();
    const closed = runStatus(db, "abandoned", now);
    if (!closed.ok) return { ok: false, error: closed.error };
    const noted = fieldSet(db, "reconciled", reason, "rt runs abandon", now);
    if (!noted.ok) return { ok: false, error: noted.error };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    db?.close();
  }
}

import type { Database } from "bun:sqlite";
import { daemonSocketQuery } from "../daemon-client.ts";
import { openRunDb, runIdentity } from "./write.ts";

function field(db: Database, key: string): { value: string; at: number } | undefined {
  return (db.query("SELECT value, at FROM fields WHERE key = ?").get(key) as { value: string; at: number } | null) ?? undefined;
}

/** Registers the run's Claude session as an rt agent so console can resume it. Best effort, on emitRunUpdated's contract: the daemon's command seam logs a refusal, and nothing here may change a write verb's output. */
export async function adoptRunSession(db: Database, env: NodeJS.ProcessEnv = process.env, timeoutMs = 2_000): Promise<void> {
  if (env.RT_RUN_EMIT === "0") return;
  try {
    const session = field(db, "claude-session");
    if (!session) return;
    const agent = field(db, "agent");
    if (agent && agent.at >= session.at) return;
    const ident = runIdentity(db);
    if (!ident) return;
    const label = field(db, "ticket")?.value ?? ident.runId;
    const res = await daemonSocketQuery(
      "agent:adopt",
      { sessionId: session.value, repo: ident.repo, subject: `run:${ident.runId}`, label },
      timeoutMs,
    );
    const id = res?.ok ? (res.data as { id?: unknown } | undefined)?.id : undefined;
    if (typeof id !== "string") return;
    db.run(
      "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at) SELECT id, 'agent', ?, 'run', ? FROM runs",
      [id, Date.now()],
    );
  } catch {
    // best effort by contract
  }
}

/** For a caller holding only the run db's path: opens it, adopts, closes. Any failure, the open included, is swallowed. */
export async function adoptRunSessionAt(runDbPath: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.RT_RUN_EMIT === "0") return;
  try {
    const db = openRunDb(runDbPath);
    try {
      await adoptRunSession(db, env);
    } finally {
      db.close();
    }
  } catch {
    // best effort by contract
  }
}

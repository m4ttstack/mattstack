import type { Database } from "bun:sqlite";

// Change-guarded: rt's liveness ladder reads fields.at as pipeline activity,
// so an unchanged session or pane must not look like a fresh event.
export function recordIdentity(db: Database, env: NodeJS.ProcessEnv, now: number): void {
  const pairs: [string, string | undefined][] = [
    ["claude-session", env.CLAUDE_CODE_SESSION_ID],
    ["herdr-pane", env.HERDR_PANE_ID],
    ["test", env.RT_RUN_TEST],
  ];
  for (const [key, value] of pairs) {
    if (!value) continue;
    const current = db.query("SELECT value FROM fields WHERE key=?").get(key) as { value: string } | undefined;
    if (current?.value === value) continue;
    db.run(
      "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at) SELECT id, ?, ?, 'run', ? FROM runs",
      [key, value, now],
    );
    if (key === "claude-session") appendSession(db, current?.value, value, now);
  }
}

// Readers fall back to claude-session while the list is absent, so it is
// seeded from that field only when a different session first appears.
function appendSession(db: Database, previous: string | undefined, session: string, now: number): void {
  const row = db.query("SELECT value FROM fields WHERE key='claude-sessions'").get() as { value: string } | undefined;
  const list: string[] = row ? JSON.parse(row.value) : previous ? [previous] : [];
  if (list.includes(session)) return;
  list.push(session);
  db.run(
    "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at) SELECT id, 'claude-sessions', ?, 'run', ? FROM runs",
    [JSON.stringify(list), now],
  );
}

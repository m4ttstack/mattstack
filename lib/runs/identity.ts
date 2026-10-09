import type { Database } from "bun:sqlite";
import type { SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";

/** The run field naming the binding that owns a run; `claude-session` is only its Claude native id, kept for the Stop hook. */
export const SESSION_KEY_FIELD = "session-key";

/**
 * A bound caller's identity comes only from its binding: a worker can inherit
 * another session's CLAUDE_CODE_SESSION_ID or HERDR_PANE_ID, so with a binding
 * the environment is never read. Without one, the environment path is today's.
 */
function identityPairs(env: NodeJS.ProcessEnv, binding?: SessionBinding): [string, string | undefined][] {
  if (!binding) return [["claude-session", env.CLAUDE_CODE_SESSION_ID], ["herdr-pane", env.HERDR_PANE_ID]];
  const pane = binding.attachment.pane;
  return [
    [SESSION_KEY_FIELD, binding.key],
    ["claude-session", binding.native.harness === "claude" ? binding.native.value : undefined],
    ["herdr-pane", pane],
  ];
}

// Change-guarded: rt's liveness ladder reads fields.at as pipeline activity,
// so an unchanged session or pane must not look like a fresh event.
export function recordIdentity(db: Database, env: NodeJS.ProcessEnv, now: number, binding?: SessionBinding): void {
  for (const [key, value] of identityPairs(env, binding)) {
    if (!value) continue;
    const current = db.query("SELECT value FROM fields WHERE key=?").get(key) as { value: string } | undefined;
    if (current?.value === value) continue;
    db.run(
      "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at) SELECT id, ?, ?, 'run', ? FROM runs",
      [key, value, now],
    );
  }
}

import { redactDeep } from "../../../lib/mcp/redact";
import { safeAppend } from "./evidence";

const KEYS = [
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
  "HERDR_PANE_ID",
  "HERDR_SOCKET_PATH",
  "HERDR_ENV",
  "HERDR_WORKSPACE_ID",
];
export function envSnapshot(
  env: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    KEYS.filter(k => env[k] !== undefined).map(k => [k, env[k]!])
  );
}
if (import.meta.main) {
  const [verb, file, marker] = process.argv.slice(2);
  if (!file) throw new Error("missing evidence path");
  if (verb === "sleep") await Bun.sleep(15000);
  const row = redactDeep({
    at: Date.now(),
    marker,
    pid: process.pid,
    env: envSnapshot(process.env),
  });
  safeAppend(file, row);
  process.stdout.write(JSON.stringify(row) + "\n");
}

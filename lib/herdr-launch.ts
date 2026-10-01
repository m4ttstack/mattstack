/**
 * Sequential fallback launcher for a batch of commands, used when no runner
 * board is available to seed instead.
 */
import * as out from "./ui/out.ts";
import { childEnv } from "./subprocess.ts";

export interface LaunchItem {
  label: string;
  command: string;
  cwd: string;
}

export function shellQuote(s: string): string {
  // If the string is clean (no special chars), return as-is
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(s)) return s;
  // Otherwise wrap in single quotes, escaping internal single quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** `reason` is the caller's real cause for falling back (e.g. "tmux is not on PATH") -- named by the caller, not guessed here, since this function has no way to tell "not interactive" from "no tmux" from "not inside herdr" apart on its own. */
export function launchFallback(items: LaunchItem[], reason: string): void {
  out.note(out.line("warn", "Running these one at a time", reason));
  for (const item of items) {
    out.note(out.section(item.label, undefined));
    const result = Bun.spawnSync(["sh", "-c", item.command], {
      cwd: item.cwd,
      env: childEnv(),
      stdio: ["inherit", "inherit", "inherit"],
    });
    if (result.exitCode !== 0) {
      out.note(out.line("failed", `${item.label} stopped with an error`, `exit ${result.exitCode}`));
    }
  }
}

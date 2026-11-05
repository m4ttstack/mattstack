import { join } from "path";
import { rtDir } from "../rt-paths.ts";
import { rtSelfArgv } from "../rt-self.ts";
import { childEnv, MAX_LOGGED_OUTPUT, outputTail } from "../subprocess.ts";

export const SWEEP_DEADLINE_MS = 30 * 60_000;

export interface SweepChild {
  exited: Promise<number>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal?: NodeJS.Signals): void;
}

export type SweepSpawn = (
  argv: string[],
  opts: { cwd: string; env: Record<string, string | undefined> },
) => SweepChild;

const spawnChild: SweepSpawn = (argv, opts) =>
  Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdin: "ignore", stdout: "ignore", stderr: "pipe" });

/** The daemon's own entry is lib/daemon.ts from source, so Bun.main there is not the CLI. */
const CLI_ENTRY = join(import.meta.dir, "..", "..", "cli.ts");

export function usageSweepArgv(opts: { compiled?: boolean; execPath?: string } = {}): string[] {
  return [...rtSelfArgv({ ...opts, main: CLI_ENTRY }), "usage", "sweep"];
}

let running = false;

export async function spawnUsageSweep(
  deps: { argv?: string[]; spawn?: SweepSpawn; timeoutMs?: number } = {},
): Promise<void> {
  if (running) return;
  running = true;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let killedAtDeadline = false;
  try {
    // Bun reads bunfig and .env from the child's cwd, and a checkout's would load into the sweep.
    const child = (deps.spawn ?? spawnChild)(deps.argv ?? usageSweepArgv(), { cwd: rtDir(), env: childEnv() });
    const stderr = new Response(child.stderr).text().catch(() => "");
    const timedOut = new Promise<"timeout">((resolve) => {
      deadline = setTimeout(() => {
        killedAtDeadline = true;
        child.kill("SIGKILL");
        resolve("timeout");
      }, deps.timeoutMs ?? SWEEP_DEADLINE_MS);
      deadline.unref();
    });
    const outcome = await Promise.race([child.exited, timedOut]);
    if (killedAtDeadline || outcome === "timeout") throw new Error(`usage sweep timed out after ${(deps.timeoutMs ?? SWEEP_DEADLINE_MS) / 1000}s and was killed`);
    if (outcome !== 0) {
      throw new Error(`usage sweep exited ${outcome}: ${outputTail(await stderr, MAX_LOGGED_OUTPUT)}`);
    }
  } finally {
    clearTimeout(deadline);
    running = false;
  }
}

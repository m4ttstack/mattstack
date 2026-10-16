import { childEnv } from "../subprocess.ts";
import { runGitOrigin, type FetchAuthSeams } from "../worktree/fetch-auth.ts";
import type { RunResult } from "./sync.ts";

export type SpawnCapture = (argv: string[], cwd: string | undefined, env?: Record<string, string>) => Promise<RunResult>;

export const spawnCapture: SpawnCapture = async (argv, cwd, env) => {
  const proc = Bun.spawn(argv, { cwd, env: { ...childEnv(), ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
};

/**
 * Git against a pack checkout's origin: the user's own credentials and hooks
 * first, then rt's forge token on an auth failure. The retry runs with hooks
 * off, because the token rides in the environment every hook would inherit.
 */
export async function runSkillsOrigin(
  args: string[],
  opts: { cwd: string; push?: boolean },
  seams: { auth?: FetchAuthSeams; spawn?: SpawnCapture } = {},
): Promise<RunResult> {
  const spawn = seams.spawn ?? spawnCapture;
  const r = await runGitOrigin(opts.cwd, args, {
    push: opts.push,
    auth: seams.auth,
    run: async (cwd, a, o) => {
      const hooks = o.env?.RT_GIT_TOKEN ? ["-c", "core.hooksPath=/dev/null"] : [];
      const res = await spawn(["git", ...hooks, ...a], cwd, o.env);
      return { exitCode: res.code, stdout: res.stdout, stderr: res.stderr };
    },
  });
  return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
}

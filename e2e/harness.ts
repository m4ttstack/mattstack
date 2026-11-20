import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const RT_BINARY = process.env.RT_BINARY || join(import.meta.dir, "..", "dist", "rt");

/**
 * A daemon started with RT_API_PORT=0 binds a port the OS picks, so no test
 * races another process for a probed port. The daemon reports that port only
 * in its "api server listening" log line. Matching on the daemon's pid keeps
 * an earlier daemon's line under the same HOME from answering.
 */
export async function daemonApiPort(home: string, pid: number, timeoutMs = 15_000): Promise<number> {
  const logs = join(home, ".mattstack", "rt", "logs");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const port = existsSync(logs) ? listeningPort(logs, pid) : null;
    if (port !== null) return port;
    if (Date.now() > deadline) throw new Error(`the daemon (pid ${pid}) under ${home} never logged its API port`);
    await Bun.sleep(100);
  }
}

function listeningPort(logs: string, pid: number): number | null {
  for (const name of readdirSync(logs).filter((n) => n.startsWith("daemon"))) {
    for (const line of readFileSync(join(logs, name), "utf8").split("\n")) {
      if (!line.includes("api server listening")) continue;
      try {
        const entry = JSON.parse(line) as { port?: unknown; pid?: unknown };
        if (entry.pid === pid && typeof entry.port === "number" && entry.port > 0) return entry.port;
      } catch {
        // A line still being written is not JSON yet; the next poll reads it whole.
      }
    }
  }
  return null;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunOpts {
  home?: string;
  env?: Record<string, string>;
  /** Defaults to the test HOME. */
  cwd?: string;
}

export function createTestHome(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "rt-e2e-"));

  writeFileSync(
    join(path, ".gitconfig"),
    "[user]\n\tname = rt-test\n\temail = test@rt.test\n",
  );

  writeFileSync(join(path, ".zshrc"), "");

  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}

/** The environment `rt()` runs the binary under, for a test that has to spawn it some other way. */
export function rtEnv(home: string, extra: Record<string, string> = {}, skipSetup = true): Record<string, string> {
  // Some spawned children may exec a script with a `#!/usr/bin/env bun`
  // shebang, so bun's own directory must be on PATH for the spawned rt
  // binary's children to find it. process.execPath is the running bun binary
  // itself, which resolves correctly whether bun was installed via the bun
  // installer (~/.bun/bin) or Homebrew (/opt/homebrew/bin) -- unlike a
  // hardcoded guess.
  const bunDir = join(process.execPath, "..");

  const env: Record<string, string> = {
    HOME: home,
    PATH: `${join(RT_BINARY, "..")}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
    TERM: "xterm-256color",
    RT_GH_TOKEN_FALLBACK: "off",
    ...extra,
  };

  if (skipSetup) {
    env.RT_SKIP_SETUP = "1";
    env.CI = "true";
  }
  return env;
}

async function run(
  args: string[],
  opts: RunOpts & { skipSetup: boolean },
): Promise<RunResult> {
  const home = opts.home ?? createTestHome().path;
  const env = rtEnv(home, opts.env, opts.skipSetup);

  const proc = Bun.spawn([RT_BINARY, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts.cwd ?? home,
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

export function rt(args: string[], opts?: RunOpts): Promise<RunResult> {
  return run(args, { ...opts, skipSetup: true });
}

export function rtRaw(args: string[], opts?: RunOpts): Promise<RunResult> {
  return run(args, { ...opts, skipSetup: false });
}

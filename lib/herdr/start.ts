import { spawn as spawnChild } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolveHerdrBin } from "../agent-herdr.ts";
import { herdrAvailable, herdrSocketPath } from "./client.ts";
import { herdrServerEnv, loginShellEnv } from "./login-env.ts";

export const HERDR_NOT_INSTALLED = "herdr isn't installed. Open mattstack Setup to install it";

const SERVER_LOG = "~/.config/herdr/herdr-server.log";
const POLL_MS = 100;

export type HerdrStartResult =
  | { state: "running"; bin: string }
  | { state: "started"; bin: string }
  | { state: "not-installed"; bin: string }
  | { state: "failed"; bin: string; detail: string };

export interface HerdrStartSeams {
  ping(sock: string): Promise<boolean>;
  resolveBin(): string;
  exists(path: string): boolean;
  loginEnv(): Promise<Record<string, string>>;
  spawn(argv: string[], env: Record<string, string>, cwd: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  env: Record<string, string | undefined>;
  home: string;
}

export function spawnDetached(argv: string[], env: Record<string, string>, cwd: string): void {
  const child = spawnChild(argv[0]!, argv.slice(1), { detached: true, stdio: "ignore", cwd, env });
  // An unheard 'error' event (ENOENT, EACCES) would crash the caller;
  // the ready poll already reports a server that never came up.
  child.on("error", () => {});
  child.unref();
}

function defaultSeams(): HerdrStartSeams {
  return {
    ping: (sock) => herdrAvailable(sock),
    resolveBin: () => resolveHerdrBin(),
    exists: existsSync,
    loginEnv: () => loginShellEnv(),
    spawn: spawnDetached,
    sleep: (ms) => Bun.sleep(ms),
    now: () => Date.now(),
    env: process.env,
    home: process.env.HOME ?? homedir(),
  };
}

export function createHerdrStarter(
  seams: Partial<HerdrStartSeams> = {},
  opts: { socketPath?: string; extraEnv?: Record<string, string>; readyTimeoutMs?: number; cooldownMs?: number } = {},
): { start(): Promise<HerdrStartResult> } {
  const s: HerdrStartSeams = { ...defaultSeams(), ...seams };
  const readyTimeoutMs = opts.readyTimeoutMs ?? 10_000;
  const cooldownMs = opts.cooldownMs ?? 60_000;
  let inFlight: Promise<HerdrStartResult> | null = null;
  let failedAt: number | null = null;
  let lastFailure = "";

  async function launch(): Promise<HerdrStartResult> {
    const sock = opts.socketPath ?? herdrSocketPath();
    const bin = s.resolveBin();
    // A socket file that refuses connections is a crash leftover, so only a
    // reply counts as running.
    if (await s.ping(sock)) return { state: "running", bin };
    if (!s.exists(bin)) return { state: "not-installed", bin };
    // A timed-out spawn may still be binding; a second one would fight it
    // for the socket.
    if (failedAt !== null && s.now() - failedAt < cooldownMs) {
      return { state: "failed", bin, detail: lastFailure };
    }
    const fail = (detail: string): HerdrStartResult => {
      failedAt = s.now();
      lastFailure = detail;
      return { state: "failed", bin, detail };
    };
    const env = herdrServerEnv(s.env, await s.loginEnv(), opts.extraEnv);
    try {
      s.spawn([bin, "server"], env, s.home);
    } catch (err) {
      return fail(`herdr server could not start: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Another process winning the start race makes this spawn exit with
    // "already running"; the ping sees that server either way.
    const deadline = s.now() + readyTimeoutMs;
    while (s.now() < deadline) {
      if (await s.ping(sock)) {
        failedAt = null;
        return { state: "started", bin };
      }
      await s.sleep(POLL_MS);
    }
    return fail(`herdr server did not answer within ${Math.round(readyTimeoutMs / 1000)}s. See ${SERVER_LOG}`);
  }

  return {
    async start(): Promise<HerdrStartResult> {
      if (inFlight) return inFlight;
      inFlight = launch();
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
  };
}

let defaultStarter: { start(): Promise<HerdrStartResult> } | null = null;

export function startHerdr(): Promise<HerdrStartResult> {
  defaultStarter ??= createHerdrStarter();
  return defaultStarter.start();
}

/**
 * Claude, Doppler and ldcli sign in without a terminal: rt starts the login
 * detached under `script`, which gives it a pty, feeds its input through a
 * fifo and collects its output in a log. The session record lets the form and
 * later verbs read the URL, code or paste prompt and send a pasted code back.
 * rt never opens the URL itself: the tool does, and the form offers it again.
 */
import { spawn, spawnSync } from "child_process";
import { closeSync, constants, openSync, writeSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { stripVTControlCharacters } from "util";
import { wellKnownBinDirs } from "../bundled-tool.ts";
import { childEnv } from "../subprocess.ts";
import type { Probes } from "./probes.ts";
import { pidAlive } from "./update-lock.ts";

export type LoginTool = "claude" | "doppler" | "ldcli";

export interface LoginSpec {
  argv(input: { email?: string }): string[];
  urlPattern: RegExp;
  codePattern: RegExp | null;
  promptPattern: RegExp | null;
}

export const LOGIN_SPECS: Readonly<Record<LoginTool, LoginSpec>> = {
  claude: {
    argv: ({ email }) => ["claude", "auth", "login", ...(email ? ["--email", email] : [])],
    urlPattern: /https:\/\/\S+/,
    codePattern: null,
    promptPattern: /paste/i,
  },
  doppler: {
    argv: () => ["doppler", "login", "--yes"],
    urlPattern: /https:\/\/\S*doppler\.com\S*/,
    codePattern: /auth code[^:\n]*:\s*([A-Za-z0-9-]+)/i,
    promptPattern: null,
  },
  ldcli: {
    argv: () => ["ldcli", "login"],
    urlPattern: /https:\/\/\S*launchdarkly\S*/,
    codePattern: null,
    promptPattern: null,
  },
};

export interface LoginSession {
  tool: LoginTool;
  pid: number;
  startedAt: string;
  logPath: string;
  fifoPath: string;
  url: string | null;
  code: string | null;
  prompt: boolean;
}

/** A pid alone cannot prove a session is still this login: after a reboot it can belong to anything. A sign-in nobody finished in ten minutes is over. */
export const LOGIN_TTL_MS = 10 * 60 * 1000;

export interface LoginSeams {
  spawnDetached(argv: string[], io: { fifo: string; log: string }): number | null;
  alive(pid: number): boolean;
  kill(pid: number): void;
  mkfifo(path: string): boolean;
  writeFifo(path: string, text: string): boolean;
}

const DEFAULT_WAIT_MS = 3000;
const POLL_MS = 100;

/**
 * Opening the fifo read-write keeps a writer on it, so the child never reads
 * end-of-file between pasted lines and the open never blocks. macOS script
 * refuses a fifo as its stdin (tcgetattr fails with EOPNOTSUPP rather than
 * ENOTTY), so cat relays the fifo through a pipe, and `kill 0` ends the whole
 * group when the tool exits, or cat would hold the session open forever.
 */
const SCRIPT_WRAPPER = 'exec 3<>"$1"; shift; cat <&3 | { /usr/bin/script -q /dev/null "$@"; kill 0; }';

function loginsDir(home: string): string {
  return join(home, ".mattstack", "rt", "logins");
}

export function loginSessionPath(home: string, tool: LoginTool): string {
  return join(loginsDir(home), `${tool}.json`);
}

function loginEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(childEnv())) if (value !== undefined) env[key] = value;
  const dirs = (env.PATH ?? "").split(":").filter((dir) => dir.length > 0);
  const local = join(home, ".local", "bin");
  const path = [local, ...dirs.filter((dir) => dir !== local)];
  for (const dir of wellKnownBinDirs(home)) if (!path.includes(dir)) path.push(dir);
  return { ...env, PATH: path.join(":") };
}

function runsWrapper(pid: number): boolean {
  const ps = spawnSync("/bin/ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf8" });
  return ps.status === 0 && ps.stdout.includes(SCRIPT_WRAPPER);
}

export function realLoginSeams(): LoginSeams {
  const home = process.env.HOME ?? homedir();
  return {
    spawnDetached(argv, io) {
      let logFd: number | null = null;
      try {
        logFd = openSync(io.log, "w", 0o600);
        const child = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: ["ignore", logFd, logFd], env: loginEnv(home) });
        child.on("error", () => {});
        child.unref();
        return child.pid ?? null;
      } catch {
        return null;
      } finally {
        if (logFd !== null) closeSync(logFd);
      }
    },
    alive: pidAlive,
    kill(pid) {
      // A recorded pid that no longer runs the wrapper is someone else's process now.
      if (!runsWrapper(pid)) return;
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          return;
        }
      }
    },
    mkfifo(path) {
      return spawnSync("/usr/bin/mkfifo", ["-m", "600", path]).status === 0;
    },
    writeFifo(path, text) {
      let fd: number | null = null;
      try {
        // Non-blocking: with no reader left the open fails instead of hanging rt.
        fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
        writeSync(fd, text);
        return true;
      } catch {
        return false;
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },
  };
}

function parseRecord(text: string | null, tool: LoginTool): LoginSession | null {
  if (text === null) return null;
  try {
    const record = JSON.parse(text) as LoginSession;
    if (typeof record !== "object" || record === null || record.tool !== tool || typeof record.pid !== "number") return null;
    if (typeof record.logPath !== "string" || typeof record.fifoPath !== "string" || Number.isNaN(Date.parse(record.startedAt))) return null;
    return record;
  } catch {
    return null;
  }
}

function readRecord(p: Pick<Probes, "readFile" | "home">, tool: LoginTool): LoginSession | null {
  return parseRecord(p.readFile(loginSessionPath(p.home, tool)), tool);
}

function writeRecord(p: Probes, session: LoginSession): void {
  const path = loginSessionPath(p.home, session.tool);
  const tmp = `${path}.${process.pid}.tmp`;
  p.mkdirp(dirname(path));
  p.writeFile(tmp, JSON.stringify(session), 0o600);
  p.rename(tmp, path);
}

/** URLs stay in the result: the app needs them. A CLI log line built from this log goes through withoutUrls first. */
function fromLog(log: string, spec: LoginSpec): Pick<LoginSession, "url" | "code" | "prompt"> {
  const text = stripVTControlCharacters(log);
  return {
    url: spec.urlPattern.exec(text)?.[0] ?? null,
    code: spec.codePattern?.exec(text)?.[1] ?? null,
    prompt: spec.promptPattern?.test(text) ?? false,
  };
}

function withLog(p: Pick<Probes, "readFile">, session: LoginSession): LoginSession {
  return { ...session, ...fromLog(p.readFile(session.logPath) ?? "", LOGIN_SPECS[session.tool]) };
}

export function readLogin(p: Probes, tool: LoginTool, seams: LoginSeams = realLoginSeams()): LoginSession | null {
  const session = readRecord(p, tool);
  if (session === null) return null;
  if (p.now().getTime() - Date.parse(session.startedAt) > LOGIN_TTL_MS) {
    if (seams.alive(session.pid)) seams.kill(session.pid);
    p.removeFile(loginSessionPath(p.home, tool));
    return null;
  }
  if (!seams.alive(session.pid)) return null;
  return withLog(p, session);
}

export async function startLogin(p: Probes, tool: LoginTool, opts: { email?: string; seams?: LoginSeams; waitMs?: number }): Promise<LoginSession | null> {
  const seams = opts.seams ?? realLoginSeams();
  const live = readLogin(p, tool, seams);
  if (live !== null) return live;

  const dir = loginsDir(p.home);
  const fifoPath = join(dir, `${tool}.fifo`);
  const logPath = join(dir, `${tool}.log`);
  p.mkdirp(dir, 0o700);
  p.removeFile(fifoPath);
  if (!seams.mkfifo(fifoPath)) return null;

  const argv = ["/bin/sh", "-c", SCRIPT_WRAPPER, "sh", fifoPath, ...LOGIN_SPECS[tool].argv({ email: opts.email })];
  const pid = seams.spawnDetached(argv, { fifo: fifoPath, log: logPath });
  if (pid === null) {
    p.removeFile(fifoPath);
    return null;
  }

  let session: LoginSession = { tool, pid, startedAt: p.now().toISOString(), logPath, fifoPath, url: null, code: null, prompt: false };
  writeRecord(p, session);

  const polls = Math.ceil((opts.waitMs ?? DEFAULT_WAIT_MS) / POLL_MS);
  for (let poll = 0; ; poll++) {
    session = withLog(p, session);
    if (session.url !== null || poll >= polls || !seams.alive(pid)) break;
    p.sleepSync(POLL_MS);
  }
  // A tool missing from PATH or one that quits at once ends the group within
  // milliseconds, and readLogin would already call that session none.
  if (!seams.alive(pid)) {
    p.removeFile(loginSessionPath(p.home, tool));
    p.removeFile(fifoPath);
    return null;
  }
  writeRecord(p, session);
  return session;
}

export const LOGIN_POLL_MS = 2000;
/** How long a connect watches a fresh session before it hands the sign-in to the person. */
export const CONNECT_WAIT_MS = 10_000;
export const FINISH_IN_BROWSER = "Finish signing in in your browser";

/** Polls `check` every LOGIN_POLL_MS for up to `budgetMs`; its first non-null answer wins. */
export async function waitForSignIn<T>(check: () => Promise<T | null>, budgetMs: number, sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms)): Promise<T | null> {
  for (let waited = 0; waited < budgetMs; waited += LOGIN_POLL_MS) {
    await sleep(LOGIN_POLL_MS);
    const answer = await check();
    if (answer !== null) return answer;
  }
  return null;
}

export function sendLoginInput(p: Probes, tool: LoginTool, line: string, seams: LoginSeams = realLoginSeams()): boolean {
  const session = readLogin(p, tool, seams);
  if (session === null) return false;
  return seams.writeFifo(session.fifoPath, `${line.replace(/[\r\n]+$/, "")}\n`);
}

export function endLogin(p: Probes, tool: LoginTool, seams: LoginSeams = realLoginSeams()): void {
  const session = readRecord(p, tool);
  if (session === null) return;
  if (seams.alive(session.pid)) seams.kill(session.pid);
  p.removeFile(loginSessionPath(p.home, tool));
  p.removeFile(session.fifoPath);
}

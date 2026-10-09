/**
 * lib/agent-herdr.ts - herdr transport for `rt agent` (and rebase
 * escalation): workspace find-or-create, tab-label dedup, pane run.
 *
 * Lifted from mr-board src/herdr.ts, which has months of production history
 * with exactly this sequence. Dedup rule: a live tab with the requested
 * label is focused, never re-run - re-invoking an action must not stack a
 * second claude in a fresh pane.
 *
 * herdr is invoked by absolute path with HERDR_SOCKET_PATH set explicitly:
 * under launchd the daemon's start PATH has neither, and Bun.spawn resolves
 * executables from the start env, not runtime process.env.
 *
 * The bounded-agent primitive for rt verbs (see rt-agent-boundary memory):
 * rt gathers context deterministically, an agent does one bounded step in a
 * visible pane, rt verifies the result from real state afterward.
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import pino from "pino";
import { whichWithWellKnownDirs } from "./bundled-tool.ts";
import { resolveUserPath } from "./daemon/user-path.ts";
import { runCapture } from "./subprocess.ts";

export interface HerdrResult { stdout: string; exitCode: number }
export type HerdrRunner = (args: string[]) => Promise<HerdrResult>;

/**
 * HERDR_BIN, then `env.PATH`, then ~/.local/bin (where herdr's own installer
 * puts it), then the brew prefixes. The search PATH is passed to Bun.which
 * explicitly: a bare Bun.which reads the PATH the process started with, which
 * under launchd is the minimal system PATH, never the login PATH the daemon
 * overlays onto process.env at boot.
 */
export function resolveHerdrBin(
  env: NodeJS.ProcessEnv = process.env,
  which?: (cmd: string) => string | null,
): string {
  if (env.HERDR_BIN) return env.HERDR_BIN;
  const home = env.HOME ?? homedir();
  const local = join(home, ".local", "bin");
  const search = which ?? whichWithWellKnownDirs(home, [env.PATH, local].filter(Boolean).join(":"));
  return search("herdr") ?? join(local, "herdr");
}

const LOGIN_PATH_TTL_MS = 60_000;
let loginPathMemo: { at: number; path: Promise<string | null> } | null = null;

/** The login shell's PATH as it is now, not as it was at daemon boot, so a
 * tool whose installer edited the shell profile afterwards is visible. At
 * most one probe a minute: a machine with no herdr must not spawn a login
 * shell on every launch attempt. */
async function currentLoginPath(): Promise<string | null> {
  const now = Date.now();
  if (!loginPathMemo || now - loginPathMemo.at > LOGIN_PATH_TTL_MS) {
    const path = resolveUserPath(pino({ level: "silent" })).catch(() => null);
    loginPathMemo = { at: now, path };
  }
  return loginPathMemo.path;
}

/** Finds herdr on the login PATH and keeps what it found for as long as the
 * binary is still there, so only a miss ever costs a login shell. */
export function loginPathHerdrProbe(loginPath: () => Promise<string | null>): () => Promise<string | null> {
  let found: string | null = null;
  return async () => {
    if (found && existsSync(found)) return found;
    const path = await loginPath();
    found = path ? Bun.which("herdr", { PATH: path }) : null;
    return found;
  };
}

const probeLoginPathForHerdr = loginPathHerdrProbe(currentLoginPath);

export function defaultHerdrRunner(
  env: NodeJS.ProcessEnv = process.env,
  seams: {
    resolve?: (env: NodeJS.ProcessEnv) => string;
    probe?: () => Promise<string | null>;
  } = {},
): HerdrRunner {
  const home = env.HOME ?? homedir();
  const socket = env.HERDR_SOCKET_PATH ?? join(home, ".config", "herdr", "herdr.sock");
  const resolve = seams.resolve ?? resolveHerdrBin;
  const probe = seams.probe ?? probeLoginPathForHerdr;
  return async (args) => {
    let bin = resolve(env);
    if (!existsSync(bin) && !env.HERDR_BIN) bin = (await probe()) ?? bin;
    if (!existsSync(bin)) {
      throw new Error(`herdr not found at ${bin} (install via \`rt setup\` / brew)`);
    }
    const r = await runCapture([bin, ...args], {
      timeoutMs: 15_000,
      stderr: "pipe",
      env: { ...env, HERDR_SOCKET_PATH: socket },
    });
    return { stdout: r.stdout || r.stderr, exitCode: r.exitCode };
  };
}

/**
 * A launch whose command never ran: herdr failed a step before `pane run`, or
 * answered the run itself with its own error. A run that failed any other
 * way (a timeout, no answer) may have reached the pane, and is a plain Error.
 * Only a caller that asks (`reportNotRun`) gets this class; every other
 * caller keeps the plain Errors it always got.
 */
export class HerdrLaunchNotRun extends Error {
  override name = "HerdrLaunchNotRun";
  /** The labeled tab a refused line left open because rt could not close it. */
  leftoverTab?: string;
}

function answeredWithError(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as { error?: unknown } | null;
    return typeof parsed?.error === "object" && parsed.error !== null;
  } catch {
    return false;
  }
}

/** Every herdr invocation in this module goes through here: a non-zero exit must fail the launch, never look like a quiet no-op. */
async function runHerdr(runner: HerdrRunner, args: string[], typed = false): Promise<HerdrResult> {
  const r = await runner(args);
  // The verb only: a pane run's last arg is the whole agent command line
  // (env, settings JSON, prompt), which buries the cause and can carry secrets.
  if (r.exitCode !== 0) {
    const message = `herdr ${args.slice(0, 2).join(" ")} failed (${r.exitCode}): ${r.stdout.slice(0, 400)}`;
    throw typed && answeredWithError(r.stdout) ? new HerdrLaunchNotRun(message) : new Error(message);
  }
  return r;
}

/** Steps before `pane run` start nothing in a pane, so however they fail, the command never ran. */
async function beforeRun<T>(typed: boolean, step: () => Promise<T>): Promise<T> {
  if (!typed) return step();
  try {
    return await step();
  } catch (err) {
    if (err instanceof HerdrLaunchNotRun) throw err;
    throw new HerdrLaunchNotRun(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Runs the launch line in the pane rt just made. A line herdr refused never
 * ran, but its labeled tab would make the next launch under that label focus
 * it and run nothing, so the pane is closed first; one rt cannot close is
 * named in the error.
 */
async function runInNewPane(runner: HerdrRunner, paneId: string, opts: LaunchOpts): Promise<void> {
  try {
    await runHerdr(runner, ["pane", "run", paneId, opts.paneCommand], opts.reportNotRun === true);
  } catch (err) {
    if (!(err instanceof HerdrLaunchNotRun)) throw err;
    let closed = false;
    try {
      const r = await runner(["pane", "close", paneId]);
      closed = r.exitCode === 0 && !answeredWithError(r.stdout);
    } catch {
      closed = false;
    }
    if (closed) throw err;
    const leftover = new HerdrLaunchNotRun(`${err.message}. Its tab "${opts.tabLabel}" is still open and rt could not close it; close that tab before starting another session there`);
    leftover.leftoverTab = opts.tabLabel;
    throw leftover;
  }
}

async function herdrJson(runner: HerdrRunner, args: string[]): Promise<any> {
  const r = await runHerdr(runner, args);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`herdr ${args.join(" ")} returned invalid JSON: ${r.stdout.slice(0, 400)}`);
  }
}

export interface LaunchOutcome {
  workspaceId: string;
  tabId: string;
  paneId: string;
  focusedExisting: boolean;
}

/** `reportNotRun`: a launch that never ran throws HerdrLaunchNotRun, and a refused line's pane is closed. */
type LaunchOpts = { workspaceLabel: string; tabLabel: string; paneCommand: string; reportNotRun?: true };

export async function launchInWorkspace(
  opts: LaunchOpts,
  runner: HerdrRunner = defaultHerdrRunner(),
): Promise<LaunchOutcome> {
  const typed = opts.reportNotRun === true;
  const list = await beforeRun(typed, () => herdrJson(runner, ["workspace", "list"]));
  const workspaces: any[] = list?.result?.workspaces ?? [];
  const existing = workspaces.find((w) => w?.label === opts.workspaceLabel);

  if (!existing) {
    // A fresh workspace ships with an initial tab; reuse it instead of
    // orphaning a blank one.
    const root = await beforeRun(typed, async () => {
      const created = await herdrJson(runner, ["workspace", "create", "--label", opts.workspaceLabel, "--no-focus"]);
      const pane = created?.result?.root_pane;
      if (!pane?.pane_id) throw new Error("herdr workspace create returned no root pane");
      await runHerdr(runner, ["tab", "rename", pane.tab_id, opts.tabLabel]);
      return pane;
    });
    await runInNewPane(runner, root.pane_id, opts);
    return { workspaceId: root.workspace_id, tabId: root.tab_id, paneId: root.pane_id, focusedExisting: false };
  }

  const wsId: string = existing.workspace_id;
  const tabs = await beforeRun(typed, () => herdrJson(runner, ["tab", "list", "--workspace", wsId]));
  const match = (tabs?.result?.tabs ?? []).find((t: any) => t?.label === opts.tabLabel);
  if (match) {
    await runHerdr(runner, ["tab", "focus", match.tab_id]);
    return { workspaceId: wsId, tabId: match.tab_id, paneId: "", focusedExisting: true };
  }

  const root = await beforeRun(typed, async () => {
    const created = await herdrJson(runner, ["tab", "create", "--workspace", wsId, "--label", opts.tabLabel, "--no-focus"]);
    const pane = created?.result?.root_pane;
    if (!pane?.pane_id) throw new Error("herdr tab create returned no root pane");
    return pane;
  });
  await runInNewPane(runner, root.pane_id, opts);
  return { workspaceId: wsId, tabId: root.tab_id, paneId: root.pane_id, focusedExisting: false };
}

/**
 * Polls herdr's own agent-session report until it surfaces codex's real
 * session id, or the timeout elapses. herdr's per-CLI SessionStart hook
 * (installed by `herdr integration install codex`) reports the id to herdr
 * over its socket once codex processes its first turn; this reads it back
 * via `herdr agent get`. Confirmed against a real herdr pane 2026-09-15: the
 * id lands at `result.agent.agent_session.value` (present only after the
 * pane's first prompt completes -- a freshly launched, not-yet-prompted pane
 * has no `agent_session` key at all), not the guessed `result.agentSessionId`
 * / `agentSessionId`.
 */
export async function herdrAgentSessionId(
  paneId: string,
  timeoutMs: number,
  runner: HerdrRunner = defaultHerdrRunner(),
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await runner(["agent", "get", paneId]);
    if (r.exitCode === 0) {
      try {
        const parsed = JSON.parse(r.stdout);
        const sid = parsed?.result?.agent?.agent_session?.value;
        if (typeof sid === "string" && sid) return sid;
      } catch {
        // keep polling -- a transient non-JSON response is not fatal
      }
    }
    // 2s, not 500ms: the 10-minute budget above would otherwise spawn up to
    // 1200 `herdr agent get` subprocesses waiting on a turn that typically
    // takes well over a few seconds anyway.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return undefined;
}

export async function herdrAgentWait(
  paneId: string,
  until: string[],
  timeoutMs: number,
  runner: HerdrRunner = defaultHerdrRunner(),
): Promise<boolean> {
  const args = ["agent", "wait", paneId];
  for (const u of until) args.push("--until", u);
  args.push("--timeout", String(timeoutMs));
  const r = await runner(args);
  return r.exitCode === 0;
}

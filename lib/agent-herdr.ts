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
import { wellKnownBinDirs } from "./bundled-tool.ts";
import { resolveUserPath } from "./daemon/user-path.ts";
import { runCapture } from "./subprocess.ts";

export interface HerdrResult { stdout: string; exitCode: number }
export type HerdrRunner = (args: string[]) => Promise<HerdrResult>;

/**
 * HERDR_BIN, then `env.PATH`, then the brew prefixes and ~/.local/bin (where
 * herdr's own installer puts it). The PATH is passed to Bun.which explicitly:
 * a bare Bun.which reads the PATH the process started with, which under
 * launchd is the minimal system PATH, never the login PATH the daemon
 * overlays onto process.env at boot.
 */
export function resolveHerdrBin(
  env: NodeJS.ProcessEnv = process.env,
  which?: (cmd: string) => string | null,
  extraDirs: (home: string) => string[] = wellKnownBinDirs,
): string {
  if (env.HERDR_BIN) return env.HERDR_BIN;
  const home = env.HOME ?? homedir();
  const search = [...(env.PATH ?? "").split(":").filter(Boolean), ...extraDirs(home)].join(":");
  const found = (which ?? ((cmd: string) => Bun.which(cmd, { PATH: search })))("herdr");
  if (found) return found;
  return join(home, ".local", "bin", "herdr");
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

export function defaultHerdrRunner(
  env: NodeJS.ProcessEnv = process.env,
  loginPath: () => Promise<string | null> = currentLoginPath,
): HerdrRunner {
  const home = env.HOME ?? homedir();
  const socket = env.HERDR_SOCKET_PATH ?? join(home, ".config", "herdr", "herdr.sock");
  return async (args) => {
    let bin = resolveHerdrBin(env);
    if (!existsSync(bin) && !env.HERDR_BIN) {
      const path = await loginPath();
      bin = (path ? Bun.which("herdr", { PATH: path }) : null) ?? bin;
    }
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

/** Every herdr invocation in this module goes through here: a non-zero exit must fail the launch, never look like a quiet no-op. */
async function runHerdr(runner: HerdrRunner, args: string[]): Promise<HerdrResult> {
  const r = await runner(args);
  if (r.exitCode !== 0) throw new Error(`herdr ${args.join(" ")} failed (${r.exitCode}): ${r.stdout.slice(0, 400)}`);
  return r;
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

export async function launchInWorkspace(
  opts: { workspaceLabel: string; tabLabel: string; paneCommand: string },
  runner: HerdrRunner = defaultHerdrRunner(),
): Promise<LaunchOutcome> {
  const list = await herdrJson(runner, ["workspace", "list"]);
  const workspaces: any[] = list?.result?.workspaces ?? [];
  const existing = workspaces.find((w) => w?.label === opts.workspaceLabel);

  if (!existing) {
    // A fresh workspace ships with an initial tab; reuse it instead of
    // orphaning a blank one.
    const created = await herdrJson(runner, ["workspace", "create", "--label", opts.workspaceLabel, "--no-focus"]);
    const root = created?.result?.root_pane;
    if (!root?.pane_id) throw new Error("herdr workspace create returned no root pane");
    await runHerdr(runner, ["tab", "rename", root.tab_id, opts.tabLabel]);
    await runHerdr(runner, ["pane", "run", root.pane_id, opts.paneCommand]);
    return { workspaceId: root.workspace_id, tabId: root.tab_id, paneId: root.pane_id, focusedExisting: false };
  }

  const wsId: string = existing.workspace_id;
  const tabs = await herdrJson(runner, ["tab", "list", "--workspace", wsId]);
  const match = (tabs?.result?.tabs ?? []).find((t: any) => t?.label === opts.tabLabel);
  if (match) {
    await runHerdr(runner, ["tab", "focus", match.tab_id]);
    return { workspaceId: wsId, tabId: match.tab_id, paneId: "", focusedExisting: true };
  }

  const created = await herdrJson(runner, ["tab", "create", "--workspace", wsId, "--label", opts.tabLabel, "--no-focus"]);
  const root = created?.result?.root_pane;
  if (!root?.pane_id) throw new Error("herdr tab create returned no root pane");
  await runHerdr(runner, ["pane", "run", root.pane_id, opts.paneCommand]);
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

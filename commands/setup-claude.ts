/**
 * `rt setup claude connect|code`: signs in to Claude Code from setup without a
 * terminal. connect starts `claude auth login` as a background session and
 * watches `claude auth status --json`; code feeds that session the code the
 * browser shows.
 */
import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { CONNECT_WAIT_MS, endLogin, FINISH_IN_BROWSER, readLogin, sendLoginInput, startLogin, waitForSignIn, type LoginSeams } from "../lib/setup/cli-login.ts";
import { envelope } from "../lib/setup/contract.ts";
import { createRealProbes, readStdinJson, type Probes } from "../lib/setup/probes.ts";
import { exitWithUserError, type UserErrorSink } from "../lib/setup/user-failure.ts";
import * as out from "../lib/ui/out.ts";
import type { RenderStatus } from "../lib/ui/protocol.ts";

export interface ClaudeDeps {
  probes: Probes;
  json: (v: unknown) => void;
  exit: (code: number) => never;
  seams?: LoginSeams;
  stdin: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}

function realClaudeDeps(): ClaudeDeps {
  return { probes: createRealProbes(), json: (v) => out.json(v), exit: process.exit, stdin: () => readStdinJson() };
}

type ClaudeStatus = "ready" | "needs-you" | "invalid";

const RENDER: Record<ClaudeStatus, RenderStatus> = { ready: "done", "needs-you": "needs-you", invalid: "failed" };

const CODE_WAIT_MS = 30_000;
const STATUS_TIMEOUT_MS = 5000;

function report(deps: ClaudeDeps, json: boolean, status: ClaudeStatus, detail: string): void {
  if (json) deps.json(envelope({ integration: "claude", status, detail }, deps.probes.now()));
  else out.print(out.line(RENDER[status], "Claude Code", detail));
}

function sinkOf(deps: ClaudeDeps): UserErrorSink {
  return { json: deps.json, exit: deps.exit, now: () => deps.probes.now() };
}

/** The signed-in email, "" when signed in without one, null when signed out or unreadable. */
async function signedIn(p: Probes): Promise<string | null> {
  const res = await p.exec(["claude", "auth", "status", "--json"], { timeoutMs: STATUS_TIMEOUT_MS });
  try {
    const state = JSON.parse(res.stdout) as { loggedIn?: unknown; email?: unknown };
    if (state?.loggedIn !== true) return null;
    return typeof state.email === "string" ? state.email : "";
  } catch {
    return null;
  }
}

function signedInDetail(email: string): string {
  return email ? `Signed in as ${email}` : "Signed in";
}

function waitForClaude(deps: ClaudeDeps, budgetMs: number): Promise<string | null> {
  return waitForSignIn(() => signedIn(deps.probes), budgetMs, deps.sleep);
}

async function gitEmail(p: Probes): Promise<string | undefined> {
  const res = await p.exec(["git", "config", "--global", "user.email"], { timeoutMs: STATUS_TIMEOUT_MS });
  const email = res.code === 0 ? res.stdout.trim() : "";
  return email || undefined;
}

export async function setupClaudeConnect(args: string[], _ctx: CommandContext = {}, deps: ClaudeDeps = realClaudeDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const p = deps.probes;

  const already = await signedIn(p);
  if (already !== null) return report(deps, json, "ready", signedInDetail(already));

  const session = await startLogin(p, "claude", { email: await gitEmail(p), seams: deps.seams });
  if (session === null) {
    const err = new UserActionableError("login-failed", "Claude Code did not start signing in. Try again");
    return exitWithUserError(err, json, sinkOf(deps));
  }

  const email = await waitForClaude(deps, CONNECT_WAIT_MS);
  if (email === null) return report(deps, json, "needs-you", FINISH_IN_BROWSER);
  endLogin(p, "claude", deps.seams);
  report(deps, json, "ready", signedInDetail(email));
}

function codeFrom(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const code = (input as { code?: unknown }).code;
  return typeof code === "string" && code.trim() !== "" ? code.trim() : null;
}

export async function setupClaudeCode(args: string[], _ctx: CommandContext = {}, deps: ClaudeDeps = realClaudeDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  const p = deps.probes;
  const noLogin = () => exitWithUserError(new UserActionableError("no-login", "Start signing in again"), json, sinkOf(deps), { title: "No Claude sign-in is waiting for a code. Start signing in again" });

  // Checked before stdin: with no session there is nothing to read a code for.
  if (readLogin(p, "claude", deps.seams) === null) return noLogin();

  let input: unknown;
  try {
    input = await deps.stdin();
  } catch (err) {
    if (err instanceof UserActionableError) return exitWithUserError(err, json, sinkOf(deps));
    throw err;
  }
  const code = codeFrom(input);
  if (code === null) {
    const err = new UserActionableError("bad-stdin", 'No code given. Pipe {"code": "<code>"} on stdin');
    return exitWithUserError(err, json, sinkOf(deps));
  }
  if (!sendLoginInput(p, "claude", code, deps.seams)) return noLogin();

  const email = await waitForClaude(deps, CODE_WAIT_MS);
  if (email === null) return report(deps, json, "invalid", "Claude did not accept that code");
  endLogin(p, "claude", deps.seams);
  report(deps, json, "ready", signedInDetail(email));
}

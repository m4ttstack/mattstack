/**
 * Claude Code's native worktree lifecycle: the WorktreeCreate and
 * WorktreeRemove hooks (`rt worktree claude-hook`) and the EnterWorktree
 * PreToolUse hook (`rt worktree announce-relocation`).
 *
 * The create hook must be TOTAL: Claude Code has no fallthrough (empty
 * stdout fails the creation), so every input either yields a path or a
 * deliberate refusal. daemonQuery null = unreachable (fallback); an answered
 * refusal is loud, EXCEPT repo-unknown, which means "not rt's repo"
 * (fallback).
 *
 * Hook protocol (probed 2026-09-01): stdin JSON; stdout = absolute tree path
 * on create; non-zero exit surfaces stderr verbatim in the Claude session.
 * The WorktreeRemove stdin shape is UNVERIFIED (never observed firing), so
 * the parser accepts worktree_path or path and treats absence as a noop.
 */
import type { Database } from "bun:sqlite";
import { join } from "path";
import type { CallerContext, Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import type { DaemonResponse } from "../../daemon-client.ts";
import { selfPaneRef } from "../../self-pane.ts";
import { childEnv } from "../../subprocess.ts";
import { extractCliEvidence, resolveCallerOrEnvironmentNow, type CallerEvidence } from "../context.ts";
import { integrationsEnabled } from "../switch.ts";

export type RelocationAnnouncement = Commands["pane:announce-relocation"]["payload"];

export interface CreateHookInput { cwd: string; name: string }
export type CreateDecision =
  | { kind: "provisioned"; path: string }
  | { kind: "fallback"; path: string }
  | { kind: "refused"; error: string };
export interface CreateHookDeps {
  repoIdentity: (cwd: string) => string | null;
  provision: (repoName: string, intent: { ticket?: string; ticketTitle?: string; branch?: string }) => Promise<DaemonResponse | null>;
  stockAdd: (cwd: string, name: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
}

const TICKET_RE = /^([A-Za-z]+-\d+)(?:-(.+))?$/;

export function nameIntent(name: string): { ticket: string; ticketTitle?: string } | { branch: string } {
  const m = TICKET_RE.exec(name);
  const ticket = m?.[1];
  if (!ticket) return { branch: name };
  const title = m[2];
  return title ? { ticket, ticketTitle: title } : { ticket };
}

export async function decideCreate(input: CreateHookInput, deps: CreateHookDeps): Promise<CreateDecision> {
  const fallback = async (): Promise<CreateDecision> => {
    const added = await deps.stockAdd(input.cwd, input.name);
    return added.ok ? { kind: "fallback", path: added.path } : { kind: "refused", error: added.error };
  };

  const repoName = deps.repoIdentity(input.cwd);
  if (!repoName) return fallback();

  const res = await deps.provision(repoName, nameIntent(input.name));
  if (res === null) return fallback();
  if (!res.ok) return res.error === "repo-unknown" ? fallback() : { kind: "refused", error: res.error ?? "unknown error" };
  return { kind: "provisioned", path: res.data.path };
}

export async function stockWorktreeAdd(cwd: string, name: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd, env: childEnv() });
  if (top.exitCode !== 0) return { ok: false, error: "not a git repository" };
  const root = top.stdout.toString().trim();
  const path = join(root, ".claude", "worktrees", name);
  const add = Bun.spawnSync(["git", "worktree", "add", "-b", name, path], { cwd: root, env: childEnv() });
  if (add.exitCode !== 0) return { ok: false, error: add.stderr.toString().trim().split("\n").pop() ?? "git worktree add failed" };
  return { ok: true, path };
}

export type RemoveDecision = { kind: "dispose"; repoName: string; tree: string } | { kind: "noop" };

export function decideRemove(
  worktreePath: string | null,
  registryLookup: (path: string) => { repoName: string; tree: string } | null,
): RemoveDecision {
  if (!worktreePath) return { kind: "noop" };
  const hit = registryLookup(worktreePath);
  return hit ? { kind: "dispose", repoName: hit.repoName, tree: hit.tree } : { kind: "noop" };
}

export type ParsedStdin =
  | { event: "create"; cwd: string; name: string; sessionId?: string }
  | { event: "remove"; path: string | null; sessionId?: string }
  | { event: "invalid" };

export function parseHookStdin(raw: string): ParsedStdin {
  try {
    const j = JSON.parse(raw);
    const session = typeof j.session_id === "string" ? { sessionId: j.session_id as string } : {};
    if (j.hook_event_name === "WorktreeCreate" && typeof j.cwd === "string" && typeof j.name === "string") {
      return { event: "create", cwd: j.cwd, name: j.name, ...session };
    }
    if (j.hook_event_name === "WorktreeRemove") {
      const p = typeof j.worktree_path === "string" ? j.worktree_path : typeof j.path === "string" ? j.path : null;
      return { event: "remove", path: p, ...session };
    }
  } catch { /* fall through to invalid */ }
  return { event: "invalid" };
}

/** Only EnterWorktree paints a Claude Code relocation dialog (ExitWorktree has none on 2.1.283), so any other tool is null. */
export function buildRelocationAnnouncement(stdin: string, env: NodeJS.ProcessEnv): RelocationAnnouncement | null {
  let hook: { session_id?: unknown; cwd?: unknown; tool_name?: unknown; tool_input?: unknown };
  try {
    hook = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (!hook || typeof hook !== "object") return null;
  if (hook.tool_name !== "EnterWorktree") return null;
  if (typeof hook.session_id !== "string" || typeof hook.cwd !== "string") return null;
  const out: RelocationAnnouncement = { sessionId: hook.session_id, tool: "EnterWorktree", cwd: hook.cwd };
  const paneId = selfPaneRef(env);
  if (paneId) out.paneId = paneId;
  const input = hook.tool_input;
  if (input && typeof input === "object" && typeof (input as { path?: unknown }).path === "string") {
    out.path = (input as { path: string }).path;
  }
  return out;
}

/**
 * Who a hook runs for. "legacy" keeps the hook exactly as it was: the switch
 * is off, the hook carries no session, or the session was never bound (or
 * every binding of it was detached by a /clear). "refused": the session
 * names a binding rt cannot attribute, so it acts as nobody.
 */
export type HookCaller =
  | { kind: "legacy" }
  | { kind: "bound"; context: CallerContext }
  | { kind: "refused"; error: { message: string } };

/** The hook's stdin session id is Claude Code's own reference to the session it runs for; the environment is the fallback. */
export function claudeHookCaller(
  sessionId: string | undefined, env: NodeJS.ProcessEnv, deps: { db?: Database; enabled?: () => boolean } = {},
): HookCaller {
  if (!(deps.enabled ?? integrationsEnabled)()) return { kind: "legacy" };
  const evidence = hookEvidence(sessionId, env);
  if (!evidence) return { kind: "legacy" };
  let caller: Outcome<CallerContext> | null;
  try {
    caller = resolveCallerOrEnvironmentNow(evidence, deps.db ? { db: deps.db } : {});
  } catch (err) {
    return { kind: "refused", error: { message: `rt could not read its session records: ${String(err)}` } };
  }
  if (caller === null) return { kind: "legacy" };
  return caller.ok ? { kind: "bound", context: caller.data } : { kind: "refused", error: caller.error };
}

function hookEvidence(sessionId: string | undefined, env: NodeJS.ProcessEnv): CallerEvidence | null {
  if (sessionId !== undefined && sessionId.length > 0) return { native: { harness: "claude", kind: "id", value: sessionId } };
  const fromEnv = extractCliEvidence([], env);
  return fromEnv.ok && fromEnv.data.native !== undefined ? { native: fromEnv.data.native } : null;
}

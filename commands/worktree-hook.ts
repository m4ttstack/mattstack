/**
 * rt worktree claude-hook (Claude Code WorktreeCreate/WorktreeRemove hook)
 * and rt worktree announce-relocation (its EnterWorktree PreToolUse hook).
 * The hook protocol and the decisions live in Claude's integration
 * (lib/agent-integrations/claude/worktrees.ts); with agent.integrations.enabled
 * on, a bound session's events go through the shared worktree service.
 */
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { warn } from "../lib/ui/warn.ts";
import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { daemonQuery } from "../lib/daemon-client.ts";
import { currentRepoIdentityFor } from "../lib/repo-arg.ts";
import { isRepoRegistered } from "../lib/repo-index.ts";
import { claudeWorktreeHookStatus, HOOK_TIMEOUT_SECONDS, installClaudeWorktreeHooks, uninstallClaudeWorktreeHooks } from "../lib/claude-settings.ts";
import { explainSetting } from "../lib/settings/resolve.ts";
import { setSetting } from "../lib/settings/write.ts";
import {
  buildRelocationAnnouncement, claudeHookCaller, decideCreate, decideRemove, parseHookStdin, stockWorktreeAdd,
  type HookCaller, type RelocationAnnouncement,
} from "../lib/agent-integrations/claude/worktrees.ts";
import { loadWorktreeAppConfig } from "../lib/worktree/config.ts";
import { explainError } from "./worktree.ts";
import { findTreeByPath } from "../lib/worktree/registry.ts";
import { selfPaneRef } from "../lib/self-pane.ts";
import { rtCommand } from "../packages/rt-client/src/index.ts";

export { buildRelocationAnnouncement, parseHookStdin };

// One shared number with lib/claude-settings.ts's HOOK_TIMEOUT_SECONDS (the
// installed hook entries' Claude Code `timeout` field) so the two can never
// drift apart: the daemon call this constant bounds must never outlive the
// hook process Claude Code itself is willing to wait on.
const HOOK_PROVISION_TIMEOUT_MS = HOOK_TIMEOUT_SECONDS * 1000;

export function claudeSettingsPath(): string {
  return join(process.env.HOME ?? homedir(), ".claude", "settings.json");
}

// Same key as lib/worktree/config.ts's app-level toggle (`enabled`,
// `killProcesses`)... a field-bag, not owned exclusively by either module, so
// every write here must merge rather than replace. `claudeHook` records whether
// THIS machine's ~/.claude/settings.json has the hook, so it is read from and
// written to the machine store only: a team value would silence the offer on
// every member's machine.
const WORKTREE_APP_SETTING_KEY = "rt.worktreeApp";

function machineWorktreeAppValue(): Record<string, unknown> | undefined {
  const row = explainSetting(WORKTREE_APP_SETTING_KEY).find((r) => r.scope === "machine");
  if (!row?.present || row.invalid !== undefined) return undefined;
  const value = row.value;
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The pure offer gate: every field must clear for the offer to fire. */
export function shouldOfferClaudeHook(env: {
  isTTY: boolean;
  json: boolean;
  batch: boolean;
  settingsFileExists: boolean;
  hookInstalled: boolean;
  priorAnswer: string | undefined;
}): boolean {
  return (
    env.isTTY &&
    !env.json &&
    !env.batch &&
    env.settingsFileExists &&
    !env.hookInstalled &&
    env.priorAnswer === undefined
  );
}

export function priorClaudeHookAnswer(): string | undefined {
  const value = machineWorktreeAppValue();
  return typeof value?.claudeHook === "string" ? value.claudeHook : undefined;
}

/**
 * Merges `claudeHook` into the machine-scope value only, so sibling fields
 * are kept but nothing else is pinned: a copied `enabled` would outvote the
 * team's and user's values forever.
 */
export function recordClaudeHookAnswer(answer: "installed" | "declined"): void {
  setSetting(WORKTREE_APP_SETTING_KEY, { ...(machineWorktreeAppValue() ?? {}), claudeHook: answer }, "machine");
}

/**
 * One-time TTY offer to install the Claude Code worktree hook, called as the
 * last statement of the five worktree lifecycle verbs' success paths. Never
 * throws into its caller: an offer failure must never fail the lifecycle
 * verb that hosted it.
 */
export async function maybeOfferClaudeHook(json: boolean): Promise<void> {
  try {
    const settingsPath = claudeSettingsPath();
    const status = claudeWorktreeHookStatus(settingsPath);

    const offer = shouldOfferClaudeHook({
      isTTY: Boolean(process.stdin.isTTY),
      json,
      batch: Boolean(process.env.RT_BATCH),
      settingsFileExists: existsSync(settingsPath),
      hookInstalled: status.installed,
      priorAnswer: priorClaudeHookAnswer(),
    });
    if (!offer) return;

    const { confirm } = await import("../lib/rt-render.ts");
    const accepted = await confirm({
      message: "Install the Claude Code worktree hook? (rt provisions a worktree automatically when Claude creates one)",
      initialValue: true,
    });

    if (!accepted) {
      recordClaudeHookAnswer("declined");
      return;
    }

    const rtBin = Bun.which("rt");
    if (!rtBin) {
      warn("worktree-hook", "skipping claude hook install offer: rt is not on PATH", { show: { title: "rt could not install the worktree hook", hint: "rt is not on your PATH" } });
      return;
    }
    installClaudeWorktreeHooks(settingsPath, rtBin);
    recordClaudeHookAnswer("installed");
  } catch (err) {
    warn("worktree-hook", `claude hook install offer failed: ${String(err)}`, {
      show: { title: "rt could not install the worktree hook", hint: firstLine(String(err)), next: out.cmd("rt worktree hook install") },
    });
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}

export function hookResultBlocks(kind: "install" | "uninstall", changed: boolean): Block[] {
  if (kind === "install") {
    return [changed ? out.line("done", "Installed the worktree hook", "Claude Code now asks rt for a worktree") : out.line("skipped", "The worktree hook is already installed")];
  }
  return [changed ? out.line("done", "Removed the worktree hook") : out.line("skipped", "The worktree hook was not installed")];
}

export function hookStatusBlocks(s: ReturnType<typeof claudeWorktreeHookStatus>): Block[] {
  if (!s.installed) return [out.line("off", "The worktree hook is not installed"), out.callout("next", out.cmd("rt worktree hook install"))];
  return [out.line("done", "The worktree hook is installed"), out.kv("runs", s.command)];
}

function settingsFail(json: boolean, err: unknown): never {
  if (json) out.json({ error: String(err) });
  else out.fail({ title: "rt could not update Claude Code's settings", why: firstLine(String(err)) });
  process.exit(1);
}

export async function hookInstallCommand(
  args: string[],
  _ctx: unknown,
  deps: { which: (cmd: string) => string | null } = { which: (cmd) => Bun.which(cmd) },
): Promise<void> {
  const json = args.includes("--json");
  const rtBin = deps.which("rt");
  if (!rtBin) {
    if (json) out.json({ error: "rt-not-on-path" });
    else out.fail({ title: "rt is not on your PATH", why: "rt must be available before you can install the hook." });
    process.exit(1);
  }
  try {
    const r = installClaudeWorktreeHooks(claudeSettingsPath(), rtBin);
    recordClaudeHookAnswer("installed");
    if (json) out.json({ installed: true, changed: r.changed, rtBin });
    else out.print(...hookResultBlocks("install", r.changed));
  } catch (err) {
    settingsFail(json, err);
  }
}

export async function hookUninstallCommand(args: string[], _ctx: unknown): Promise<void> {
  const json = args.includes("--json");
  try {
    const r = uninstallClaudeWorktreeHooks(claudeSettingsPath());
    if (json) out.json({ installed: false, changed: r.changed });
    else out.print(...hookResultBlocks("uninstall", r.changed));
  } catch (err) {
    settingsFail(json, err);
  }
}

export async function hookStatusCommand(args: string[], _ctx: unknown): Promise<void> {
  const json = args.includes("--json");
  try {
    const s = claudeWorktreeHookStatus(claudeSettingsPath());
    if (json) {
      out.json(s);
      return;
    }
    if (s.installed && !s.binaryExists) {
      out.fail({ title: "The worktree hook points at an rt that is gone", why: "Every new Claude worktree will fail until it is fixed.", next: out.cmd("rt worktree hook uninstall") });
      return;
    }
    out.print(...hookStatusBlocks(s));
  } catch (err) {
    settingsFail(json, err);
  }
}

/** Never call directly: Claude Code's PreToolUse hook drives this over stdin. Every path prints nothing and exits 0 so a daemon-down or malformed-input case never stalls the pane. */
export async function announceRelocation(_args: string[]): Promise<void> {
  const stdin = process.stdin.isTTY ? "" : await Bun.stdin.text();
  const payload = buildRelocationAnnouncement(stdin, process.env);
  if (!payload) return;
  try {
    if (!(await relocationIsCallers(payload))) return;
    await rtCommand("pane:announce-relocation", payload, { timeoutMs: 3_000 });
  } catch {
    // the daemon being unreachable falls through to the human's own dialog, not the hook's error
  }
}

/**
 * With the switch on, a tree some session holds through rt is announced only
 * for its holder, so the daemon never drives the dialog into another
 * session's tree; that dialog stays with the person. A tree nobody holds
 * (claimed before the switch, by a herd spawn, or by another verb) and every
 * other caller announce as before.
 */
export async function relocationIsCallers(payload: RelocationAnnouncement, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (payload.path === undefined) return true;
  const caller = claudeHookCaller(payload.sessionId, env);
  if (caller.kind === "legacy") return true;
  const { applyWorktreeEvent, liveHolder } = await import("../lib/agent-integrations/worktrees.ts");
  const path = resolve(payload.cwd, payload.path);
  if (!liveHolder(path)) return true;
  if (caller.kind === "refused") return false;
  return (await applyWorktreeEvent(caller.context, { kind: "relocate", path })).ok;
}

/**
 * A tree some session holds through rt is left only by its holder, which
 * disposes it once. False when nobody holds the tree, so the hook takes its
 * own path; an unreachable daemon stays quiet, as on that path.
 */
async function leftAsHolder(caller: Exclude<HookCaller, { kind: "legacy" }>, path: string, query: typeof daemonQuery): Promise<boolean> {
  const { applyWorktreeEvent, disposeThrough, liveHolder } = await import("../lib/agent-integrations/worktrees.ts");
  if (!liveHolder(path)) return false;
  if (caller.kind === "refused") {
    out.diagnostic(`rt: tree kept: ${caller.error.message}\n`);
    return true;
  }
  const left = await applyWorktreeEvent(caller.context, { kind: "leave", path }, { dispose: disposeThrough(query) });
  if (!left.ok && left.error.code !== "transient") out.diagnostic(`rt: tree kept: ${left.error.message}\n`);
  return true;
}

/** Records the bound session that asked for a provisioned tree as its holder; a failure is logged and never fails the create. */
async function holdAsCaller(sessionId: string | undefined, path: string): Promise<void> {
  try {
    const caller = claudeHookCaller(sessionId, process.env);
    if (caller.kind !== "bound") return;
    const { claimWorktree } = await import("../lib/agent-integrations/worktrees.ts");
    const held = claimWorktree(caller.context, path);
    if (!held.ok) warn("worktree-hook", `could not record the session holding ${path}: ${held.error.message}`);
  } catch (err) {
    warn("worktree-hook", `could not record the session holding ${path}: ${String(err)}`);
  }
}

/**
 * The `repoIdentity` dep `decideCreate` calls: read-only end to end. It
 * derives the identity without ever registering it, then answers "rt's
 * repo" only if that identity is already an index row AND the worktree app
 * is enabled on this machine (`loadWorktreeAppConfig().enabled`) -- a
 * disabled app means rt's reconciler will never pick up a provisioned tree,
 * so a registered repo is routed to the same stock fallback as an
 * unregistered one rather than left half-managed. A repo that is derivable
 * but not indexed, or whose app toggle is off, returns null, which
 * `decideCreate` already routes to the stock fallback. Deps are overridable
 * purely so a unit test can exercise each branch without a real git repo,
 * a live index, or a real settings store.
 */
export function hookRepoIdentity(
  cwd: string,
  deps: {
    identityFor: (cwd: string) => string | undefined;
    isRegistered: (identity: string) => boolean;
    appEnabled: () => boolean;
  } = {
    identityFor: currentRepoIdentityFor,
    isRegistered: isRepoRegistered,
    appEnabled: () => loadWorktreeAppConfig().enabled,
  },
): string | null {
  if (!deps.appEnabled()) return null;
  const identity = deps.identityFor(cwd);
  return identity !== undefined && deps.isRegistered(identity) ? identity : null;
}

export async function claudeHookCommand(args: string[], _ctx: unknown, deps: { query?: typeof daemonQuery } = {}): Promise<void> {
  const query = deps.query ?? daemonQuery;
  const removeMode = args.includes("--remove");
  const parsed = parseHookStdin(await Bun.stdin.text());

  if (parsed.event === "invalid") {
    out.diagnostic("rt worktree claude-hook: unrecognized stdin payload\n");
    process.exit(removeMode ? 0 : 2);
  }

  if (parsed.event === "remove" || removeMode) {
    if (parsed.event !== "remove") process.exit(0);
    const caller = claudeHookCaller(parsed.sessionId, process.env);
    if (caller.kind !== "legacy" && parsed.path !== null && await leftAsHolder(caller, parsed.path, query)) process.exit(0);
    const decision = decideRemove(parsed.path, (p) => findTreeByPath(p));
    if (decision.kind === "dispose") {
      const res = await query("worktree:dispose", { repoName: decision.repoName, tree: decision.tree, force: false, callerPid: process.pid });
      if (res && !res.ok) out.diagnostic(`rt: tree kept: ${explainError(res.error ?? "unknown error")}\n`);
    }
    process.exit(0);
  }

  const decision = await decideCreate(
    { cwd: parsed.cwd, name: parsed.name },
    {
      repoIdentity: hookRepoIdentity,
      provision: (repoName, intent) =>
        query("worktree:provision", { repoName, owner: "claude", ...intent }, HOOK_PROVISION_TIMEOUT_MS),
      stockAdd: stockWorktreeAdd,
    },
  );

  if (decision.kind === "refused") {
    out.diagnostic(`rt worktree provision refused: ${explainError(decision.error)} (escape hatch: rt worktree hook uninstall)\n`);
    process.exit(2);
  }
  if (decision.kind === "provisioned") await holdAsCaller(parsed.sessionId, decision.path);
  if (decision.kind === "provisioned" && parsed.sessionId) {
    const announce: RelocationAnnouncement = { sessionId: parsed.sessionId, tool: "EnterWorktree", path: decision.path, cwd: parsed.cwd };
    const paneId = selfPaneRef(process.env);
    if (paneId) announce.paneId = paneId;
    try {
      await rtCommand("pane:announce-relocation", announce, { timeoutMs: 3_000 });
    } catch {
      // same as announceRelocation: the dialog falls to the human on a daemon-down case
    }
  }
  out.payload(`${decision.path}\n`);
  process.exit(0);
}

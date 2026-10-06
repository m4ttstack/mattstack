/**
 * Claude Code's per-agent `--settings` file carrying the AskUserQuestion
 * PreToolUse hook (docs/superpowers/specs/2026-09-11-executor-reconciler-design.md
 * "AskUserQuestion hook"). Both `rt agent` launch paths write it here: the
 * daemon handler's own launcher and the Claude session integration.
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { Logger } from "pino";
import { mergeGateForkHookSettings, resolveGateForkHookPath } from "../../agent-hooks.ts";
import { rtDir } from "../../rt-paths.ts";

/** The inline `--settings` JSON `inboundAccept` triggers on its own (no settingsPath). Exported so a settingsPath caller can merge it into the SAME file instead of the flag being emitted twice. */
export const CROSS_SESSION_INBOUND_SETTINGS = { crossSessionInbound: "accept" } as const;

export type ClaudeGateHook = {
  agentId: string;
  subject?: string;
  extraArgs?: string;
  /** The launch would otherwise carry the inline inbound-accept settings (interactive, with a chat handle). */
  inbound: boolean;
};

/** Deterministic from the id alone, so a resume rewrites the same file. */
export function claudeHookSettingsPath(agentId: string): string {
  return join(rtDir(), "agent-hooks", `${agentId}.json`);
}

/** Tokenized the same way claudeArgs splits extraArgs, so a match here is exactly a flag claude will also see. Matches both the split ("--settings", "<path>") and "--settings=<path>" spellings. */
function extraArgsHasSettingsFlag(extraArgs: string | undefined): boolean {
  if (!extraArgs) return false;
  return extraArgs.split(/\s+/).filter(Boolean).some((tok) => tok === "--settings" || tok.startsWith("--settings="));
}

/**
 * Absolute path to a freshly written per-agent settings file, or undefined
 * when injection is skipped. Three skip cases, all non-fatal to the launch:
 * no explicit subject (with no subject there is no gate for the hook to
 * check, so it would only ever degrade to allow), extraArgs already sets
 * --settings (merge is not attempted; the user's own value wins outright),
 * or gate-fork.sh cannot be resolved on this machine.
 *
 * A launch never emits two --settings flags (repeated-flag semantics are
 * unverified against the real CLI): when this launch would otherwise get the
 * inline CROSS_SESSION_INBOUND_SETTINGS JSON, that object is folded into this
 * SAME file, and claudeArgs skips its inline JSON whenever settingsPath is
 * set. A subjectless launch skips this file entirely, so that inline JSON
 * keeps riding its own --settings flag.
 */
export function writeClaudeGateHookSettings(hook: ClaudeGateHook, log?: Pick<Logger, "debug" | "warn">): string | undefined {
  if (hook.subject === undefined) {
    log?.debug({ id: hook.agentId }, "agent: no explicit subject; gate-fork hook injection skipped");
    return undefined;
  }
  if (extraArgsHasSettingsFlag(hook.extraArgs)) {
    log?.debug({ id: hook.agentId }, "agent: extraArgs already sets --settings; gate-fork hook injection skipped");
    return undefined;
  }
  const hookPath = resolveGateForkHookPath();
  if (!hookPath) {
    log?.debug({ id: hook.agentId }, "agent: gate-fork.sh not found; hook injection skipped");
    return undefined;
  }
  const settings = mergeGateForkHookSettings(hook.inbound ? CROSS_SESSION_INBOUND_SETTINGS : undefined, hookPath);
  const settingsPath = claudeHookSettingsPath(hook.agentId);
  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings));
    return settingsPath;
  } catch (err) {
    log?.warn({ err, id: hook.agentId }, "agent: failed to write gate-fork hook settings file");
    return undefined;
  }
}

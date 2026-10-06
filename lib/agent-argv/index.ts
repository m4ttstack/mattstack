/**
 * lib/agent-argv/index.ts -- barrel + provider dispatch for `rt agent`.
 * lib/daemon/handlers/agent.ts calls buildAgentArgv/buildAgentPaneCommand
 * here instead of reaching into a harness's builders directly. Claude's
 * builders live in its integration; claude.ts forwards them.
 */
export * from "./types.ts";
export * from "./claude.ts";
export * from "./codex.ts";
export * from "./prompt-file.ts";

import type { AgentInvocation, AgentProvider } from "./types.ts";
import { buildClaudeArgv, buildPaneCommand as buildClaudePaneCommand } from "../agent-integrations/claude/sessions.ts";
import { buildCodexArgv, buildCodexPaneCommand } from "./codex.ts";

export function buildAgentArgv(
  provider: AgentProvider,
  inv: AgentInvocation,
  bins?: { claude?: string; cswap?: string; codex?: string },
): string[] {
  if (provider === "codex") return buildCodexArgv(inv, bins);
  if (provider === "claude") return buildClaudeArgv(inv, bins);
  throw unknownProvider(provider);
}

export function buildAgentPaneCommand(provider: AgentProvider, cwd: string, inv: AgentInvocation): string {
  if (provider === "codex") return buildCodexPaneCommand(cwd, inv);
  if (provider === "claude") return buildClaudePaneCommand(cwd, inv);
  throw unknownProvider(provider);
}

function unknownProvider(provider: AgentProvider): Error {
  return new Error(`no argv builder for harness "${provider}"`);
}

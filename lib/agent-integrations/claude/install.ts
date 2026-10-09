/**
 * What setup installs for Claude Code: its plugins (which carry the
 * Mattstack MCP server and skills), the Linear MCP entry and the baseline
 * permissions. Each step is the one setup has always run; with the
 * integrations switch on, setup runs them only while Claude is enabled.
 */

import { runAdapterSteps, type HarnessInstall, type InstallAdapter } from "../install.ts";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { claudePermissionsStep } from "../../setup/steps/claude-permissions.ts";
import { linearMcpStep } from "../../setup/steps/linear-mcp.ts";
import { pluginsInstallStep } from "../../setup/steps/plugins.ts";
import { claudeRow, pluginsRow } from "../../setup/validators/tools.ts";

export function createClaudeInstall(deps: { p?: Probes } = {}): InstallAdapter {
  const probes = (): Probes => deps.p ?? createRealProbes();
  const steps = () => [pluginsInstallStep, linearMcpStep, claudePermissionsStep];
  return {
    steps,
    /** Uninstall takes nothing here: Claude's plugins leave through `rt uninstall`'s own plugins step, as they always have. */
    reconcile: async (mode, ctx) => (mode === "uninstall" ? [] : runAdapterSteps(steps(), mode, ctx)),
    async verify() {
      const p = probes();
      const tool = await claudeRow(p, { hasBrew: false });
      if (tool.status !== "ready") return { ok: true, data: { ready: false, reason: tool.detail } };
      const plugins = pluginsRow(await p.exec(["claude", "plugin", "list", "--json"], { timeoutMs: 5000 }));
      return { ok: true, data: plugins.status === "ready" ? { ready: true } : { ready: false, reason: plugins.detail } };
    },
  };
}

export const claudeInstall: HarnessInstall = { id: "claude", loadInstall: async () => createClaudeInstall() };

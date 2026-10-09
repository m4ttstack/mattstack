/**
 * Which harnesses setup installs for. With the integrations switch off,
 * setup keeps its Claude-only path byte for byte; with it on, setup installs
 * for exactly the enabled set (`agent.integrations`), which may leave Claude
 * out entirely.
 */

import type { HarnessId } from "../../packages/rt-client/src/agent-integrations.ts";
import { enabledIntegrations } from "../agent-integrations/preferences.ts";
import { integrationsEnabled } from "../agent-integrations/switch.ts";
import type { ApplyContext } from "./apply.ts";
import type { Probes } from "./probes.ts";
import { claudeConfigDirs } from "./tools-install.ts";
import { codexHomeOf } from "./validators/codex.ts";

export type IntegrationSelection = { switchOn: false } | { switchOn: true; enabled: HarnessId[] };

/** Read at call time from the settings stores. */
export function readIntegrationSelection(): IntegrationSelection {
  return integrationsEnabled() ? { switchOn: true, enabled: enabledIntegrations() } : { switchOn: false };
}

export function selectionFor(ctx: Pick<ApplyContext, "integrations">): IntegrationSelection {
  return ctx.integrations ?? readIntegrationSelection();
}

/**
 * Harnesses whose legs in shared steps `rt setup update` leaves out. Codex's
 * skill links, herdr integration and Fast Browser host carry no record of
 * what rt wrote, so a repeat could not tell a link the member deleted from
 * one never made. Codex's own steps (its MCP entry and policy hooks) are
 * update-safe: their records say exactly what rt wrote.
 */
const NOT_UPDATE_SAFE: readonly HarnessId[] = ["codex"];

/** The selection a shared update-safe step installs for: under `rt setup update`, without the harnesses above. */
export function stepSelectionFor(ctx: Pick<ApplyContext, "integrations" | "update">): IntegrationSelection {
  const selection = selectionFor(ctx);
  if (!ctx.update || !selection.switchOn) return selection;
  return { switchOn: true, enabled: selection.enabled.filter((id) => !NOT_UPDATE_SAFE.includes(id)) };
}

/** Why a shared step has no harness to set up in this run. */
export function noHarnessDetail(ctx: Pick<ApplyContext, "integrations" | "update">): string {
  const selection = selectionFor(ctx);
  const leftToInstall = ctx.update && selection.switchOn && selection.enabled.some((id) => NOT_UPDATE_SAFE.includes(id));
  return leftToInstall ? "Codex is set up by Install, not by an update" : "No agent integration is turned on";
}

/** Whether setup installs for `id`: with the switch off, only Claude. */
export function harnessSelected(selection: IntegrationSelection, id: HarnessId): boolean {
  return selection.switchOn ? selection.enabled.includes(id) : id === "claude";
}

export type FastBrowserHost = "claude" | "codex" | "both";

/** The `--host` Fast Browser's setup integrates into; null when no harness it serves is selected. */
export function fastBrowserHost(selection: IntegrationSelection): FastBrowserHost | null {
  const claude = harnessSelected(selection, "claude");
  const codex = harnessSelected(selection, "codex");
  if (claude && codex) return "both";
  return claude ? "claude" : codex ? "codex" : null;
}

/** Herdr's integrations to install, one per selected harness it has one for. */
export function herdrHosts(selection: IntegrationSelection): ("claude" | "codex")[] {
  return (["claude", "codex"] as const).filter((id) => harnessSelected(selection, id));
}

/** Where Fast Browser and herdr integrate: with the switch off, exactly today's Claude folders. */
export function hostSetupFor(
  p: Pick<Probes, "env" | "home">,
  selection: IntegrationSelection,
  extraClaudeDirs: string[] = [],
): { configDirs: string[]; codexHomes: string[]; host: FastBrowserHost | null } {
  const hosts = herdrHosts(selection);
  const codexHome = hosts.includes("codex") ? codexHomeOf(p) : null;
  return {
    configDirs: hosts.includes("claude") ? claudeConfigDirs(p, extraClaudeDirs) : [],
    codexHomes: codexHome === null ? [] : [codexHome],
    host: fastBrowserHost(selection),
  };
}

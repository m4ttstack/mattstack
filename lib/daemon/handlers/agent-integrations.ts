/**
 * agent:integrations: the registry's metadata for apps choosing a harness.
 *
 * Listing reads each integration's host readiness and never loads its
 * sessions: loading Codex's starts discovery of its app server, and a
 * metadata read must not start a session, a connection or a native probe.
 * Codex therefore reads not ready until something else connects to it.
 */

import type {
  AgentOptions, CapabilityReport, IntegrationDiagnostics, IntegrationSummary, Mode, OptionDescriptor,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { builtinRegistry } from "../../agent-integrations/builtins.ts";
import type { HarnessIntegration, IntegrationRegistry } from "../../agent-integrations/contracts.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import type { ModLinks } from "../../agent-integrations/claude/mod-links.ts";
import { codexExperimentalApi } from "../../agent-integrations/codex/link.ts";
import { getSetting } from "../../settings/resolve.ts";

/** CommandResult's shape, spelled here because ./types.ts reaches setup modules through the daemon's snapshot types. */
type IntegrationsResult = { ok: true; data: Commands["agent:integrations"]["data"] } | { ok: false; error: string };

export type IntegrationListDeps = {
  integrations?: IntegrationRegistry;
  /** Whether the user enabled a harness; defaults to the reading an absent enabled-set setting has. */
  enabled?: (id: string) => boolean;
  /** The daemon's mod-link registry; defaults to the installed one, null outside the daemon. */
  modLinks?: () => Promise<ModLinks | null> | ModLinks | null;
  now?: () => number;
  /** What the live Codex connection negotiated; undefined while there is none. */
  experimentalApi?: () => boolean | undefined;
};

const MODES: readonly Mode[] = ["herdr", "headless"];
const OPTION_NAMES: ReadonlySet<string> = new Set<keyof AgentOptions>(["model", "effort", "account", "extraArgs", "yolo"]);
const OPTION_KINDS: ReadonlySet<string> = new Set<OptionDescriptor["kind"]>(["text", "boolean", "choice"]);

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * There is no enabled-set setting yet; until there is, the set reads as Claude
 * plus `agent.provider`, since Claude runs herds, chat and gates on every
 * existing installation whatever that default names.
 */
function defaultEnabled(): (id: string) => boolean {
  let provider: string | undefined;
  try {
    provider = getSetting<string>("agent.provider").value ?? undefined;
  } catch {
    provider = undefined;
  }
  return (id) => id === "claude" || id === provider;
}

/** Only descriptors a consumer can render: a known option, a known kind, choices exactly when it is a choice, each name once. */
function validOptions(descriptors: unknown): OptionDescriptor[] {
  if (!Array.isArray(descriptors)) return [];
  const seen = new Set<string>();
  const out: OptionDescriptor[] = [];
  for (const d of descriptors as Array<Partial<OptionDescriptor> | null>) {
    if (!d || typeof d.name !== "string" || !OPTION_NAMES.has(d.name) || seen.has(d.name)) continue;
    if (typeof d.kind !== "string" || !OPTION_KINDS.has(d.kind)) continue;
    const choices = Array.isArray(d.choices) && d.choices.length > 0 && d.choices.every((c) => typeof c === "string") ? d.choices : undefined;
    if (d.kind === "choice" && !choices) continue;
    seen.add(d.name);
    out.push({ name: d.name, kind: d.kind, ...(d.kind === "choice" && { choices: [...choices!] }) });
  }
  return out;
}

/** Imported on demand: the registry module reaches daemon code a metadata listing must not load. */
async function installedLinks(): Promise<ModLinks | null> {
  return (await import("../../agent-integrations/claude/mod-links.ts")).installedModLinks();
}

async function diagnose(integration: HarnessIntegration, deps: IntegrationListDeps): Promise<IntegrationDiagnostics | undefined> {
  if (integration.id === "claude") {
    const links = await (deps.modLinks ?? installedLinks)();
    if (!links) return undefined;
    const now = (deps.now ?? Date.now)();
    return {
      claudeLinks: links.list().map((link) => ({
        sessionId: link.sessionId, claudeCode: link.claudeCode, plugin: link.plugin,
        blocks: link.blocks, lastHeartbeatAgoMs: Math.max(0, now - link.lastHeartbeatAt),
      })),
    };
  }
  if (integration.id === "codex") {
    const experimentalApi = (deps.experimentalApi ?? codexExperimentalApi)();
    return experimentalApi === undefined ? undefined : { experimentalApi };
  }
  return undefined;
}

async function summarize(
  integration: HarnessIntegration, mode: Mode, enabled: boolean, deps: IntegrationListDeps,
): Promise<IntegrationSummary> {
  let report: CapabilityReport;
  try {
    report = await integration.capabilities(mode);
  } catch (err) {
    report = { mode, supported: [], readiness: { ready: false, reason: `rt could not read ${integration.label}'s capabilities: ${messageOf(err)}` } };
  }
  let options: unknown;
  try {
    options = await integration.options();
  } catch {
    options = [];
  }
  let diagnostics: IntegrationDiagnostics | undefined;
  try {
    diagnostics = await diagnose(integration, deps);
  } catch {
    diagnostics = undefined;
  }
  return {
    id: integration.id, label: integration.label, enabled,
    readiness: report.readiness,
    capabilities: [...report.supported],
    options: validOptions(options),
    ...(diagnostics && { diagnostics }),
  };
}

export async function listAgentIntegrations(mode: Mode, deps: IntegrationListDeps = {}): Promise<IntegrationSummary[]> {
  const registry = deps.integrations ?? builtinRegistry();
  const enabled = deps.enabled ?? defaultEnabled();
  return Promise.all(registry.list().map((integration) => summarize(integration, mode, enabled(integration.id), deps)));
}

export function createAgentIntegrationHandlers(deps: IntegrationListDeps = {}):
  { "agent:integrations": (payload: unknown) => Promise<IntegrationsResult> } {
  return {
    "agent:integrations": async (payload: unknown): Promise<IntegrationsResult> => {
      const mode = (payload as { mode?: unknown } | undefined)?.mode;
      if (typeof mode !== "string" || !MODES.includes(mode as Mode)) {
        return { ok: false, error: `invalid mode "${String(mode)}"; must be one of ${MODES.join(", ")}` };
      }
      return { ok: true, data: { integrations: await listAgentIntegrations(mode as Mode, deps) } };
    },
  };
}

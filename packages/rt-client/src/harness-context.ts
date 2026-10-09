/**
 * What an app needs to launch an agent and name its caller under the
 * harness integrations switch, read the way rt itself reads them
 * (lib/agent-integrations/switch.ts, preferences.ts and context.ts), so an
 * app does not keep its own copy.
 */

import type { HarnessId, IntegrationSummary } from "./agent-integrations.ts";
import { getSetting } from "./settings/resolve.ts";
import type { RtResponse } from "./transport.ts";

type Read = typeof getSetting;

/** `agent.integrations.enabled`, read at call time; unreadable settings keep it off. */
export function integrationsSwitchOn(read: Read = getSetting): boolean {
  try {
    return read<boolean>("agent.integrations.enabled").value === true;
  } catch {
    return false;
  }
}

/** The user's default harness (`agent.provider`); undefined when unset or unreadable. */
export function defaultHarness(read: Read = getSetting): HarnessId | undefined {
  try {
    const value = read<string>("agent.provider").value;
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The harnesses the user turned on (`agent.integrations`), in their order.
 * An absent, unreadable or malformed list reads as Claude plus the default
 * harness, which is what an installation ran before the setting existed.
 */
export function enabledHarnesses(read: Read = getSetting): HarnessId[] {
  let value: unknown;
  try {
    value = read<unknown>("agent.integrations").value;
  } catch {
    value = undefined;
  }
  if (Array.isArray(value) && value.every((id) => typeof id === "string")) return [...(value as string[])];
  const provider = defaultHarness(read);
  return provider === undefined || provider === "claude" ? ["claude"] : ["claude", provider];
}

/** The native session a CLI call's environment names. `both` is set, and nothing else, when it names a Codex thread and a Claude session. */
export interface NativeCaller {
  sessionId?: string;
  harness?: HarnessId;
  both?: { codex: string; claude: string };
}

const named = (v: string | undefined): string | undefined => (v && v.trim() ? v : undefined);

/**
 * With the switch off only Claude Code's own variable counts, raw, as
 * before. With it on, Codex names its thread through CODEX_THREAD_ID and
 * Claude Code its session through CLAUDE_CODE_SESSION_ID.
 */
export function nativeCallerFromEnv(env: Record<string, string | undefined>, switchOn: boolean): NativeCaller {
  if (!switchOn) {
    const raw = env.CLAUDE_CODE_SESSION_ID;
    return raw ? { sessionId: raw } : {};
  }
  const claude = named(env.CLAUDE_CODE_SESSION_ID);
  const codex = named(env.CODEX_THREAD_ID);
  if (codex && claude) return { both: { codex, claude } };
  if (codex) return { sessionId: codex, harness: "codex" };
  return claude ? { sessionId: claude, harness: "claude" } : {};
}

export interface LaunchHarnessIo {
  switchOn(): boolean;
  defaultHarness(): HarnessId | undefined;
  agentIntegrations(a: { mode: "herdr" }): Promise<RtResponse<{ integrations: IntegrationSummary[] }>>;
}

/**
 * The harness a fresh pane runs: undefined while the switch is off, so the
 * caller launches as it always did. With it on, the default harness when it
 * is turned on, else the first one turned on in registry order. Readiness is
 * left to the launch, since a harness can read not ready until something
 * connects. `who` names the app in its refusals.
 */
export async function selectLaunchHarness(io: LaunchHarnessIo, who: string): Promise<HarnessId | undefined> {
  if (!io.switchOn()) return undefined;
  const res = await io.agentIntegrations({ mode: "herdr" });
  if (!res.ok || !res.data) throw new Error(`${who} could not read which agents are turned on: ${res.error ?? "rt sent no answer"}`);
  const enabled = res.data.integrations.filter((i) => i.enabled);
  const preferred = io.defaultHarness();
  const chosen = enabled.find((i) => i.id === preferred) ?? enabled[0];
  if (!chosen) throw new Error(`No agent is turned on, so ${who} cannot start one. Turn one on in setup.`);
  return chosen.id;
}

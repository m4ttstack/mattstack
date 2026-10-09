/**
 * The agent.integrations.enabled kill switch, on its own so a module that
 * only needs the switch does not load caller resolution with it.
 */

import { getSetting } from "../settings/resolve.ts";

const SETTING = "agent.integrations.enabled";

/** Read at call time: a machine can flip the switch under a running server. Unreadable settings keep it off. */
export function integrationsEnabled(): boolean {
  try {
    return getSetting<boolean>(SETTING).value === true;
  } catch {
    return false;
  }
}

/** The configured default harness (`agent.provider`), or undefined while none is set or the setting cannot be read. */
export function configuredHarness(): string | undefined {
  try {
    return getSetting<string>("agent.provider").value ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the user enabled a harness. There is no enabled-set setting yet;
 * until there is, the set reads as Claude plus `agent.provider`, since Claude
 * runs herds, chat and gates on every existing installation whatever that
 * default names.
 */
export function harnessEnabled(): (id: string) => boolean {
  const provider = configuredHarness();
  return (id) => id === "claude" || id === provider;
}

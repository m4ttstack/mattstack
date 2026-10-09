/**
 * The agent.integrations.enabled kill switch, on its own so a module that
 * only needs the switch does not load caller resolution with it.
 */

import { getSetting } from "../settings/resolve.ts";
import { configuredHarness, enabledIntegrations } from "./preferences.ts";

export { configuredHarness };

const SETTING = "agent.integrations.enabled";

/** Read at call time: a machine can flip the switch under a running server. Unreadable settings keep it off. */
export function integrationsEnabled(): boolean {
  try {
    return getSetting<boolean>(SETTING).value === true;
  } catch {
    return false;
  }
}

/** Whether the user enabled a harness (`agent.integrations`), read once per call. */
export function harnessEnabled(): (id: string) => boolean {
  const enabled = new Set(enabledIntegrations());
  return (id) => enabled.has(id);
}

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

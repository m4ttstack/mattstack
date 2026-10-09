/**
 * Which harness integrations the user turned on (`agent.integrations`).
 *
 * The set is a preference, never a probe: an installed binary enables
 * nothing, and whether an enabled harness can run now is its readiness.
 * `agent.provider` only picks the rt agent default. An absent list reads as
 * Claude plus that default, which is what every installation ran before the
 * setting existed and what the setup migration records.
 */

import type { HarnessId, IntegrationProblem, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { builtinRegistry } from "./builtins.ts";

export const INTEGRATIONS_SETTING = "agent.integrations";

const registeredIds = (): HarnessId[] => builtinRegistry().list().map((i) => i.id);

const invalid = <T>(message: string): Outcome<T> => ({ ok: false, error: { code: "invalid", message } });

const joined = (ids: readonly string[], conj: "and" | "or"): string =>
  ids.length < 2 ? ids.join("") : `${ids.slice(0, -1).join(", ")} ${conj} ${ids.at(-1)}`;

/** The configured default harness (`agent.provider`), or undefined while none is set or the setting cannot be read. */
export function configuredHarness(): string | undefined {
  try {
    return getSetting<string>("agent.provider").value ?? undefined;
  } catch {
    return undefined;
  }
}

/** Claude plus the configured default when that differs: the set an installation had before choosing one. */
export function upgradeIntegrations(): HarnessId[] {
  const provider = configuredHarness();
  return provider === undefined || provider === "claude" ? ["claude"] : ["claude", provider];
}

/** Registered ids only, each once, in the order given; an empty list is valid and enables none. */
export function validateIntegrationPreference(ids: string[], registered: readonly HarnessId[] = registeredIds()): Outcome<HarnessId[]> {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return invalid("The integrations list must be a list of names.");
  const seen = new Set<string>();
  for (const id of ids) {
    if (!registered.includes(id)) return invalid(`rt has no integration called ${id}. Choose from ${joined(registered, "and")}.`);
    if (seen.has(id)) return invalid(`${id} is listed twice. List each integration once.`);
    seen.add(id);
  }
  return { ok: true, data: [...ids] };
}

type Stored = { kind: "absent" } | { kind: "malformed" } | { kind: "list"; ids: string[] };

function readStored(): Stored {
  let value: unknown;
  try {
    value = getSetting<unknown>(INTEGRATIONS_SETTING).value;
  } catch {
    return { kind: "absent" };
  }
  if (value === undefined || value === null) return { kind: "absent" };
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) return { kind: "malformed" };
  return { kind: "list", ids: value as string[] };
}

/** The enabled set, read at call time. An unreadable store, or a value that is not a list of names, reads as the upgrade set. */
export function enabledIntegrations(): HarnessId[] {
  const stored = readStored();
  return stored.kind === "list" ? [...stored.ids] : upgradeIntegrations();
}

/** What the user should fix in their integration settings; neither value is ever replaced here. */
export function integrationPreferenceProblems(): IntegrationProblem[] {
  const stored = readStored();
  if (stored.kind === "absent") return [];
  if (stored.kind === "malformed") {
    return [{ code: "invalid-preference", message: `${INTEGRATIONS_SETTING} needs fixing: it must be a list of integration names, such as ["claude"].` }];
  }
  const valid = validateIntegrationPreference(stored.ids);
  if (!valid.ok) return [{ code: "invalid-preference", message: `${INTEGRATIONS_SETTING} needs fixing: ${valid.error.message}` }];
  const provider = configuredHarness();
  if (stored.ids.length === 0 || provider === undefined || stored.ids.includes(provider)) return [];
  return [{
    code: "default-not-enabled",
    message: `${provider} is your default for rt agent, but it is not turned on. Add it to ${INTEGRATIONS_SETTING}, or set agent.provider to ${joined(stored.ids, "or")}.`,
  }];
}

export type IntegrationChoice = { enabled: string[]; defaultHarness?: string };

/** Setup's write of a chosen set and default. A default must be one of the chosen; nothing is written unless both are valid. */
export function writeIntegrationChoice(choice: IntegrationChoice, scope: "user" | "machine"): Outcome<void> {
  const valid = validateIntegrationPreference(choice.enabled);
  if (!valid.ok) return valid;
  const def = choice.defaultHarness;
  if (def !== undefined && !valid.data.includes(def)) {
    const instead = valid.data.length === 0 ? "" : `, or pick ${joined(valid.data, "or")} as your default`;
    return invalid(`${def} is your default, but it is not turned on. Turn it on${instead}.`);
  }
  setSetting(INTEGRATIONS_SETTING, valid.data, scope);
  if (def !== undefined) setSetting("agent.provider", def, scope);
  return { ok: true, data: undefined };
}

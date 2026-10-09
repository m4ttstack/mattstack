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
import { explainSetting, getSetting, type ExplainRow } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { BUILTIN_HARNESS_IDS } from "./harness-ids.ts";

export const INTEGRATIONS_SETTING = "agent.integrations";

/** The verb that saves a fresh choice of apps and default, at the scope that outranks the rest. */
export const CHOOSE_AGAIN = "rt setup harnesses";

const registeredIds = (): HarnessId[] => [...BUILTIN_HARNESS_IDS];

const invalid = <T>(message: string): Outcome<T> => ({ ok: false, error: { code: "invalid", message } });

export const joined = (ids: readonly string[], conj: "and" | "or"): string =>
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

/**
 * Every scope that stores a value, including one the resolver refused or
 * applied despite its schema, so a wrong-typed value is never mistaken for
 * an absent one. Throws when the stores cannot be read.
 */
export function storedIntegrationScopes(): ExplainRow[] {
  return explainSetting(INTEGRATIONS_SETTING).filter((row) => row.present);
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
  let rows: ExplainRow[];
  try {
    rows = storedIntegrationScopes();
  } catch {
    rows = [];
  }
  const wrongShape = rows.filter((row) => row.invalid !== undefined || row.nonconforming !== undefined);
  if (wrongShape.length > 0) {
    // A machine value is the one `rt setup harnesses` overwrites; a value in any other scope stays until removed.
    return wrongShape.map((row) => row.scope === "machine"
      ? { code: "invalid-preference", message: "Your list of agent apps in this Mac's settings cannot be read. Choose them again.", next: CHOOSE_AGAIN }
      : { code: "invalid-preference", message: `Your list of agent apps in your ${row.scope} settings cannot be read. Remove it.`, next: `rt settings unset ${INTEGRATIONS_SETTING} --scope ${row.scope}` });
  }
  const stored = readStored();
  if (stored.kind === "absent") return [];
  if (stored.kind === "malformed") {
    return [{ code: "invalid-preference", message: "Your list of agent apps cannot be read. Choose them again.", next: CHOOSE_AGAIN }];
  }
  const valid = validateIntegrationPreference(stored.ids);
  if (!valid.ok) return [{ code: "invalid-preference", message: `Your list of agent apps needs fixing: ${valid.error.message}`, next: CHOOSE_AGAIN }];
  const provider = configuredHarness();
  if (stored.ids.length === 0 || provider === undefined || stored.ids.includes(provider)) return [];
  return [{ code: "default-not-enabled", message: `${provider} is your default for rt agent, but it is not turned on.`, next: CHOOSE_AGAIN }];
}

export type IntegrationChoice = { enabled: string[]; defaultHarness?: string };

/**
 * Setup's write of a chosen set and default. A default must be one of the
 * chosen, and a user write this Mac's own list would hide is refused;
 * nothing is written on a refusal.
 */
export function writeIntegrationChoice(choice: IntegrationChoice, scope: "user" | "machine"): Outcome<void> {
  const valid = validateIntegrationPreference(choice.enabled);
  if (!valid.ok) return valid;
  const def = choice.defaultHarness;
  if (def !== undefined && !valid.data.includes(def)) {
    const instead = valid.data.length === 0 ? "" : `, or pick ${joined(valid.data, "or")} as your default`;
    return invalid(`${def} is your default, but it is not turned on. Turn it on${instead}.`);
  }
  if (scope === "user" && storedIntegrationScopes().some((row) => row.scope === "machine")) {
    return {
      ok: false,
      error: {
        code: "refused",
        message: `This Mac has its own list of integrations, which would hide this change. Change this Mac's list instead: rt settings set ${INTEGRATIONS_SETTING} '${JSON.stringify(valid.data)}' --scope machine`,
      },
    };
  }
  if (def !== undefined) setSetting("agent.provider", def, scope);
  setSetting(INTEGRATIONS_SETTING, valid.data, scope);
  return { ok: true, data: undefined };
}

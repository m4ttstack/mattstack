/**
 * Which harness, options and mode a herd job's worker runs with.
 *
 * Precedence is by presence, never by validity: the user's explicit
 * assignment, else the shepherd's proposal, else the configured default.
 * Whichever is chosen must be registered, enabled, ready, able to run the
 * job's required capabilities in its mode, and accept its options; one that
 * is not refuses with the reason. Nothing here substitutes another harness.
 *
 * A retry keeps the selection and mode its job's latest attempt recorded,
 * checked again but never chosen again, so a changed default cannot move it.
 */

import type {
  AgentOptions, Capability, HarnessId, Mode, Outcome, Selection,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { builtinRegistry } from "../agent-integrations/builtins.ts";
import type { HarnessIntegration, IntegrationRegistry } from "../agent-integrations/contracts.ts";
import { POLICY_CAPABILITIES } from "../agent-integrations/policy-readiness.ts";
import { configuredHarness } from "../agent-integrations/switch.ts";
import { getSetting } from "../settings/resolve.ts";

export type SelectWorkerInput = {
  explicit?: Selection; proposed?: Selection; fallback: Selection;
  enabled: HarnessId[]; mode: Mode; required: Capability[];
};
type DefaultedOption = "model" | "effort";
const DEFAULTED_OPTIONS: readonly DefaultedOption[] = ["model", "effort"];

export type SelectionDeps = {
  registry?: IntegrationRegistry;
  /** The value a launch fills an unset option with; the `agent.<harness>.<option>` setting when omitted. */
  launchDefault?: (harness: HarnessId, option: DefaultedOption) => string | undefined;
};
export type JobWorker = { selection: Selection; mode: Mode };
export type JobWorkerInput = Omit<SelectWorkerInput, "mode"> & {
  /** The mode the caller asked for; omitted, the first of WORKER_MODES that can run the job. */
  mode?: Mode;
  /** The job's latest attempt, which a request naming no selection retries. */
  persisted?: JobWorker;
  /** Options the shepherd named without a harness: they go to the persisted harness, else to a sole enabled, ready default. */
  proposedOptions?: AgentOptions;
  /** The caller's own account, taken only by a harness with an account option and a selection naming none. */
  callerAccount?: string;
};

/** A pane first: it is the one a person can watch. */
const WORKER_MODES: readonly Mode[] = ["herdr", "headless"];

const fail = <T>(code: "invalid" | "refused" | "not-ready" | "unsupported", message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The configured default harness: `agent.provider`, else Claude Code; its launch defaults are pinned when it is chosen. */
export function configuredWorkerSelection(): Selection {
  return { harness: configuredHarness() ?? "claude", options: {} };
}

function candidateOf(input: Pick<SelectWorkerInput, "explicit" | "proposed" | "fallback">): Selection {
  return input.explicit ?? input.proposed ?? input.fallback;
}

/** A Claude-style integration proves policy per session after bind, so its mode report never lists the policy capabilities. */
async function provesPolicyPerSession(integration: HarnessIntegration): Promise<boolean> {
  if (!integration.loadPolicy) return false;
  try {
    return (await integration.loadPolicy()).verifiesPerSession === true;
  } catch {
    return false;
  }
}

/** Readiness some harnesses only know once their sessions load (Codex connects to its app server then); a load failure shows as not ready. */
async function loadSessions(integration: HarnessIntegration): Promise<string | undefined> {
  try {
    await integration.loadSessions?.();
    return undefined;
  } catch (err) {
    return messageOf(err);
  }
}

/** Checks one selection as it stands; it is returned with the options the integration validated. */
export async function checkSelection(
  selection: Selection, input: Pick<SelectWorkerInput, "enabled" | "mode" | "required">, deps: SelectionDeps = {},
): Promise<Outcome<Selection>> {
  const registry = deps.registry ?? builtinRegistry();
  const integration = registry.get(selection.harness);
  if (!integration) {
    const known = registry.list().map((i) => i.id).join(", ");
    return fail("invalid", `no harness is registered as "${selection.harness}"; the registered ones are ${known}`);
  }
  if (!input.enabled.includes(integration.id)) {
    return fail("refused", `${integration.label} is not enabled on this machine, so it cannot run this job's worker`);
  }
  const options = integration.validateOptions(selection.options);
  if (!options.ok) return options;
  const loadError = await loadSessions(integration);
  if (loadError !== undefined) return fail("not-ready", `${integration.label} is not ready: ${loadError}`);
  let report;
  try {
    report = await integration.capabilities(input.mode);
  } catch (err) {
    return fail("not-ready", `${integration.label} is not ready: rt could not read its capabilities (${messageOf(err)})`);
  }
  if (!report.readiness.ready) {
    return fail("not-ready", `${integration.label} is not ready: ${report.readiness.reason ?? "it did not say why"}`);
  }
  const supported = new Set(report.supported);
  let missing = [...new Set(input.required)].filter((c) => !supported.has(c));
  if (missing.length > 0 && missing.every((c) => POLICY_CAPABILITIES.includes(c)) && await provesPolicyPerSession(integration)) missing = [];
  if (missing.length > 0) {
    return fail("unsupported", `${integration.label} cannot run a herd worker in ${input.mode} mode: it does not support ${missing.join(", ")}`);
  }
  return { ok: true, data: { harness: integration.id, options: options.data } };
}

/** The user's explicit assignment, then the shepherd's proposal, then the configured default; the chosen one is checked, never replaced. */
export async function selectWorker(input: SelectWorkerInput, deps: SelectionDeps = {}): Promise<Outcome<Selection>> {
  return checkSelection(candidateOf(input), input, deps);
}

/**
 * The worker for one spawn. A request naming no selection retries the job's
 * latest attempt in its recorded mode; anything else is a new selection. With
 * no mode asked, the first mode the chosen harness can run the job in wins,
 * and when none can, the reason given is the first mode's.
 */
export async function chooseJobWorker(input: JobWorkerInput, deps: SelectionDeps = {}): Promise<Outcome<JobWorker>> {
  const registry = deps.registry ?? builtinRegistry();
  if (input.persisted && !input.explicit && !input.proposed && !input.proposedOptions) {
    const mode = input.mode ?? input.persisted.mode;
    const checked = await checkSelection(input.persisted.selection, { ...input, mode }, deps);
    if (!checked.ok) return checked;
    return { ok: true, data: { selection: await withAccountHint(input.persisted.selection, input.callerAccount, registry), mode } };
  }
  let proposed = input.proposed;
  if (!proposed && input.proposedOptions) {
    let harness = input.persisted?.selection.harness;
    if (harness === undefined) {
      const sole = await soleReadyDefault(input.fallback.harness, input.enabled, registry);
      if (!sole.ok) return sole;
      harness = sole.data;
    }
    proposed = { harness, options: input.proposedOptions };
  }
  const modes = input.mode ? [input.mode] : WORKER_MODES;
  let first: Outcome<Selection> | undefined;
  for (const mode of modes) {
    const chosen = await selectWorker({ ...input, ...(proposed && { proposed }), mode }, deps);
    if (chosen.ok) {
      const resolved = withLaunchDefaults(chosen.data, deps.launchDefault ?? settingDefault);
      return { ok: true, data: { selection: await withAccountHint(resolved, input.callerAccount, registry), mode } };
    }
    first ??= chosen;
    if (chosen.error.code !== "unsupported") break;
  }
  if (!first || first.ok) return fail("invalid", "no mode was asked for this worker");
  return first;
}

/** What a launch would fill an unset option with; agent:start reads the same `agent.<harness>.<option>` settings. */
function settingDefault(harness: HarnessId, option: DefaultedOption): string | undefined {
  try {
    return getSetting<string>(`agent.${harness}.${option}`).value ?? undefined;
  } catch {
    return undefined;
  }
}

/** Pinned into the selection before it is recorded, so a retry launches what the first attempt did even after a default changes. */
function withLaunchDefaults(selection: Selection, read: (harness: HarnessId, option: DefaultedOption) => string | undefined): Selection {
  const options = { ...selection.options };
  for (const option of DEFAULTED_OPTIONS) {
    if (options[option] !== undefined) continue;
    const value = read(selection.harness, option);
    if (value !== undefined) options[option] = value;
  }
  return { harness: selection.harness, options };
}

/** The caller's account applies only to a harness that takes an account option, and never over one already chosen. */
async function withAccountHint(selection: Selection, account: string | undefined, registry: IntegrationRegistry): Promise<Selection> {
  if (account === undefined || selection.options.account !== undefined) return selection;
  let takesAccount = false;
  try {
    takesAccount = (await registry.get(selection.harness)?.options())?.some((o) => o.name === "account") === true;
  } catch {
    takesAccount = false;
  }
  return takesAccount ? { harness: selection.harness, options: { ...selection.options, account } } : selection;
}

/** Options that name no harness go to the configured default only when it is the one harness that could take them. */
async function soleReadyDefault(fallback: HarnessId, enabled: HarnessId[], registry: IntegrationRegistry): Promise<Outcome<HarnessId>> {
  const ready: HarnessId[] = [];
  for (const id of enabled) {
    const integration = registry.get(id);
    if (!integration || (await loadSessions(integration)) !== undefined) continue;
    try {
      if ((await integration.capabilities(WORKER_MODES[0]!)).readiness.ready) ready.push(id);
    } catch {
      // An integration whose capabilities cannot be read is not ready.
    }
  }
  if (ready.length === 1 && ready[0] === fallback) return { ok: true, data: fallback };
  const which = ready.length > 0 ? ready.join(", ") : "none";
  return fail("invalid", `these worker options name no harness, and the default (${fallback}) is not the only enabled, ready harness (enabled and ready: ${which}); name the harness for this job`);
}

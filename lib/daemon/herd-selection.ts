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
  Capability, HarnessId, Mode, Outcome, Selection,
} from "../../packages/rt-client/src/agent-integrations.ts";
import { builtinRegistry } from "../agent-integrations/builtins.ts";
import type { HarnessIntegration, IntegrationRegistry } from "../agent-integrations/contracts.ts";
import { POLICY_CAPABILITIES } from "../agent-integrations/policy-readiness.ts";
import { configuredHarness } from "../agent-integrations/switch.ts";

export type SelectWorkerInput = {
  explicit?: Selection; proposed?: Selection; fallback: Selection;
  enabled: HarnessId[]; mode: Mode; required: Capability[];
};
export type SelectionDeps = { registry?: IntegrationRegistry };
export type JobWorker = { selection: Selection; mode: Mode };
export type JobWorkerInput = Omit<SelectWorkerInput, "mode"> & {
  /** The mode the caller asked for; omitted, the first of WORKER_MODES that can run the job. */
  mode?: Mode;
  /** The job's latest attempt, which a request naming no selection retries. */
  persisted?: JobWorker;
};

/** A pane first: it is the one a person can watch. */
const WORKER_MODES: readonly Mode[] = ["herdr", "headless"];

const fail = <T>(code: "invalid" | "refused" | "not-ready" | "unsupported", message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The configured default worker: `agent.provider`, else Claude Code, with the options its launch settings supply. */
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
  if (input.persisted && !input.explicit && !input.proposed) {
    const mode = input.mode ?? input.persisted.mode;
    const checked = await checkSelection(input.persisted.selection, { ...input, mode }, deps);
    return checked.ok ? { ok: true, data: { selection: input.persisted.selection, mode } } : checked;
  }
  const modes = input.mode ? [input.mode] : WORKER_MODES;
  let first: Outcome<Selection> | undefined;
  for (const mode of modes) {
    const chosen = await selectWorker({ ...input, mode }, deps);
    if (chosen.ok) return { ok: true, data: { selection: chosen.data, mode } };
    first ??= chosen;
    if (chosen.error.code !== "unsupported") break;
  }
  return first as Outcome<JobWorker>;
}

/**
 * Composes setup from the enabled harnesses. Each harness's install adapter
 * owns its steps; the shared registry keeps their order and the shared
 * required and finish-gated rules. With the integrations switch off the
 * registry runs exactly as it always has.
 */

import type { HarnessId } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createClaudeInstall, claudeInstall } from "../../agent-integrations/claude/install.ts";
import { createCodexInstall, codexInstall } from "../../agent-integrations/codex/install.ts";
import type { HarnessInstall, InstallAdapter } from "../../agent-integrations/install.ts";
import { writeIntegrationChoice, type IntegrationChoice } from "../../agent-integrations/preferences.ts";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import { STEP_IDS } from "../contract.ts";
import type { IntegrationSelection } from "../integration-selection.ts";

export const HARNESS_INSTALLS: readonly HarnessInstall[] = [claudeInstall, codexInstall];

const ADAPTERS: Record<string, () => InstallAdapter> = { claude: createClaudeInstall, codex: createCodexInstall };

const byContractOrder = (a: StepDef, b: StepDef): number => STEP_IDS.indexOf(a.id) - STEP_IDS.indexOf(b.id);

/** The enabled harnesses' own steps, each once, in contract order; an id with no install adapter adds none. */
export function createIntegrationSteps(enabled: HarnessId[]): StepDef[] {
  const steps = new Map<string, StepDef>();
  for (const id of enabled) {
    for (const step of Object.hasOwn(ADAPTERS, id) ? ADAPTERS[id]!().steps() : []) steps.set(step.id, step);
  }
  return [...steps.values()].sort(byContractOrder);
}

const ownedStepIds = (): Set<string> => new Set(Object.values(ADAPTERS).flatMap((make) => make().steps().map((s) => s.id)));

/** `base` unchanged with the switch off; otherwise its shared steps plus only the enabled harnesses' own. */
export function setupSteps(base: StepDef[], selection: IntegrationSelection): StepDef[] {
  if (!selection.switchOn) return base;
  const owned = ownedStepIds();
  const wanted = new Set(createIntegrationSteps(selection.enabled).map((s) => s.id));
  return base.filter((s) => !owned.has(s.id) || wanted.has(s.id));
}

/**
 * Setup's write of the member's harness choice. A refusal and a store that
 * cannot be read both come back as a failed outcome with a way forward,
 * never a crash.
 */
export function recordIntegrationChoice(
  choice: IntegrationChoice,
  scope: "user" | "machine",
  write: (choice: IntegrationChoice, scope: "user" | "machine") => Outcome<void> = writeIntegrationChoice,
): StepOutcome {
  let written: Outcome<void>;
  try {
    written = write(choice, scope);
  } catch (err) {
    return {
      state: "failed",
      detail: `Your integration choice was not saved: ${err instanceof Error ? err.message : String(err)}`,
      remedy: "Fix the settings file it names, then choose again.",
    };
  }
  if (written.ok) return { state: "done", detail: choice.enabled.length === 0 ? "No integration is turned on" : `Turned on ${choice.enabled.join(", ")}` };
  return { state: "failed", detail: written.error.message, remedy: "Change your choice, then choose again." };
}

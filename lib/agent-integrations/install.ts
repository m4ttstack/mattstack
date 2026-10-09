import type { HarnessId, Outcome, Readiness } from "../../packages/rt-client/src/agent-integrations.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../setup/apply.ts";

export type LifecycleMode = "update" | "restore" | "uninstall";

// Kept apart from contracts.ts: the daemon reaches the runtime contract, and
// even a type-only edge to setup couples it to the CLI chain (no-eager-tui).
export interface InstallAdapter {
  steps(): StepDef[];
  verify(): Promise<Outcome<Readiness>>;
  /**
   * `update` re-runs the update-safe steps as `rt setup update` does;
   * `restore` runs every step as Install does; `uninstall` takes back what
   * the harness's ownership records say rt wrote, each only while it is
   * still exactly what rt wrote.
   */
  reconcile(mode: LifecycleMode, context: ApplyContext): Promise<StepOutcome[]>;
}
/** Setup composes these by harness ID; there is no installation capability in the shared vocabulary. */
export type HarnessInstall = { readonly id: HarnessId; loadInstall(): Promise<InstallAdapter> };

/** One outcome per step that runs in `mode`, in order. */
export async function runAdapterSteps(steps: StepDef[], mode: "update" | "restore", context: ApplyContext): Promise<StepOutcome[]> {
  const { update: _update, ...install } = context;
  const ctx: ApplyContext = mode === "update" ? { ...install, update: true } : install;
  const outcomes: StepOutcome[] = [];
  for (const step of steps) {
    if (mode === "update" && !step.updateSafe) continue;
    outcomes.push(await step.run(ctx));
  }
  return outcomes;
}

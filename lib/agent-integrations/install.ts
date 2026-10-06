import type { HarnessId, Outcome, Readiness } from "../../packages/rt-client/src/agent-integrations.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../setup/apply.ts";

// Kept apart from contracts.ts: the daemon reaches the runtime contract, and
// even a type-only edge to setup couples it to the CLI chain (no-eager-tui).
export interface InstallAdapter {
  steps(): StepDef[];
  verify(): Promise<Outcome<Readiness>>;
  reconcile(mode: "update" | "restore" | "uninstall", context: ApplyContext): Promise<StepOutcome[]>;
}
/** Setup composes these by harness ID; there is no installation capability in the shared vocabulary. */
export type HarnessInstall = { readonly id: HarnessId; loadInstall(): Promise<InstallAdapter> };

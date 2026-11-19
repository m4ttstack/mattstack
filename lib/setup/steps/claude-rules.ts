import { claudeRulesDetail, reconcileClaudeRules } from "../../claude-rules/reconcile.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import { toFailedOutcome } from "./step-utils.ts";

async function run(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return { state: "done", detail: claudeRulesDetail(await reconcileClaudeRules(ctx.p)) };
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const claudeRulesStep: StepDef = {
  id: "claude.rules",
  title: "Link the shared Claude rules",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run,
};

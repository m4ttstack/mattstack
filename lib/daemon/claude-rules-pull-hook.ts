/**
 * Runs after a team pull moved the clone: rewrites the shared Claude rules
 * folder, so a newly published pack rule, a join or a leave reaches every
 * Claude session on this Mac without a setup run.
 */
import type { Logger } from "pino";
import type { reconcileClaudeRules } from "../claude-rules/reconcile.ts";
import { createRealProbes, type Probes } from "../setup/probes.ts";

export interface ClaudeRulesPullHookDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  probes?: Probes;
  reconcile?: typeof reconcileClaudeRules;
}

/** The returned hook never throws: a failed reconcile must not fail the pull that drove it. */
export function createClaudeRulesPullHook(deps: ClaudeRulesPullHookDeps): (slug: string) => Promise<void> {
  return async (slug) => {
    try {
      // Loaded on first use, like materialize: the reconcile reaches the team and setup graph, which the daemon must not load at boot.
      const mod = await import("../claude-rules/reconcile.ts");
      const result = await (deps.reconcile ?? mod.reconcileClaudeRules)(deps.probes ?? createRealProbes());
      const changed = result.packs.some((pk) => pk.state !== "ok");
      deps.log[changed ? "info" : "debug"]({ team: slug, detail: mod.claudeRulesDetail(result) }, "team pull: shared Claude rules reconciled");
    } catch (err) {
      deps.log.warn({ err, team: slug }, "team pull moved the clone, but linking the shared Claude rules failed; run rt setup apply --only claude.rules");
    }
  };
}

/**
 * Runs after a team pull moved the clone: rewrites every registered repo's
 * per-pack bindings from what the clone holds now, so a pulled pack edit, a
 * changed project list or the org layout conversion reaches the board
 * without a launch. Idempotent, a file walk plus a few JSON writes.
 */
import type { Logger } from "pino";
import { createRealProbes, type Probes } from "../setup/probes.ts";

export interface MaterializePullHookDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  probes?: Probes;
  materialize?: typeof import("../setup/skills-materialize.ts").materializeSkills;
}

/** The returned hook never throws: a failed materialize must not fail the pull that drove it. */
export function createMaterializePullHook(deps: MaterializePullHookDeps): (slug: string) => Promise<void> {
  return async (slug) => {
    try {
      // Loaded on first use: skills-materialize reaches the CLI repo-arg chain, which the daemon graph must not load at boot (no-eager-tui).
      const mod = await import("../setup/skills-materialize.ts");
      const materialize = deps.materialize ?? mod.materializeSkills;
      const result = await materialize(deps.probes ?? createRealProbes(), {});
      if (result.skipped) {
        deps.log.debug({ team: slug, reason: result.reason }, "team pull: skills not materialized");
        return;
      }
      for (const repo of result.repos.filter((r) => !r.ok && !r.noManifest)) {
        deps.log.warn({ team: slug, repo: repo.name, detail: repo.detail }, "team pull: materialize failed for a repo");
      }
      const wrote = result.repos.flatMap((r) => r.packs ?? []).some((pk) => pk.ok) || result.repos.some((r) => (r.pruned?.length ?? 0) > 0);
      const level = wrote ? "info" : "debug";
      deps.log[level]({ team: slug, tally: mod.materializeTally(result.repos) }, "team pull: skills materialized");
    } catch (err) {
      deps.log.warn({ err, team: slug }, "team pull moved the clone, but materializing skills failed; run rt skills materialize");
    }
  };
}

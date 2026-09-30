/**
 * Runs after a team settings pull moves a team clone: when the intercept
 * rules the settings now declare differ from the cached rules the shims were
 * installed from, reinstall the shims. When they match, nothing is written.
 */

import type { Logger } from "pino";
import {
  buildInterceptRules,
  installShims,
  loadInterceptRules,
  type InterceptRule,
} from "../endpoint/shim.ts";

export interface InterceptPullHookDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  loadInterceptRules?: () => InterceptRule[];
  buildInterceptRules?: () => Promise<InterceptRule[]>;
  installShims?: typeof installShims;
}

function rulesKey(rules: InterceptRule[]): string {
  return JSON.stringify(
    rules
      .map((r) => ({ command: r.command, repo: r.repo, repoRemote: r.repoRemote, matches: r.matches }))
      .sort((a, b) => `${a.command} ${a.repo}`.localeCompare(`${b.command} ${b.repo}`)),
  );
}

/** The returned hook never throws: a failed reinstall must not fail the pull that drove it. */
export function createInterceptPullHook(deps: InterceptPullHookDeps): (slug: string) => Promise<void> {
  const cached = deps.loadInterceptRules ?? loadInterceptRules;
  const build = deps.buildInterceptRules ?? buildInterceptRules;
  const install = deps.installShims ?? installShims;

  return async (slug) => {
    try {
      if (rulesKey(await build()) === rulesKey(cached())) {
        deps.log.debug({ team: slug }, "intercept rules unchanged by the pull");
        return;
      }
      const result = await install();
      deps.log.info(
        { team: slug, installed: result.installed, current: result.current, skipped: result.skipped, rules: result.rules },
        "team pull changed the intercept rules; reinstalled shims",
      );
    } catch (err) {
      deps.log.warn({ err, team: slug }, "team pull changed the intercept rules, but reinstalling shims failed; run rt intercept install");
    }
  };
}

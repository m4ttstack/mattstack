import type { Logger } from "pino";
import { createClaudeRulesPullHook } from "./claude-rules-pull-hook.ts";
import { createInterceptPullHook } from "./intercept-pull-hook.ts";
import { createMaterializePullHook } from "./materialize-pull-hook.ts";
import { createRenderPullHook } from "./render-pull-hook.ts";

type PullHook = (slug: string) => Promise<void>;
type HookLog = Pick<Logger, "debug" | "info" | "warn">;

const DEFAULT_MAKERS = {
  intercepts: (log: HookLog): PullHook => createInterceptPullHook({ log }),
  materialize: (log: HookLog): PullHook => createMaterializePullHook({ log }),
  render: (log: HookLog): PullHook => createRenderPullHook({ log }),
  claudeRules: (log: HookLog): PullHook => createClaudeRulesPullHook({ log }),
};

/** What runs after a team pull, in order. */
export function teamPullHooks(childLogger: (name: string) => HookLog, toolNotices: PullHook, make: typeof DEFAULT_MAKERS = DEFAULT_MAKERS): PullHook[] {
  return [make.intercepts(childLogger("intercepts")), make.materialize(childLogger("materialize")), make.render(childLogger("render")), make.claudeRules(childLogger("claude-rules")), toolNotices];
}

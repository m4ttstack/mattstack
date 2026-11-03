/** Runs after a team pull moved the clone: tells the member once about a tool their team newly requires. */
import type { Logger } from "pino";
import { notifyEnabled } from "../notifier.ts";
import { createRealProbes, type Probes } from "../setup/probes.ts";

export interface ToolNoticePullHookDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  probes?: Probes;
  send?: typeof notifyEnabled;
}

/** The returned hook never throws: a failed notice must not fail the pull that drove it. */
export function createToolNoticePullHook(deps: ToolNoticePullHookDeps): (slug: string) => Promise<void> {
  const send = deps.send ?? notifyEnabled;
  return async (slug) => {
    try {
      // Loaded on first use: the setup chain must stay out of the daemon graph at boot (no-eager-tui).
      const [{ runToolNotices }, { SETUP_UPDATE_CATEGORY }] = await Promise.all([import("../setup/tool-notices.ts"), import("../setup/update.ts")]);
      await runToolNotices(deps.probes ?? createRealProbes(), slug, (title, message, id) => {
        send(SETUP_UPDATE_CATEGORY, title, message, undefined, undefined, id);
      });
    } catch (err) {
      deps.log.warn({ err, team: slug }, "team pull moved the clone, but the required-tool notice failed; the next pull tries again");
    }
  };
}

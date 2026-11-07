/**
 * lib/slack/support-pane.ts: closing the herdr pane of a support agent.
 */

import type { Logger } from "pino";
import { parsePaneRef } from "../../packages/rt-client/src/index.ts";
import { defaultHerdrRunner, type HerdrRunner } from "../agent-herdr.ts";
import { bgSocketPath } from "../daemon/bg-service.ts";

export type SupportPaneDeps = {
  herdrRunnerFor(socket: string | null): HerdrRunner;
  log: Pick<Logger, "warn">;
};

export function realHerdrRunnerFor(socket: string | null): HerdrRunner {
  return defaultHerdrRunner(socket ? { ...process.env, HERDR_SOCKET_PATH: socket } : process.env);
}

/** Never throws: a pane that cannot be closed must not block the close's own bookkeeping. */
export async function closeSupportPane(deps: SupportPaneDeps, pane: string | null): Promise<boolean> {
  if (!pane) return false;
  try {
    // The row stores the addressable ref, bg:-prefixed for a background pane; herdr only knows the bare id.
    const ref = parsePaneRef(pane);
    const r = await deps.herdrRunnerFor(ref.server === "bg" ? bgSocketPath() : null)(["pane", "close", ref.paneId]);
    if (r.exitCode === 0) return true;
    deps.log.warn({ pane, exitCode: r.exitCode }, "slack: support pane close failed");
  } catch (err) {
    deps.log.warn({ err, pane }, "slack: support pane close threw");
  }
  return false;
}

/**
 * The dev Mac's hourly look for a new release. The update itself runs in a
 * detached `rt dev update --auto` child: its last step swaps the app, which
 * restarts this daemon, so it must not be this daemon's work.
 */
import type { Logger } from "pino";

export const DEV_UPDATE_SCHEDULE = { bootDelayMs: 5 * 60_000, intervalMs: 60 * 60_000 };

export interface DevUpdateSweepDeps {
  flavor(): "dev" | "prod";
  autoUpdateOn(): boolean;
  /** Starts `rt dev update --auto --json` detached, in its own process group, and resolves once it has started. */
  spawnUpdate(): Promise<void>;
  /** Records the Mac as turned off by its org, for the version ping. */
  markOff(): void;
  log: Pick<Logger, "warn" | "info">;
}

export function createDevUpdateSweep(deps: DevUpdateSweepDeps): () => Promise<void> {
  let running = false;
  return async () => {
    if (running || deps.flavor() !== "dev") return;
    running = true;
    try {
      if (!deps.autoUpdateOn()) {
        deps.markOff();
        return;
      }
      await deps.spawnUpdate();
      deps.log.info({ sweep: "dev-auto-update" }, "started rt dev update --auto");
    } catch (err) {
      deps.log.warn({ err, sweep: "dev-auto-update" }, "dev update check failed");
    } finally {
      running = false;
    }
  };
}

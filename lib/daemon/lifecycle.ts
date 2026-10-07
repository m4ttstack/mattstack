import type { Logger } from "pino";

export interface DaemonUnit {
  name: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
}

export async function runUnits(units: DaemonUnit[], log: Logger): Promise<void> {
  const started: DaemonUnit[] = [];
  for (const u of units) {
    try {
      await u.start();
      started.push(u);
    } catch (err) {
      await stopUnits(started, log);
      throw err;
    }
  }
}

export async function stopUnits(units: DaemonUnit[], log: Logger): Promise<void> {
  for (const u of [...units].reverse()) {
    try {
      await u.stop();
    } catch (err) {
      log.warn({ err, unit: u.name }, "daemon unit stop failed");
    }
  }
}

/**
 * A unit whose work runs in the background once it starts, so boot never
 * waits on it. Stop aborts `controller` and waits for the work to settle, so
 * the units stopped after it (the state database) outlive it. Other work that
 * shares the controller's signal is cancelled with it.
 */
export function backgroundUnit(
  name: string, controller: AbortController, run: (signal: AbortSignal) => Promise<void>, onError: (err: unknown) => void,
): DaemonUnit {
  let running: Promise<void> | undefined;
  return {
    name,
    start() {
      running = run(controller.signal).catch(onError);
    },
    async stop() {
      controller.abort();
      await running;
    },
  };
}

/**
 * The daemon's version-ping tick: decides whether this Mac owes the relay a
 * ping and sends it. Nothing here ever reaches a person; a failure is a
 * debug line and the next tick tries again.
 */

import type { Logger } from "pino";
import type { PingVersions, TelemetryPing } from "./ping.ts";

/** Under the relay's 60 minute "running" window, so tick jitter never lets a live Mac lapse. */
const RESEND_AFTER_MS = 50 * 60_000;

export interface TickDeps {
  enabled(): boolean;
  versions(): Promise<PingVersions>;
  collect(): Promise<TelemetryPing>;
  token(): Promise<string | null>;
  /** The HTTP status; 0 means the relay was unreachable. */
  post(url: string, body: string, token: string | null): Promise<number>;
  url(): string;
  now(): number;
  log: Logger;
}

interface LastSent {
  at: number;
  versions: PingVersions;
}

export function makeTelemetryTick(deps: TickDeps): () => Promise<void> {
  let last: LastSent | null = null;
  let inFlight = false;

  async function run(): Promise<void> {
    if (!deps.enabled()) return;
    const versions = await deps.versions();
    const now = deps.now();
    const unchanged = last !== null && last.versions.appVersion === versions.appVersion && last.versions.rtVersion === versions.rtVersion;
    if (last !== null && unchanged && now - last.at < RESEND_AFTER_MS) return;

    const ping = await deps.collect();
    const token = await deps.token();
    const status = await deps.post(deps.url(), JSON.stringify(ping), token);
    if (status >= 200 && status < 300) {
      last = { at: now, versions };
      return;
    }
    deps.log.debug({ status }, "telemetry ping not accepted");
  }

  return async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await run();
    } catch (err) {
      deps.log.debug({ err }, "telemetry tick failed");
    } finally {
      inFlight = false;
    }
  };
}
